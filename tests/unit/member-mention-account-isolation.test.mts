import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { spawnSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const A = "11111111-1111-4111-8111-000000000001";
const B = "11111111-1111-4111-8111-000000000002";
const CHAT = "22222222-2222-4222-8222-000000000001";
const ID = "55555555-5555-4555-8555-000000000001";
const text = "synthetic @Ada";
const literal = '{"version":1,"revision":"33333333-3333-4333-8333-000000000001","items":[{"kind":"user","user_id":"11111111-1111-4111-8111-000000000002","offset":10,"length":4,"label":"@Ada"}]}';
const noop = () => {};
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function source(relative: string) {
  let result = readFileSync(path.join(root, relative), "utf8");
  const mutants: Record<string, [string, Array<[string, string]>]> = {
    reset: ["store/app.store.ts", [["chats: [], messages: {},", "chats: [],"]]],
    epoch: ["store/app.store.ts", [["accountEpoch: state.accountEpoch + 1", "accountEpoch: state.accountEpoch"]]],
    stop: ["store/app.store.ts", [["appOutbox.stop();", ""]]],
    profile: ["store/app.store.ts", [["if ((state.currentUser?.id ?? null) !== (user?.id ?? null))", "if (true)"]]],
    history: ["hooks/useMessages.ts", [["const isCurrent = () => sameAccount() && chatIdRef.current === chatId", "const isCurrent = () => chatIdRef.current === chatId"]]],
    byId: ["hooks/useMessages.ts", [["!sameAccount() || chatIdRef.current !== activeChatId ||", ""]]],
    pinned: ["hooks/useMessages.ts", [["if (!sameAccount() || chatIdRef.current !== chatId) return;", ""]]],
    realtime: ["hooks/useMessages.ts", [["if (!isCurrent() || !data) return;", "if (!data) return;"],
      ["if (!isCurrent() || !fetchedHiddenIds) return;", "if (!fetchedHiddenIds) return;"]]],
    send: ["hooks/useMessages.ts", [["if (!sameAccount()) return null;", ""]]],
    owner: ["hooks/useMessages.ts", [["if (input.ownerUserId !== undefined && input.ownerUserId !== user?.id) return null;", ""]]],
    display: ["hooks/useMessages.ts", [["verifiedAccountEpochRef.current === accountEpoch &&", ""]]],
    lifecycle: ["hooks/useMessages.ts", [[", accountEpoch]);", "]);"]]],
    refEpoch: ["hooks/useMessages.ts", [["const epoch = currentUserRef.accountEpoch;", "const epoch = useAppStore.getState().accountEpoch;"]]],
    mutationAck: ["hooks/useMessages.ts", [["if (!sameAccount()) return { ok: false, error: \"Аккаунт изменился. Повторите действие.\" };", ""]]],
    olderGeneration: ["hooks/useMessages.ts", [["olderRequestOwnerRef.current === requestOwner", "historyRequestGenerationRef.current === historyGeneration"]]],
    olderOwner: ["hooks/useMessages.ts", [[" && olderRequestOwnerRef.current === requestOwner", ""]]],
    olderReset: ["hooks/useMessages.ts", [["olderRequestOwnerRef.current = null;\n    loadingOlderRef.current = false;", ""]]],
    historyClaim: ["hooks/useMessages.ts", [["if (!sameAccount() || chatIdRef.current !== chatId || topicIdRef.current !== topicId) return;", ""]]],
    reconcileDisposal: ["hooks/useMessages.ts", [["disposed = true;", ""]]],
    reconcileScope: ["hooks/useMessages.ts", [["const isActive = () => !disposed && sameAccount() && chatIdRef.current === chatId && topicIdRef.current === topicId;", "const isActive = () => !disposed;"]]],
  };
  const id = process.env.D331_ACCOUNT_MUTANT;
  if (id) {
    assert.ok(Object.hasOwn(mutants, id), `unknown mutation: ${id}`);
    const [target, replacements] = mutants[id];
    if (target === relative) for (const [from, to] of replacements) {
      assert.ok(result.includes(from), `mutation anchor missing: ${id}`);
      result = result.replaceAll(from, to);
    }
  }
  return result;
}

function expression(relative: string, name: string, env: Record<string, any>) {
  const program = source(relative);
  const tree = ts.createSourceFile(relative, program, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dependencies = name.startsWith("deps:");
  const selectedName = dependencies ? name.slice(5) : name;
  let node: ts.Node | undefined;
  const visit = (current: ts.Node) => {
    if (ts.isVariableDeclaration(current) && current.name.getText(tree) === selectedName && current.initializer) {
      node = ts.isCallExpression(current.initializer) ? current.initializer.arguments[dependencies ? 1 : 0] : current.initializer;
    }
    if (ts.isFunctionDeclaration(current) && current.name?.text === selectedName) node = current;
    if (selectedName.startsWith("effect:") && ts.isCallExpression(current) && current.expression.getText(tree) === "useEffect" &&
        current.arguments[0]?.getText(tree).includes(selectedName.slice(7))) node = current.arguments[dependencies ? 1 : 0];
    ts.forEachChild(current, visit);
  };
  visit(tree);
  assert.ok(node, `missing expression: ${name}`);
  const compiled = ts.transpileModule(`(function(${Object.keys(env).join(",")}){return (${node.getText(tree).replaceAll("import.meta.env", "({DEV:false})")});})`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return runInThisContext(compiled.replaceAll("import.meta.env", "({DEV:false})"))(...Object.values(env));
}

function modules(stubs: Record<string, any>) {
  const cache = new Map<string, any>();
  const load = (relative: string): any => {
    let filename = path.resolve(root, relative);
    if (!existsSync(filename)) filename += existsSync(`${filename}.ts`) ? ".ts" : ".tsx";
    const key = path.relative(root, filename).replaceAll("\\", "/");
    if (Object.hasOwn(stubs, key)) return stubs[key];
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const require = (name: string) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name.startsWith("@/")) return load(name.slice(2));
      if (name.startsWith(".")) return load(path.relative(root, path.resolve(path.dirname(filename), name)));
      return requireKub(name);
    };
    const compiled = ts.transpileModule(source(key), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const timer = (run: () => void, ms: number) => { const handle = setTimeout(run, ms); handle.unref(); return handle; };
    runInThisContext(`(function(require,module,exports,setTimeout){${compiled}\n})`)(require, module, module.exports, timer);
    return module.exports;
  };
  return load;
}

function message(userId = A, overrides: Record<string, any> = {}) {
  return { id: `tmp:${ID}`, client_message_id: ID, client_sent_at: "2026-10-01T12:00:00.000Z",
    created_at: "2026-10-01T12:00:00.000Z", chat_id: CHAT, topic_id: null, user_id: userId, bot_id: null,
    type: "text", content: text, mention_entities: JSON.parse(literal), sender: { id: userId },
    pending: false, failed: true, checking: false, deleted_at: null, reply_to_id: null,
    media_bucket: null, media_path: null, media_url: null, reactions: [], ...overrides };
}

type Options = { read?: Promise<any>; enqueue?: Promise<any>; realOutbox?: boolean };
function harness(options: Options = {}) {
  const reads: string[] = [];
  const sends: any[] = [];
  const effects: string[] = [];
  const queued = new Map<string, any>();
  const client = { rpc: async () => options.read ?? { data: null, error: null }, from: (table: string) => {
    reads.push(table);
    const query: any = { select: () => query, eq: () => query, is: () => query, gt: () => query,
      lt: () => query, or: () => query, order: () => query,
      insert: (payload: any) => { sends.push(structuredClone(payload)); return query; }, update: () => query,
      limit: () => options.read ?? Promise.resolve({ data: [], error: null }),
      single: () => options.read ?? Promise.resolve({ data: null, error: null }),
      maybeSingle: () => options.read ?? Promise.resolve({ data: null, error: null }), then: (done: any) => Promise.resolve({}).then(done),
    };
    return query;
  } };
  const load = modules({ "lib/supabase/client.ts": { createClient: () => client },
    "lib/monitoring.ts": { reportError: noop }, "lib/personalModeration.ts": { blockedSendRefusal: () => null },
    "lib/messageAckError.ts": { getMessageAckUserMessage: () => "retry", sanitizeMessageAckError: (error: any) => ({ error }) },
    "lib/outbox/outboxStorage.ts": { browserOutboxStorage: () => ({
      put: async (entry: any) => { queued.set(entry.clientMessageId, structuredClone(entry)); },
      remove: async (id: string) => { queued.delete(id); },
      list: async (userId: string) => [...queued.values()].filter((entry) => entry.userId === userId),
    }) },
  });
  const store = load("store/app.store.ts").useAppStore;
  const appOutbox = options.realOutbox ? load("lib/outbox/appOutbox.ts").appOutbox : null;
  store.getState().setCurrentUser({ id: A, full_name: "Synthetic A" });
  const currentUserRef = { current: store.getState().currentUser, accountEpoch: store.getState().accountEpoch };
  const refs = { chatIdRef: { current: CHAT }, topicIdRef: { current: undefined },
    generalTopicIdsRef: { current: [] }, clearedAtRef: { current: null }, hiddenMessageIdsRef: { current: new Set() },
    historyRequestGenerationRef: { current: 0 }, verifiedChatIdRef: { current: CHAT },
    verifiedAccountEpochRef: { current: null },
    subscribedChatIdRef: { current: null },
    loadingOlderRef: { current: false }, olderRequestOwnerRef: { current: null }, hasMoreOlderRef: { current: true } };
  const set = (name: string) => (..._args: any[]) => effects.push(name);
  const env: Record<string, any> = { useAppStore: store, currentUserRef, ...refs, chatId: CHAT, userId: A,
    topicId: undefined, generalTopicIds: [], supabase: client, EMPTY_MESSAGES: [], MESSAGE_PAGE_SIZE: 100,
    MESSAGE_SELECT_WITH_JOINS: "*", loadClearedAt: async () => null, fetchHiddenMessageIdSet: async () => new Set(),
    clearedAtCache: { hasFresh: () => true, evictChat: noop }, hiddenMessagesLive: { markVerified: noop },
    fetchedMessageScopes: new Set(), shouldMarkDeliveredForPrivateChat: () => false,
    bumpFetch: noop, reportError: noop, scheduleMarkChatRead: noop, scheduleMarkChatDelivered: noop,
    document: { visibilityState: "hidden" }, console: { error: noop },
    rememberHiddenMessageIds: set("hidden"), setLoading: set("loading"), setHistoryError: set("history"),
    setVerifiedChatId: set("verified"), setVerifyingChatId: set("verifying"), setClearedAt: set("cleared"),
    setHasMoreOlder: set("more"), setOlderError: set("olderError"), setLoadingOlder: set("olderLoading"),
    setPinnedMessages: set("pinned"), setPinnedRead: set("pinnedRead"), setActionRefusal: set("refusal"),
    setMessages: store.getState().setMessages, addMessage: store.getState().addMessage,
    removeMessage: store.getState().removeMessage, updateChat: store.getState().updateChat,
    dispatchChatsRefresh: noop, mapPgError: () => "refused",
    replaceMessage: store.getState().replaceMessage, updateChatLastMessage: store.getState().updateChatLastMessage,
    blockedSendRefusal: () => null,
    appOutbox: appOutbox ?? { enqueue: async (entry: any) => { sends.push(structuredClone(entry)); return options.enqueue ?? { kind: "waiting" }; } },
    ...load("lib/memberMentions.ts"), ...load("lib/optimisticMessage.ts"),
    ...load("lib/messageActor.ts"), ...load("lib/messageMerge.ts"), ...load("lib/deletedMessages.ts"),
    ...load("lib/listReadState.ts"), ...load("lib/realtimeMessage.ts"),
    emitChannelActivity: noop, registerChannel: noop, unregisterChannel: noop,
  };
  for (const name of ["getPinnedKey", "messageBelongsToTopic", "applyGeneralTopicFilter", "getMessageAndReplyIds",
    "sanitizeHiddenReply", "sanitizeHiddenReplies", "sortPinnedMessages", "buildRealtimeMessage", "needsJoinedRow", "upsertPinnedMessage"]) {
    env[name] = expression("hooks/useMessages.ts", name, env);
  }
  if (source("hooks/useMessages.ts").includes("function captureMessageAccount(")) {
    env.captureMessageAccount = expression("hooks/useMessages.ts", "captureMessageAccount", env);
  }
  const callback = (name: string, extra: Record<string, any> = {}) => expression("hooks/useMessages.ts", name, {
    ...env, accountEpoch: store.getState().accountEpoch, ...extra,
  });
  const realtime = () => {
    const handlers: Record<string, any> = {};
    const channel: any = { on: (_kind: string, filter: any, handle: any) => {
      handlers[filter.event] = handle; return channel;
    }, subscribe: () => channel };
    const dispose = callback("effect:messages:chat:", { rt: { channel: () => channel, removeChannel: noop } })();
    return { handlers, dispose };
  };
  const switchTo = (id: string | null, render = true) => {
    store.getState().setCurrentUser(id ? { id, full_name: "Synthetic profile" } : null);
    if (render) {
      currentUserRef.current = store.getState().currentUser;
      currentUserRef.accountEpoch = store.getState().accountEpoch;
    }
  };
  return { store, refs, env, callback, currentUserRef, reads, sends, effects, switchTo, appOutbox, queued, realtime };
}

function readClient(read: Promise<any>) {
  let requests = 0;
  const client = { from: () => {
    requests++;
    const query: any = { select: () => query, eq: () => query, is: () => query, gt: () => query,
      lt: () => query, or: () => query, order: () => query, limit: () => read, maybeSingle: () => read };
    return query;
  } };
  return { client, requests: () => requests };
}

function page(prefix: string, userId = A, topicId: string | null = null) {
  return Array.from({ length: 101 }, (_, index) => message(userId, {
    id: `${prefix}:${index}`, client_message_id: null, failed: false, pending: false, topic_id: topicId,
    created_at: `2026-10-01T11:00:${String(index % 60).padStart(2, "0")}.000Z`, content: prefix,
  }));
}

function reconcile(h: ReturnType<typeof harness>) {
  const pending = new Map<number, () => void>();
  let nextId = 0;
  let listener: any;
  const dispose = h.callback("effect:const timers = new Map", {
    KUB_CHATS_REFRESH_EVENT: "synthetic-refresh", ACTIVE_CHAT_RECONCILE_DELAY_MS: 600, ACTIVE_CHAT_RECONNECT_DELAY_MS: 900,
    fetchMessages: h.callback("fetchMessages"), fetchMessageById: h.callback("fetchMessageById"),
    setTimeout: (run: () => void) => { pending.set(++nextId, run); return nextId; },
    clearTimeout: (id: number) => pending.delete(id),
    window: { addEventListener: (_name: string, run: any) => { listener = run; }, removeEventListener: noop },
  })();
  return { pending, dispose, refresh: () => listener({ detail: { reason: "message-realtime", chatId: CHAT, messageId: ID } }),
    runNext: () => {
      const entry = pending.entries().next().value;
      assert.ok(entry, "an actual scheduled timer must exist");
      pending.delete(entry[0]); entry[1]();
    } };
}

test("older busy ownership releases after a successful background history generation supersedes its result", async () => {
  const held = deferred<any>();
  const h = harness({ read: held.promise });
  const loading: boolean[] = [];
  h.store.getState().setMessages(CHAT, [message(A, { id: ID, failed: false })]);
  const older = h.callback("loadOlderMessages", { setLoadingOlder: (value: boolean) => loading.push(value) });
  const first = older();
  await flush();
  assert.equal(h.reads.length, 1);
  const fresh = readClient(Promise.resolve({ data: page("fresh"), error: null }));
  await h.callback("fetchMessages", { supabase: fresh.client })({ background: true });
  assert.equal(fresh.requests(), 1);
  assert.equal(h.refs.historyRequestGenerationRef.current, 1);
  assert.equal(h.refs.hasMoreOlderRef.current, true);
  held.resolve({ data: page("obsolete older"), error: null });
  assert.deepEqual(await first, { loaded: 0 });
  assert.equal(h.store.getState().messages[CHAT].some((row: any) => row.content === "obsolete older"), false);
  assert.equal(h.refs.loadingOlderRef.current, false);
  assert.deepEqual(loading, [true, false]);
  assert.deepEqual(await older(), { loaded: 100 });
  assert.equal(h.reads.length, 2, "pagination must issue its next request, not remain permanently busy");
  assert.deepEqual(loading, [true, false, true, false]);
});

test("older busy owner cannot be released by an obsolete same-scope request after returning to that scope", async () => {
  const old = deferred<any>();
  const next = deferred<any>();
  const h = harness({ read: old.promise });
  const loading: boolean[] = [];
  const options = { setLoadingOlder: (value: boolean) => loading.push(value) };
  const reset = () => h.callback("effect:setPinnedRead((current)", { ...options, LIST_READ_PENDING: {},
    setIsTyping: noop, typingTimer: { current: null } })();
  h.store.getState().setMessages(CHAT, [message(A, { id: ID, failed: false })]);
  const older = h.callback("loadOlderMessages", options)();
  await flush();
  h.refs.topicIdRef.current = "temporary-topic" as any;
  reset();
  h.refs.topicIdRef.current = undefined;
  reset();
  const fresh = readClient(Promise.resolve({ data: page("current"), error: null }));
  await h.callback("fetchMessages", { supabase: fresh.client })();
  const nextClient = readClient(next.promise);
  const newer = h.callback("loadOlderMessages", { ...options, supabase: nextClient.client })();
  await flush();
  assert.equal(nextClient.requests(), 1);
  const rows = h.store.getState().messages;
  const calls = loading.length;
  old.resolve({ data: page("obsolete"), error: null });
  assert.deepEqual(await older, { loaded: 0 });
  assert.equal(h.store.getState().messages, rows);
  assert.equal(h.refs.loadingOlderRef.current, true);
  assert.equal(loading.length, calls, "same-scope old finally must respect the independent busy owner");
  next.resolve({ data: [], error: null });
  await newer;
  assert.equal(h.refs.loadingOlderRef.current, false);
});

for (const transition of ["chat", "topic", "A-B", "A-null-A"]) {
  test(`older completion cannot release a newer busy owner after ${transition} transition`, async () => {
    const old = deferred<any>();
    const next = deferred<any>();
    const h = harness({ read: old.promise });
    const loading: boolean[] = [];
    h.store.getState().setMessages(CHAT, [message(A, { id: ID, failed: false })]);
    const options = { setLoadingOlder: (value: boolean) => loading.push(value) };
    const older = h.callback("loadOlderMessages", options)();
    await flush();
    if (transition === "chat") h.refs.chatIdRef.current = "second-chat";
    if (transition === "topic") h.refs.topicIdRef.current = "second-topic" as any;
    if (transition === "A-B") h.switchTo(B);
    if (transition === "A-null-A") { h.switchTo(null); h.switchTo(A); }
    h.callback("effect:setPinnedRead((current)", { ...options, LIST_READ_PENDING: {}, setClearedAt: noop,
      setIsTyping: noop, typingTimer: { current: null } })();
    const target = h.refs.chatIdRef.current;
    const owner = h.store.getState().currentUser.id;
    h.store.getState().setMessages(target, [message(owner, { id: ID, chat_id: target, failed: false,
      topic_id: h.refs.topicIdRef.current ?? null, content: "new scope" })]);
    h.refs.hasMoreOlderRef.current = true;
    const nextClient = readClient(next.promise);
    const newer = h.callback("loadOlderMessages", { ...options, supabase: nextClient.client })();
    await flush();
    assert.equal(nextClient.requests(), 1, "reset scope must permit its own pagination");
    const before = h.store.getState().messages;
    const calls = loading.length;
    old.resolve({ data: page("old"), error: null });
    assert.deepEqual(await older, { loaded: 0 });
    assert.equal(h.store.getState().messages, before);
    assert.equal(h.refs.loadingOlderRef.current, true);
    assert.equal(loading.length, calls, "old finally must not clear new scope's busy claim");
    next.resolve({ data: [], error: null });
    await newer;
    assert.equal(h.refs.loadingOlderRef.current, false);
    assert.equal(loading.at(-1), false);
  });
}

for (const transition of ["chat", "topic", "A-B", "A-null-A"]) {
  test(`stale history invocation cannot invalidate current pending history after ${transition} transition`, async () => {
    const h = harness();
    const stale = h.callback("fetchMessages");
    if (transition === "chat") h.refs.chatIdRef.current = "second-chat";
    if (transition === "topic") h.refs.topicIdRef.current = "second-topic" as any;
    if (transition === "A-B") h.switchTo(B);
    if (transition === "A-null-A") { h.switchTo(null); h.switchTo(A); }
    const read = deferred<any>();
    const current = readClient(read.promise);
    const loading: boolean[] = [];
    const target = h.refs.chatIdRef.current;
    const owner = h.store.getState().currentUser.id;
    const fresh = h.callback("fetchMessages", { chatId: target, topicId: h.refs.topicIdRef.current, userId: owner,
      supabase: current.client, setLoading: (value: boolean) => loading.push(value) })();
    await flush();
    assert.equal(current.requests(), 1);
    assert.equal(h.refs.historyRequestGenerationRef.current, 1);
    await stale({ background: true });
    assert.equal(h.refs.historyRequestGenerationRef.current, 1, "stale caller must not take generation ownership");
    assert.equal(h.reads.length, 0);
    read.resolve({ data: [message(owner, { id: ID, chat_id: target, failed: false,
      topic_id: h.refs.topicIdRef.current ?? null, content: "current verified" })], error: null });
    await fresh;
    assert.deepEqual(loading, [true, false]);
    assert.equal(h.refs.verifiedAccountEpochRef.current, h.store.getState().accountEpoch);
    assert.equal(h.store.getState().messages[target][0].content, "current verified");
  });
}

test("active reconcile positive control schedules and performs history after a missing by-ID reply", async () => {
  const read = deferred<any>();
  const h = harness({ read: read.promise });
  const effect = reconcile(h);
  effect.refresh();
  effect.runNext();
  await flush();
  assert.equal(h.reads.length, 1);
  read.resolve({ data: null, error: null });
  await flush();
  assert.equal(effect.pending.size, 1);
  effect.runNext();
  await flush();
  assert.equal(h.reads.length, 2);
  assert.equal(h.refs.historyRequestGenerationRef.current, 1);
  effect.dispose();
  assert.equal(effect.pending.size, 0);
});

for (const transition of ["chat", "A-B", "A-null-A", "dispose"]) {
  test(`disposed reconcile does not install a timer after a late by-ID reply (${transition})`, async () => {
    const read = deferred<any>();
    const h = harness({ read: read.promise });
    const effect = reconcile(h);
    effect.refresh();
    effect.runNext();
    await flush();
    assert.equal(h.reads.length, 1);
    if (transition === "chat") h.refs.chatIdRef.current = "second-chat";
    if (transition === "A-B") h.switchTo(B);
    if (transition === "A-null-A") { h.switchTo(null); h.switchTo(A); }
    effect.dispose();
    const pending = deferred<any>();
    const current = readClient(pending.promise);
    const loading: boolean[] = [];
    const target = h.refs.chatIdRef.current;
    const owner = h.store.getState().currentUser.id;
    const fresh = h.callback("fetchMessages", { chatId: target, userId: owner, supabase: current.client,
      setLoading: (value: boolean) => loading.push(value) })();
    await flush();
    assert.equal(current.requests(), 1);
    read.resolve({ data: null, error: null });
    await flush();
    assert.equal(effect.pending.size, 0, "cleanup must also dispose the pending promise continuation");
    assert.equal(h.refs.historyRequestGenerationRef.current, 1);
    pending.resolve({ data: [message(owner, { id: ID, chat_id: target, failed: false, content: "current" })], error: null });
    await fresh;
    assert.deepEqual(loading, [true, false]);
    assert.equal(h.refs.verifiedAccountEpochRef.current, h.store.getState().accountEpoch);
    assert.equal(h.store.getState().messages[target][0].content, "current");
  });
}

for (const transition of ["chat", "topic", "A-B", "A-null-A"]) {
  test(`reconcile rejects stale scope before effect cleanup (${transition})`, async () => {
    const read = deferred<any>();
    const h = harness({ read: read.promise });
    const effect = reconcile(h);
    effect.refresh();
    effect.runNext();
    await flush();
    assert.equal(h.reads.length, 1);
    if (transition === "chat") h.refs.chatIdRef.current = "second-chat";
    if (transition === "topic") h.refs.topicIdRef.current = "second-topic" as any;
    if (transition === "A-B") h.switchTo(B, false);
    if (transition === "A-null-A") { h.switchTo(null, false); h.switchTo(A, false); }
    read.resolve({ data: null, error: null });
    await flush();
    assert.equal(effect.pending.size, 0, "stale account/scope must not schedule even before passive cleanup");
    effect.refresh();
    assert.equal(effect.pending.size, 0, "the retained listener must not restart a stale by-ID request");
    assert.equal(h.reads.length, 1);
    effect.dispose();
  });
}

test("logout/login into the same shared chat removes A failed/pending bodies and mention UUIDs before B reads", async () => {
  const h = harness();
  h.store.getState().setMessages(CHAT, [message(), message(A, { id: "tmp:second", client_message_id: "second", failed: false, pending: true })]);
  h.store.getState().setSelectedChatId(CHAT);
  h.switchTo(null);
  assert.deepEqual(h.store.getState().messages, {});
  h.switchTo(B);
  const read = h.callback("fetchMessages", { userId: B });
  await read();
  assert.deepEqual(h.store.getState().messages[CHAT], []);
  assert.equal(h.store.getState().selectedChatId, null);
});

test("same-account profile and heartbeat updates preserve message objects and pending deep-link first login", () => {
  const h = harness();
  h.store.getState().setMessages(CHAT, [message()]);
  h.store.getState().setSelectedChatId(CHAT);
  const before = h.store.getState();
  assert.equal(before.accountEpoch, 1);
  h.store.getState().setCurrentUser({ ...before.currentUser, full_name: "Updated" });
  assert.equal(h.store.getState().messages, before.messages);
  assert.equal(h.store.getState().selectedChatId, CHAT);
  assert.equal(h.store.getState().accountEpoch, 1);
  const updated = h.store.getState();
  h.store.getState().setCurrentUser({ ...updated.currentUser, online_at: "2026-10-01T13:00:00.000Z" });
  assert.equal(h.store.getState(), updated);
  h.switchTo(null);
  h.store.getState().setSelectedChatId(CHAT);
  h.switchTo(B);
  assert.equal(h.store.getState().selectedChatId, CHAT);
  assert.equal(h.store.getState().accountEpoch, 3);
});

test("account boundary also clears message-bearing composer state instead of carrying A into B", () => {
  const h = harness();
  const row = message();
  h.store.getState().setReplyToMessage(row);
  h.store.getState().setEditingMessage(row);
  h.store.getState().setForwardingMessages([row]);
  h.store.getState().setPendingForward({ chatId: CHAT, messages: [row] });
  h.store.getState().setMessageSelection({ chatId: CHAT, ids: [row.id] });
  h.store.getState().setMessageDeleteRequest({ chatId: CHAT, ids: [row.id] });
  h.switchTo(B);
  const state = h.store.getState();
  assert.deepEqual([state.replyToMessage, state.editingMessage, state.forwardingMessages, state.pendingForward,
    state.messageSelection, state.messageDeleteRequest], [null, null, null, null, null, null]);
});

test("stale A ref cannot enqueue or start a history read before B's hook rerenders", async () => {
  const h = harness();
  h.switchTo(B, false);
  assert.equal(await h.callback("sendLocalMessage")({ type: "text", content: text, mentionEntities: JSON.parse(literal) }), null);
  await h.callback("fetchMessages")();
  assert.equal(h.sends.length, 0);
  assert.equal(h.reads.length, 0);
  assert.deepEqual(h.store.getState().messages, {});
});

test("stale same-ID profile ref cannot enqueue after batched A-null-A before rerender", async () => {
  const h = harness();
  const oldHistory = h.callback("fetchMessages");
  h.switchTo(null, false);
  h.switchTo(A, false);
  assert.equal(await h.callback("sendLocalMessage")({ type: "text", content: text, mentionEntities: JSON.parse(literal) }), null);
  await oldHistory();
  await h.callback("fetchMessageById")(ID);
  assert.equal(h.sends.length, 0);
  assert.equal(h.reads.length, 0);
  assert.deepEqual(h.store.getState().messages, {});
});

test("same-account retry preserves owner, original client UUID and serialized mention revision", async () => {
  const h = harness();
  const sendLocalMessage = h.callback("sendLocalMessage");
  const waiting = await h.callback("retryMessageSend", { sendLocalMessage })(message());
  assert.equal(waiting.user_id, "11111111-1111-4111-8111-000000000001");
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].clientMessageId, "55555555-5555-4555-8555-000000000001");
  assert.equal(JSON.stringify(h.sends[0].mentionEntities), literal);
});

