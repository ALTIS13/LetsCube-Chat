import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { createRealtimeRevival } from '../../artifacts/kub/src/lib/realtimeRevival.ts';
import { createConnectionStateMachine } from '../../artifacts/kub/src/lib/connectionState.ts';
import { createDeadlineFetch } from '../../artifacts/kub/src/lib/supabase/deadlineFetch.ts';

const require = createRequire(new URL('../../artifacts/kub/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
assert.equal(require('@supabase/supabase-js/package.json').version, '2.105.1');
const ORIGIN = 'https://network-reconnect.fixture.invalid';
const UID = '10000000-0000-4000-8000-000000000001';
const NOW = Date.UTC(2030, 0, 1);
const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); await new Promise(setImmediate); };
const source = readFileSync(new URL('../../artifacts/kub/src/lib/realtimeRevival.ts', import.meta.url), 'utf8');
function loadMutant(change) {
  const changed = change(source); assert.notEqual(changed, source, 'loaded omission must change actual source');
  const module = { exports: {} };
  const compiled = ts.transpileModule(changed, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports,
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle) });
  return module.exports.createRealtimeRevival;
}

async function fixture(t, { revivalFactory = createRealtimeRevival } = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: NOW });
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: UID, exp: NOW / 1000 + 7200, aud: 'authenticated' })}.synthetic`;
  const session = { access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer',
    expires_in: 7200, expires_at: NOW / 1000 + 7200,
    user: { id: UID, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {},
      created_at: new Date(NOW).toISOString(), identities: [], is_anonymous: false } };
  const key = 'network-reconnect-synthetic-session';
  const storage = new Map([[key, JSON.stringify(session)]]);
  const sockets = [], statuses = [], authEvents = [], reads = [];
  const route = { state: 'healthy' }, metrics = { replaced: 0, heartbeatReplies: 0 };
  class Transport {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = 0; bufferedAmount = 0;
    constructor(url) {
      const endpoint = new URL(url);
      assert.equal(endpoint.origin, ORIGIN.replace('https:', 'wss:'));
      assert.equal(endpoint.pathname, '/realtime/v1/websocket');
      sockets.push(this);
      if (route.state === 'healthy') queueMicrotask(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1; this.onopen?.({});
      });
    }
    send(raw) {
      assert.equal(typeof raw, 'string', 'these join/heartbeat controls use real SDK JSON frames');
      const [joinRef, ref, topic, event, payload] = JSON.parse(raw);
      if (route.state !== 'healthy') return;
      if (event === 'heartbeat') metrics.heartbeatReplies++;
      const response = event === 'phx_join'
        ? { postgres_changes: payload.config.postgres_changes.map((binding, index) => ({ ...binding, id: index + 1 })) }
        : {};
      queueMicrotask(() => {
        if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]) });
      });
    }
    close() {
      this.readyState = 3;
      queueMicrotask(() => this.onclose?.({ code: 1000, wasClean: true }));
    }
  }
  const fetcher = createDeadlineFetch(async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, ORIGIN, 'unknown network target refused');
    assert.equal(url.pathname, '/rest/v1/profiles', 'no real Auth/messages transport');
    assert.equal(init.method, 'GET'); reads.push({ method: init.method });
    return new Response(JSON.stringify([{ id: UID }]), { headers: { 'content-type': 'application/json' } });
  });
  const client = createClient(ORIGIN, 'synthetic-public-key', {
    global: { fetch: fetcher }, realtime: { transport: Transport },
    auth: { storageKey: key, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: name => storage.get(name) ?? null, setItem: (name, value) => storage.set(name, value),
        removeItem: name => storage.delete(name) }, lock: async (_name, _timeout, work) => work() },
  });
  const subscription = client.auth.onAuthStateChange((event, current) => {
    authEvents.push(event);
    if (current?.access_token) void client.realtime.setAuth(current.access_token);
  }).data.subscription;
  assert.equal((await client.auth.getSession()).data.session.user.id, UID);
  const revival = revivalFactory(client.realtime, { onReplaced: () => { metrics.replaced++; } });
  client.realtime.onHeartbeat(status => revival.heartbeat(status));
  const machine = createConnectionStateMachine();
  const state = () => machine.next({ deviceOnline: true, socketOpen: client.realtime.isConnected() });
  const channel = client.channel('synthetic-reconnect-probe')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${UID}` }, () => {})
    .subscribe(status => statuses.push(status));
  await drain();
  assert.equal(channel.state, 'joined', 'real SDK initial join calibration');
  assert.equal(statuses.filter(status => status === 'SUBSCRIBED').length, 1);
  assert.equal(state(), 'online');
  t.after(async () => {
    revival.dispose(); route.state = 'healthy'; subscription.unsubscribe();
    const removed = client.removeAllChannels();
    t.mock.timers.tick(10001); await drain(); await removed;
    const disconnected = client.realtime.disconnect();
    t.mock.timers.tick(10001); await drain(); await disconnected;
    await client.auth.stopAutoRefresh();
  });
  return { client, revival, route, sockets, statuses, authEvents, metrics, reads, state, fetcher,
    async tick(ms) { t.mock.timers.tick(ms); await drain(); },
    async verifyReadAndSession() {
      const result = await client.from('profiles').select('id').eq('id', UID);
      assert.equal(result.error, null); assert.deepEqual(result.data, [{ id: UID }]);
      assert.equal((await client.auth.getSession()).data.session.user.id, UID);
      assert.equal(storage.has(key), true); assert.equal(authEvents.includes('SIGNED_OUT'), false);
      assert.equal(fetcher.waiting(), 0);
    } };
}

