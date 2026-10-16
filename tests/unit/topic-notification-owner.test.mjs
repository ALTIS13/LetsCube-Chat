import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../artifacts/kub/src/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8').replaceAll('\r\n', '\n');
const hookPath = new URL('hooks/useTopicNotificationPreferences.ts', root);
const source = existsSync(hookPath) ? read('hooks/useTopicNotificationPreferences.ts') : null;
const storeSource = read('store/app.store.ts');
const requireKub = createRequire(new URL('../../artifacts/kub/package.json', import.meta.url));
const { createStore } = requireKub('zustand/vanilla');
const A = '70000000-0000-4000-8000-000000000001', B = '70000000-0000-4000-8000-000000000002';
const CHAT = '70000000-0000-4000-8000-000000000010', OTHER = '70000000-0000-4000-8000-000000000011';
const TOPIC = '70000000-0000-4000-8000-000000000020';
const row = (mode = 'disabled', revision = 1, scope_key = TOPIC) => ({ scope_key, mode, revision });
const ack = (status = 'applied', mode = 'enabled', revision = 2, scope_key = TOPIC) => ({ status, scope_key, mode, revision });
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function compile(text, imports, globals) {
  const result = ts.transpileModule(text, { reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  vm.runInNewContext(result.outputText, { module, exports: module.exports, Date, AbortController,
    require(name) { assert.ok(Object.hasOwn(imports, name), `uncontrolled import ${name}`); return imports[name]; }, ...globals });
  return module.exports;
}
function events() {
  const listeners = new Map();
  return { addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name) { for (const fn of [...(listeners.get(name) ?? [])]) fn(); },
    count(name) { return listeners.get(name)?.size ?? 0; } };
}

// Full production hook/store and real Zustand core. React effect commit/cleanup
// are controlled per mounted consumer; only SDK, browser events and outbox I/O
// are ports. Deferred SDK replies may complete even after abort, deliberately.
function fixture({ hook = source, store = storeSource, storeOnly = false } = {}) {
  const requests = [], channels = [], removed = [], window = events(), document = { ...events(), visibilityState: 'visible' };
  const navigator = { onLine: true }, globals = { window, document, navigator, console: { error() { assert.fail('no raw error logging'); } } };
  let core, active;
  const client = { rpc(name, args) {
    assert.ok(['topic_notification_preferences_read', 'topic_notification_preference_set'].includes(name));
    const gate = deferred(), request = { name, args, ...gate, aborted: false }; requests.push(request);
    gate.promise.abortSignal = signal => { signal.addEventListener('abort', () => { request.aborted = true; }); return gate.promise; };
    return gate.promise;
  }, channel(name) {
    const ch = { name, changes: [], on(kind, filter, fn) { this.changes.push({ kind, filter, fn }); return this; },
      subscribe(fn) { this.status = fn; return this; }, change(payload = {}) { for (const item of this.changes) item.fn(payload); } };
    channels.push(ch); return ch;
  }, removeChannel(ch) { removed.push(ch); return Promise.resolve('ok'); } };
  const mute = compile(read('lib/chatMute.ts'), { './plainMessages.ts': compile(read('lib/plainMessages.ts'), {}, globals) }, globals);
  const imports = { '@/lib/supabase/client': { createClient: () => client }, '@/lib/chatMute': mute,
    '@/lib/errors': { mapPgError: () => 'fixture refusal' }, '@/lib/outbox/appOutbox': { appOutbox: { stop() {} } },
    '@/lib/authSessionIdentity': compile(read('lib/authSessionIdentity.ts'), {}, globals),
    '@/lib/profileChange': compile(read('lib/profileChange.ts'), {}, globals),
    zustand: { create(init) { core = createStore(init); return Object.assign(selector => selector(core.getState()), core); } } };
  const ast = ts.createSourceFile('store.ts', store, ts.ScriptTarget.Latest, true);
  for (const node of ast.statements) if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
    const name = node.moduleSpecifier.text; if (!Object.hasOwn(imports, name)) imports[name] = {};
  }
  const app = compile(store, imports, globals).useAppStore;
  const state = () => core.getState();
  function owner(userId = A, sessionId = 'session-1') {
    state().setAuthSessionIdentity({ userId, sessionId });
    state().setCurrentUser({ id: userId }, state().accountEpoch);
  }
  owner();
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  function memo(fn, deps) { const i = active.cursor++, old = active.slots[i];
    if (!old || !same(old.deps, deps)) active.slots[i] = { deps, value: fn() }; return active.slots[i].value; }
  const react = { useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useRef(value) { const i = active.cursor++; return active.slots[i] ??= { current: value }; },
    useEffect(fn, deps) { const host = active, i = host.cursor++, old = host.slots[i];
      if (!old || !same(old.deps, deps)) host.effects.set(i, () => { old?.cleanup?.(); host.slots[i] = { deps, cleanup: fn() }; }); } };
  let hooks;
  if (!storeOnly) { assert.ok(hook, 'TOPIC_PREFERENCE_HOOK_REQUIRED'); hooks = compile(hook, { react,
    '@/store/app.store': { useAppStore: app }, '@/lib/supabase/client': { createClient: () => client } }, globals); }
  const mounted = [];
  function mount(chatId = CHAT, commit = true) {
    const host = { chatId, cursor: 0, slots: [], effects: new Map(), live: true,
      render(commit = true) { this.cursor = 0; active = this; this.value = hooks.useTopicNotificationPreferences(this.chatId); active = null;
        if (commit) this.commit(); return this.value; },
      commit() { for (const work of this.effects.values()) work(); this.effects.clear(); },
      unmount() { if (!this.live) return; this.live = false; this.effects.clear(); for (const slot of this.slots) slot?.cleanup?.(); this.slots = []; } };
    mounted.push(host); host.render(commit); return host;
  }
  const view = host => host.render();
  const reads = () => requests.filter(r => r.name === 'topic_notification_preferences_read');
  const writes = () => requests.filter(r => r.name === 'topic_notification_preference_set');
  async function ready(host, rows = [row()]) {
    channels.at(-1).status('SUBSCRIBED'); await tick();
    reads().at(-1).resolve({ data: rows, error: null }); await tick(); return view(host);
  }
  return { app, state, owner, mount, view, requests, channels, removed, window, document, navigator, reads, writes, ready,
    close() { for (const host of mounted) host.unmount(); },
    async finishRead(rows, index = -1) { reads().at(index).resolve({ data: rows, error: null }); await tick(); } };
}
function owned(t, options) { const f = fixture(options); t.after(() => f.close()); return f; }

