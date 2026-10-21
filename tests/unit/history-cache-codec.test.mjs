import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { historyCacheCodecModules } from '../helpers/history-cache-codec.mjs';

const root = new URL('../../artifacts/kub/src/lib/', import.meta.url);
const id = n => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-20T00:00:00.123456Z';
const scope = { chatId: id(10), mode: 'all', topicId: null, before: null };
const hash = s => createHash('sha256').update(s, 'utf8').digest('hex');
const row = (n = 2) => ({ id: id(1000+n), user_id: id(2), content: 'Synthetic text',
  created_at: at, edited_at: null, pinned: false, topic_id: null, mention_entities: null });
const page = () => ({ version: 1, chat_id: id(10), scope: 'all', topic_id: null,
  general_topic_ids: [], before_created_at: null, before_id: null, cleared_at: null,
  has_more: false, next_before_created_at: null, next_before_id: null, rows: [row()] });
const wire = p => { const payload = JSON.stringify(p); return { status: 'fresh', payload, digest: hash(payload) }; };
const modules = new Map();
async function moduleUrl(path) {
  if (modules.has(path)) return modules.get(path);
  let source;
  try { source = await readFile(new URL(path, root), 'utf8'); }
  catch(e) { if (e.code === 'ENOENT') return null; throw e; }
  for (const match of source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
    const relative = new URL(match[1], new URL(path, root));
    const dep = await moduleUrl(relative.href.slice(root.href.length));
    source = source.replace(match[0], `from ${JSON.stringify(dep)}`);
  }
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const url = 'data:text/javascript;base64,'+Buffer.from(code).toString('base64'); modules.set(path, url); return url;
}
const url = await moduleUrl('historyCache/codec.ts');
const api = url ? await import(url) : null;

test('received-history codec admits exact bounded synthetic text page', async () => {
  assert.equal(typeof api?.admitHistoryCacheReply, 'function', 'conditional history admission codec is missing');
  const fresh = wire(page());
  const accepted = await api.admitHistoryCacheReply(fresh, scope, null, () => true);
  assert.equal(accepted?.page.rows[0].content, 'Synthetic text');
  assert.equal(accepted?.payload, fresh.payload); assert.equal(accepted?.digest, fresh.digest);
});

test('unchanged requires locally matching bytes and the exact matching response digest', async () => {
  const saved = wire(page());
  const match = { status: 'unchanged', digest: saved.digest, payload: null };
  assert.equal((await api.admitHistoryCacheReply(match, scope, saved, () => true))?.page.rows.length, 1);
  assert.equal(await api.admitHistoryCacheReply(match, scope, null, () => true), null);
  assert.equal(await api.admitHistoryCacheReply(match, scope, { ...saved, payload: saved.payload.replace('Synthetic', 'Corrupted') }, () => true), null);
  assert.equal(await api.admitHistoryCacheReply({ ...match, digest: '0'.repeat(64) }, scope, saved, () => true), null);
  assert.equal(await api.admitHistoryCacheReply({ ...match, payload: saved.payload }, scope, saved, () => true), null);
});

test('no content may publish after owner/privacy retires during asynchronous hashing', async () => {
  let calls = 0;
  assert.equal(await api.admitHistoryCacheReply(wire(page()), scope, null, () => ++calls === 1), null);
  assert.ok(calls >= 2);
  assert.equal(await api.admitHistoryCacheReply(wire(page()), scope, null, () => false), null);
});

test('refusals, malformed digest, corrupted fresh bytes and unexpected fields never admit', async () => {
  const fresh = wire(page());
  for (const reply of [null, {}, { ...fresh, status: 'denied' }, { ...fresh, status: 'unsupported' },
    { ...fresh, digest: 'invalid' }, { ...fresh, payload: fresh.payload+' ' },
    { ...fresh, secret: 'unexpected' }, { status: 'fresh', digest: fresh.digest, payload: null }]) {
    assert.equal(await api.admitHistoryCacheReply(reply, scope, null, () => true), null);
  }
});

test('scope and cursor validation preserve all microseconds and cannot certify another window', async () => {
  const p = page();
  assert.equal(await api.admitHistoryCacheReply(wire(p), { ...scope, chatId: id(11) }, null, () => true), null);
  assert.equal(await api.admitHistoryCacheReply(wire(p), { ...scope, mode: 'root' }, null, () => true), null);
  const upper = { createdAt: '2026-10-20T03:00:00.123457+03:00', id: id(1001) };
  p.before_created_at = '2026-10-20T00:00:00.123457Z'; p.before_id = id(1001);
  assert.ok(await api.admitHistoryCacheReply(wire(p), { ...scope, before: upper }, null, () => true));
  assert.equal(await api.admitHistoryCacheReply(wire(p), { ...scope, before: { ...upper, createdAt: at } }, null, () => true), null);
});

