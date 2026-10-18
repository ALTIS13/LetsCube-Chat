import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

import {
  REQUEST_DEADLINE_MS,
  STRANDED_AFTER_MS,
  cutError,
  deadlineFor,
  requestKind,
  strandedByNetworkChange,
} from "../../artifacts/kub/src/lib/supabase/requestDeadline.ts";
import { createDeadlineFetch } from "../../artifacts/kub/src/lib/supabase/deadlineFetch.ts";
import { ANSWER_MS, createRealtimeRevival } from "../../artifacts/kub/src/lib/realtimeRevival.ts";

/**
 * Tracker item 53: «Если меняется IP… приходится перезапускать мессенджер».
 * A VPN switched off to open another app left the application dead until a
 * restart. No request had a deadline, the chat list queues every refresh behind
 * the one in flight, and a socket whose TCP connection vanished looked open for
 * up to fifty seconds. These are the rules that replace the restart.
 */

const API = "https://core.example.test";

// ── which requests, how long ──────────────────────────────────────────────

test("reads, writes and transfers are told apart by path and verb", () => {
  assert.equal(requestKind(`${API}/rest/v1/chat_members?select=*`, "GET"), "read");
  assert.equal(requestKind(`${API}/rest/v1/chat_members?select=*`, undefined), "read");
  assert.equal(requestKind(`${API}/rest/v1/chat_members`, "head"), "read");
  assert.equal(requestKind(`${API}/rest/v1/messages`, "POST"), "write");
  assert.equal(requestKind(`${API}/rest/v1/rpc/chat_list_summaries`, "POST"), "write");
  assert.equal(requestKind(`${API}/auth/v1/token?grant_type=refresh_token`, "POST"), "write");
  // A file on a slow line may take minutes: no deadline, and never cut.
  assert.equal(requestKind(`${API}/storage/v1/object/media/a/b.webm`, "POST"), "transfer");
  assert.equal(requestKind(`${API}/storage/v1/object/sign/media/a.jpg`, "GET"), "transfer");
});

test("everything but a transfer has a deadline, and a transfer has none", () => {
  assert.equal(deadlineFor("read"), REQUEST_DEADLINE_MS);
  assert.equal(deadlineFor("write"), REQUEST_DEADLINE_MS);
  assert.equal(deadlineFor("transfer"), null);
});

test("a network change strands only reads that were already waiting", () => {
  assert.equal(strandedByNetworkChange("read", 0, STRANDED_AFTER_MS), true);
  assert.equal(strandedByNetworkChange("read", 0, STRANDED_AFTER_MS - 1), false, "one sent after the change is the new route's");
  assert.equal(strandedByNetworkChange("write", 0, 60_000), false, "a write is never cut mid-flight");
  assert.equal(strandedByNetworkChange("transfer", 0, 60_000), false);
});

test("a cut fails exactly as a dropped connection does", () => {
  const error = cutError("deadline");
  // What PostgREST's client, `mapPgError`, the upload rule and the auth
  // client's retry all recognise as the network's.
  assert.ok(error instanceof TypeError);
  assert.equal(error.message, "Failed to fetch");
  assert.equal((error as TypeError & { kubCut?: string }).kubCut, "deadline");
});

// ── the fetch ─────────────────────────────────────────────────────────────

type Timer = { at: number; run: () => void; cleared: boolean };

function harness() {
  let clock = 0;
  const timers: Timer[] = [];
  const calls: { url: string; signal: AbortSignal }[] = [];
  const hanging = (url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      calls.push({ url, signal: init!.signal! });
      init!.signal!.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
    });
  const fetcher = createDeadlineFetch(
    ((input: RequestInfo | URL, init?: RequestInit) => hanging(String(input), init)) as typeof fetch,
    () => clock,
    {
      set: (run, ms) => {
        const timer = { at: clock + ms, run, cleared: false };
        timers.push(timer);
        return timer;
      },
      clear: (handle) => {
        (handle as Timer).cleared = true;
      },
    },
  );
  const advance = (ms: number) => {
    clock += ms;
    for (const timer of timers) {
      if (!timer.cleared && timer.at <= clock) {
        timer.cleared = true;
        timer.run();
      }
    }
  };
  return { fetcher, calls, advance };
}