test('actual store retires topic display rows at same-UID new-session boundary', t => {
  const f = owned(t, { storeOnly: true });
  assert.deepEqual(plain(f.state().topicNotificationPreferences), {}, 'TOPIC_DISPLAY_STATE_REQUIRED');
  f.app.setState({ topicNotificationPreferences: { [CHAT]: { userId: A, accountEpoch: f.state().accountEpoch, rows: [row('enabled')] } } });
  const epoch = f.state().accountEpoch; f.owner(A, 'session-2');
  assert.equal(f.state().accountEpoch, epoch + 1);
  assert.deepEqual(plain(f.state().topicNotificationPreferences), {}, 'retirement must erase old confirmed display state');
});

test('two mounted consumers share initial SUBSCRIBED read and one channel', async t => {
  const f = owned(t), a = f.mount(), b = f.mount();
  assert.equal(f.channels.length, 1); assert.equal(f.reads().length, 0);
  await f.ready(a); assert.equal(f.reads().length, 1);
  assert.equal(f.view(b).unavailable, false); assert.equal(f.view(b).rows[0].mode, 'disabled');
  f.channels[0].status('SUBSCRIBED'); await tick(); assert.equal(f.reads().length, 1, 'duplicate subscribe is not a new reconnect');
  a.unmount(); assert.equal(f.removed.length, 0); b.unmount(); assert.equal(f.removed.length, 1);
});

for (const who of [A, B]) test(`old owner read and ACK cannot publish after owner replacement ${who}`, async t => {
  const f = owned(t), h = f.mount(); await f.ready(h);
  const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick();
  const oldChannel = f.channels[0]; f.owner(who, 'session-2'); h.render();
  assert.equal(f.removed.includes(oldChannel), true);
  await f.ready(h, [row('inherit', 4)]);
  f.writes()[0].resolve({ data: ack(), error: null }); await tick();
  assert.equal((await pending).status, 'retired'); assert.equal(f.view(h).rows[0].revision, 4);
});

test('same-UID retired read is dropped before React gets its next render', async t => {
  const f = owned(t), h = f.mount(); f.channels[0].status('SUBSCRIBED'); await tick();
  f.owner(A, 'session-2'); await f.finishRead([row('enabled')], 0);
  assert.deepEqual(plain(f.state().topicNotificationPreferences), {});
  assert.equal(f.view(h).unavailable, true);
});

