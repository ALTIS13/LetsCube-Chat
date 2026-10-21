import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, page, seed, chat, id, owner, quote, proposal } from './history-cache-page.fixture.mjs';
import { historyCacheCodecModules } from '../helpers/history-cache-codec.mjs';
import { readFile } from 'node:fs/promises';

test('actual SQL payload is accepted by actual client codec; independent windows, UTF8 and mentions survive', async t => {
  const db = await fixture(); t.after(() => db.close()); await seed(db, 103);
  await db.exec(`update public.messages set content=${quote('Synthetic @Alice \u041f\u0440\u0438\u0432\u0435\u0442 \ud83d\ude00')},
    mention_entities='{"version":1,"revision":"${id(9000)}","items":[{"kind":"user","user_id":"${owner}","offset":10,"length":6,"label":"@Alice"}]}'
    where id='${id(1103)}'`);
  const { admitHistoryCacheReply } = await import(await historyCacheCodecModules());
  const scope = { chatId: chat, mode: 'all', topicId: null, before: null };
  const raw = await page(db);
  const first = await admitHistoryCacheReply(raw, scope, null, () => true);
  assert.ok(first, 'SQL canonical payload/UTF8 digest must match browser decoder');
  assert.equal(first.page.rows.length, 100); assert.equal(first.page.rows[0].mention_entities.items[0].user_id, owner);
  const unchanged = await page(db, { digest: first.digest });
  assert.ok(await admitHistoryCacheReply(unchanged, scope, first, () => true));
  const oldest = first.page.rows.at(-1);
  const olderScope = { ...scope, before: { createdAt: oldest.created_at, id: oldest.id } };
  const older = await page(db, { beforeAt: oldest.created_at, beforeId: oldest.id });
  assert.equal((await admitHistoryCacheReply(older, olderScope, null, () => true))?.page.rows.length, 3);
  assert.equal(await admitHistoryCacheReply(older, scope, null, () => true), null);
});

test('loaded SQL omissions fail their calibrated access/content/hide/clear/tuple oracles', async t => {
  const source = await readFile(proposal, 'utf8');
  const cases = [
    ['IF NOT FOUND THEN', 'IF false THEN', async db => {
      await db.exec(`delete from public.chat_members where user_id='${owner}'`);
      assert.deepEqual(await page(db), { status: 'denied' });
    }],
    ["sha256(convert_to(v_payload,'UTF8'))", "sha256(convert_to((v_payload::jsonb-'rows')::text,'UTF8'))", async db => {
      const original = await page(db);
      await db.exec("update public.messages set content='changed without edited timestamp'");
      assert.equal((await page(db, { digest: original.digest })).status, 'fresh');
    }],
    ['h.message_id=m.id AND h.user_id=$7', 'false', async db => {
      await db.exec(`insert into public.message_hidden_for_users values('${id(1103)}','${owner}')`);
      assert.equal(JSON.parse((await page(db)).payload).rows.some(r => r.id === id(1103)), false);
    }],
    ["v_where || ' AND m.created_at>$2'", 'v_where', async db => {
      await db.exec(`update public.chat_members set cleared_at='2026-10-20T00:00:00.123456Z' where user_id='${owner}'`);
      assert.equal(JSON.parse((await page(db)).payload).rows.length, 0);
    }],
    ['(m.created_at,m.id)<($5,$6)', 'm.created_at<$5', async db => {
      const older = await page(db, { beforeAt: '2026-10-20T00:00:00.123456Z', beforeId: id(1004) });
      assert.deepEqual(JSON.parse(older.payload).rows.map(r => r.id), [id(1003),id(1002),id(1001)]);
    }],
  ];
  for (const [from,to,oracle] of cases) {
    assert.equal(source.split(from).length, 2, 'exactly one SQL mutation site required');
    const db = await fixture({ sql: source.replace(from,to) });
    try {
      await seed(db, 103); assert.equal((await page(db)).status, 'fresh', 'positive fixture must remain functional');
      await assert.rejects(oracle(db), { code: 'ERR_ASSERTION' }, from);
    } finally { await db.close(); }
  }
});
