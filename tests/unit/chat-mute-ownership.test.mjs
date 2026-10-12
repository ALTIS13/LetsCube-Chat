import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../../artifacts/kub/src/', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8').replaceAll('\r\n', '\n');
const hookSource = read('hooks/useChatMute.ts');
const listSource = read('components/sidebar/ChatList.tsx');
const storeSource = read('store/app.store.ts');
const requireKub = createRequire(new URL('../../artifacts/kub/package.json', import.meta.url));
const { createStore } = requireKub('zustand/vanilla');
const A = '10000000-0000-0000-0000-000000000001';
const B = '10000000-0000-0000-0000-000000000002';
const CHAT = '20000000-0000-0000-0000-000000000001';
const row = (enabled = false) => ({ chat_id: CHAT, push_enabled: enabled, muted_until: null });
const tick = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function compile(source, imports, globals = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(source, { reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.equal(result.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, { module, exports: module.exports, Date,
    require(name) { assert.ok(Object.hasOwn(imports, name), `blocked import ${name}`); return imports[name]; }, ...globals });
  return module.exports;
}

// Actual full hook/store, mute projection and Zustand core; only lifecycle and
// external I/O are controlled. No Supabase SDK, network or real browser storage.
function fixture({ hook = hookSource, store = storeSource } = {}) {
  const reads = [], writes = [], cache = [], logs = [], storageReads = [];
  let core, cached = null;
  const storage = { getItem: key => { storageReads.push(key); return cached; }, setItem: (...args) => cache.push(args), removeItem: (...args) => cache.push(args) };
  const globals = { window: { localStorage: storage, setTimeout: () => 1, clearTimeout() {} },
    localStorage: storage, console: { error: (...args) => logs.push(args) } };
  const mute = compile(read('lib/chatMute.ts'), {
    './plainMessages.ts': compile(read('lib/plainMessages.ts'), {}, globals),
  }, globals);
  const client = { from(table) {
    assert.equal(table, 'chat_notification_preferences');
    return { select: () => ({ eq(field, userId) {
      assert.equal(field, 'user_id'); const gate = deferred(); reads.push({ userId, ...gate }); return gate.promise;
    } }), upsert(value) { const gate = deferred(); writes.push({ value, ...gate }); return gate.promise; } };
  } };
  const imports = { '@/lib/chatMute': mute, '@/lib/supabase/client': { createClient: () => client },
    '@/lib/errors': { mapPgError: () => 'fixture refusal' }, '@/lib/outbox/appOutbox': { appOutbox: { stop() {} } },
    '@/lib/authSessionIdentity': compile(read('lib/authSessionIdentity.ts'), {}, globals),
    '@/lib/profileChange': { isHeartbeatOnlyProfileChange: () => false },
    zustand: { create(init) { core = createStore(init); return Object.assign((select) => select(core.getState()), core); } },
  };
  const parsed = ts.createSourceFile('store.ts', store, ts.ScriptTarget.Latest, true);
  for (const node of parsed.statements) if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
    const name = node.moduleSpecifier.text;
    if (!Object.hasOwn(imports, name)) imports[name] = {};
  }
  const app = compile(store, imports, globals).useAppStore;
  const slots = [], effects = [];
  let cursor = 0;
  const react = {
    useEffect(callback, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
      }
    }, useMemo: (fn) => fn(), useCallback: (fn) => fn,
  };
  const hooks = compile(hook, { ...imports, react, '@/store/app.store': { useAppStore: app } }, globals);
  const state = () => core.getState();
  function owner(id = A) {
    state().setCurrentUser(null); state().setCurrentUser({ id }); state().syncChatMuteUser(id);
  }
  owner();
  const flush = () => { for (const effect of effects.splice(0)) effect(); };
  function render() { cursor = 0; hooks.useChatMutes(); flush(); }
  function control() { cursor = 0; const value = hooks.useChatMute(CHAT); flush(); return value; }
  function queueRead() { cursor = 0; hooks.useChatMutes(); }
  return { reads, writes, cache, logs, storageReads, state, owner, render, hooks, core,
    control, queueRead, flush,
    cacheValue(value) { cached = value; },
    remount() { for (const slot of slots) slot?.cleanup?.(); slots.length = 0; render(); },
    muted: () => state().mutedChatIds.includes(CHAT),
    seed: (enabled = true) => state().applyServerChatMutes(state().currentUser.id, [row(enabled)]),
  };
}