test('switched-chat read cannot replace the current view', async t => {
  const f = owned(t), h = f.mount(); f.channels[0].status('SUBSCRIBED'); await tick();
  h.chatId = OTHER; h.render(); await f.ready(h, [row('inherit', 3)]);
  await f.finishRead([row('enabled', 7)], 0);
  assert.equal(f.view(h).chatId, OTHER); assert.equal(f.view(h).rows[0].revision, 3);
  assert.equal(f.state().topicNotificationPreferences[CHAT], undefined);
});

for (const loss of ['offline', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) test(`loss ${loss} invalidates trust and reconnect rereads`, async t => {
  const f = owned(t), h = f.mount(); await f.ready(h);
  if (loss === 'offline') { f.navigator.onLine = false; f.window.emit('offline'); }
  else f.channels[0].status(loss);
  assert.equal(f.view(h).unavailable, true); assert.equal(f.view(h).rows[0].mode, 'disabled');
  const count = f.reads().length;
  if (loss === 'offline') { f.navigator.onLine = true; f.window.emit('online'); }
  else f.channels[0].status('SUBSCRIBED');
  await tick(); assert.equal(f.reads().length, count + 1);
  await f.finishRead([row('inherit', 2)]); assert.equal(f.view(h).unavailable, false);
});

test('focus and realtime coalesce an in-flight refresh but require a fresh answer', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h);
  f.window.emit('focus'); await tick(); assert.equal(f.reads().length, 2);
  f.channels[0].change(); await tick(); assert.equal(f.view(h).unavailable, true);
  await f.finishRead([row('enabled', 2)], 1); await tick();
  assert.equal(f.reads().length, 3, 'a change heard during a read needs one successor read');
  assert.equal(f.view(h).unavailable, true);
  await f.finishRead([row('disabled', 3)]); assert.equal(f.view(h).rows[0].revision, 3);
});

test('unmounted callbacks and late channel events cannot dispatch or publish', async t => {
  const f = owned(t), h = f.mount(), other = f.mount(); await f.ready(h);
  const retained = h.render(); h.unmount();
  assert.equal((await retained.setMode(TOPIC, 'enabled', 1)).status, 'retired');
  assert.equal(f.writes().length, 0);
  other.unmount(); const count = f.reads().length;
  f.channels[0].status('SUBSCRIBED'); f.channels[0].change(); f.window.emit('focus'); await tick();
  assert.equal(f.reads().length, count); assert.deepEqual(plain(f.state().topicNotificationPreferences), {});
});

test('pending is not confirmed enable and alias writes get an explicit busy refusal', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h);
  const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick();
  assert.equal(f.view(h).rows[0].mode, 'disabled'); assert.equal(f.view(h).pending.mode, 'enabled');
  assert.equal((await h.render().setMode(null, 'disabled', 0)).status, 'busy'); assert.equal(f.writes().length, 1);
  assert.deepEqual(plain(f.writes()[0].args), { p_chat_id: CHAT, p_topic_id: TOPIC, p_mode: 'enabled', p_expected_revision: 1 });
  f.writes()[0].resolve({ data: ack(), error: null }); assert.equal((await pending).status, 'applied'); await tick();
  assert.equal(f.view(h).rows[0].mode, 'enabled'); assert.equal(f.view(h).pending, null);
});

async function oldReadAgainstWrite(f) {
  const h = f.mount(); await f.ready(h);
  f.window.emit('focus'); await tick();
  const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick();
  f.writes()[0].resolve({ data: ack(), error: null }); await pending; await tick();
  await f.finishRead([row('disabled', 1)], 1);
  assert.equal(f.view(h).rows[0].mode, 'enabled', 'pre-write read must not regress confirmed ACK');
}
test('a pre-write in-flight read cannot regress the confirmed ACK', async t => { await oldReadAgainstWrite(owned(t)); });

test('conflict restores exact server state without retry or overwrite', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h);
  const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick();
  f.writes()[0].resolve({ data: ack('conflict', 'inherit', 4), error: null });
  assert.equal((await pending).status, 'conflict'); await tick();
  assert.equal(f.view(h).rows[0].mode, 'inherit'); assert.equal(f.view(h).conflict.revision, 4);
  assert.equal(f.writes().length, 1);
});

