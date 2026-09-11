import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { renderServiceWorker } from "../../artifacts/kub/src/lib/pwa/serviceWorkerBuild.ts";
import {
  KUB_SW_HANDOFF_MESSAGE,
  KUB_SW_HANDOFF_RESULT,
  nextHandoffDelay,
  pageEntryPath,
  parseHandoffResult,
  requestHandoff,
  shouldAnnounceWaitingWorker,
} from "../../artifacts/kub/src/lib/pwa/serviceWorkerHandoff.ts";

/**
 * A waiting worker must not ask a page to update to the build it already runs.
 *
 * Once every deploy installs a new worker (see pwa-service-worker-build), the
 * worker waits behind the previous one, and the page that just loaded the new
 * build from the network — every first launch after a deploy — would otherwise
 * be told "Доступно обновление" and reloaded for nothing. These cases pin the
 * page's half of the agreement, and then both halves together through a real
 * MessageChannel against the real worker, so neither side can rename or reshape
 * the message without the other noticing.
 */

const ORIGIN = "https://app.letscube.ru";
const ENTRY = "/assets/index-NEW111.js";
const template = await readFile(new URL("../../artifacts/kub/public/sw.js", import.meta.url), "utf8");

test("the page's entry is its first module script from this origin's assets", () => {
  assert.equal(
    pageEntryPath(["https://cdn.example/assets/lib.js", `${ORIGIN}${ENTRY}`, `${ORIGIN}/assets/other.js`], ORIGIN),
    ENTRY,
  );
  // The dev server boots /src/main.tsx: no build, so no claim to be one.
  assert.equal(pageEntryPath([`${ORIGIN}/src/main.tsx`], ORIGIN), null);
  assert.equal(pageEntryPath(["http://[bad", ""], ORIGIN), null);
});

test("only a well-formed answer counts as an answer", () => {
  assert.deepEqual(
    parseHandoffResult({ type: KUB_SW_HANDOFF_RESULT, build: "abc", current: true, activated: false }),
    { build: "abc", current: true, activated: false },
  );
  assert.equal(parseHandoffResult({ type: "KUB_SKIP_WAITING", build: "abc", current: true, activated: true }), null);
  assert.equal(parseHandoffResult({ type: KUB_SW_HANDOFF_RESULT, build: "abc", current: "yes", activated: false }), null);
  assert.equal(parseHandoffResult(null), null);
});

test("only a page that is the worker's build keeps quiet", () => {
  assert.equal(shouldAnnounceWaitingWorker(null), true);
  assert.equal(shouldAnnounceWaitingWorker({ build: "abc", current: false, activated: false }), true);
  assert.equal(shouldAnnounceWaitingWorker({ build: "abc", current: true, activated: false }), false);
  assert.equal(shouldAnnounceWaitingWorker({ build: "abc", current: true, activated: true }), false);
});

test("a page told to keep waiting asks again a bounded number of times, and only then", () => {
  const waiting = { build: "abc", current: true, activated: false };
  // A closed window lingers in the worker's client list for a moment, so the
  // first "wait" right after one closes is not final.
  const delays = [0, 1, 2, 3].map((attempt) => nextHandoffDelay(waiting, attempt));
  assert.equal(delays.at(-1), null, "the page kept asking forever");
  assert.ok(
    delays.slice(0, -1).every((delay) => typeof delay === "number" && delay > 0),
    "a page told to wait never asked again",
  );
  // Nothing to ask after a takeover, after an update was offered, or with no answer.
  assert.equal(nextHandoffDelay({ ...waiting, activated: true }, 0), null);
  assert.equal(nextHandoffDelay({ ...waiting, current: false }, 0), null);
  assert.equal(nextHandoffDelay(null, 0), null);
});

test("a worker that never answers, or cannot be asked, leaves the page announcing", async () => {
  const silent = { postMessage() {} };
  assert.equal(await requestHandoff(silent, ENTRY, 20), null);

  const broken = {
    postMessage() {
      throw new Error("InvalidStateError");
    },
  };
  assert.equal(await requestHandoff(broken, ENTRY, 20), null);
});

/** Loads the real worker, rendered for one build, and hands it a page's message. */
function workerFor(build: { id: string; entry: string; precache: string[] }, windowIds: string[]) {
  const listeners = new Map<string, (event: unknown) => void>();
  const state = { skipWaitingCalls: 0 };
  const context = {
    URL,
    Headers,
    Response,
    Request,
    self: {
      addEventListener(type: string, listener: (event: unknown) => void) {
        listeners.set(type, listener);
      },
      location: { origin: ORIGIN },
      registration: { async getNotifications() { return []; } },
      clients: { async matchAll() { return windowIds.map((id) => ({ id, type: "window" })); } },
      async skipWaiting() {
        state.skipWaitingCalls += 1;
      },
    },
  };
  vm.runInNewContext(renderServiceWorker(template, build), context, { filename: "sw.js" });
  const pending: Promise<unknown>[] = [];
  const worker = (pageId: string) => ({
    postMessage(message: unknown, transfer: Transferable[]) {
      listeners.get("message")!({
        data: message,
        source: { id: pageId },
        ports: transfer,
        waitUntil(promise: Promise<unknown>) {
          pending.push(promise);
        },
      });
    },
  });
  return { worker, state, settled: () => Promise.all(pending) };
}

const BUILD = { id: "a1b2c3d4e5f60718", entry: ENTRY, precache: [ENTRY] };

test("the page and the real worker agree: this build, sole window, taken over at once", async () => {
  const { worker, state, settled } = workerFor(BUILD, ["page-1"]);
  const result = await requestHandoff(worker("page-1"), ENTRY, 2000);
  await settled();
  assert.deepEqual(result, { build: BUILD.id, current: true, activated: true });
  assert.equal(state.skipWaitingCalls, 1);
  assert.equal(shouldAnnounceWaitingWorker(result), false);
});

test("the page and the real worker agree: another build is offered the update", async () => {
  const { worker, state, settled } = workerFor(BUILD, ["page-1"]);
  const result = await requestHandoff(worker("page-1"), "/assets/index-OLD000.js", 2000);
  await settled();
  assert.deepEqual(result, { build: BUILD.id, current: false, activated: false });
  assert.equal(state.skipWaitingCalls, 0);
  assert.equal(shouldAnnounceWaitingWorker(result), true);
});

test("the message the page sends is the one the worker listens for", () => {
  assert.ok(template.includes(`"${KUB_SW_HANDOFF_MESSAGE}"`), "the worker does not handle the page's message type");
  assert.ok(template.includes(`"${KUB_SW_HANDOFF_RESULT}"`), "the worker does not answer with the type the page reads");
});
