import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const directory = new URL('../../artifacts/kub/src/lib/supabase/', import.meta.url);
const source = readFileSync(new URL('deadlineFetch.ts', directory), 'utf8');
function compile(text, imports = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } });
  assert.equal(output.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(output.outputText, { module, exports: module.exports, URL, Request,
    Response, ReadableStream, AbortController, TypeError, Uint8Array, setTimeout, clearTimeout,
    require(name) { assert.ok(Object.hasOwn(imports, name)); return imports[name]; } });
  return module.exports;
}
const rules = compile(readFileSync(new URL('requestDeadline.ts', directory), 'utf8'));
const load = (text = source) => compile(text, { './requestDeadline.ts': rules }).createDeadlineFetch;
const API = 'https://fixture.invalid/rest/v1/messages?select=id';
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(setImmediate); };
const observe = promise => {
  const state = { status: 'pending' };
  promise.then(value => { Object.assign(state, { status: 'fulfilled', value }); },
    error => { Object.assign(state, { status: 'rejected', error }); });
  return state;
};
function fixture(t, { factory = load(), holdHeaders = false, empty = false } = {}) {
  let clock = 0, id = 0, incoming, signal, answer, response, pulls = 0;
  const timers = new Map(), calls = [], cancellations = [];
  const fetcher = factory((input, init) => {
    signal = init.signal; calls.push({ input, init });
    return new Promise((resolve, reject) => {
      const abort = () => { if (incoming) { try { incoming.error(new DOMException('transport aborted', 'AbortError')); } catch {} } else reject(signal.reason); };
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      answer = () => {
        const body = empty ? null : new ReadableStream({
          start(controller) { incoming = controller; controller.enqueue(new TextEncoder().encode('{"ok":')); },
          pull() { pulls++; },
          cancel(reason) { cancellations.push(reason); },
        });
        response = new Response(body, { status: empty ? 204 : 200, headers: { 'content-type': 'application/json', 'x-fixture': 'one' } });
        const metadata = item => Object.defineProperties(item, {
          url: { value: API }, redirected: { value: true }, type: { value: 'cors' },
          clone: { value: () => metadata(Response.prototype.clone.call(item)) },
        });
        metadata(response);
        resolve(response);
      };
      if (!holdHeaders) answer();
    });
  }, () => clock, {
    set(fn, delay) { assert.equal(delay, 30_000); const key = ++id; timers.set(key, { at: clock + delay, fn }); return key; },
    clear(key) { timers.delete(key); },
  });
  const f = { fetcher, calls, timers, cancellations, get original() { return response; }, get signal() { return signal; }, get pulls() { return pulls; },
    headers() { answer(); }, complete(tail = 'true}') { incoming.enqueue(new TextEncoder().encode(tail)); incoming.close(); },
    fail(error) { incoming.error(error); }, advance(ms) {
      clock += ms;
      for (const [key, timer] of [...timers]) if (timer.at <= clock) { timers.delete(key); timer.fn(); }
    }, cleanup() { try { incoming?.error(new DOMException('fixture cleanup', 'AbortError')); } catch {} },
  };
  t.after(f.cleanup); return f;
}
async function bodyCut(t, trigger, factory = load()) {
  const f = fixture(t, { factory }), outer = new AbortController();
  const response = await f.fetcher(API, { signal: outer.signal });
  const result = observe(response.text()); await drain();
  assert.equal(result.status, 'pending');
  const reason = new DOMException('fixture caller', 'AbortError');
  if (trigger === 'deadline') f.advance(30_000);
  if (trigger === 'network-change') { f.advance(3_000); assert.equal(f.fetcher.cutStrandedReads(), 1, 'BODY_NETWORK_CUT'); }
  if (trigger === 'caller') outer.abort(reason);
  await drain();
  assert.equal(result.status, 'rejected', 'BODY_MUST_SETTLE');
  if (trigger === 'caller') assert.equal(result.error, reason);
  else { assert.equal(result.error.name, 'TypeError'); assert.equal(result.error.kubCut, trigger); }
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
  assert.equal(f.signal.aborted, true);
}
for (const trigger of ['deadline', 'network-change', 'caller']) {
  test(`PostgREST body remains owned through ${trigger}`, t => bodyCut(t, trigger));
}
test('headers do not reset the original thirty-second budget', async t => {
  const f = fixture(t, { holdHeaders: true });
  const pending = f.fetcher(API); f.advance(20_000); f.headers();
  const response = await pending, body = observe(response.json());
  f.advance(9_999); await drain(); assert.equal(body.status, 'pending');
  f.advance(1); await drain(); assert.equal(body.status, 'rejected', 'BODY_ORIGINAL_BUDGET');
  assert.equal(body.error.kubCut, 'deadline'); assert.equal(f.fetcher.waiting(), 0);
});
test('ordinary EOF releases registration and timer, retaining native body semantics', async t => {
  const f = fixture(t), response = await f.fetcher(API);
  assert.ok(response instanceof Response); assert.equal(response.bodyUsed, false);
  const body = response.json(); assert.equal(response.bodyUsed, true);
  f.complete(); assert.deepEqual(await body, { ok: true });
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
  assert.equal(response.headers.get('x-fixture'), 'one');
  assert.equal(response.url, API); assert.equal(response.redirected, true); assert.equal(response.type, 'cors');
  await assert.rejects(response.text(), TypeError);
});
test('both clones keep metadata and receive the same completed bytes', async t => {
  const f = fixture(t), response = await f.fetcher(API), clone = response.clone();
  for (const item of [response, clone]) { assert.equal(item.url, API); assert.equal(item.type, 'cors'); assert.equal(item.redirected, true); }
  const bodies = Promise.all([response.text(), clone.text()]); f.complete();
  assert.deepEqual(await bodies, ['{"ok":true}', '{"ok":true}']); assert.equal(f.fetcher.waiting(), 0);
});
test('a deadline errors both cloned readers without another request', async t => {
  const f = fixture(t), response = await f.fetcher(API), clone = response.clone();
  const reads = [observe(response.text()), observe(clone.json())];
  f.advance(30_000); await drain();
  assert.ok(reads.every(r => r.status === 'rejected' && r.error.kubCut === 'deadline'), 'BODY_CLONES_CUT');
  assert.equal(f.calls.length, 1); assert.equal(f.fetcher.waiting(), 0);
});
test('explicit body cancellation retires ownership and cancels the original stream', async t => {
  const f = fixture(t), response = await f.fetcher(API);
  await response.body.cancel('fixture cancelled');
  assert.equal(f.cancellations.length, 1); assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
});
test('abandoned unread bodies retire at the original deadline', async t => {
  const f = fixture(t), response = await f.fetcher(API);
  f.advance(30_000); await drain();
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
  const body = observe(response.text()); await drain();
  assert.equal(body.status, 'rejected', 'BODY_ABANDONED_CUT'); assert.equal(body.error.kubCut, 'deadline');
});
test('an ordinary stream failure is not reclassified as a deadline', async t => {
  const f = fixture(t), response = await f.fetcher(API), error = new TypeError('fictional disconnect');
  const body = response.text(); f.fail(error);
  await assert.rejects(body, e => e === error);
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
});
test('empty HEAD response has nothing left to wait for', async t => {
  const f = fixture(t, { empty: true }), response = await f.fetcher(API, { method: 'HEAD' });
  assert.equal(response, f.original); assert.equal(await response.text(), '');
  assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
});
async function backpressure(t, factory = load()) {
  const f = fixture(t, { factory }), response = await f.fetcher(API); await drain();
  assert.equal(f.pulls, 0, 'BODY_MUST_NOT_PREFETCH');
  const body = response.text(); observe(body); await drain(); assert.ok(f.pulls > 0 && f.pulls <= 2);
  f.complete(); assert.equal(await body, '{"ok":true}');
}
test('the adapter does not eagerly drain or buffer an unread response', t => backpressure(t));
async function release(t, factory = load()) {
  const f = fixture(t, { factory }), response = await f.fetcher(API), body = response.text();
  f.complete(); await body;
  assert.equal(f.fetcher.waiting(), 0, 'BODY_EOF_MUST_RELEASE'); assert.equal(f.timers.size, 0);
}
test('malformed JSON keeps its parser error after transport EOF', async t => {
  const f = fixture(t), response = await f.fetcher(API), body = observe(response.json());
  f.complete('wrong}'); await drain();
  assert.equal(body.status, 'rejected'); assert.equal(body.error.name, 'SyntaxError');
  assert.equal(body.error.kubCut, undefined); assert.equal(f.fetcher.waiting(), 0);
});
async function outsideScope(t, factory = load()) {
  const f = fixture(t, { factory }), response = await f.fetcher('https://fixture.invalid/auth/v1/token', { method: 'POST' });
  assert.equal(response, f.original, 'BODY_SCOPE_MUST_STAY_REST');
  const body = response.text(); f.complete(); await body;
}
for (const endpoint of ['https://fixture.invalid/auth/v1/token', 'https://fixture.invalid/storage/v1/object/media/file']) {
  test(`non-PostgREST response contract is unchanged: ${new URL(endpoint).pathname}`, async t => {
    const f = fixture(t), response = await f.fetcher(endpoint, { method: 'POST' });
    assert.equal(response, f.original); assert.equal(f.fetcher.waiting(), 0); assert.equal(f.timers.size, 0);
    const body = response.text(); f.complete(); assert.equal(await body, '{"ok":true}');
  });
}
const mutate = (before, after) => {
  assert.equal(source.split(before).length, 2, 'mutation must have one exact target');
  return load(source.replace(before, after));
};
for (const [name, before, after, contract, expected] of [
  ['retire at headers', 'return trackResponseBody(response, controller.signal,', 'settle(); return trackResponseBody(response, controller.signal,',
    (t, factory) => bodyCut(t, 'network-change', factory), 'BODY_NETWORK_CUT'],
  ['drop body adapter', 'if (isPostgrest(input) && response.body && response.status !== 0)', 'if (false && response.body && response.status !== 0)',
    (t, factory) => bodyCut(t, 'deadline', factory), 'BODY_MUST_SETTLE'],
  ['forget EOF retirement', 'signal.removeEventListener("abort", abort);\n    settle();', 'signal.removeEventListener("abort", abort);', release, 'BODY_EOF_MUST_RELEASE'],
  ['eagerly drain', '{ highWaterMark: 0 }', '{ highWaterMark: 1 }', backpressure, 'BODY_MUST_NOT_PREFETCH'],
  ['wrap Auth too', 'if (isPostgrest(input) && response.body && response.status !== 0)', 'if (response.body && response.status !== 0)', outsideScope, 'BODY_SCOPE_MUST_STAY_REST'],
]) {
  test(`compiled omission is rejected: ${name}`, async t => {
    await assert.rejects(contract(t, mutate(before, after)), error =>
      error?.code === 'ERR_ASSERTION' && String(error.message).includes(expected));
  });
}