test('server can canonicalize a general-topic UUID ACK to general', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h, [row('disabled', 1, 'general')]);
  const pending = h.render().setMode(TOPIC, 'inherit', 1); await tick();
  f.writes()[0].resolve({ data: ack('applied', 'inherit', 2, 'general'), error: null });
  assert.equal((await pending).status, 'applied'); await tick();
  assert.deepEqual(plain(f.view(h).rows), [row('inherit', 2, 'general')]);
});

const invalidRows = [null, {}, [row('enable')], [row('enabled', 0)], [row('enabled', 1.5)],
  [row('enabled', 9007199254740992)], [row('enabled', 1, TOPIC.toUpperCase().replace('7000', 'ABCD'))],
  [row('enabled', 1, 'unknown')], [row(), row()], [{ ...row(), user_id: B }]];
for (const [i, data] of invalidRows.entries()) test(`malformed rows ${i} mean unavailable, never a successful empty snapshot`, async t => {
  const f = owned(t), h = f.mount(); await f.ready(h, data);
  assert.equal(f.view(h).unavailable, true); assert.equal(f.view(h).error.retryable, true);
});

const invalidAcks = [null, [], { ...ack(), mode: 'disabled' }, ack('applied', 'enabled', 1), ack('applied', 'enabled', 9007199254740992),
  ack('applied', 'enabled', 2, OTHER), ack('unknown'), { ...ack(), recipient: B }];
for (const [i, data] of invalidAcks.entries()) test(`malformed ACK ${i} cannot confirm a write`, async t => {
  const f = owned(t), h = f.mount(); await f.ready(h);
  const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick();
  f.writes()[0].resolve({ data, error: null }); assert.equal((await pending).status, 'unavailable'); await tick();
  assert.equal(f.view(h).unavailable, true); assert.equal(f.view(h).rows[0].mode, 'disabled');
  assert.equal(f.view(h).error.retryable, true); assert.equal(f.writes().length, 1);
});

test('read refusal preserves stale display rows and explicit refresh can recover', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h); const pending = h.render().refresh(); await tick();
  f.reads().at(-1).resolve({ data: null, error: { message: 'not for UI' } }); await pending; await tick();
  assert.equal(f.view(h).unavailable, true); assert.equal(f.view(h).rows[0].mode, 'disabled');
  assert.equal(JSON.stringify(f.view(h)).includes('not for UI'), false);
  const retry = h.render().refresh(); await tick(); await f.finishRead([]); await retry;
  assert.equal(f.view(h).unavailable, false); assert.deepEqual(plain(f.view(h).rows), []);
});

test('offline write ACK and writer unmount are unknown, never a confirmed publication', async t => {
  const f = owned(t), h = f.mount(), observer = f.mount(); await f.ready(h);
  const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick();
  f.navigator.onLine = false; f.window.emit('offline'); h.unmount();
  f.writes()[0].resolve({ data: ack(), error: null }); assert.equal((await pending).status, 'retired');
  assert.equal(f.view(observer).unavailable, true); assert.equal(f.view(observer).rows[0].mode, 'disabled');
});

test('two explicit refresh callers share the same read without a redundant successor', async t => {
  const f = owned(t), a = f.mount(), b = f.mount(); await f.ready(a);
  const first = a.render().refresh(), second = b.render().refresh(); await tick();
  assert.equal(f.reads().length, 2);
  await f.finishRead([row('inherit', 2)]); await Promise.all([first, second]); await tick();
  assert.equal(f.reads().length, 2, 'explicit refresh consumers must deduplicate');
  assert.equal(f.view(a).unavailable, false);
});

for (const badError of [undefined, false, 0]) test(`malformed SDK envelope error=${badError} cannot become a ready snapshot`, async t => {
  const f = owned(t), h = f.mount(); f.channels[0].status('SUBSCRIBED'); await tick();
  f.reads()[0].resolve({ data: [], error: badError }); await tick();
  assert.equal(f.view(h).unavailable, true, 'only explicit error:null is a successful SDK envelope');
});

test('malformed SDK setter envelope cannot confirm a write', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h);
  const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick();
  f.writes()[0].resolve({ data: ack(), error: false });
  assert.equal((await pending).status, 'unavailable');
  assert.equal(f.view(h).rows[0].mode, 'disabled');
});

