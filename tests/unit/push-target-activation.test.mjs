import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { chatAddressPath } from "../../artifacts/kub/src/lib/chatRoute.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const hookSource = read("artifacts/kub/src/hooks/usePush.ts");
const chatSource = read("artifacts/kub/src/lib/safeOpenChat.ts");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function compile(source, dependencies, globals = {}) {
  const module = { exports: {} };
  const program = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    transformers: { before: [(context) => {
      const visit = (node) => ts.isMetaProperty(node)
        ? ts.factory.createIdentifier("testImportMeta")
        : ts.visitEachChild(node, visit, context);
      return (node) => ts.visitNode(node, visit);
    }] },
  }).outputText;
  vm.runInNewContext(program, {
    module, exports: module.exports, testImportMeta: { env: { BASE_URL: "/", VITE_VAPID_PUBLIC_KEY: "" } },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`);
      return dependencies[name];
    },
    ...globals,
  });
  return module.exports;
}

function fixture({ source = hookSource, base = "/" } = {}) {
  const effects = [];
  const timers = [];
  const requests = [];
  const listeners = new Set();
  const effectsToMount = [];
  const registration = deferred();
  let onNativeTarget;
  const state = {
    currentUser: { id: "owner" }, accountEpoch: 1,
    chats: [{ id: "chat-a" }, { id: "chat-b" }], selectedChatId: "previous", selectedTopicId: null,
    setSelectedChatId(id) { effects.push(["select", id]); patch({ selectedChatId: id, selectedTopicId: null }); },
  };
  const client = {
    from(table) {
      assert.equal(table, "chat_members", "cached chat still needs its actual access check");
      const request = deferred();
      let chatId;
      const query = {
        select() { return query; },
        eq(key, value) { if (key === "chat_id") chatId = value; return query; },
        maybeSingle() { requests.push({ chatId, ...request }); return request.promise; },
      };
      return query;
    },
  };
  const patch = (changes) => {
    const previous = { ...state };
    Object.assign(state, changes);
    for (const listener of listeners) listener({ ...state }, previous);
  };
  const store = Object.assign((selector) => selector(state), {
    getState: () => ({ ...state }), subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  });
  const safeOpenChat = compile(chatSource, {
    "@/lib/supabase/client": { createClient: () => client },
    "@/lib/chatEvents": { dispatchChatsRefresh: () => effects.push(["refresh"]) },
    "@/lib/chatDisplay": { isSavedChat: () => false, isSavedChatLikeName: () => false },
    "@/lib/chatSort": { sortChatsForSidebar: (chats) => chats },
    "@/lib/appDialogs": { showAppAlert: () => effects.push(["alert"]) },
    "@/store/app.store": { useAppStore: store },
    "@/lib/messageProjection": { MESSAGE_LAST_MESSAGE_SELECT: "id" },
  }).safeOpenChat;
  const window = {
    location: new URL("https://app.letscube.ru/"),
    history: { pushState(_state, _title, route) {
      effects.push(["route", route]); window.location = new URL(route, window.location.origin);
    } },
    dispatchEvent() {},
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
  };
  const imports = Object.fromEntries([...ts.createSourceFile("usePush.ts", source, ts.ScriptTarget.Latest, true).statements]
    .filter(ts.isImportDeclaration).map((node) => [node.moduleSpecifier.text, {}]));
  Object.assign(imports, {
    "react": { useRef: (value) => ({ current:value }), useEffect: (effect) => effectsToMount.push(effect) },
    "@/lib/platform/capabilities": { isNativeAndroid: () => false, isNativeApp: () => false },
    "@/lib/platform/desktop": { isDesktopApp: () => true },
    "@/lib/pushNavigationQueue": compile(read("artifacts/kub/src/lib/pushNavigationQueue.ts"), {}),
    "@/lib/platform/desktopNotifications": {
      registerDesktopNotificationNavigationListener: (callback) => { onNativeTarget = callback; return registration.promise; },
    },
    "@/lib/safeOpenChat": { safeOpenChat }, "@/lib/chatRoute": { chatAddressPath },
    "@/lib/chatJumpEvents": { requestChatMessageJump: (chat, message) => effects.push(["jump", chat, message]) },
    "@/store/app.store": { useAppStore: store },
  });
  // Export the existing private entrypoint only in this test's compiled module.
  const compiledHook = compile(`${source}\nexport { openPushTargetInApp };`, imports, {
    window, URL, PopStateEvent: class {}, testImportMeta: { env: { BASE_URL: base, VITE_VAPID_PUBLIC_KEY: "" } },
  });
  const open = compiledHook.openPushTargetInApp;
  const grant = async (index = 0, allowed = true, error = null) => {
    const request = requests[index];
    assert.ok(request, "the notification must reach the real access boundary");
    request.resolve({ data: allowed && !error ? { chat_id: request.chatId } : null, error });
    await new Promise(setImmediate);
  };
  const tick = () => { for (const { callback, delay } of timers.splice(0)) { assert.equal(delay, 150); callback(); } };
  const switchAccount = (id) => patch({ currentUser: id ? { id } : null, accountEpoch: state.accountEpoch + 1, selectedChatId: null });
  return { open, effects, requests, timers, state, window, grant, tick, switchAccount, patch, listeners,
    mount() {
      compiledHook.usePushNotificationNavigation();
      const cleanups = effectsToMount.map((effect) => effect());
      return () => { for (const cleanup of cleanups) cleanup?.(); };
    },
    emitNative: (target) => onNativeTarget(target),
    async finishRegistration() { registration.resolve(() => effects.push(["unregister"])); await new Promise(setImmediate); },
  };
}

test("an ordinary card opens its authorized exact message", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-a");
  await f.grant();
  assert.deepEqual(f.effects, [["select", "chat-a"], ["route", "/chat/chat-a/m/message-a"]]);
  f.tick();
  assert.deepEqual(f.effects.at(-1), ["jump", "chat-a", "message-a"]);
});

test("a delayed message jump cannot run in another account", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-a");
  await f.grant();
  const accepted = [...f.effects];
  f.switchAccount("other");
  f.tick();
  assert.deepEqual(f.effects, accepted);
});

test("logout and return to the same account invalidate a delayed jump", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-a");
  await f.grant();
  const accepted = [...f.effects];
  f.switchAccount(null); f.switchAccount("owner"); f.patch({ selectedChatId: "chat-a" });
  f.tick();
  assert.deepEqual(f.effects, accepted);
});

test("logout and return during the access check cannot select the stale chat", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-a");
  f.switchAccount(null); f.switchAccount("owner");
  await f.grant(); f.tick();
  assert.deepEqual(f.effects, []);
});

test("two cards resolved out of order keep the most recent target", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-a");
  f.open("/?chat=chat-b&message=message-b");
  await f.grant(1); await f.grant(0); f.tick();
  assert.deepEqual(f.effects, [
    ["select", "chat-b"], ["route", "/chat/chat-b/m/message-b"], ["jump", "chat-b", "message-b"],
  ]);
});

test("two cards in the same chat cannot jump back to the older message", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-old"); await f.grant(0);
  f.open("/?chat=chat-a&message=message-new"); await f.grant(1); f.tick();
  assert.deepEqual(f.effects.filter(([kind]) => kind === "jump"), [["jump", "chat-a", "message-new"]]);
});

test("leaving the selected chat cancels its delayed jump", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-a"); await f.grant();
  const accepted = [...f.effects];
  f.patch({ selectedChatId: "chat-b" }); f.tick();
  assert.deepEqual(f.effects, accepted);
});

test("a manual chat selection during access checking wins over the older card", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-a");
  f.patch({ selectedChatId: "chat-b" });
  await f.grant(); f.tick();
  assert.deepEqual(f.effects, []);
  assert.equal(f.state.selectedChatId, "chat-b");
});

test("a manual topic selection during access checking wins over the older card", async () => {
  const f = fixture();
  f.patch({ selectedChatId: "chat-a", selectedTopicId: "topic-old" });
  f.open("/?chat=chat-a&message=message-a"); f.patch({ selectedTopicId: "topic-new" });
  await f.grant(); f.tick();
  assert.deepEqual(f.effects, []); assert.equal(f.state.selectedTopicId, "topic-new");
});

test("a manual chat round trip during access checking still cancels the old card", async () => {
  const f = fixture(); f.patch({ selectedChatId: "chat-a" });
  f.open("/?chat=chat-b&message=message-b");
  f.patch({ selectedChatId: "chat-b" }); f.patch({ selectedChatId: "chat-a" });
  await f.grant(); f.tick();
  assert.deepEqual(f.effects, []); assert.equal(f.state.selectedChatId, "chat-a");
});

test("a manual address change during access checking cancels the old card", async () => {
  const f = fixture(); f.open("/?chat=chat-b&message=message-b");
  f.window.location = new URL("https://app.letscube.ru/support");
  await f.grant(); f.tick(); assert.deepEqual(f.effects, []);
});

test("a route change within the same chat cancels the old jump", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-a"); await f.grant();
  const accepted = [...f.effects];
  f.window.location = new URL("https://app.letscube.ru/chat/chat-a/m/manual-target"); f.tick();
  assert.deepEqual(f.effects, accepted);
});

test("a profile update without an account transition retains an accepted tap", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-a"); await f.grant();
  f.state.currentUser = { id: "owner", online_at: "2026-10-05T12:00:00Z" }; f.tick();
  assert.deepEqual(f.effects.at(-1), ["jump", "chat-a", "message-a"]);
});

test("an access refusal never schedules a message jump", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-a"); await f.grant(0, false); f.tick();
  assert.deepEqual(f.effects, [["alert"]]);
});

test("an explicit permission refusal cannot use a cached chat as fallback", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-a");
  await f.grant(0, false, { code: "42501", message: "Fictional access refusal" }); f.tick();
  assert.deepEqual(f.effects, [["alert"]]);
});

test("a foreign-origin card does not reach the access boundary", () => {
  const f = fixture(); f.open("https://example.invalid/?chat=chat-a&message=message-a");
  assert.deepEqual(f.requests, []); assert.deepEqual(f.effects, []);
});

test("a signed-out target cannot select a chat or navigate to a task", () => {
  const f = fixture(); f.switchAccount(null);
  f.open("/?chat=chat-a&message=message-a"); f.open("/tasks?task=task-a");
  assert.deepEqual(f.requests, []); assert.deepEqual(f.effects, []);
});

test("a canonical message target retains the base path and hash", async () => {
  const f = fixture({ base: "/client/" });
  f.open("/?chat=chat-a&message=message-a#details"); await f.grant(); f.tick();
  assert.deepEqual(f.effects, [
    ["select", "chat-a"], ["route", "/client/chat/chat-a/m/message-a#details"], ["jump", "chat-a", "message-a"],
  ]);
});

test("a newer task target cancels a chat access check", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-a"); f.open("/tasks?task=task-a");
  await f.grant(); f.tick();
  assert.deepEqual(f.effects, [["route", "/tasks?task=task-a"]]);
});

test("selection watchers are released after completion, replacement and a rejected request", async () => {
  const f = fixture();
  f.open("/?chat=chat-a&message=message-a");
  assert.equal(f.listeners.size, 1);
  await f.grant(0);
  assert.equal(f.listeners.size, 0);
  f.open("/?chat=chat-a&message=message-old");
  f.open("/?chat=chat-b&message=message-new");
  assert.equal(f.listeners.size, 1);
  await f.grant(1);
  assert.equal(f.listeners.size, 1, "settling a replaced action must not release the current watcher");
  f.requests[2].reject(new Error("fixture transport rejected"));
  await new Promise(setImmediate);
  assert.equal(f.listeners.size, 0);
});

async function cancelledRegistration(source = hookSource) {
  const f = fixture({ source });
  const unmount = f.mount(); unmount();
  f.emitNative("/?chat=chat-a&message=message-a");
  assert.deepEqual(f.requests, [], "a disposed hook must refuse callbacks before registration settles");
  await f.finishRegistration();
  assert.deepEqual(f.effects, [["unregister"]], "a late registration must release its listeners");
  f.emitNative("/?chat=chat-b&message=message-b");
  assert.deepEqual(f.requests, []);
}

test("unmount during native registration refuses targets and disposes its eventual listener", () => cancelledRegistration());

test("a mounted native navigation hook retains ordinary exact-message activation", async () => {
  const f = fixture(); const unmount = f.mount();
  await f.finishRegistration(); f.emitNative("/?chat=chat-a&message=message-a");
  await f.grant(); f.tick();
  assert.deepEqual(f.effects, [["select", "chat-a"], ["route", "/chat/chat-a/m/message-a"], ["jump", "chat-a", "message-a"]]);
  unmount(); assert.deepEqual(f.effects.at(-1), ["unregister"]);
});

for (const [name, from, to] of [
  ["keep unmounted callbacks active", "if (!cancelled) targetHandler.handle(target);", "targetHandler.handle(target);"],
  ["lose deferred unregister", "if (cancelled) removeListeners();", "if (cancelled) undefined;"],
]) {
  test(`literal registration oracle refuses compiled mutation: ${name}`, async () => {
    assert.equal(hookSource.split(from).length, 2);
    await assert.rejects(() => cancelledRegistration(hookSource.replace(from, to)), assert.AssertionError);
  });
}

for (const [name, from, to, scenario] of [
  ["drop epoch fence", "state.accountEpoch === accountEpoch", "true", async (f) => {
    f.open("/?chat=chat-a&message=message-a"); await f.grant(); const accepted = [...f.effects];
    f.switchAccount(null); f.switchAccount("owner"); f.state.selectedChatId = "chat-a";
    f.tick(); assert.deepEqual(f.effects, accepted);
  }],
  ["drop latest tap fence", "revision === pushTargetRevision", "true", async (f) => {
    f.state.selectedChatId = "chat-a";
    f.open("/?chat=chat-a&message=message-a"); await f.grant(0);
    f.open("/?chat=chat-a&message=message-a"); await f.grant(1); f.tick();
    assert.deepEqual(f.effects.filter(([kind]) => kind === "jump"), [["jump", "chat-a", "message-a"]]);
  }],
  ["drop delayed selection fence", "canCommit() && useAppStore.getState().selectedChatId === chatId\n                &&", "canCommit() &&", async (f) => {
    f.open("/?chat=chat-a&message=message-a"); await f.grant(); const accepted = [...f.effects];
    f.state.selectedChatId = "chat-b"; f.tick(); assert.deepEqual(f.effects, accepted);
  }],
  ["drop delayed route fence", "`${location.pathname}${location.search}${location.hash}` === route", "true", async (f) => {
    f.open("/?chat=chat-a&message=message-a"); await f.grant(); const accepted = [...f.effects];
    f.window.location = new URL("https://app.letscube.ru/chat/chat-a/m/manual-target"); f.tick();
    assert.deepEqual(f.effects, accepted);
  }],
  ["drop pending selection fence", "&& !selectionChanged", "&& true", async (f) => {
    f.patch({ selectedChatId: "chat-a" }); f.open("/?chat=chat-b&message=message-b");
    f.patch({ selectedChatId: "chat-b" }); f.patch({ selectedChatId: "chat-a" });
    await f.grant(); f.tick(); assert.deepEqual(f.effects, []);
  }],
  ["drop pending address fence", "window.location.href === addressBefore", "true", async (f) => {
    f.open("/?chat=chat-b&message=message-b"); f.window.location = new URL("https://app.letscube.ru/support");
    await f.grant(); f.tick(); assert.deepEqual(f.effects, []);
  }],
]) {
  test(`literal activation oracle refuses compiled mutation: ${name}`, async () => {
    const normalized = hookSource.replaceAll("\r\n", "\n");
    assert.equal(normalized.split(from).length, 2, "mutation must touch the actual implementation exactly once");
    const f = fixture({ source: normalized.replace(from, to) });
    await assert.rejects(() => scenario(f), (error) => error instanceof assert.AssertionError);
  });
}
