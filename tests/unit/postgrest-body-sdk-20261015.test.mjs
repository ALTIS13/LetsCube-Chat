import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const kub = createRequire(new URL('../../artifacts/kub/package.json', import.meta.url));
const dependency = createRequire(kub.resolve('@supabase/supabase-js'));
const { PostgrestClient } = dependency('@supabase/postgrest-js');
const { createClient } = kub('@supabase/supabase-js');
const root = new URL('../../artifacts/kub/src/lib/supabase/', import.meta.url);
const sources = Object.fromEntries(['deadlineFetch.ts', 'requestDeadline.ts'].map(name =>
  [name, readFileSync(new URL(name, root), 'utf8')]));
function compile(name, imports = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(sources[name], { reportDiagnostics: true, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, { module, exports: module.exports, URL, Request, Response,
    Headers, ReadableStream, AbortController, DOMException, TextEncoder, TextDecoder, TypeError,
    setTimeout, clearTimeout, require(name) { assert.ok(Object.hasOwn(imports, name)); return imports[name]; } });
  return module.exports;
}
const rules = compile('requestDeadline.ts');
const { createDeadlineFetch } = compile('deadlineFetch.ts', { './requestDeadline.ts': rules });
const origin = 'https://fixture.invalid';
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(setImmediate); };
function observe(promise) {
  const state = { state: 'pending' };
  Promise.resolve(promise).then(value => { state.state = 'fulfilled'; state.value = value; }, error => {
    state.state = 'rejected'; state.error = error;
  });
  return state;
}
async function finished(state) {
  await drain();
  assert.notEqual(state.state, 'pending', 'SDK_BODY_OPERATION_MUST_SETTLE');
  assert.equal(state.state, 'fulfilled', 'SDK non-throwing operation must return its finite result');
  return state.value;
}
function fixture(t, { status = 200, metadata = false } = {}) {
  let now = 0, id = 0;
  const timers = new Map(), before = [], calls = [], returned = [], controllers = [];
  const responses = [];
  const base = async (input, init) => {
    calls.push({ input, init });
    let controller;
    const stream = new ReadableStream({ start(c) { controller = c; }, cancel() {} });
    controllers.push(controller);
    const abort = () => {
      try { controller.error(new DOMException('fixture transport abort', 'AbortError')); } catch {}
    };
    if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
    const response = new Response(stream, { status, statusText: status < 400 ? 'Fixture OK' : 'Fixture Error',
      headers: { 'content-type': 'application/json', 'x-fixture': 'present', 'retry-after': '0' } });
    if (metadata) {
      const decorate = value => {
        const nativeClone = value.clone.bind(value);
        Object.defineProperties(value, {
          url: { value: `${origin}/rest/v1/fictional_rows` }, type: { value: 'cors' }, redirected: { value: true },
          clone: { value: () => decorate(nativeClone()) },
        });
        return value;
      };
      decorate(response);
    }
    responses.push(response); return response;
  };
  const fetcher = createDeadlineFetch(base, () => now, {
    set(fn, ms) { const key = ++id; timers.set(key, { fn, at: now + ms }); return key; },
    clear(key) { timers.delete(key); },
  });
  const transport = async (input, init) => {
    before.push({ input, init });
    const response = await fetcher(input, init); returned.push(response); return response;
  };
  const pg = new PostgrestClient(`${origin}/rest/v1`, { fetch: transport, headers: { 'x-fixture-request': 'present' } });
  const f = { pg, fetcher, transport, before, calls, returned, responses, timers,
    advance(ms) {
      now += ms;
      for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.fn(); }
    },
    finish(body = '[{"id":7}]') {
      for (const controller of controllers) {
        try { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } catch {}
      }
    },
    checkInit() {
      assert.equal(calls.length, before.length);
      for (let i = 0; i < calls.length; i++) {
        assert.ok(calls[i].input === before[i].input, 'request input unchanged');
        assert.ok(calls[i].init.headers === before[i].init.headers, 'headers identity unchanged');
        assert.ok(calls[i].init.body === before[i].init.body, 'serialized body bytes unchanged');
        assert.ok(calls[i].init.method === before[i].init.method, 'HTTP method unchanged');
        assert.equal(new Headers(calls[i].init.headers).has('x-retry-count'), false);
      }
    },
    checkCleared() {
      assert.equal(fetcher.waiting(), 0); assert.equal(timers.size, 0); f.checkInit();
      for (let i = 0; i < responses.length; i++) if (returned[i] && returned[i] !== responses[i]) {
        assert.equal(responses[i].body?.locked, false, 'adapted source reader released after completion');
      }
    },
  };
  t.after(async () => {
    for (const c of controllers) { try { c.error(new DOMException('fixture cleanup', 'AbortError')); } catch {} }
    await drain();
  });
  return f;
}
function networkFailure(result) {
  assert.equal(result.status, 0); assert.equal(result.data, null);
  assert.ok(result.error !== null); assert.equal(result.error.message, 'TypeError: Failed to fetch');
}

