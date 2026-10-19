import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const directory = new URL('../../artifacts/kub/src/lib/supabase/', import.meta.url);
const source = readFileSync(new URL('deadlineFetch.ts', directory), 'utf8');
const ruleSource = readFileSync(new URL('requestDeadline.ts', directory), 'utf8');
const require = createRequire(new URL('../../artifacts/kub/package.json', import.meta.url));
const sdkRequire = createRequire(require.resolve('@supabase/supabase-js'));
const { StorageClient } = sdkRequire('@supabase/storage-js');
assert.equal(require('@supabase/supabase-js/package.json').version, '2.105.1');
const ORIGIN = 'https://signing.fixture.invalid';
const PATHS = ['synthetic/one.png', 'synthetic/two.png'];
const drain = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); await new Promise(setImmediate); };
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
const load = (text = source, rules = ruleSource) => compile(text, {
  './requestDeadline.ts': compile(rules),
}).createDeadlineFetch;

function fixture(t, { stage = 'body', single = false, status = 200, factory = load() } = {}) {
  let clock = 0, nextTimer = 0;
  const timers = new Map(), calls = [], pending = [];
  const payload = () => status === 200
    ? single ? { signedURL: `/object/sign/media/${PATHS[0]}?token=synthetic` }
      : PATHS.map(path => ({ path, signedURL: `/object/sign/media/${path}?token=synthetic`, error: null }))
    : { statusCode: String(status), error: 'Unauthorized', message: 'Synthetic signing refusal' };
  const fetcher = factory((input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
    assert.equal(url.origin, ORIGIN); assert.equal(init.method, 'POST');
    assert.equal(url.pathname, `/storage/v1/object/sign/media${single ? '/' + PATHS[0] : ''}`);
    const body = JSON.parse(init.body);
    assert.equal(body.expiresIn, 3600);
    if (!single) assert.deepEqual(body.paths, PATHS);
    return new Promise((resolve, reject) => {
      let incoming;
      const call = { signal: init.signal, aborts: 0, response: null,
        fail() {
          const error = new DOMException('synthetic transport retired', 'AbortError');
          try { incoming?.error(error); } catch {}
          reject(error);
        },
        headers() {
          const stream = new ReadableStream({ start(controller) { incoming = controller; } });
          call.response = Object.defineProperties(new Response(stream, {
            status, statusText: 'Synthetic Signing',
            headers: { 'content-type': 'application/json', 'x-signing-fixture': 'one' },
          }), { url: { value: url.href }, type: { value: 'cors' }, redirected: { value: true } });
          resolve(call.response);
        },
        complete(value = payload()) {
          incoming.enqueue(new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)));
          incoming.close();
        },
      };
      calls.push(call);
      init.signal.addEventListener('abort', () => { call.aborts++; call.fail(); }, { once: true });
      if (stage !== 'headers' || calls.length > 1) call.headers();
      if (stage === 'complete' || calls.length > 1) call.complete();
    });
  }, () => clock, {
    set(fn, ms) { const key = ++nextTimer; timers.set(key, { at: clock + ms, fn }); return key; },
    clear(key) { timers.delete(key); },
  });
  const client = new StorageClient(`${ORIGIN}/storage/v1`, {}, fetcher).from('media');
  t.after(async () => { for (const call of calls) call.fail(); await drain(); await Promise.allSettled(pending); });
  return { client, fetcher, calls, timers, pending,
    advance(ms) {
      clock += ms;
      for (const [key, timer] of [...timers]) if (timer.at <= clock) { timers.delete(key); timer.fn(); }
    },
    begin() {
      const promise = single ? client.createSignedUrl(PATHS[0], 3600) : client.createSignedUrls(PATHS, 3600);
      pending.push(promise); return observe(promise);
    },
  };
}

test('actual Storage SDK calibration: completed batch signing preserves paths and usable URLs', async t => {
  const f = fixture(t), result = f.begin(); await drain();
  assert.equal(result.status, 'pending'); assert.equal(f.calls.length, 1);
  f.calls[0].complete(); await drain();
  assert.equal(result.status, 'fulfilled'); assert.equal(result.value.error, null);
  assert.deepEqual(result.value.data.map(row => row.path), PATHS);
  assert.equal(result.value.data[0].signedUrl, `${ORIGIN}/storage/v1/object/sign/media/${PATHS[0]}?token=synthetic`);
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
});

async function heldDeadline(t, stage, { single = false, status = 200, factory = load(), headerDelay = 0 } = {}) {
  const f = fixture(t, { stage, single, status, factory }), result = f.begin(); await drain();
  assert.equal(result.status, 'pending'); assert.equal(f.calls.length, 1);
  if (headerDelay) { f.advance(headerDelay); f.calls[0].headers(); await drain(); }
  f.advance(29_999 - headerDelay); await drain();
  assert.equal(result.status, 'pending', 'signing cannot be cut before the literal original deadline');
  f.advance(1); await drain();
  assert.equal(result.status, 'fulfilled', 'SIGNING_DEADLINE_RELEASES_SDK');
  assert.equal(result.value.data, null);
  assert.equal(result.value.error.name, 'StorageUnknownError', 'SIGNING_CUT_IS_REQUEST_FAILURE');
  assert.equal(result.value.error.originalError.name, 'TypeError');
  assert.equal(result.value.error.originalError.kubCut, 'deadline');
  assert.equal(f.calls[0].aborts, 1); assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
  return f;
}
for (const stage of ['headers', 'body']) test(`actual Storage SDK: held signing ${stage} ends at thirty seconds`,
  t => heldDeadline(t, stage));