test("render boundary rejects A's verified and pinned cache in B's first same-chat render", () => {
  const h = harness();
  const epochA = h.store.getState().accountEpoch;
  h.switchTo(B);
  const accepted = expression("hooks/useMessages.ts", "boundaryVerified", { ...h.env,
    userId: B, accountEpoch: h.store.getState().accountEpoch, verifiedAccountEpochRef: { current: epochA },
    verifiedChatId: CHAT, verifyingChatId: null });
  assert.equal(accepted, false);
});

test("batched same-account relogin reopens reads and realtime for the new epoch", async () => {
  const h = harness();
  const env = { ...h.env, rt: {}, fetchMessages: noop, refreshMessageById: noop, accountEpoch: h.store.getState().accountEpoch };
  const names = ["fetchMessages", "fetchPinnedMessages", "effect:messages:chat:", "effect:profiles:chat:",
    "effect:reactions:chat:", "effect::typing", "effect:hiddenMessagesLive.subscribe",
    "effect:hiddenMessagesLive.canSkip", "effect:markReadWhenVisible"];
  const before = names.map((name) => expression("hooks/useMessages.ts", `deps:${name}`, env));
  h.switchTo(null);
  h.switchTo(A);
  const after = names.map((name) => expression("hooks/useMessages.ts", `deps:${name}`, {
    ...env, accountEpoch: h.store.getState().accountEpoch,
  }));
  for (let index = 0; index < names.length; index++) {
    const reruns = after[index].some((value: any, dependency: number) => !Object.is(value, before[index][dependency]));
    assert.equal(reruns, true, `${names[index]} must reopen without a userId or chatId change`);
  }
  await h.callback("fetchMessages")();
  assert.deepEqual(h.store.getState().messages[CHAT], []);
  const rt = h.realtime();
  await rt.handlers.INSERT({ new: message(A, { id: ID, failed: false, pending: false }) });
  assert.equal(h.store.getState().messages[CHAT][0].content, "synthetic @Ada");
  rt.dispose();
});

