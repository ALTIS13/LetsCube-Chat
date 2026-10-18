import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../artifacts/kub/public/sw.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const ORIGIN = "https://app.letscube.ru";
const TARGET = "/?chat=chat-1&message=message-1";
const turn = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  // Observe provider failures even on the old handler that ignores the promise.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function windowClient(id, url = `${ORIGIN}/`) {
  return { id, url, type: "window", frameType: "top-level", posts: [], focuses: 0,
    async focus() { this.focuses += 1; return this; },
    postMessage(message) { this.posts.push(structuredClone(message)); },
  };
}

function worker({ text = source, clients = [], get, open } = {}) {
  const listeners = new Map(), windows = [...clients], opened = [], lookedUp = [];
  vm.runInNewContext(text, { URL, Promise, Date,
    self: {
      location: { origin: ORIGIN },
      addEventListener: (name, callback) => listeners.set(name, callback),
      clients: {
        async matchAll(options) {
          assert.equal(options.type, "window");
          assert.equal(options.includeUncontrolled, true);
          return windows.slice();
        },
        async get(id) { lookedUp.push(id); return get ? get(id) : windows.find((entry) => entry.id === id); },
        async openWindow(url) {
          opened.push(url);
          const client = open ? await open(url) : windowClient(`opened-${opened.length}`, url);
          if (client) windows.push(client);
          return client;
        },
      },
    },
  }, { filename: "sw.js" });
  return { opened, lookedUp, click(url = TARGET) {
    const pending = [];
    let closed = 0, settled = false;
    listeners.get("notificationclick")({
      notification: { data: { url }, close() { closed += 1; } },
      waitUntil: (promise) => pending.push(promise),
    });
    assert.equal(closed, 1, "close only the clicked card");
    assert.equal(pending.length, 1, "the whole click is retained by waitUntil");
    const done = Promise.all(pending).finally(() => { settled = true; });
    void done.catch(() => {});
    return { done, get settled() { return settled; } };
  } };
}

async function waitsForFocus(text = source) {
  const client = windowClient("held"), gate = deferred();
  client.focus = () => gate.promise;
  const f = worker({ text, clients: [client] }), click = f.click();
  await turn();
  const settledEarly = click.settled, postedEarly = client.posts.length;
  gate.resolve(client);
  await click.done;
  assert.equal(settledEarly, false, "waitUntil ended before focus settled");
  assert.equal(postedEarly, 0, "navigation was sent before focus succeeded");
  assert.deepEqual(client.posts, [{ type: "kub-open", url: TARGET }]);
  assert.equal(f.opened.length, 0, "a focused client must not create another window");
}
test("notificationclick retains pending focus before posting the exact message route", () => waitsForFocus());

async function rejectsFocus(text = source) {
  const stale = windowClient("stale"), live = windowClient("live"), gate = deferred();
  stale.focus = () => gate.promise;
  const f = worker({ text, clients: [stale, live] }), click = f.click();
  await turn();
  gate.reject(new TypeError("fictional document is not active"));
  await assert.doesNotReject(click.done, "rejected focus must continue to another client");
  assert.equal(stale.posts.length, 0, "a rejected focus cannot receive the click target");
  assert.deepEqual(live.posts, [{ type: "kub-open", url: TARGET }]);
  assert.equal(live.focuses, 1);
  assert.equal(f.opened.length, 0, "a later live client prevents a duplicate window");
}
test("rejected focus tries the next live same-origin client without opening another window", () => rejectsFocus());

async function closedClient(text = source) {
  const closed = windowClient("closed");
  const f = worker({ text, clients: [closed], get: () => undefined });
  await f.click().done;
  assert.equal(closed.focuses, 1, "the client disappeared after a successful focus");
  assert.equal(closed.posts.length, 0, "a client closed after focus cannot receive the target");
  assert.deepEqual(f.opened, [`${ORIGIN}/?chat=chat-1&message=message-1`]);
}
test("a client that closed after focus falls back to one exact-route window", () => closedClient());

async function freshSnapshot(text = source) {
  const old = windowClient("same-id"), current = windowClient("same-id", `${ORIGIN}/chat/resumed`);
  old.focus = async () => current;
  const f = worker({ text, clients: [old], get: () => current });
  await f.click().done;
  assert.equal(old.posts.length, 0, "navigation used the stale matchAll snapshot");
  assert.deepEqual(current.posts, [{ type: "kub-open", url: TARGET }]);
  assert.deepEqual(f.lookedUp, ["same-id"]);
  assert.equal(f.opened.length, 0);
}
test("the current client snapshot receives the route instead of the stale matchAll object", () => freshSnapshot());

async function strictOrigin(text = source) {
  const invalid = [
    windowClient("query", `https://unrelated.example/?return=${ORIGIN}`),
    windowClient("prefix", `${ORIGIN}.unrelated.example/`),
    windowClient("invalid", "not a client URL"),
    { ...windowClient("frame"), frameType: "nested" },
  ];
  const live = windowClient("live"), f = worker({ text, clients: [...invalid, live] });
  await f.click().done;
  assert.equal(invalid.reduce((sum, client) => sum + client.focuses + client.posts.length, 0), 0,
    "a substring match or nested frame received the click");
  assert.deepEqual(live.posts, [{ type: "kub-open", url: TARGET }]);
  assert.equal(f.opened.length, 0);
}
test("only an exact-origin top-level client is eligible, not an origin substring or frame", () => strictOrigin());