for (const failure of [false, true]) test(`same UID new epoch rejects late read ${failure ? 'error' : 'success'}`, async () => {
  const f = fixture(); f.render(); f.owner(); f.seed(true);
  if (failure) f.reads[0].reject({ code: 'fixture' });
  else f.reads[0].resolve({ data: [row(false)], error: null });
  await tick();
  assert.equal(f.muted(), false);
  assert.equal(f.state().chatMutes.error, null);
  assert.equal(f.cache.length, 1);
  assert.equal(f.logs.length, 0);
});

for (const replacement of [B, A]) test(`retained hook callback refuses retired owner ${replacement === B ? 'A to B' : 'same UID epoch'}`, async () => {
  const f = fixture(); const retained = f.control().setMute;
  assert.equal(typeof retained, 'function'); f.owner(replacement); f.seed(true);
  const snapshot = f.state().chatMutes, cached = f.cache.length;
  const pending = retained('forever'); await tick();
  assert.equal(f.writes.length, 0, 'RETIRED_CALLBACK_ZERO_UPSERT');
  assert.equal(f.state().chatMutes, snapshot, 'RETIRED_CALLBACK_ZERO_OPTIMISTIC');
  assert.equal(f.cache.length, cached, 'RETIRED_CALLBACK_ZERO_CACHE');
  assert.equal((await pending).ok, false); assert.equal((await pending).error, null);
  const current = f.control().setMute('forever'); await tick();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].value.user_id, replacement);
  f.writes[0].resolve({ error: null }); assert.equal((await current).ok, true); assert.equal(f.muted(), true);
});

for (const initial of [A, null]) test(`queued retired ${initial ? 'A' : 'null'} effect cannot erase B pending draft`, async () => {
  const f = fixture(); if (!initial) { f.state().setCurrentUser(null); f.state().syncChatMuteUser(null); }
  f.queueRead(); f.owner(B); f.seed(true);
  const pending = f.state().setChatMute(CHAT, 'forever'); await tick();
  assert.equal(f.muted(), true); const snapshot = f.state().chatMutes, cached = f.cache.length;
  f.flush(); assert.equal(f.state().chatMutes, snapshot, 'RETIRED_EFFECT_ZERO_SYNC'); assert.equal(f.storageReads.length, 0);
  assert.equal(f.muted(), true, 'RETIRED_EFFECT_PRESERVES_DRAFT'); assert.equal(f.cache.length, cached); assert.equal(f.reads.length, 0);
  f.render(); assert.equal(f.muted(), true); assert.equal(f.reads.length, 1); assert.equal(f.reads[0].userId, B);
  f.writes[0].resolve({ error: null }); assert.equal((await pending).ok, true); assert.equal(f.muted(), true);
});
test('queued same UID old epoch performs no storage or read admission', () => {
  const f = fixture(); f.queueRead(); f.owner(); f.flush();
  assert.equal(f.storageReads.length, 0); assert.equal(f.reads.length, 0);
  f.render(); assert.equal(f.storageReads.length, 1); assert.equal(f.reads.length, 1);
});