for (const callbackName of ["fetchMessages", "fetchMessageById", "refreshMessageById", "loadOlderMessages", "fetchPinnedMessages"]) {
  test(`${callbackName} same-account positive control still accepts the real read`, async () => {
    const row = message(A, { id: ID, pending: false, failed: false, content: "fresh" });
    const h = harness({ read: Promise.resolve({ data: ["fetchMessages", "loadOlderMessages", "fetchPinnedMessages"].includes(callbackName) ? [row] : row, error: null }) });
    h.store.getState().setMessages(CHAT, [message(A, { id: ID })]);
    await h.callback(callbackName)(ID);
    assert.ok(h.reads.length > 0);
    if (callbackName === "fetchPinnedMessages") assert.ok(h.effects.includes("pinned"));
    else assert.equal(h.store.getState().messages[CHAT][0].content, "fresh");
  });
  for (const transition of ["A-B", "A-null-A"]) {
    test(`${callbackName} late A reply cannot mutate a newer ${transition} account epoch`, async () => {
      const held = deferred<any>();
      const h = harness({ read: held.promise });
      h.store.getState().setMessages(CHAT, [message(A, { id: ID, failed: false, pending: false })]);
      const reading = h.callback(callbackName)(ID);
      await flush();
      h.switchTo(transition === "A-B" ? B : null);
      if (transition === "A-null-A") h.switchTo(A);
      h.store.getState().setMessages(CHAT, [message(h.store.getState().currentUser.id, { id: ID, content: "new epoch", mention_entities: { version: 1, revision: null, items: [] } })]);
      const before = h.store.getState().messages;
      const effectCount = h.effects.length;
      held.resolve({ data: callbackName === "fetchMessages" || callbackName === "loadOlderMessages" || callbackName === "fetchPinnedMessages" ? [message()] : message(), error: null });
      await reading;
      assert.equal(h.store.getState().messages, before);
      assert.equal(h.effects.length, effectCount);
    });
  }
}