test('post-outage ACK confirms only its row, not the unrefreshed full snapshot', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h);
  f.channels[0].status('CHANNEL_ERROR'); f.channels[0].status('SUBSCRIBED'); await tick();
  const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick();
  f.writes()[0].resolve({ data: ack(), error: null }); assert.equal((await pending).status, 'applied'); await tick();
  assert.equal(f.view(h).unavailable, true, 'one ACK cannot restore a full snapshot lost during outage');
  assert.equal(f.reads().length, 3, 'a fresh post-write full read is required');
  await f.finishRead([row('enabled', 2)]); assert.equal(f.view(h).unavailable, false);
  await f.finishRead([row('disabled', 1)], 1); assert.equal(f.view(h).rows[0].mode, 'enabled');
});

test('a retained old-chat callback is refused before effect cleanup even with another old-chat consumer', async t => {
  const f = owned(t), h = f.mount(), observer = f.mount(); await f.ready(h);
  const retained = h.render(); h.chatId = OTHER; h.render(false);
  assert.equal((await retained.setMode(TOPIC, 'enabled', 1)).status, 'retired');
  assert.equal(f.writes().length, 0, 'old-chat callback must dispatch zero writes');
  h.commit(); assert.equal(f.view(observer).chatId, CHAT);
});

test('parallel active chats publish only into their own stamped store view', async t => {
  const f = owned(t), a = f.mount(), b = f.mount(OTHER);
  f.channels[0].status('SUBSCRIBED'); f.channels[1].status('SUBSCRIBED'); await tick();
  await f.finishRead([row('disabled', 1)], 0); await f.finishRead([row('inherit', 5)], 1);
  assert.equal(f.view(a).rows[0].revision, 1); assert.equal(f.view(b).rows[0].revision, 5);
  assert.equal(f.view(a).accountEpoch, f.state().accountEpoch); assert.equal(f.view(b).userId, A);
});

test('unmounting an in-flight writer drops ACK while remaining consumers reread the server', async t => {
  const f = owned(t), h = f.mount(), observer = f.mount(); await f.ready(h);
  const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick(); h.unmount(); await tick();
  assert.equal(f.view(observer).unavailable, true); assert.equal(f.reads().length, 2);
  await f.finishRead([row('inherit', 3)]);
  f.writes()[0].resolve({ data: ack(), error: null }); assert.equal((await pending).status, 'retired');
  assert.equal(f.view(observer).rows[0].revision, 3);
});

test('revision0 conflict is absence, not a persisted row or an automatic retry', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h, []);
  const pending = h.render().setMode(null, 'enabled', 1); await tick();
  f.writes()[0].resolve({ data: ack('conflict', 'inherit', 0, 'general'), error: null });
  assert.equal((await pending).status, 'conflict');
  assert.equal(f.view(h).conflict.revision, 0); assert.deepEqual(plain(f.view(h).rows), []);
  assert.equal(f.writes().length, 1);
});

test('SDK write rejection is unavailable without raw messages or automatic CAS retry', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h);
  const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick();
  f.writes()[0].reject(new Error('private provider detail'));
  assert.equal((await pending).status, 'unavailable');
  assert.equal(f.view(h).rows[0].mode, 'disabled'); assert.equal(f.view(h).pending, null);
  assert.equal(f.writes().length, 1); assert.equal(JSON.stringify(f.view(h)).includes('private provider detail'), false);
});

test('invalid CAS inputs cannot issue any RPC and safe-integer maximum is readable', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h, [row('inherit', 9007199254740991)]);
  assert.equal(f.view(h).rows[0].revision, 9007199254740991);
  for (const args of [[TOPIC, 'unknown', 1], [TOPIC, 'enabled', -1], [TOPIC, 'enabled', 1.5],
    [TOPIC, 'enabled', 9007199254740992], ['bad-topic', 'enabled', 0]])
    assert.equal((await h.render().setMode(...args)).status, 'invalid');
  assert.equal(f.writes().length, 0);
});

test('same-owner immediate remount cannot reuse a channel still being unsubscribed', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h); const old = f.channels[0];
  h.unmount(); const next = f.mount();
  assert.notEqual(f.channels[1].name, old.name, 'remount must not reuse an unsubscribing SDK channel');
  await f.ready(next, [row('inherit', 2)]); old.status('CHANNEL_ERROR'); old.change();
  assert.equal(f.view(next).unavailable, false); assert.equal(f.view(next).rows[0].revision, 2);
});

