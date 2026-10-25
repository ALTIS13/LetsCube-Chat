import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let source = 'export {};';
try { source = await readFile(new URL('../../artifacts/kub/src/lib/mediaCache/loader.ts', import.meta.url), 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const scope = { partition: 'backend/account/session', chatId: 'chat', bucket: 'media', path: 'one.jpg' };
const url = 'https://core.example/storage/v1/object/public/media/one.jpg';
function fixture(options = {}) {
  assert.equal(typeof api.createMediaLoader, 'function', 'managed binary loader is absent');
  let saved = null, calls = 0, retired = 0;
  const cache = { get: async () => saved, put: async (_key, blob) => { saved = blob; return true; },
    prepare: async key => ({put:blob=>cache.put(key,blob)}) };
  const loader = api.createMediaLoader({ cache, backend: 'https://core.example',
    fetch: async () => { calls++; return new Response(new Uint8Array([1,2,3]), { headers: { 'Content-Type': 'image/jpeg' } }); },
    onRefused: () => { retired++; }, ...options });
  return { loader, cache, stats: () => ({ calls, saved, retired }) };
}
test('downloaded bytes survive an unavailable network without persisting an address', async () => {
  const f = fixture();
  assert.deepEqual([...new Uint8Array(await (await f.loader.load(scope, url, { download: true })).arrayBuffer())], [1,2,3]);
  assert.equal(f.stats().calls, 1);
  assert.ok(await f.loader.load(scope, null, { download: false }));
  assert.equal(f.stats().calls, 1);
});
test('passive original lookup never downloads a large original', async () => {
  const f = fixture(); assert.equal(await f.loader.load(scope, url, { download: false }), null);
  assert.equal(f.stats().calls, 0);
});
test('cache admission refuses foreign hosts, traversal and credential-bearing URL authorities', async () => {
  const f = fixture();
  for (const address of ['https://outside.example/storage/v1/object/public/media/one.jpg',
    'https://user:password@core.example/storage/v1/object/public/media/one.jpg',
    'https://core.example/not-storage/one.jpg', 'https://core.example/storage/v1/object/public/media/%2e%2e%2fsecret']) {
    assert.equal(await f.loader.load(scope, address, { download: true }), null);
  }
  assert.equal(f.stats().calls, 0);
});
test('declared oversized, partial and executable responses are not cached', async () => {
  for (const response of [new Response('x', {headers:{'content-length':'33554433','content-type':'image/jpeg'}}),
    new Response('part', {status:206,headers:{'content-type':'video/mp4'}}),
    new Response('<html>', {headers:{'content-type':'text/html'}})]) {
    const f = fixture({ fetch: async () => response });
    assert.equal(await f.loader.load(scope, url, { download: true }), null);
    assert.equal(f.stats().saved, null);
  }
});
test('stream without content length is cancelled at the actual byte ceiling', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(4)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'image/jpeg' } });
  const f = fixture({ fetch: async () => response });
  assert.equal(await f.loader.load(scope, url, { download: true, maxBytes: 5 }), null);
  assert.equal(cancelled, true); assert.equal(f.stats().saved, null);
});
test('retirement during a held response cannot publish or persist bytes', async () => {
  let current = true, release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ fetch: async () => { await gate; return new Response('old', {headers:{'content-type':'image/jpeg'}}); } });
  const pending = f.loader.load(scope, url, {download:true,isCurrent:()=>current});
  await new Promise(resolve => setImmediate(resolve)); current = false; release();
  assert.equal(await pending, null); assert.equal(f.stats().saved, null);
});
test('actual permission refusal retires media while a transient failure does not', async () => {
  for (const status of [401,403,503]) {
    const f = fixture({ fetch: async () => new Response('', {status}) });
    assert.equal(await f.loader.load(scope, url, {download:true}), null);
    assert.equal(f.stats().retired, status === 503 ? 0 : 1);
  }
});

test('a durable producer is captured before the download, not after another document clears it', async () => {
  let generation = 0, saved = false, capture = -1;
  const f = fixture({ cache: {
    get: async () => null,
    put: async () => { saved = true; return true; },
    prepare: async () => { capture = generation; return { put: async () => { saved = capture === generation; return saved; } }; },
  }, fetch: async () => { assert.equal(capture,0); generation++; return new Response('old', {headers:{'content-type':'image/jpeg'}}); } });
  await f.loader.load(scope, url, {download:true});
  assert.equal(capture,0); assert.equal(saved,false);
});