test("a request nobody answers ends at its deadline, as a network failure", async () => {
  const { fetcher, advance } = harness();
  const pending = fetcher(`${API}/rest/v1/chat_members?select=*`, { method: "GET" });
  const outcome = pending.then(() => "resolved", (error: unknown) => error);
  advance(REQUEST_DEADLINE_MS - 1);
  assert.equal(fetcher.waiting(), 1, "cut before its deadline");
  advance(1);
  const error = await outcome;
  // Rewritten from the engine's AbortError: an engine that ignores the abort
  // reason would otherwise report a cut as something else.
  assert.ok(error instanceof TypeError, `a cut surfaced as ${String(error)}`);
  assert.equal((error as TypeError & { kubCut?: string }).kubCut, "deadline");
  assert.equal(fetcher.waiting(), 0);
});

test("a network change cuts the stranded reads and leaves writes and fresh reads alone", async () => {
  const { fetcher, advance } = harness();
  const stranded = fetcher(`${API}/rest/v1/chat_members?select=*`, { method: "GET" }).catch((error: unknown) => error);
  const write = fetcher(`${API}/rest/v1/messages`, { method: "POST" }).catch((error: unknown) => error);
  advance(STRANDED_AFTER_MS);
  const fresh = fetcher(`${API}/rest/v1/messages?select=*`, { method: "GET" }).catch((error: unknown) => error);

  assert.equal(fetcher.cutStrandedReads(), 1);
  const cut = await stranded;
  assert.ok(cut instanceof TypeError);
  assert.equal((cut as TypeError & { kubCut?: string }).kubCut, "network-change");
  assert.equal(fetcher.waiting(), 2, "the write or the fresh read was cut too");

  // Both still end at their deadlines rather than hanging for ever.
  advance(REQUEST_DEADLINE_MS);
  assert.ok((await write) instanceof TypeError);
  assert.ok((await fresh) instanceof TypeError);
  assert.equal(fetcher.waiting(), 0);
});

test("a caller's own cancellation stays the caller's, not the network's", async () => {
  const { fetcher } = harness();
  const caller = new AbortController();
  const pending = fetcher(`${API}/rest/v1/chat_members?select=*`, { method: "GET", signal: caller.signal }).catch(
    (error: unknown) => error,
  );
  caller.abort();
  const error = await pending;
  assert.ok(error instanceof DOMException, `a cancellation was reported as ${String(error)}`);
  assert.equal((error as DOMException).name, "AbortError");
  assert.equal(fetcher.waiting(), 0);
});

test("a transfer is never cut, by a deadline or by a change", async () => {
  const { fetcher, advance } = harness();
  void fetcher(`${API}/storage/v1/object/media/a/b.webm`, { method: "POST" }).catch(() => undefined);
  advance(10 * REQUEST_DEADLINE_MS);
  assert.equal(fetcher.cutStrandedReads(), 0);
  assert.equal(fetcher.waiting(), 1);
});

// ── the socket ────────────────────────────────────────────────────────────

function socketHarness({ connected = true }: { connected?: boolean } = {}) {
  const state = { connected, connects: 0, beats: 0, replaced: 0 };
  let pending: (() => void) | null = null;
  const revival = createRealtimeRevival(
    {
      isConnected: () => state.connected,
      connect: () => {
        state.connects += 1;
      },
      sendHeartbeat: () => {
        state.beats += 1;
      },
    },
    {
      onReplaced: () => {
        state.replaced += 1;
      },
      timers: {
        set: (run, ms) => {
          assert.equal(ms, ANSWER_MS);
          pending = run;
          return run;
        },
        clear: () => {
          pending = null;
        },
      },
    },
  );
  const elapse = () => {
    const run = pending;
    pending = null;
    run?.();
  };
  return { revival, state, elapse };
}

test("a live socket answers the probe and is left alone", () => {
  const { revival, state, elapse } = socketHarness();
  assert.equal(revival.doubt(), "probe");
  assert.equal(state.beats, 1);
  revival.heartbeat("ok");
  elapse();
  assert.equal(state.beats, 1, "a second beat went out to a socket that answered");
  assert.equal(state.replaced, 0);
});

test("a stranded socket is replaced by phoenix's own timeout, started now instead of in fifty seconds", () => {
  const { revival, state, elapse } = socketHarness();
  revival.doubt();
  revival.heartbeat("sent");
  elapse();
  // The second beat with the first unanswered is phoenix's heartbeat timeout:
  // teardown, the channels errored so they rejoin, and a reconnect.
  assert.equal(state.beats, 2);
  assert.equal(state.replaced, 1);
});

test("doubts that arrive together make one probe", () => {
  const { revival, state } = socketHarness();
  assert.equal(revival.doubt(), "probe");
  assert.equal(revival.doubt(), "probing");
  assert.equal(revival.doubt(), "probing");
  assert.equal(state.beats, 1);
});

test("a socket that already knows it is closed is opened rather than probed", () => {
  const { revival, state } = socketHarness({ connected: false });
  assert.equal(revival.doubt(), "connect");
  assert.equal(state.connects, 1);
  assert.equal(state.beats, 0);
});