test('coalesced explicit reads do not leave a phantom refresh queued behind the next CAS', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h);
  const first = h.render().refresh(), second = h.render().refresh(); await tick();
  await f.finishRead([row('disabled', 1)]); await Promise.all([first, second]);
  const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick();
  f.writes()[0].resolve({ data: ack(), error: null }); await pending; await tick();
  assert.equal(f.reads().length, 2, 'coalescing must not queue a phantom post-CAS read');
  assert.equal(f.view(h).unavailable, false);
});

test('queued retired effect admits no subscription for a replaced owner', async t => {
  const f = owned(t), h = f.mount(CHAT, false);
  assert.equal(f.channels.length, 0); f.owner(B, 'session-2'); h.commit();
  assert.equal(f.channels.length, 0, 'retired effect must not subscribe under another owner');
  assert.deepEqual(plain(f.state().topicNotificationPreferences), {});
  h.render(); await f.ready(h); assert.equal(f.channels.length, 1); assert.equal(f.view(h).userId, B);
});

test('synchronous account retirement while pending is published admits zero old-owner writes', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h); let switched = false;
  const stop = f.app.subscribe(state => {
    if (!switched && state.topicNotificationPreferences[CHAT]?.pending) { switched = true; f.owner(B, 'session-2'); }
  }); t.after(stop);
  const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick();
  assert.equal(f.writes().length, 0, 'retirement during pending publication must precede RPC admission');
  assert.equal((await pending).status, 'retired');
});

test('synchronous account retirement during refresh loading admits zero old-owner reads', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h); let switched = false;
  const stop = f.app.subscribe(state => {
    if (!switched && state.topicNotificationPreferences[CHAT]?.loading) { switched = true; f.owner(B, 'session-2'); }
  }); t.after(stop);
  const pending = h.render().refresh(); await tick();
  assert.equal(f.reads().length, 1, 'retirement during loading publication must precede RPC admission'); await pending;
});

test('synchronous account retirement at initial view publication admits zero old-owner channels', t => {
  const f = owned(t); let switched = false;
  const stop = f.app.subscribe(state => {
    if (!switched && state.topicNotificationPreferences[CHAT]) { switched = true; f.owner(B, 'session-2'); }
  }); t.after(stop); f.mount();
  assert.equal(f.channels.length, 0, 'retirement during initial publication must precede channel admission');
  assert.equal(f.window.count('focus'), 0);
});

test('a read failure retires full-snapshot trust before a later single-row ACK', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h);
  const failed = h.render().refresh(); await tick(); f.reads().at(-1).reject(new Error('fixture refusal')); await failed;
  void h.render().refresh(); await tick();
  const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick();
  f.writes()[0].resolve({ data: ack(), error: null }); await pending; await tick();
  assert.equal(f.view(h).unavailable, true, 'one row ACK cannot restore a failed full snapshot');
  assert.equal(f.reads().length, 4);
  await f.finishRead([row('enabled', 2)]); assert.equal(f.view(h).unavailable, false);
});

test('an unknown write retires snapshot trust before a different-scope ACK', async t => {
  const f = owned(t), h = f.mount(); await f.ready(h);
  const failed = h.render().setMode(TOPIC, 'enabled', 1); await tick();
  f.writes()[0].reject(new Error('outcome unknown')); assert.equal((await failed).status, 'unavailable');
  void h.render().refresh(); await tick(); const next = h.render().setMode(null, 'disabled', 0); await tick();
  f.writes()[1].resolve({ data: ack('applied', 'disabled', 1, 'general'), error: null }); await next; await tick();
  assert.equal(f.view(h).unavailable, true, 'different-scope ACK cannot restore an unknown write snapshot');
  assert.equal(f.reads().length, 3);
  await f.finishRead([row('enabled', 2), row('disabled', 1, 'general')]); assert.equal(f.view(h).unavailable, false);
});