test('actual Storage SDK: single-object signing has the same finite body contract',
  t => heldDeadline(t, 'body', { single: true }));
test('actual Storage SDK: incomplete 403 JSON is request failure, not completed RLS refusal',
  t => heldDeadline(t, 'body', { status: 403 }));
test('actual Storage SDK: signing headers do not restart the original thirty-second budget',
  t => heldDeadline(t, 'headers', { headerDelay: 20_000 }));

async function networkCut(t, factory = load()) {
  const f = fixture(t, { factory }), result = f.begin(); await drain();
  f.advance(2_999); assert.equal(f.fetcher.cutStrandedReads(), 0);
  assert.equal(result.status, 'pending');
  f.advance(1); assert.equal(f.fetcher.cutStrandedReads(), 1, 'SIGNING_OLD_READ_NETWORK_CUT'); await drain();
  assert.equal(result.status, 'fulfilled'); assert.equal(result.value.error.name, 'StorageUnknownError');
  assert.equal(result.value.error.originalError.kubCut, 'network-change');
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
}
test('actual Storage SDK: only a three-second-old signing read is stranded', t => networkCut(t));

test('actual Storage SDK: a young signing read survives the network change and completes normally', async t => {
  const f = fixture(t), result = f.begin(); await drain();
  f.advance(2_999); assert.equal(f.fetcher.cutStrandedReads(), 0);
  assert.equal(f.calls[0].signal.aborted, false);
  f.calls[0].complete(); await drain();
  assert.equal(result.status, 'fulfilled'); assert.equal(result.value.error, null);
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
});

test('actual Storage SDK: explicit fresh signing succeeds after the timed-out request', async t => {
  const f = await heldDeadline(t, 'body'), next = f.begin(); await drain();
  assert.equal(next.status, 'fulfilled'); assert.equal(next.value.error, null);
  assert.equal(next.value.data.length, 2); assert.equal(f.calls.length, 2);
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
});

test('actual Storage SDK: a complete per-path refusal remains data, not a failed POST', async t => {
  const f = fixture(t), result = f.begin(); await drain();
  f.calls[0].complete([
    { path: PATHS[0], signedURL: `/object/sign/media/${PATHS[0]}?token=synthetic`, error: null },
    { path: PATHS[1], signedURL: null, error: 'Object not found' },
  ]); await drain();
  assert.equal(result.value.error, null);
  assert.equal(result.value.data[0].signedUrl, `${ORIGIN}/storage/v1/object/sign/media/${PATHS[0]}?token=synthetic`);
  assert.equal(result.value.data[1].signedUrl, null); assert.equal(result.value.data[1].error, 'Object not found');
  assert.equal(f.fetcher.waiting(), 0);
});

test('actual Storage SDK: completed 403 retains StorageApiError status and message', async t => {
  const f = fixture(t, { stage: 'complete', status: 403 }), result = f.begin(); await drain();
  assert.equal(result.status, 'fulfilled'); assert.equal(result.value.data, null);
  assert.equal(result.value.error.name, 'StorageApiError'); assert.equal(result.value.error.status, 403);
  assert.equal(result.value.error.statusCode, '403'); assert.equal(result.value.error.message, 'Synthetic signing refusal');
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
});

test('actual Storage SDK: malformed completed JSON retains its parser error', async t => {
  const f = fixture(t), result = f.begin(); await drain();
  f.calls[0].complete('{'); await drain();
  assert.equal(result.status, 'fulfilled'); assert.equal(result.value.error.name, 'StorageUnknownError');
  assert.equal(result.value.error.originalError.name, 'SyntaxError');
  assert.equal(result.value.error.originalError.kubCut, undefined); assert.equal(f.fetcher.waiting(), 0);
});

test('completed signing JSON preserves native response metadata, bytes and clones', async t => {
  const f = fixture(t, { status: 403 });
  const promise = f.fetcher(new URL(`${ORIGIN}/storage/v1/object/sign/media`), {
    method: 'POST', body: JSON.stringify({ paths: PATHS, expiresIn: 3600 }),
  });
  f.pending.push(promise); await drain(); f.calls[0].complete();
  const response = await promise, clone = response.clone();
  for (const item of [response, clone]) {
    assert.equal(item.status, 403); assert.equal(item.statusText, 'Synthetic Signing');
    assert.equal(item.url, `${ORIGIN}/storage/v1/object/sign/media`);
    assert.equal(item.type, 'cors'); assert.equal(item.redirected, true); assert.equal(item.bodyUsed, false);
    assert.equal(item.headers.get('x-signing-fixture'), 'one');
    assert.deepEqual(await item.json(), { statusCode: '403', error: 'Unauthorized', message: 'Synthetic signing refusal' });
  }
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
});