function listMute(f, source = listSource) {
  const sf = ts.createSourceFile('ChatList.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks = []; function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'applyMute') callbacks.push(n.initializer.arguments[0].getText(sf));
    ts.forEachChild(n, visit);
  } visit(sf); assert.equal(callbacks.length, 1);
  const feedback = [], closed = [];
  const exports = compile(`export const applyMute = ${callbacks[0]};`, {}, {
    currentUser: f.state().currentUser, muteOwnerId: f.state().currentUser?.id ?? null,
    accountEpoch: f.state().accountEpoch, useAppStore: { getState: f.state },
    setChatMute: f.state().setChatMute, setMuteChoiceOpen: value => closed.push(value),
    showActionFeedback: value => feedback.push(value), chatMuteChoiceTitle: () => 'fictional mute',
  });
  return { apply: exports.applyMute, feedback, closed };
}
for (const replacement of [B, A]) test(`retained ChatList callback refuses retired ${replacement === B ? 'UID' : 'epoch'}`, async () => {
  const f = fixture(), old = listMute(f); f.owner(replacement); f.seed(true);
  const snapshot = f.state().chatMutes, cached = f.cache.length;
  const pending = old.apply(CHAT, 'forever'); await tick();
  assert.equal(f.writes.length, 0, 'RETIRED_LIST_ZERO_UPSERT'); assert.equal(f.state().chatMutes, snapshot);
  assert.equal(f.cache.length, cached); await pending; assert.equal(old.feedback.length, 0); assert.equal(old.closed.length, 0);
});
test('ChatList live write works but retired after-await feedback stays silent', async () => {
  const f = fixture(), live = listMute(f); const pending = live.apply(CHAT, 'forever'); await tick();
  assert.equal(f.writes.length, 1); f.writes[0].resolve({ error: null }); await pending;
  assert.equal(live.feedback.length, 1); assert.equal(live.feedback[0].kind, 'success');
  const next = listMute(f), old = next.apply(CHAT, 'off'); await tick(); f.owner();
  f.writes[1].resolve({ error: null }); await old; assert.equal(next.feedback.length, 0);
});
test('new compiled callback/effect/list ownership omissions are independently killed', async () => {
  const replace = (source, from, to) => { assert.equal(source.split(from).length, 2); return source.replace(from, to); };
  for (const id of [B, A]) {
    const f = fixture({ hook: replace(hookSource, ' && currentOwner({ userId, accountEpoch })', '') });
    const retained = f.control().setMute; f.owner(id); const pending = retained('forever'); await tick();
    assert.throws(() => assert.equal(f.writes.length, 0));
    f.writes[0].resolve({ error: null }); await pending;
  }
  for (const [removed, id] of [['(current.currentUser?.id ?? null) !== userId || ', B], [' || current.accountEpoch !== accountEpoch', A]]) {
    const f = fixture({ hook: replace(hookSource, removed, '') }); f.queueRead();
    // Fixed epoch isolates the UID predicate; ordinary owner() tests both transitions above.
    if (id === B) { f.core.setState({ currentUser: { id: B } }); f.state().syncChatMuteUser(B); }
    else f.owner(id);
    f.flush();
    assert.throws(() => assert.equal(f.storageReads.length, 0));
  }
  const nullEffect = fixture({ hook: replace(hookSource,
    'if ((current.currentUser?.id ?? null) !== userId || current.accountEpoch !== accountEpoch) return;', '') });
  nullEffect.state().setCurrentUser(null); nullEffect.state().syncChatMuteUser(null); nullEffect.queueRead(); nullEffect.owner(B);
  const write = nullEffect.state().setChatMute(CHAT, 'forever'); await tick(); nullEffect.flush();
  assert.throws(() => assert.equal(nullEffect.muted(), true)); nullEffect.writes[0].resolve({ error: null }); await write;
  for (const [from, id] of [['current.currentUser?.id === muteOwnerId', B], ['current.accountEpoch === accountEpoch', A]]) {
    const f = fixture(), callback = listMute(f, replace(listSource, from, 'true'));
    if (id === B) { f.core.setState({ currentUser: { id: B } }); f.state().syncChatMuteUser(B); }
    else f.owner(id);
    const pending = callback.apply(CHAT, 'forever'); await tick(); assert.throws(() => assert.equal(f.writes.length, 0));
    f.writes[0].resolve({ error: null }); await pending;
  }
  const f = fixture(), callback = listMute(f, replace(listSource,
    'const result = await setChatMute(chatId, option);\n    if (!ownsMute()) return;', 'const result = await setChatMute(chatId, option);'));
  const pending = callback.apply(CHAT, 'forever'); await tick(); f.owner(); f.writes[0].resolve({ error: null }); await pending;
  assert.throws(() => assert.equal(callback.feedback.length, 0));
});

test('pending A does not block B read, old finalizer cannot erase B flight', async () => {
  const f = fixture(); f.render(); f.owner(B); f.render();
  assert.equal(f.reads.length, 2);
  f.reads[0].resolve({ data: [row(false)], error: null }); await tick();
  // A newly mounted consumer shares B's pending request, not A's finalizer.
  f.remount(); assert.equal(f.reads.length, 2);
  f.reads[1].resolve({ data: [], error: null }); await tick();
});

test('same UID new epoch schedules a fresh read', () => {
  const f = fixture(); f.render(); f.owner(); f.render(); assert.equal(f.reads.length, 2);
});

for (const failure of [false, true]) test(`retired write ${failure ? 'failure' : 'ack'} cannot publish or cache replacement`, async () => {
  const f = fixture(); f.seed(true); const pending = f.state().setChatMute(CHAT, 'forever'); await tick();
  f.owner(); f.seed(false); const before = f.cache.length;
  f.writes[0].resolve({ error: failure ? { code: 'fixture' } : null });
  const result = await pending;
  assert.equal(f.muted(), true);
  assert.equal(f.cache.length, before);
  assert.equal(result.ok, false);
  assert.equal(result.error, null);
  assert.equal(f.logs.length, 0);
});