test('installed real PostgREST and Supabase consumer versions are 2.105.1', t => {
  assert.equal(dependency('@supabase/postgrest-js/package.json').version, '2.105.1');
  assert.equal(kub('@supabase/supabase-js/package.json').version, '2.105.1');
  t.diagnostic(`actual app source sha256 ${createHash('sha256').update(sources['deadlineFetch.ts']).digest('hex')}`);
});

test('SDK select normal .text JSON consumption succeeds and preserves request init', async t => {
  const f = fixture(t), state = observe(f.pg.from('fictional_rows').select('id'));
  await drain(); assert.equal(f.returned.length, 1, 'fetch resolves before body EOF');
  assert.equal(state.state, 'pending'); f.finish();
  const result = await finished(state);
  assert.equal(result.status, 200); assert.equal(result.error, null);
  assert.equal(result.data.length, 1); assert.equal(result.data[0].id, 7); f.checkCleared();
});

test('SDK select body deadline is finite with default retries and clears ownership', async t => {
  const f = fixture(t), state = observe(f.pg.from('fictional_rows').select('id'));
  await drain(); f.advance(29_999); await drain(); assert.equal(state.state, 'pending');
  f.advance(1); const result = await finished(state); networkFailure(result);
  assert.equal(f.calls.length, 1, 'body failure must not enter fetch retry loop'); f.checkCleared();
});

test('SDK select body is cut at the literal network-change age and never retried', async t => {
  const f = fixture(t), state = observe(f.pg.from('fictional_rows').select('id'));
  await drain(); f.advance(2_999); assert.equal(f.fetcher.cutStrandedReads(), 0);
  f.advance(1); assert.equal(f.fetcher.cutStrandedReads(), 1);
  networkFailure(await finished(state)); assert.equal(f.calls.length, 1); f.checkCleared();
});

test('SDK explicit caller abort after headers remains a finite caller abort', async t => {
  const f = fixture(t), caller = new AbortController();
  const state = observe(f.pg.from('fictional_rows').select('id').abortSignal(caller.signal));
  await drain(); caller.abort(new DOMException('fixture cancellation', 'AbortError'));
  const result = await finished(state); assert.equal(result.status, 0); assert.equal(result.data, null);
  assert.ok(result.error.message.startsWith('AbortError:'));
  assert.equal(result.error.hint, 'Request was aborted (timeout or manual cancellation)');
  assert.equal(f.calls.length, 1); f.checkCleared();
});

test('SDK REST POST RPC is not network-cut, times out its body once and preserves payload', async t => {
  const f = fixture(t), state = observe(f.pg.rpc('fixture_noop', { fixture_id: 7 }));
  await drain(); assert.equal(f.calls[0].init.method, 'POST');
  assert.ok(f.calls[0].init.body === '{"fixture_id":7}', 'fictional JSON payload unchanged');
  f.advance(3_000); assert.equal(f.fetcher.cutStrandedReads(), 0); await drain(); assert.equal(state.state, 'pending');
  f.advance(27_000); networkFailure(await finished(state));
  assert.equal(f.calls.length, 1); f.checkCleared();
});

for (const method of ['PATCH', 'DELETE']) test(`SDK REST ${method} body is bounded without network cuts or retries`, async t => {
  const f = fixture(t);
  const query = method === 'PATCH'
    ? f.pg.from('fictional_rows').update({ fixture_id: 7 }).eq('id', 7).select('id')
    : f.pg.from('fictional_rows').delete().eq('id', 7).select('id');
  const state = observe(query); await drain(); assert.equal(f.calls[0].init.method, method);
  f.advance(3_000); assert.equal(f.fetcher.cutStrandedReads(), 0);
  f.advance(27_000); networkFailure(await finished(state));
  assert.equal(f.calls.length, 1); f.checkCleared();
});

