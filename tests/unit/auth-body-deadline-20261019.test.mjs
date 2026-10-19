import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const directory = new URL('../../artifacts/kub/src/lib/supabase/', import.meta.url);
const source = readFileSync(new URL('deadlineFetch.ts', directory), 'utf8');
const require = createRequire(new URL('../../artifacts/kub/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
assert.equal(require('@supabase/supabase-js/package.json').version, '2.105.1');
const ORIGIN = 'https://auth-body.fixture.invalid';
const UID = '10000000-0000-4000-8000-000000000001';
const NOW = Date.UTC(2030, 0, 1);
let nextFixture = 0;
const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); await new Promise(setImmediate); };
const observe = promise => {
  const state = { status: 'pending' };
  promise.then(value => Object.assign(state, { status: 'fulfilled', value }),
    error => Object.assign(state, { status: 'rejected', error }));
  return state;
};
function compile(text, imports = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } });
  assert.equal(output.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(output.outputText, { module, exports: module.exports, URL, Request, Response,
    ReadableStream, AbortController, TypeError, Uint8Array, setTimeout, clearTimeout,
    require(name) { assert.ok(Object.hasOwn(imports, name)); return imports[name]; } });
  return module.exports;
}
const rules = compile(readFileSync(new URL('requestDeadline.ts', directory), 'utf8'));
const load = (text = source) => compile(text, { './requestDeadline.ts': rules }).createDeadlineFetch;
function session(suffix = 'old') {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: UID, exp: NOW / 1000 + 7200, aud: 'authenticated' })}.${Buffer.from(suffix).toString('base64url')}`,
    refresh_token: `synthetic-${suffix}`, token_type: 'bearer', expires_in: 7200, expires_at: NOW / 1000 + 7200,
    user: { id: UID, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {},
      created_at: new Date(NOW).toISOString(), identities: [], is_anonymous: false } };
}
async function fixture(t, { status = 200, hold = false, headerDelay = 0, endpoint = 'token', factory = load() } = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: NOW });
  const key = `auth-body-fixture-${++nextFixture}`, stored = new Map([[key, JSON.stringify(session())]]);
  const events = [], streams = [], calls = [], sdkErrors = [];
  t.mock.method(console, 'error', error => {
    assert.equal(error?.name, 'TypeError', 'only the SDK expected transport logger is intercepted');
    sdkErrors.push(error.kubCut ?? 'transport');
  });
  const fetcher = factory(async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, ORIGIN); assert.equal(url.pathname, `/auth/v1/${endpoint}`);
    assert.equal(url.search, endpoint === 'token' ? '?grant_type=refresh_token' : '');
    assert.equal(init.method, endpoint === 'token' ? 'POST' : 'GET');
    calls.push({ status });
    if (headerDelay) await new Promise(resolve => setTimeout(resolve, headerDelay));
    const value = status === 200 ? (endpoint === 'user' ? session().user : session('new'))
      : { code: 'refresh_token_not_found', message: 'Synthetic invalid refresh' };
    const headers = { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' };
    const response = body => Object.defineProperties(new Response(body, { status, statusText: 'Synthetic Auth', headers }), {
      url: { value: url.href }, type: { value: 'cors' }, redirected: { value: true },
    });
    if (!hold) return response(JSON.stringify(value));
    let incoming;
    const stream = { signal: init.signal, aborts: 0, complete() {
      try { incoming.enqueue(new TextEncoder().encode(JSON.stringify(value))); incoming.close(); } catch {}
    }, fail() { try { incoming.error(new TypeError('synthetic transport closed')); } catch {} } };
    streams.push(stream);
    const body = new ReadableStream({ start(controller) { incoming = controller; } });
    init.signal.addEventListener('abort', () => { stream.aborts++; stream.fail(); }, { once: true });
    return response(body);
  }, () => Date.now(), { set: (fn, ms) => setTimeout(fn, ms), clear: handle => clearTimeout(handle) });
  const client = createClient(ORIGIN, 'synthetic-public-key', { global: { fetch: fetcher }, auth: {
    storageKey: key, storage: { getItem: name => stored.get(name) ?? null,
      setItem: (name, value) => stored.set(name, value), removeItem: name => stored.delete(name) },
    persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    lock: async (_name, _timeout, fn) => fn(),
  } });
  const subscription = client.auth.onAuthStateChange(event => { events.push(event); }).data.subscription;
  const initial = await client.auth.getSession();
  assert.equal(initial.data.session.user.id, UID); assert.equal(calls.length, 0, 'valid initial session needs no transport');
  const pending = [];
  t.after(async () => {
    for (const stream of streams) stream.fail();
    t.mock.timers.tick(60_001); await drain();
    await Promise.allSettled(pending);
    subscription.unsubscribe(); await client.auth.stopAutoRefresh(); await client.removeAllChannels();
  });
  return { client, fetcher, stored, key, streams, calls, events, pending, sdkErrors,
    async begin() {
      const refreshPromise = client.auth.refreshSession(); pending.push(refreshPromise);
      const refresh = observe(refreshPromise); await drain();
      const queuePromise = client.auth.getSession(); pending.push(queuePromise);
      const queued = observe(queuePromise); await drain();
      return { refresh, queued };
    } };
}

test('actual SDK calibration: completed refresh releases queued getSession and adopts new session', async t => {
  const f = await fixture(t, { hold: true }), { refresh, queued } = await f.begin();
  assert.equal(refresh.status, 'pending'); assert.equal(queued.status, 'pending');
  assert.equal(f.calls.length, 1); f.streams[0].complete(); await drain();
  assert.equal(refresh.status, 'fulfilled'); assert.equal(refresh.value.error, null);
  assert.equal(queued.status, 'fulfilled'); assert.equal(queued.value.data.session.refresh_token, 'synthetic-new');
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.events.includes('SIGNED_OUT'), false);
  assert.deepEqual(f.sdkErrors, []);
});

async function heldDeadline(t, status, factory = load(), headerDelay = 0) {
  const f = await fixture(t, { status, hold: true, factory, headerDelay }), { refresh, queued } = await f.begin();
  assert.equal(refresh.status, 'pending'); assert.equal(queued.status, 'pending'); assert.equal(f.calls.length, 1);
  if (headerDelay) { t.mock.timers.tick(headerDelay); await drain(); assert.equal(f.streams.length, 1); }
  t.mock.timers.tick(29_999 - headerDelay); await drain(); assert.equal(refresh.status, 'pending');
  assert.equal(f.fetcher.cutStrandedReads(), 0, 'network change must not cut an Auth POST');
  t.mock.timers.tick(2); await drain();
  assert.equal(refresh.status, 'fulfilled', 'AUTH_BODY_DEADLINE_RELEASES_REFRESH');
  assert.equal(refresh.value.error.name, 'AuthRetryableFetchError', 'AUTH_BODY_REMAINS_RETRYABLE');
  assert.equal(queued.status, 'fulfilled', 'AUTH_BODY_RELEASES_QUEUED_SESSION');
  assert.equal(queued.value.data.session.user.id, UID);
  assert.equal(JSON.parse(f.stored.get(f.key)).refresh_token, 'synthetic-old');
  assert.equal(f.events.includes('SIGNED_OUT'), false); assert.equal(f.streams[0].aborts, 1);
  assert.equal(f.fetcher.waiting(), 0); assert.deepEqual(f.sdkErrors, ['deadline']);
}
for (const status of [200, 400, 401]) test(`actual SDK held ${status} body: deadline releases Auth queue without signing out`,
  t => heldDeadline(t, status));

test('actual SDK Auth headers do not restart the original thirty-second budget', t => heldDeadline(t, 200, load(), 20_000));

test('actual SDK old Auth GET body is cut by a network change without retiring the session', async t => {
  const f = await fixture(t, { endpoint: 'user', hold: true });
  const promise = f.client.auth.getUser(session().access_token); f.pending.push(promise);
  const result = observe(promise); await drain();
  t.mock.timers.tick(2_999); assert.equal(f.fetcher.cutStrandedReads(), 0);
  t.mock.timers.tick(1); assert.equal(f.fetcher.cutStrandedReads(), 1); await drain();
  assert.equal(result.status, 'fulfilled'); assert.equal(result.value.error.name, 'AuthRetryableFetchError');
  assert.equal(f.stored.has(f.key), true); assert.equal(f.events.includes('SIGNED_OUT'), false);
  assert.deepEqual(f.sdkErrors, ['network-change']); assert.equal(f.fetcher.waiting(), 0);
});

for (const status of [400, 401]) test(`actual SDK calibration: complete invalid ${status} refresh still retires the session`, async t => {
  const f = await fixture(t, { status }), result = await f.client.auth.refreshSession();
  assert.equal(result.error.name, 'AuthApiError'); assert.equal(result.error.code, 'refresh_token_not_found');
  assert.equal(f.stored.has(f.key), false); assert.equal(f.events.includes('SIGNED_OUT'), true);
  assert.equal((await f.client.auth.getSession()).data.session, null);
  assert.deepEqual(f.sdkErrors, []);
});

test('actual SDK calibration: complete 503 stays retryable and retains the session', async t => {
  const f = await fixture(t, { status: 503 });
  const result = observe(f.client.auth.refreshSession());
  await drain(); t.mock.timers.tick(30_001); await drain();
  assert.equal(result.status, 'fulfilled'); assert.equal(result.value.error.name, 'AuthRetryableFetchError');
  assert.equal(result.value.error.status, 503, 'actual 503 classification, not a pre-header timeout');
  assert.equal(f.stored.has(f.key), true); assert.equal(f.events.includes('SIGNED_OUT'), false);
  assert.deepEqual(f.sdkErrors, []);
});

test('Auth caller abort retains its exact cause and releases body ownership', async t => {
  const f = await fixture(t, { hold: true }), outer = new AbortController();
  const pending = f.fetcher(`${ORIGIN}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', signal: outer.signal });
  f.pending.push(pending); const result = observe(pending); await drain();
  const reason = new DOMException('synthetic owner retired', 'AbortError'); outer.abort(reason); await drain();
  assert.equal(result.status, 'rejected'); assert.equal(result.error, reason);
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.streams[0].aborts, 1);
  assert.equal(f.events.includes('SIGNED_OUT'), false);
});