test('actual SDK healthy route answers revival without replacing transport or losing Auth', async t => {
  const f = await fixture(t);
  assert.equal(f.revival.doubt(), 'probe'); await drain();
  await f.tick(15000);
  assert.equal(f.sockets.length, 1); assert.equal(f.metrics.replaced, 0);
  assert.equal(f.metrics.heartbeatReplies, 1); assert.equal(f.state(), 'online');
  await f.verifyReadAndSession();
});

async function recoveredStalledHandshake(t, revivalFactory = createRealtimeRevival) {
  const f = await fixture(t, { revivalFactory });
  f.route.state = 'stalled';
  assert.equal(f.revival.doubt(), 'probe');
  await f.tick(4000); await f.tick(1000);
  assert.equal(f.metrics.replaced, 1, 'actual Phoenix heartbeat timeout calibration');
  assert.equal(f.sockets.length, 2); assert.equal(f.client.realtime.isConnecting(), true);
  f.state(); await f.tick(2000); assert.equal(f.state(), 'connecting');
  // The old SYN remains stuck; only a fresh transport will use the restored route.
  f.route.state = 'healthy';
  await f.tick(13000);
  assert.equal(f.sockets.length, 3, 'RECOVERY_HANDSHAKE_MUST_RETRY_WITHOUT_ANOTHER_UI_EVENT');
  assert.equal(f.client.realtime.isConnected(), true);
  assert.equal(f.statuses.filter(status => status === 'SUBSCRIBED').length, 2, 'actual SDK channel must rejoin');
  assert.equal(f.state(), 'online');
  await f.verifyReadAndSession();
}
test('actual SDK new recovery handshake cannot strand CONNECTING after the route recovers', recoveredStalledHandshake);

test('SDK-owned heartbeat recovery is supervised even without an explicit UI doubt', async t => {
  const f = await fixture(t);
  f.route.state = 'stalled';
  await f.tick(25000); await f.tick(25000); await f.tick(1000);
  assert.equal(f.sockets.length, 2); assert.equal(f.client.realtime.isConnecting(), true);
  f.route.state = 'healthy';
  await f.tick(10000);
  assert.equal(f.sockets.length, 3, 'SDK_TIMEOUT_RECOVERY_MUST_NOT_NEED_A_UI_EVENT');
  assert.equal(f.statuses.filter(status => status === 'SUBSCRIBED').length, 2);
  assert.equal(f.client.realtime.isConnected(), true);
  await f.verifyReadAndSession();
});

function recoveryClock(t, factory = createRealtimeRevival, { failConnect = false } = {}) {
  let clock = 0;
  const pending = new Set();
  const state = { phase: 'closed', connects: 0, disconnects: 0, failConnect };
  const revival = factory({
    isConnected: () => state.phase === 'open', isConnecting: () => state.phase === 'connecting',
    connect() { state.connects++; if (state.failConnect) throw new Error('synthetic constructor refusal'); state.phase = 'connecting'; },
    async disconnect() { state.disconnects++; state.phase = 'closed'; },
    sendHeartbeat() { assert.fail('closed transport cannot send a heartbeat'); },
  }, { timers: {
    set(run, ms) { const timer = { at: clock + ms, run }; pending.add(timer); return timer; },
    clear(timer) { pending.delete(timer); },
  } });
  t.after(() => revival.dispose());
  return { revival, state, pending, async tick(ms) {
    clock += ms;
    for (const timer of [...pending]) if (timer.at <= clock) { pending.delete(timer); timer.run(); }
    await drain();
  } };
}