test('same chat writes serialize, older failure cannot roll back newer draft', async () => {
  const f = fixture(); f.seed(true);
  const first = f.state().setChatMute(CHAT, 'forever'); await tick();
  const second = f.state().setChatMute(CHAT, 'hour'); await tick();
  assert.equal(f.writes.length, 1);
  f.writes[0].resolve({ error: { code: 'fixture' } }); await first; await tick();
  assert.equal(f.muted(), true);
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1].value.push_enabled, true);
  assert.ok(f.writes[1].value.muted_until);
  f.writes[1].resolve({ error: null }); assert.equal((await second).ok, true);
});

test('newer failure rolls back to confirmed first write, not optimistic draft', async () => {
  const f = fixture(); f.seed(true);
  const first = f.state().setChatMute(CHAT, 'forever'); await tick();
  const second = f.state().setChatMute(CHAT, 'off'); await tick();
  f.writes[0].resolve({ error: null }); await first; await tick();
  f.writes[1].resolve({ error: { code: 'fixture' } }); await second;
  assert.equal(f.state().chatMutes.prefs[CHAT].pushEnabled, false);
  assert.equal(f.muted(), true);
});

test('two refused overlapping writes restore original confirmed state', async () => {
  const f = fixture(); f.seed(true);
  const first = f.state().setChatMute(CHAT, 'forever'); await tick();
  const second = f.state().setChatMute(CHAT, 'hour'); await tick();
  f.writes[0].resolve({ error: { code: 'fixture' } }); await first; await tick();
  f.writes[1].resolve({ error: { code: 'fixture' } }); await second;
  assert.equal(f.muted(), false);
});

test('read started before write cannot overwrite its confirmed result', async () => {
  const f = fixture(); f.render(); const write = f.state().setChatMute(CHAT, 'forever'); await tick();
  f.writes[0].resolve({ error: null }); await write;
  f.reads[0].resolve({ data: [row(true)], error: null }); await tick();
  assert.equal(f.muted(), true);
});

test('read started during write cannot overwrite optimistic or confirmed state', async () => {
  const f = fixture(); const write = f.state().setChatMute(CHAT, 'forever'); await tick(); f.render();
  f.reads[0].resolve({ data: [row(true)], error: null }); await tick(); assert.equal(f.muted(), true);
  f.writes[0].resolve({ error: null }); await write; assert.equal(f.muted(), true);
});

test('current failure keeps public refusal; independent chats need not serialize', async () => {
  const f = fixture(); f.seed(true);
  const one = f.state().setChatMute(CHAT, 'forever');
  const two = f.state().setChatMute('20000000-0000-0000-0000-000000000002', 'off'); await tick();
  assert.equal(f.writes.length, 2);
  f.writes[0].resolve({ error: { code: 'fixture' } }); f.writes[1].resolve({ error: null });
  const result = await one; await two;
  assert.equal(result.ok, false); assert.ok(result.error); assert.equal(f.muted(), false);
});

test('same UID retirement clears display and old cache is not written by pending read', async () => {
  const f = fixture(); f.seed(false); f.owner(); assert.equal(f.muted(), false);
  const write = f.state().setChatMute(CHAT, 'forever'); await tick(); const before = f.cache.length;
  f.render(); f.reads[0].resolve({ data: [], error: null }); await tick();
  assert.equal(f.cache.length, before);
  f.writes[0].resolve({ error: { code: 'fixture' } }); await write;
  assert.equal(f.muted(), false);
});

test('read during write settled before reply cannot overwrite confirmed result', async () => {
  const f = fixture(); const write = f.state().setChatMute(CHAT, 'forever'); await tick(); f.render();
  f.writes[0].resolve({ error: null }); await write;
  f.reads[0].resolve({ data: [], error: null }); await tick(); assert.equal(f.muted(), true);
});

test('superseded failure is silent; successor failure retains public error', async () => {
  const f = fixture(); f.seed(true);
  const first = f.state().setChatMute(CHAT, 'forever'); await tick();
  const second = f.state().setChatMute(CHAT, 'hour');
  f.writes[0].resolve({ error: { code: 'fixture' } });
  assert.equal((await first).error, null); await tick(); assert.equal(f.logs.length, 0);
  f.writes[1].resolve({ error: { code: 'fixture' } });
  assert.ok((await second).error); assert.equal(f.logs.length, 1); assert.equal(f.logs[0].length, 1);
});