test('a signing caller abort retains its exact cause instead of becoming a deadline', async t => {
  const f = fixture(t), outer = new AbortController();
  const promise = f.fetcher(`${ORIGIN}/storage/v1/object/sign/media`, {
    method: 'POST', body: JSON.stringify({ paths: PATHS, expiresIn: 3600 }), signal: outer.signal,
  });
  f.pending.push(promise); const result = observe(promise); await drain();
  const reason = new DOMException('synthetic owner retired', 'AbortError'); outer.abort(reason); await drain();
  assert.equal(result.status, 'rejected'); assert.equal(result.error, reason);
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
});

async function transfer(t, path, method, factory = load()) {
  let clock = 0, answer, incoming, response, aborted = false;
  const outer = new AbortController();
  const fetcher = factory((_input, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      aborted = true; try { incoming?.error(init.signal.reason); } catch {} reject(init.signal.reason);
    }, { once: true });
    answer = () => {
      response = new Response(new ReadableStream({ start(controller) { incoming = controller; } }));
      resolve(response);
    };
  }), () => clock, { set() { assert.fail('SIGNING_TRANSFER_MUST_HAVE_NO_TIMER'); }, clear() {} });
  const pending = fetcher(`${ORIGIN}${path}`, { method, signal: outer.signal });
  const result = observe(pending);
  t.after(async () => {
    outer.abort(new DOMException('synthetic transfer cleanup', 'AbortError'));
    try { incoming?.close(); } catch {} await drain();
  });
  clock = 300_000; assert.equal(fetcher.cutStrandedReads(), 0); assert.equal(result.status, 'pending');
  answer(); await drain();
  assert.equal(result.status, 'fulfilled', 'SIGNING_TRANSFERS_MUST_STAY_STREAMING');
  assert.equal(result.value, response, 'SIGNING_TRANSFERS_MUST_STAY_STREAMING');
  const body = observe(response.text()); await drain();
  clock = 600_000; assert.equal(fetcher.cutStrandedReads(), 0); assert.equal(aborted, false);
  assert.equal(body.status, 'pending');
  incoming.enqueue(new TextEncoder().encode('synthetic file')); incoming.close(); await drain();
  assert.equal(body.value, 'synthetic file'); assert.equal(fetcher.waiting(), 0);
}
for (const [path, method] of [
  ['/storage/v1/object/sign/media/synthetic/one.png?token=synthetic', 'GET'],
  ['/storage/v1/object/media/synthetic/one.png', 'POST'],
  ['/storage/v1/object/upload/sign/media/synthetic/one.png', 'POST'],
]) test(`file/download/upload-sign stay unbounded: ${method} ${path.split('?')[0]}`,
  t => transfer(t, path, method));

function mutate(text, before, after) {
  assert.equal(text.split(before).length, 2, 'one exact loaded omission site');
  return text.replace(before, after);
}
for (const [name, factory, contract, marker] of [
  ['classify signing as transfer', () => load(source, mutate(ruleSource,
    'if (isStorageSigningRead(url, method)) return "read";', '')),
    (t, factory) => heldDeadline(t, 'headers', { factory }), 'SIGNING_DEADLINE_RELEASES_SDK'],
  ['omit signing body completion', () => load(mutate(source,
    'if (finiteJson && response.body && response.status !== 0)', 'if (isAuth(input) && response.body && response.status !== 0)')),
    (t, factory) => heldDeadline(t, 'body', { factory }), 'SIGNING_DEADLINE_RELEASES_SDK'],
  ['return streaming error body to SDK', () => load(mutate(source,
    'const bytes = await body.arrayBuffer();', 'return body; const bytes = await body.arrayBuffer();')),
    (t, factory) => heldDeadline(t, 'body', { factory, status: 403 }), 'SIGNING_CUT_IS_REQUEST_FAILURE'],
  ['extend deadline beyond thirty seconds', () => load(source, mutate(ruleSource,
    'REQUEST_DEADLINE_MS = 30_000', 'REQUEST_DEADLINE_MS = 31_000')),
    (t, factory) => heldDeadline(t, 'body', { factory }), 'SIGNING_DEADLINE_RELEASES_SDK'],
  ['extend network age beyond three seconds', () => load(source, mutate(ruleSource,
    'STRANDED_AFTER_MS = 3_000', 'STRANDED_AFTER_MS = 4_000')),
    networkCut, 'SIGNING_OLD_READ_NETWORK_CUT'],
  ['classify signed GET as JSON', () => load(source, mutate(ruleSource,
    'method?.toUpperCase() === "POST" && ', '')),
    (t, factory) => transfer(t, '/storage/v1/object/sign/media/synthetic/one.png', 'GET', factory),
    'SIGNING_TRANSFER_MUST_HAVE_NO_TIMER'],
]) test(`actual SDK/boundary loaded omission: ${name}`, async t => {
  await assert.rejects(() => contract(t, factory()), error =>
    error.code === 'ERR_ASSERTION' && error.message.includes(marker));
});