function replaceOnce(text, before, after) { assert.equal(text.split(before).length, 2, `mutation anchor ${before}`); return text.replace(before, after); }
const mutants = [
  ['store retirement omission', 'store', 'mutedChatIds: [], topicNotificationPreferences: {},', 'mutedChatIds: [],', async f => {
    f.app.setState({ topicNotificationPreferences: { [CHAT]: { rows: [row('enabled')] } } }); f.owner(A, 'session-2');
    assert.deepEqual(plain(f.state().topicNotificationPreferences), {}, 'retirement purges topic rows');
  }, 'retirement purges topic rows'],
  ['persisted revision0 admitted', 'hook', 'value.revision < 1', 'value.revision < 0', async f => {
    const h = f.mount(); await f.ready(h, [row('enabled', 0)]);
    assert.equal(f.view(h).unavailable, true, 'persisted zero is not confirmed');
  }, 'persisted zero is not confirmed'],
  ['SDK envelope weakened', 'hook', 'response.error !== null) throw new Error("read_failed")', 'response.error) throw new Error("read_failed")', async f => {
    const h = f.mount(); f.channels[0].status('SUBSCRIBED'); await tick(); f.reads()[0].resolve({ data: [], error: false }); await tick();
    assert.equal(f.view(h).unavailable, true, 'malformed SDK envelope is not ready');
  }, 'malformed SDK envelope is not ready'],
  ['per-chat busy latch omitted', 'hook', 'if (entry.write) return { status: "busy" };', '', async f => {
    const h = f.mount(); await f.ready(h); const first = h.render().setMode(TOPIC, 'enabled', 1);
    const second = h.render().setMode(null, 'disabled', 0); await tick();
    assert.equal(f.writes().length, 1, 'one pending CAS per chat');
    assert.equal((await second).status, 'busy'); f.writes()[0].resolve({ data: ack(), error: null }); await first;
  }, 'one pending CAS per chat'],
  ['conflict reported as applied', 'hook', 'return { status: raw.status, row };', 'return { status: "applied", row };', async f => {
    const h = f.mount(); await f.ready(h); const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick();
    f.writes()[0].resolve({ data: ack('conflict', 'inherit', 4), error: null });
    assert.equal((await pending).status, 'conflict', 'server conflict is not applied');
  }, 'server conflict is not applied'],
  ['pre-write read fence omitted', 'hook', '.abortSignal(ticket.controller.signal);\n      if (!current(entry) || entry.read !== ticket) return;',
    '.abortSignal(ticket.controller.signal);\n      if (!current(entry)) return;', oldReadAgainstWrite,
    'pre-write read must not regress confirmed ACK'],
  ['channel loss invalidation omitted', 'hook', 'else { own.connected = false; lose(own); }', 'else { own.connected = false; }', async f => {
    const h = f.mount(); await f.ready(h); f.channels[0].status('CHANNEL_ERROR');
    assert.equal(f.view(h).unavailable, true, 'channel loss invalidates confirmed trust');
  }, 'channel loss invalidates confirmed trust'],
  ['outage snapshot retirement omitted', 'hook', 'if (!current(entry)) return;\n  entry.snapshot = false;', 'if (!current(entry)) return;', async f => {
    const h = f.mount(); await f.ready(h); f.channels[0].status('CHANNEL_ERROR'); f.channels[0].status('SUBSCRIBED'); await tick();
    const pending = h.render().setMode(TOPIC, 'enabled', 1); await tick(); f.writes()[0].resolve({ data: ack(), error: null }); await pending;
    assert.equal(f.view(h).unavailable, true, 'row ACK cannot restore outage snapshot');
  }, 'row ACK cannot restore outage snapshot'],
  ['rendered chat callback fence omitted', 'hook', ' && now.chatId === chatId', '', async f => {
    const h = f.mount(); f.mount(); await f.ready(h); const retained = h.render(); h.chatId = OTHER; h.render(false);
    const pending = retained.setMode(TOPIC, 'enabled', 1); await tick();
    assert.equal(f.writes().length, 0, 'retained old-chat callback is not a write'); await pending;
  }, 'retained old-chat callback is not a write'],
  ['channel incarnation counter omitted', 'hook', '${++channelGeneration}', '${channelGeneration}', async f => {
    const h = f.mount(); await f.ready(h); const old = f.channels[0].name; h.unmount(); f.mount();
    assert.notEqual(f.channels[1].name, old, 'remount channel incarnation must advance');
  }, 'remount channel incarnation must advance'],
];
for (const [name, kind, before, after, verify, message] of mutants) test(`literal omission control: ${name}`, async () => {
  const f = fixture(kind === 'store' ? { store: replaceOnce(storeSource, before, after) } : { hook: replaceOnce(source, before, after) });
  try { await assert.rejects(async () => verify(f), error => error.code === 'ERR_ASSERTION' && error.message.includes(message)); }
  finally { f.close(); }
});
