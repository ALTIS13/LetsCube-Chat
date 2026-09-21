import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../../artifacts/kub/src/lib/safeOpenChat.ts", import.meta.url), "utf8");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture({ cached = true, access = Promise.resolve({ data: { chat_id: "chat" }, error: null }), hydration } = {}) {
  const effects = [];
  const queries = [];
  const state = {
    currentUser: { id: "owner" },
    chats: cached ? [{ id: "chat" }] : [],
    selectedChatId: "other",
    setSelectedChatId(value) { effects.push(["select", value]); state.selectedChatId = value; },
    setChats(value) { effects.push(["chats", Array.from(value, (chat) => chat.id)]); state.chats = value; },
  };
  const client = {
    from(table) {
      queries.push(table);
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; }, order() { return query; },
        maybeSingle() { return table === "chat_members" ? access : hydration; },
        limit() { return Promise.resolve({ data: [], error: null }); },
      };
      return query;
    },
  };
  const dependencies = {
    "@/lib/supabase/client": { createClient: () => client },
    "@/lib/chatEvents": { dispatchChatsRefresh: () => effects.push(["refresh"]) },
    "@/lib/chatDisplay": { isSavedChat: () => false, isSavedChatLikeName: () => false },
    "@/lib/chatSort": { sortChatsForSidebar: (chats) => chats },
    "@/lib/appDialogs": { showAppAlert: () => effects.push(["alert"]) },
    "@/store/app.store": { useAppStore: { getState: () => state } },
    "@/lib/messageProjection": { MESSAGE_LAST_MESSAGE_SELECT: "id" },
  };
  const module = { exports: {} };
  const program = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(program, {
    module, exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  return { open: module.exports.safeOpenChat, state, effects, queries };
}

test("a dismissed native action makes no request or UI mutation", async () => {
  const f = fixture();
  assert.equal(await f.open("chat", { canCommit: () => false }), false);
  assert.deepEqual(f.queries, []);
  assert.deepEqual(f.effects, []);
});

test("an account switch during access checking cannot select the old chat", async () => {
  const access = deferred();
  const f = fixture({ access: access.promise });
  const operation = f.open("chat");
  f.state.currentUser = { id: "different-owner" };
  access.resolve({ data: { chat_id: "chat" }, error: null });
  assert.equal(await operation, false);
  assert.deepEqual(f.effects, []);
});

test("same-account session replacement during access checking cannot select a chat", async () => {
  const access = deferred();
  const f = fixture({ access: access.promise });
  let current = true;
  const operation = f.open("chat", { canCommit: () => current });
  current = false;
  access.resolve({ data: { chat_id: "chat" }, error: null });
  assert.equal(await operation, false);
  assert.deepEqual(f.effects, []);
});

test("a stale denial does not clear selection or alert the new session", async () => {
  const access = deferred();
  const f = fixture({ access: access.promise });
  let current = true;
  const operation = f.open("chat", { canCommit: () => current });
  f.state.selectedChatId = "chat";
  current = false;
  access.resolve({ data: null, error: null });
  assert.equal(await operation, false);
  assert.deepEqual(f.effects, []);
  assert.equal(f.state.selectedChatId, "chat");
});

for (const found of [true, false]) {
  test(`session replacement during hydration cannot ${found ? "insert old summary" : "request refresh"}`, async () => {
    const hydration = deferred();
    const f = fixture({ cached: false, hydration: hydration.promise });
    let current = true;
    const operation = f.open("chat", { canCommit: () => current });
    await new Promise(setImmediate);
    assert.deepEqual(f.queries, ["chat_members", "chats"]);
    current = false;
    hydration.resolve({ data: found ? { id: "chat", type: "private", name: "fixture", members: [] } : null, error: null });
    assert.equal(await operation, false);
    assert.deepEqual(f.effects, []);
  });
}

test("ordinary authorized cached chat still opens", async () => {
  const f = fixture();
  assert.equal(await f.open("chat"), true);
  assert.deepEqual(f.effects, [["select", "chat"]]);
});

test("ordinary uncached chat is hydrated then selected", async () => {
  const f = fixture({ cached: false, hydration: Promise.resolve({ data: { id: "chat", type: "private", name: "fixture", members: [] }, error: null }) });
  assert.equal(await f.open("chat", { canCommit: () => true }), true);
  assert.deepEqual(f.effects, [["chats", ["chat"]], ["select", "chat"]]);
});

test("ordinary refusal still clears that selection and reports unavailable", async () => {
  const f = fixture({ access: Promise.resolve({ data: null, error: null }) });
  f.state.selectedChatId = "chat";
  assert.equal(await f.open("chat"), false);
  assert.deepEqual(f.effects, [["select", null], ["alert"]]);
});