test("a handshake that never finishes is dropped before it is opened again", async () => {
  // realtime-js 2.105.1 `RealtimeClient.connect` returns while `isConnecting()`.
  // phoenix 0.4.1 `Socket.connect` returns while `conn` exists. A handshake
  // left on the route that just died therefore stays until the browser gives
  // up, and a probe is never sent because the socket is not open. `disconnect`
  // finishes on a later turn; `connect` during that turn is refused too.
  const state = {
    phase: "connecting" as "connecting" | "disconnecting" | "closed" | "open",
    disconnects: 0,
    connects: 0,
    connectsWhileBusy: 0,
    beats: 0,
  };
  const revival = createRealtimeRevival({
    isConnected: () => state.phase === "open",
    isConnecting: () => state.phase === "connecting",
    disconnect: () =>
      new Promise<void>((resolve) => {
        state.disconnects += 1;
        state.phase = "disconnecting";
        queueMicrotask(() => {
          state.phase = "closed";
          resolve();
        });
      }),
    connect: () => {
      if (state.phase !== "closed") {
        state.connectsWhileBusy += 1;
        return;
      }
      state.connects += 1;
      state.phase = "connecting";
    },
    sendHeartbeat: () => {
      state.beats += 1;
    },
  });

  assert.equal(revival.doubt(), "connect");
  assert.equal(state.beats, 0, "a stuck handshake was probed");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.disconnects, 1);
  assert.equal(state.connectsWhileBusy, 0, "connect() ran while the old handshake was still held");
  assert.equal(state.connects, 1);
  assert.equal(state.phase, "connecting");
});

test("a socket that closed while the probe waited is not beaten again", () => {
  const { revival, state, elapse } = socketHarness();
  revival.doubt();
  state.connected = false;
  elapse();
  assert.equal(state.beats, 1);
  assert.equal(state.replaced, 0);
});

function pendingDisconnect() {
  let finish!: () => void;
  const dropped = new Promise<void>((resolve) => { finish = resolve; });
  const state = { phase: "connecting", drops: 0, connects: 0 };
  const revival = createRealtimeRevival({
    isConnected: () => state.phase === "open",
    isConnecting: () => state.phase === "connecting",
    disconnect: () => {
      state.drops += 1;
      state.phase = "disconnecting";
      return dropped;
    },
    connect: () => { state.connects += 1; state.phase = "connecting"; },
    sendHeartbeat: () => assert.fail("a closed socket must not be probed"),
  });
  return { revival, state, finish: () => { state.phase = "closed"; finish(); } };
}

test("a disposed revival cannot reconnect after its held disconnect completes", async () => {
  const { revival, state, finish } = pendingDisconnect();
  revival.doubt();
  assert.equal(state.drops, 1, "disconnect positive control");
  revival.dispose();
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.connects, 0, "retired recovery reopened the shared socket");
  revival.doubt();
  assert.equal(state.connects, 0, "a queued signal revived a disposed owner");
});

test("doubts during a held disconnect join one recovery without connecting early", async () => {
  const { revival, state, finish } = pendingDisconnect();
  revival.doubt();
  revival.doubt();
  revival.doubt();
  assert.equal(state.drops, 1);
  assert.equal(state.connects, 0, "connect ran before disconnect settled");
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.connects, 1, "one settled recovery opens once");
});

for (const failure of ["disconnect", "connect"]) {
  test(`a rejected recovery at ${failure} is handled and a later doubt can retry`, () => {
    // A separate process makes an unhandled rejection an observable failure
    // without leaking it into node:test's other lifecycle scenarios.
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { createRealtimeRevival } from ${JSON.stringify(new URL("../../artifacts/kub/src/lib/realtimeRevival.ts", import.meta.url).href)};
      const errors = [];
      process.on("unhandledRejection", (error) => errors.push(error));
      let fail = true, connects = 0;
      const revival = createRealtimeRevival({
        isConnected: () => false,
        isConnecting: () => true,
        disconnect: () => ${failure === "disconnect" ? 'fail ? Promise.reject(new Error("fictional disconnect failure")) : Promise.resolve()' : "Promise.resolve()"},
        connect: () => { if (fail) throw new Error("fictional connect failure"); connects += 1; },
        sendHeartbeat() {},
      });
      revival.doubt();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(errors.length, 0, "recovery leaked an unhandled rejection");
      assert.equal(connects, 0);
      fail = false;
      revival.doubt();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(connects, 1, "failed recovery must release the next doubt");
      revival.dispose();
    `], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  });
}