test('literal row bound, unique descending tuples and current clear/topic selection are enforced', async () => {
  const mutations = [
    p => { p.rows = Array.from({length:101}, (_,n) => row(200-n)); },
    p => { p.rows = [row(), row()]; },
    p => { p.rows = [row(1), row(2)]; },
    p => { p.cleared_at = at; },
    p => { p.rows[0].created_at = '2026-02-30T00:00:00.000000Z'; },
    p => { p.rows[0].media_url = 'https://invalid.example/private'; },
    p => { p.rows[0].sender = { full_name: 'must not persist' }; },
    p => { p.rows[0].reply_to = { content: 'must not persist' }; },
    p => { p.rows[0].mention_entities = { version: 1, revision: null, items: [{ kind: 'user' }] }; },
    p => { p.rows[0].content = '\ud800'; },
    p => { p.rows[0].pinned = null; },
  ];
  for (const mutate of mutations) {
    const p = page(); mutate(p);
    assert.equal(await api.admitHistoryCacheReply(wire(p), scope, null, () => true), null, mutate.toString());
  }
  const full = page(); full.rows = Array.from({length:100}, (_,n) => row(200-n));
  assert.equal((await api.admitHistoryCacheReply(wire(full), scope, null, () => true))?.page.rows.length, 100);
});

test('root includes only null/current general topics and explicit topics require exact matches', async () => {
  const p = page(); p.scope = 'root'; p.general_topic_ids = [id(21)]; p.rows[0].topic_id = id(21);
  assert.ok(await api.admitHistoryCacheReply(wire(p), { ...scope, mode: 'root' }, null, () => true));
  p.rows[0].topic_id = id(22);
  assert.equal(await api.admitHistoryCacheReply(wire(p), { ...scope, mode: 'root' }, null, () => true), null);
  p.scope = 'topic'; p.topic_id = id(22); p.general_topic_ids = [];
  assert.ok(await api.admitHistoryCacheReply(wire(p), { ...scope, mode: 'topic', topicId: id(22) }, null, () => true));
  assert.equal(await api.admitHistoryCacheReply(wire(p), { ...scope, mode: 'topic', topicId: id(21) }, null, () => true), null);
});

test('payload size is bounded before parsing or hashing; no content prefix is admitted', async () => {
  const p = page(); p.rows[0].content = 'x'.repeat(1048576);
  assert.equal(await api.admitHistoryCacheReply(wire(p), scope, null, () => true), null);
});

test('hidden-page continuation must advance inside the exact visible window and clear boundary', async () => {
  const p=page();p.rows=[];p.has_more=true;p.next_before_created_at=at;p.next_before_id=id(1001);
  const first=await api.admitHistoryCacheReply(wire(p),scope,null,()=>true);
  assert.equal(first?.page.next_before_id,id(1001),'empty admitted page needs its raw continuation');
  for(const mutate of [
    x=>{x.next_before_id=null;},x=>{x.next_before_created_at=null;},
    x=>{x.has_more=false;},x=>{x.cleared_at=at;},
    x=>{x.rows=[{...row(),created_at:'2026-10-19T00:00:00.000000Z'}];},
  ]) {
    const x=structuredClone(p);mutate(x);
    assert.equal(await api.admitHistoryCacheReply(wire(x),scope,null,()=>true),null);
  }
  p.before_created_at=at;p.before_id=id(1001);
  assert.equal(await api.admitHistoryCacheReply(wire(p),{...scope,before:{createdAt:at,id:id(1001)}},null,()=>true),null);
});

test('loaded omission controls expose corrupted bytes, foreign scope, stale epoch and row-limit widening', async () => {
  const variants = [
    ["digest !== reply.digest", "false", async bad => {
      const saved = wire(page()); const corrupted = { ...saved, payload: saved.payload.replace('Synthetic', 'Corrupted') };
      assert.equal(await bad.admitHistoryCacheReply({ status: 'unchanged', payload: null, digest: saved.digest }, scope, corrupted, () => true), null);
    }],
    ["p.chat_id !== expected.chatId", "false", async bad => {
      assert.equal(await bad.admitHistoryCacheReply(wire(page()), { ...scope, chatId: id(11) }, null, () => true), null);
    }],
    ["if (!isCurrent() || digest !== reply.digest)", "if (digest !== reply.digest)", async bad => {
      // Remove both post-await checks to model losing the publication fence.
      let calls = 0;
      assert.equal(await bad.admitHistoryCacheReply(wire(page()), scope, null, () => ++calls === 1), null);
    }],
    ["p.rows.length > 100", "p.rows.length > 101", async bad => {
      const p = page(); p.rows = Array.from({length:101}, (_,n) => row(200-n));
      assert.equal(await bad.admitHistoryCacheReply(wire(p), scope, null, () => true), null);
    }],
  ];
  for (const [from, to, oracle] of variants) {
    const mutatedUrl = await historyCacheCodecModules(source => {
      assert.equal(source.split(from).length, 2, 'one loaded mutation location required');
      let result = source.replace(from, to);
      if (from.includes('if (!isCurrent()')) {
        assert.equal(result.split('if (!page || !isCurrent())').length, 2);
        result = result.replace('if (!page || !isCurrent())', 'if (!page)');
      }
      return result;
    });
    const bad = await import(mutatedUrl);
    assert.ok(await bad.admitHistoryCacheReply(wire(page()), scope, null, () => true), 'positive calibration must still admit');
    await assert.rejects(oracle(bad), { code: 'ERR_ASSERTION' }, from);
  }
});