test("a queued A send ACK cannot return A content or update B before the hook ref rerenders", async () => {
  const ack = deferred<any>();
  const h = harness({ enqueue: ack.promise });
  const sending = h.callback("sendLocalMessage")({ type: "text", content: text, mentionEntities: JSON.parse(literal) });
  await flush();
  h.switchTo(B, false);
  const effectCount = h.effects.length;
  ack.resolve({ kind: "sent", row: message() });
  assert.equal(await sending, null);
  assert.equal(h.effects.length, effectCount);
  assert.deepEqual(h.store.getState().messages, {});
});

for (const event of ["INSERT", "UPDATE"]) {
  test(`realtime ${event} enrichment started by A cannot repopulate B after account switch`, async () => {
    const ack = deferred<any>();
    const h = harness({ read: ack.promise });
    h.store.getState().setMessages(CHAT, [message(A, { id: ID })]);
    const rt = h.realtime();
    const row = message(A, { id: ID, failed: false, pending: false, sender: undefined, reply_to_id: "66666666-6666-4666-8666-000000000001" });
    const reading = rt.handlers[event]({ new: row });
    await flush();
    assert.ok(h.reads.length > 0, "the real enrichment must have started");
    h.switchTo(B);
    h.store.getState().setMessages(CHAT, [message(B, { id: ID, content: "B only" })]);
    const before = h.store.getState().messages;
    const effects = h.effects.length;
    ack.resolve({ data: row, error: null });
    await reading;
    assert.equal(h.store.getState().messages, before);
    assert.equal(h.effects.length, effects);
    const requests = h.reads.length;
    await rt.handlers[event]({ new: row });
    assert.equal(h.reads.length, requests, "stale listener must not start another request");
    assert.equal(h.store.getState().messages, before);
    rt.dispose();
  });
}