test('one recovery deadline is literal ten seconds and concurrent doubts do not multiply it', async t => {
  const f = recoveryClock(t);
  f.revival.doubt();
  assert.equal(f.state.connects, 1); assert.equal(f.pending.size, 1);
  // Repeated heartbeat loss reports join the same follow-up, not a new timer.
  f.revival.heartbeat('timeout'); f.revival.heartbeat('disconnected');
  assert.equal(f.pending.size, 1);
  await f.tick(9999); assert.equal(f.state.disconnects, 0);
  await f.tick(1); assert.equal(f.state.disconnects, 1); assert.equal(f.state.connects, 2);
  assert.equal(f.pending.size, 1, 'the new handshake retains exactly one deadline');
  f.state.phase = 'open'; await f.tick(10000);
  assert.equal(f.pending.size, 0, 'healthy recovery ends supervision, no permanent polling');
});

async function staleRecovery(t, factory = createRealtimeRevival) {
  const f = recoveryClock(t, factory);
  f.revival.doubt();
  const stale = [...f.pending][0].run;
  await f.tick(9000);
  f.revival.doubt(); await drain();
  assert.equal(f.state.disconnects, 1); assert.equal(f.state.connects, 2);
  stale(); await drain();
  assert.equal(f.state.disconnects, 1, 'STALE_TIMEOUT_MUST_NOT_DROP_NEW_HANDSHAKE');
  assert.equal(f.pending.size, 1, 'stale timeout cannot clear the new deadline');
  await f.tick(9999); assert.equal(f.state.disconnects, 1);
  await f.tick(1); assert.equal(f.state.disconnects, 2);
}
test('a replaced attempt retires even an already queued old timeout', staleRecovery);

async function disposedRecovery(t, factory = createRealtimeRevival) {
  const f = recoveryClock(t, factory);
  f.revival.doubt();
  const queued = [...f.pending][0].run;
  f.revival.dispose();
  assert.equal(f.pending.size, 0, 'dispose must clear its allocated timer');
  queued(); await drain(); // Already queued task cannot be recalled by clearTimeout.
  f.revival.heartbeat('timeout'); f.revival.doubt();
  assert.equal(f.state.disconnects, 0, 'RETIRED_RECOVERY_MUST_NOT_DROP_SHARED_TRANSPORT');
  assert.equal(f.state.connects, 1); assert.equal(f.pending.size, 0);
}
test('disposed recovery rejects queued work and late heartbeat events', disposedRecovery);

test('a refused closed-socket connect retries at the bounded cadence without a hot loop', async t => {
  const f = recoveryClock(t, createRealtimeRevival, { failConnect: true });
  assert.doesNotThrow(() => f.revival.doubt());
  assert.equal(f.state.connects, 1);
  await f.tick(9999); assert.equal(f.state.connects, 1);
  await f.tick(1); assert.equal(f.state.connects, 2); assert.equal(f.pending.size, 1);
  f.state.failConnect = false; await f.tick(10000);
  assert.equal(f.state.connects, 3); assert.equal(f.state.phase, 'connecting');
});

for (const [name, change] of [
  ['follow-up watchdog', source => source.replace('if (disposed || recovery !== null) return;', 'return;')],
  ['ten-second budget', source => source.replace('CONNECTING_TIMEOUT_MS = 10_000', 'CONNECTING_TIMEOUT_MS = 100_000')],
]) test(`loaded omission of ${name} fails the actual SDK recovery oracle`, async t => {
  await assert.rejects(() => recoveredStalledHandshake(t, loadMutant(change)), error =>
    error.code === 'ERR_ASSERTION' && error.message.includes('RECOVERY_HANDSHAKE_MUST_RETRY_WITHOUT_ANOTHER_UI_EVENT'));
});

test('loaded omission of retirement guards fails the queued callback oracle', async t => {
  const mutant = loadMutant(source => source.replaceAll('disposed || ', '').replaceAll('!disposed && ', '')
    .replace('if (disposed) return;', ''));
  await assert.rejects(() => disposedRecovery(t, mutant), error =>
    error.code === 'ERR_ASSERTION' && error.message.includes('RETIRED_RECOVERY_MUST_NOT_DROP_SHARED_TRANSPORT'));
});

test('loaded omission of timeout identity fails the newer-handshake oracle', async t => {
  const mutant = loadMutant(source => source.replace('if (recovery !== pending) return;', ''));
  await assert.rejects(() => staleRecovery(t, mutant), error =>
    error.code === 'ERR_ASSERTION' && error.message.includes('STALE_TIMEOUT_MUST_NOT_DROP_NEW_HANDSHAKE'));
});