test("a current client that navigated away from the origin cannot receive the target", async () => {
  const old = windowClient("departed"), foreign = windowClient("departed", "https://unrelated.example/");
  const f = worker({ clients: [old], get: () => foreign });
  await f.click().done;
  assert.equal(old.posts.length + foreign.posts.length, 0);
  assert.deepEqual(f.opened, [`${ORIGIN}/?chat=chat-1&message=message-1`]);
});

test("a vanished client throwing during postMessage falls back to one window", async () => {
  const gone = windowClient("gone");
  gone.postMessage = () => { throw new DOMException("fictional closed client", "InvalidStateError"); };
  const f = worker({ clients: [gone] });
  await f.click().done;
  assert.deepEqual(f.opened, [`${ORIGIN}/?chat=chat-1&message=message-1`]);
});

test("a cold click opens the exact same-origin route with its query and hash", async () => {
  const f = worker();
  await f.click("/?chat=chat-1&message=message-1#reply").done;
  assert.deepEqual(f.opened, [`${ORIGIN}/?chat=chat-1&message=message-1#reply`]);
});

for (const url of ["https://unrelated.example/?chat=chat-1", "//unrelated.example/", "javascript:alert(1)"]) {
  test(`a cold click refuses an off-origin target: ${url}`, async () => {
    const f = worker();
    await f.click(url).done;
    assert.deepEqual(f.opened, [`${ORIGIN}/`]);
  });
}

async function overlappingClicks(text = source) {
  const gate = deferred(), opened = windowClient("opened"), f = worker({ text, open: () => gate.promise });
  const first = f.click(), second = f.click("/?chat=chat-2&message=message-2");
  await turn();
  const attemptsWhileOpening = f.opened.length;
  gate.resolve(opened);
  await Promise.all([first.done, second.done]);
  assert.equal(attemptsWhileOpening, 1, "overlapping clicks opened duplicate windows");
  assert.deepEqual(f.opened, [`${ORIGIN}/?chat=chat-1&message=message-1`]);
  assert.deepEqual(opened.posts, [{ type: "kub-open", url: "/?chat=chat-2&message=message-2" }]);
}
test("overlapping cold clicks reuse the first opened window and retain the second exact target", () => overlappingClicks());

async function failedOpen(text = source) {
  let attempts = 0;
  const f = worker({ text, open: async (url) => {
    if (++attempts === 1) throw new TypeError("fictional open failure");
    return windowClient("retry", url);
  } });
  await assert.rejects(f.click().done, /fictional open failure/);
  await assert.doesNotReject(f.click().done, "failed open must not poison later clicks");
  assert.equal(f.opened.length, 2);
}
test("a failed open is retained by waitUntil and does not poison the next click", () => failedOpen());

test("a null openWindow result is not retried into duplicate windows", async () => {
  const f = worker({ open: async () => null });
  await f.click().done;
  assert.deepEqual(f.opened, [`${ORIGIN}/?chat=chat-1&message=message-1`]);
});

test("a sole rejected focus opens one exact-route fallback", async () => {
  const stale = windowClient("stale"), gate = deferred();
  stale.focus = () => gate.promise;
  const f = worker({ clients: [stale] }), click = f.click();
  await turn();
  gate.reject(new TypeError("fictional inactive document"));
  await click.done;
  assert.equal(stale.posts.length, 0);
  assert.deepEqual(f.opened, [`${ORIGIN}/?chat=chat-1&message=message-1`]);
});

const omissions = [
  ["focus await", "const focused = await client.focus();", "const focused = client.focus();", waitsForFocus, "waitUntil ended before focus settled"],
  ["closed-client lookup", "const current = focused && await self.clients.get(focused.id);", "const current = focused;", closedClient, "a client closed after focus"],
  ["fresh client recipient", 'current.postMessage({ type: "kub-open", url: targetUrl });', 'client.postMessage({ type: "kub-open", url: targetUrl });', freshSnapshot, "stale matchAll snapshot"],
  ["exact origin", "new URL(client.url).origin === self.location.origin", "client.url.includes(self.location.origin)", strictOrigin, "substring match or nested frame"],
  ["top-level client", ' || client.frameType === "nested"', "", strictOrigin, "substring match or nested frame"],
  ["rejected focus fallback", "// A closed or not-yet-active client must not swallow the click.", 'throw new Error("fictional unhandled focus");', rejectsFocus, "rejected focus must continue"],
  ["serialized clicks", "const opening = notificationClicks.then(async () => {", "const opening = Promise.resolve().then(async () => {", overlappingClicks, "overlapping clicks opened duplicate windows"],
  ["queue recovery", "notificationClicks = opening.catch(() => {});", "notificationClicks = opening;", failedOpen, "failed open must not poison later clicks"],
  ["successful reuse return", 'current.postMessage({ type: "kub-open", url: targetUrl });\n        return;', 'current.postMessage({ type: "kub-open", url: targetUrl });', waitsForFocus, "a focused client must not create another window"],
];
for (const [name, before, after, scenario, oracle] of omissions) {
  test(`compiled click omission rejected: ${name}`, async () => {
    assert.equal(source.split(before).length - 1, 1, "one mutation anchor");
    await assert.rejects(() => scenario(source.replace(before, after)), (error) => {
      assert.equal(error.code, "ERR_ASSERTION", "syntax/provider failures do not kill a mutant");
      assert.ok(error.message.includes(oracle), `expected behavioral failure: ${oracle}`);
      return true;
    });
  });
}