for (const name of ["togglePin", "clearChatForMe", "hideMessageForMe"]) {
  test(`${name} late A mutation ACK cannot change B's same-chat rows`, async () => {
    const ack = deferred<any>();
    const h = harness({ read: ack.promise });
    h.store.getState().setMessages(CHAT, [message(A, { id: ID })]);
    const operation = h.callback(name)(ID, false);
    await flush();
    h.switchTo(B);
    h.store.getState().setMessages(CHAT, [message(B, { id: ID, content: "B only" })]);
    const before = h.store.getState().messages;
    const effects = h.effects.length;
    ack.resolve({ data: { pinned: true }, error: null });
    const result = await operation;
    assert.equal(result.ok, false);
    assert.equal(h.store.getState().messages, before);
    assert.equal(h.effects.length, effects);
  });
}

test("B cannot retry A failed row through the actual retry/send adapter", async () => {
  const h = harness();
  h.switchTo(B);
  const sendLocalMessage = h.callback("sendLocalMessage");
  assert.equal(await h.callback("retryMessageSend", { sendLocalMessage })(message()), null);
  assert.equal(h.sends.length, 0);
  assert.deepEqual(h.store.getState().messages, {});
});

test("atomic account switch fences the real outbox ACK before a useOutbox effect can stop it", async () => {
  const ack = deferred<any>();
  const h = harness({ realOutbox: true, read: ack.promise });
  await h.appOutbox.start(A);
  const sending = h.callback("sendLocalMessage")({ type: "text", content: text,
    mentionEntities: JSON.parse(literal), clientMessageId: ID });
  try {
    for (let n = 0; n < 30 && !h.sends.length; n++) await flush();
    assert.equal(h.sends.length, 1);
    h.switchTo(B, false);
    h.store.getState().setMessages(CHAT, [message(B, { content: "B only" })]);
    h.store.getState().setChats([{ id: CHAT, type: "group", updated_at: "2026-10-01T00:00:00.000Z" }]);
    const before = h.store.getState();
    ack.resolve({ data: message(A, { id: ID, failed: false, pending: false }), error: null, status: 201 });
    assert.equal(await sending, null);
    await flush();
    assert.equal(h.store.getState().messages, before.messages);
    assert.equal(h.store.getState().chats, before.chats);
    const persisted = h.queued.get(ID);
    assert.equal(persisted.userId, "11111111-1111-4111-8111-000000000001");
    assert.equal(JSON.stringify(persisted.mentionEntities), literal);
    assert.deepEqual(await h.appOutbox.start(B), []);
    await flush();
    assert.equal(h.sends.length, 1, "B must not send A's retained outbox entry");
    h.switchTo(A);
    await h.appOutbox.start(A);
    for (let n = 0; n < 30 && h.sends.length < 2; n++) await flush();
    assert.equal(h.sends.length, 2);
    assert.equal(h.sends[1].user_id, "11111111-1111-4111-8111-000000000001");
    assert.equal(h.sends[1].client_message_id, "55555555-5555-4555-8555-000000000001");
    assert.equal(JSON.stringify(h.sends[1].mention_entities), literal);
  } finally { ack.resolve({ data: null, error: null }); h.appOutbox.stop(); await sending; }
});