test('SDK throwOnError preserves the actual internal cut reason', async t => {
  const f = fixture(t), state = observe(f.pg.from('fictional_rows').select('id').throwOnError());
  await drain(); f.advance(30_000); await drain(); assert.equal(state.state, 'rejected');
  assert.ok(state.error instanceof TypeError); assert.equal(state.error.kubCut, 'deadline');
  assert.equal(f.calls.length, 1); f.checkCleared();
});

for (const status of [400, 503]) test(`SDK HTTP ${status} stalled error body has a finite deadline and no retries`, async t => {
  const f = fixture(t, { status }), state = observe(f.pg.from('fictional_rows').select('id'));
  await drain(); f.advance(30_000); networkFailure(await finished(state));
  assert.equal(f.calls.length, 1); f.checkCleared();
});

test('SDK complete HTTP error JSON remains an ordinary HTTP error', async t => {
  const f = fixture(t, { status: 400 }), state = observe(f.pg.from('fictional_rows').select('id'));
  await drain(); f.finish('{"code":"FIXTURE","message":"fixture","details":null,"hint":null}');
  const result = await finished(state); assert.equal(result.status, 400); assert.equal(result.data, null);
  assert.equal(result.error.code, 'FIXTURE'); assert.equal(f.calls.length, 1); f.checkCleared();
});

test('native Response metadata and clone survive body adaptation', async t => {
  const f = fixture(t, { metadata: true });
  const response = await f.transport(`${origin}/rest/v1/fictional_rows`, { method: 'GET', headers: new Headers({ 'x-fixture-request': 'present' }) });
  assert.ok(response instanceof Response); const clone = response.clone();
  for (const value of [response, clone]) {
    assert.equal(value.status, 200); assert.equal(value.statusText, 'Fixture OK');
    assert.equal(value.url, `${origin}/rest/v1/fictional_rows`);
    assert.equal(value.type, 'cors'); assert.equal(value.redirected, true);
    assert.equal(value.headers.get('x-fixture'), 'present');
  }
  const left = observe(response.text()), right = observe(clone.text()); f.finish();
  const a = await finished(left), b = await finished(right);
  assert.ok(a === b, 'clone has identical fictional bytes'); f.checkCleared();
});

function supabase(f) {
  let persisted = 0;
  const client = createClient(origin, 'fixture-public-key', { global: { fetch: f.transport }, auth: {
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
    storage: { getItem: async () => null, setItem: async () => { persisted++; }, removeItem: async () => { persisted++; } },
  } });
  return { client, persisted: () => persisted };
}
test('actual Auth SDK response is not REST-wrapped or body-bounded; no session persistence', async t => {
  const f = fixture(t), { client, persisted } = supabase(f);
  const state = observe(client.auth.getUser('fixture-credential-not-a-real-token'));
  await drain(); assert.equal(f.calls.length, 1);
  assert.ok(new URL(f.calls[0].input).pathname.startsWith('/auth/v1/'));
  assert.equal(f.returned[0], f.responses[0], 'Auth retains original Response identity');
  f.advance(30_001); assert.equal(f.fetcher.cutStrandedReads(), 0); await drain(); assert.equal(state.state, 'pending');
  f.finish('{"user":{"id":"fictional-user"}}'); const result = await finished(state);
  assert.equal(result.error, null); assert.equal(persisted(), 0); f.checkCleared();
});
test('actual Storage SDK download retains original unbounded transfer body', async t => {
  const f = fixture(t), { client, persisted } = supabase(f);
  const state = observe(client.storage.from('fixture-bucket').download('fixture.txt'));
  await drain(); assert.equal(f.calls.length, 1);
  assert.ok(new URL(f.calls[0].input).pathname.startsWith('/storage/v1/'));
  assert.equal(f.returned[0], f.responses[0], 'Storage retains original Response identity');
  f.advance(300_000); assert.equal(f.fetcher.cutStrandedReads(), 0); await drain(); assert.equal(state.state, 'pending');
  f.finish('fixture'); const result = await finished(state);
  assert.equal(result.error, null); assert.ok(result.data instanceof Blob); assert.equal(result.data.size, 7);
  assert.equal(persisted(), 0); f.checkCleared();
});