test('completed Auth JSON retains response metadata and clone semantics', async t => {
  const f = await fixture(t);
  const response = await f.fetcher(`${ORIGIN}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' });
  assert.equal(response.status, 200); assert.equal(response.bodyUsed, false);
  assert.equal(response.statusText, 'Synthetic Auth'); assert.equal(response.type, 'cors'); assert.equal(response.redirected, true);
  assert.equal(response.url, `${ORIGIN}/auth/v1/token?grant_type=refresh_token`);
  assert.equal(response.headers.get('x-supabase-api-version'), '2024-01-01');
  const clone = response.clone(), first = await response.json(), second = await clone.json();
  assert.equal(clone.url, response.url); assert.equal(clone.status, 200); assert.equal(clone.redirected, true);
  assert.equal(first.refresh_token, 'synthetic-new'); assert.equal(second.user.id, UID);
  assert.equal(f.fetcher.waiting(), 0);
});

for (const [name, from, to, status, marker] of [
  ['omit Auth completion', 'if (finiteJson && response.body && response.status !== 0)',
    'if (false && response.body && response.status !== 0)', 200, 'AUTH_BODY_DEADLINE_RELEASES_REFRESH'],
  ['settle Auth at headers', 'const body = trackResponseBody(response, controller.signal, errorFor, settle);',
    'settle(); const body = trackResponseBody(response, controller.signal, errorFor, settle);', 200, 'AUTH_BODY_DEADLINE_RELEASES_REFRESH'],
  ['return streaming Auth errors to SDK parser', 'const bytes = await body.arrayBuffer();',
    'return body; const bytes = await body.arrayBuffer();', 401, 'AUTH_BODY_REMAINS_RETRYABLE'],
]) test(`actual SDK loaded omission: ${name}`, async t => {
  assert.equal(source.split(from).length, 2, 'one exact loaded source mutation');
  await assert.rejects(() => heldDeadline(t, status, load(source.replace(from, to))),
    error => error.code === 'ERR_ASSERTION' && error.message.includes(marker));
});