test("account-boundary omission mutants fail literal runtime assertions", { skip: Boolean(process.env.D331_ACCOUNT_MUTANT) }, () => {
  const selections = [
    ["reset", "logout/login into"], ["epoch", "^fetchMessages late A reply.*A-null-A"],
    ["stop", "atomic account switch"], ["profile", "same-account profile and heartbeat"],
    ["history", "^fetchMessages late A reply.*A-B"], ["byId", "^fetchMessageById late A reply.*A-B"],
    ["pinned", "^fetchPinnedMessages late A reply.*A-B"], ["realtime", "realtime INSERT enrichment"],
    ["send", "stale A ref cannot enqueue"], ["owner", "B cannot retry A failed"],
    ["display", "render boundary rejects"], ["mutationAck", "^togglePin late A mutation ACK"],
    ["lifecycle", "batched same-account relogin"], ["refEpoch", "stale same-ID profile ref"],
    ["olderGeneration", "older busy ownership releases"],
    ["olderOwner", "older busy owner cannot be released"],
    ["olderReset", "older completion cannot.*topic transition"],
    ["historyClaim", "stale history invocation.*chat transition"],
    ["reconcileDisposal", "disposed reconcile.*\\(dispose\\)"],
    ["reconcileScope", "reconcile rejects stale scope.*\\(A-null-A\\)"],
  ];
  for (const [mutant, pattern] of selections) {
    const env = { ...process.env, D331_ACCOUNT_MUTANT: mutant };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", `--test-name-pattern=${pattern}`, fileURLToPath(import.meta.url)], {
      env, encoding: "utf8", timeout: 15000,
    });
    const output = result.stdout + result.stderr;
    assert.equal(result.status, 1, `${mutant} survived: ${output}`);
    assert.match(output, /AssertionError|ERR_ASSERTION/);
    assert.match(output, /tests 1\b/);
    assert.doesNotMatch(output, /mutation anchor missing|ReferenceError|Cannot find module|unknown mutation/);
    console.log(`KILLED account omission: ${mutant}`);
  }
});