test('same account re-entry write waits for already issued old epoch write', async () => {
  const f = fixture(); const first = f.state().setChatMute(CHAT, 'forever'); await tick();
  f.owner(); const second = f.state().setChatMute(CHAT, 'off'); await tick();
  assert.equal(f.writes.length, 1);
  f.writes[0].resolve({ error: null }); assert.equal((await first).ok, false); await tick();
  assert.equal(f.writes.length, 2); assert.equal(f.writes[1].value.push_enabled, true);
  f.writes[1].resolve({ error: null }); assert.equal((await second).ok, true); assert.equal(f.muted(), false);
});

test('fresh read still merges unrelated chat while preserving changed chat', async () => {
  const f = fixture(); f.render(); const write = f.state().setChatMute(CHAT, 'forever'); await tick();
  f.writes[0].resolve({ error: null }); await write;
  const other = '20000000-0000-0000-0000-000000000002';
  f.reads[0].resolve({ data: [{ ...row(), chat_id: other }], error: null }); await tick();
  assert.equal(f.muted(), true); assert.equal(f.state().mutedChatIds.includes(other), true);
});

test('write before first hook mount initializes own snapshot and cache cannot overwrite draft', async () => {
  const f = fixture(); f.seed(true); f.cacheValue(f.cache[0][1]); f.owner();
  const write = f.state().setChatMute(CHAT, 'forever'); await tick();
  assert.equal(f.muted(), true);
  f.render(); assert.equal(f.muted(), true);
  f.writes[0].resolve({ error: null }); await write;
  f.reads[0].resolve({ data: [], error: null }); await tick(); assert.equal(f.muted(), true);
});

test('ACK for one chat cannot cache another chat unconfirmed draft', async () => {
  const f = fixture(); f.seed(true); const before = f.cache.length;
  const first = f.state().setChatMute(CHAT, 'forever');
  const second = f.state().setChatMute('20000000-0000-0000-0000-000000000002', 'forever'); await tick();
  f.writes[0].resolve({ error: null }); await first;
  assert.equal(f.cache.length, before);
  f.writes[1].resolve({ error: { code: 'fixture' } }); await second;
  assert.equal(f.cache.length, before + 1);
});

test('actual compiled omission controls fail literal ownership/order/read assertions', async () => {
  const replace = (text, from, to) => { assert.ok(text.includes(from)); return text.replace(from, to); };
  let f = fixture({ hook: replace(hookSource,
    ' && state.accountEpoch === owner.accountEpoch', '') });
  f.render(); f.owner(); f.reads[0].reject({ code: 'fixture' }); await tick();
  assert.throws(() => assert.equal(f.logs.length, 0));

  f = fixture({ hook: replace(hookSource, ' && a.accountEpoch === b.accountEpoch', '') });
  f.render(); f.owner(); f.render(); assert.throws(() => assert.equal(f.reads.length, 2));

  f = fixture({ hook: replace(hookSource, 'if (inFlight?.request === request) inFlight = null;', 'inFlight = null;') });
  f.render(); f.owner(B); f.render(); f.reads[0].resolve({ data: [], error: null }); await tick();
  f.remount(); assert.throws(() => assert.equal(f.reads.length, 2));

  f = fixture({ store: replace(storeSource, ' && state.accountEpoch === owner.accountEpoch', '') });
  f.seed(true); let first = f.state().setChatMute(CHAT, 'forever'); await tick();
  f.owner(); f.seed(false); f.writes[0].resolve({ error: { code: 'fixture' } }); await first;
  assert.throws(() => assert.equal(f.muted(), true));

  f = fixture({ store: replace(storeSource, '(muteWrites.get(key) ?? Promise.resolve())', 'Promise.resolve()') });
  first = f.state().setChatMute(CHAT, 'forever'); await tick();
  let second = f.state().setChatMute(CHAT, 'off'); await tick();
  assert.throws(() => assert.equal(f.writes.length, 1));
  f.writes[0].resolve({ error: null }); f.writes[1].resolve({ error: null }); await first; await second;

  f = fixture({ store: replace(storeSource,
    'chat.pending || (guard && (guard.revisions.get(id) ?? 0) !== chat.revision)', 'false') });
  f.render(); first = f.state().setChatMute(CHAT, 'forever'); await tick();
  f.writes[0].resolve({ error: null }); await first;
  f.reads[0].resolve({ data: [], error: null }); await tick();
  assert.throws(() => assert.equal(f.muted(), true));

  f = fixture({ store: replace(storeSource, 'chatId, choice.confirmed)', 'chatId, pref)') });
  f.seed(true); first = f.state().setChatMute(CHAT, 'forever'); await tick();
  f.writes[0].resolve({ error: { code: 'fixture' } }); await first;
  assert.throws(() => assert.equal(f.muted(), false));
});