test("delayed old-topic history reply cannot mutate current cached topic before replacement fetch starts", { timeout: 10_000 }, async () => {
  const oldTopic = "old-topic";
  const currentTopic = "current-topic";
  const oldRow = message(A, { id: ID, topic_id: oldTopic, failed: false, content: "old topic reply" });
  const currentRow = message(A, { id: "55555555-5555-4555-8555-000000000002",
    topic_id: currentTopic, failed: false, content: "current topic cached" });

  const control = harness();
  control.refs.topicIdRef.current = oldTopic as any;
  control.refs.verifiedAccountEpochRef.current = control.store.getState().accountEpoch;
  const controlClient = readClient(Promise.resolve({ data: [oldRow], error: null }));
  await control.callback("fetchMessages", { topicId: oldTopic, supabase: controlClient.client })({ background: true });
  assert.equal(controlClient.requests(), 1, "the same-topic positive control must perform the real read");
  assert.deepEqual(control.store.getState().messages[CHAT].map((row: any) => row.content), ["old topic reply"]);
  assert.ok(control.effects.includes("verified"), "the same-topic reply must reach boundary verification");

  const observed: Array<Record<string, any>> = [];
  for (const answer of ["rows", "refused"] as const) {
    const old = deferred<any>();
    const h = harness();
    h.refs.topicIdRef.current = oldTopic as any;
    h.refs.verifiedAccountEpochRef.current = h.store.getState().accountEpoch;
    h.store.getState().setMessages(CHAT, [oldRow]);
    const oldClient = readClient(old.promise);
    let hiddenReads = 0;
    const reading = h.callback("fetchMessages", {
      topicId: oldTopic,
      supabase: oldClient.client,
      clearedAtCache: { hasFresh: () => false },
      fetchHiddenMessageIdSet: async () => { hiddenReads++; return new Set(); },
    })({ background: true });
    try {
      await flush();
      assert.equal(oldClient.requests(), 1, "the old topic's history request must already be in flight");
      assert.equal(h.refs.historyRequestGenerationRef.current, 1);

      // Model the gap before the cached-topic fallback starts its replacement
      // read: only the active topic changes, while generation remains unchanged.
      h.refs.topicIdRef.current = currentTopic as any;
      h.store.getState().setMessages(CHAT, [currentRow]);
      const before = h.store.getState().messages;
      const effectCount = h.effects.length;
      old.resolve(answer === "rows"
        ? { data: [oldRow], error: null }
        : { data: null, error: { code: "42501", message: "synthetic old-topic refusal" } });
      await reading;
      observed.push({
        answer,
        requests: oldClient.requests(),
        generation: h.refs.historyRequestGenerationRef.current,
        sameRows: h.store.getState().messages === before,
        contents: h.store.getState().messages[CHAT].map((row: any) => row.content),
        hiddenReads,
        effects: h.effects.slice(effectCount),
      });
    } finally {
      old.resolve({ data: [], error: null });
      await reading;
    }
  }
  assert.deepEqual(observed, [
    { answer: "rows", requests: 1, generation: 1, sameRows: true,
      contents: ["current topic cached"], hiddenReads: 0, effects: [] },
    { answer: "refused", requests: 1, generation: 1, sameRows: true,
      contents: ["current topic cached"], hiddenReads: 0, effects: [] },
  ]);
});
