import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fixture, id, owner, peer, chat, foreignChat, topic, general, otherTopic, quote, page, seed, asUser } from './history-cache-page.fixture.mjs';

const signature = 'public.message_text_cache_page_v1(uuid,text,uuid,timestamptz,uuid,text)';
const body = result => JSON.parse(result.payload);
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');

test('candidate adds a callable conditional-history endpoint', async t => {
  const db = await fixture(); t.after(() => db.close());
  const { rows } = await db.query(`select to_regprocedure('${signature}') is not null as present`);
  assert.equal(rows[0].present, true, 'received-history conditional endpoint is missing');
});

test('fresh page and unchanged reply share exact UTF8 content digest without a second body', async t => {
  const db = await fixture(); t.after(() => db.close()); await seed(db, 103);
  const fresh = await page(db);
  assert.equal(fresh.status, 'fresh'); assert.equal(digest(fresh.payload), fresh.digest);
  const p = body(fresh);
  assert.equal(p.version, 1); assert.equal(p.rows.length, 100); assert.equal(p.has_more, true);
  assert.equal(p.rows[0].id, id(1103)); assert.equal(p.rows[99].id, id(1004));
  assert.equal(p.rows[0].created_at, '2026-10-20T00:00:00.123456Z');
  const match = await page(db, { digest: fresh.digest });
  assert.deepEqual(match, { status: 'unchanged', digest: fresh.digest, payload: null });
  const older = await page(db, { beforeAt: p.rows[99].created_at, beforeId: p.rows[99].id });
  assert.deepEqual(body(older).rows.map(r => r.id), [id(1003), id(1002), id(1001)]);
  assert.equal(body(older).has_more, false);
});

test('same edited timestamp, mention-only mutation and head replacement change the digest', async t => {
  const db = await fixture(); t.after(() => db.close()); await seed(db, 2);
  const first = await page(db);
  await db.exec(`update public.messages set content='synthetic edited' where id='${id(1002)}'`);
  const edited = await page(db, { digest: first.digest });
  assert.equal(edited.status, 'fresh'); assert.notEqual(edited.digest, first.digest);
  assert.equal(body(edited).rows[0].content, 'synthetic edited');
  await db.exec(`update public.messages set mention_entities='{"version":1,"entities":[]}' where id='${id(1002)}'`);
  const mention = await page(db, { digest: edited.digest }); assert.notEqual(mention.digest, edited.digest);
  await db.exec(`update public.messages set created_at='2026-10-19T00:00:00Z' where id='${id(1002)}'`);
  assert.notEqual((await page(db)).digest, mention.digest);
});

test('own hide/unhide and clear change page admission without depending on edited_at', async t => {
  const db = await fixture(); t.after(() => db.close()); await seed(db, 2);
  const first = await page(db);
  await db.exec(`insert into public.message_hidden_for_users values('${id(1002)}','${owner}')`);
  const hidden = await page(db, { digest: first.digest });
  assert.equal(hidden.status, 'fresh'); assert.deepEqual(body(hidden).rows.map(r => r.id), [id(1001)]);
  assert.equal((await page(db, {}, peer)).digest, first.digest);
  await db.exec('delete from public.message_hidden_for_users');
  assert.equal((await page(db)).digest, first.digest);
  await db.exec(`update public.chat_members set cleared_at='2026-10-20T00:00:00.123456Z' where user_id='${owner}'`);
  const cleared = await page(db, { digest: first.digest });
  assert.deepEqual(body(cleared).rows, []); assert.equal(body(cleared).has_more, false);
});

test('no positive membership, banned reader or anonymous identity returns a usable digest', async t => {
  const db = await fixture(); t.after(() => db.close()); await seed(db);
  const first = await page(db);
  assert.deepEqual(await page(db, { chat: foreignChat, digest: first.digest }), { status: 'denied' });
  assert.deepEqual(await page(db, { digest: first.digest }, null), { status: 'denied' });
  await db.exec(`insert into public.fixture_bans values('${owner}')`);
  assert.deepEqual(await page(db, { digest: first.digest }), { status: 'denied' });
  await db.exec(`delete from public.fixture_bans; delete from public.chat_members where user_id='${owner}'`);
  assert.deepEqual(await page(db, { digest: first.digest }), { status: 'denied' });
});

test('server derives current general-topic set and refuses a foreign explicit topic', async t => {
  const db = await fixture(); t.after(() => db.close()); await seed(db, 3);
  await db.exec(`update public.chats set is_forum=true where id='${chat}';
    update public.messages set topic_id='${topic}' where id='${id(1003)}';
    update public.messages set topic_id='${general}' where id='${id(1002)}'`);
  assert.deepEqual(body(await page(db, { scope: 'root' })).rows.map(r => r.id), [id(1002), id(1001)]);
  assert.deepEqual(body(await page(db, { scope: 'topic', topic })).rows.map(r => r.id), [id(1003)]);
  assert.deepEqual(await page(db, { scope: 'topic', topic: otherTopic }), { status: 'denied' });
  await db.exec(`update public.topics set is_general=false where id='${general}'`);
  assert.deepEqual(body(await page(db, { scope: 'root' })).rows.map(r => r.id), [id(1001)]);
});

test('mixed media/replies/forwards/bots/group tombstones fall back, never drop unsupported slots', async t => {
  const db = await fixture(); t.after(() => db.close()); await seed(db, 2);
  for (const patch of ["type='photo'", "reply_to_id='"+id(1001)+"'", "forwarded_from_id='"+id(1001)+"'",
    "bot_id='"+peer+"'", "media_path='synthetic'", "media_metadata='{}'", "system_payload='{}'"]) {
    await db.exec(`update public.messages set ${patch} where id='${id(1002)}'`);
    assert.deepEqual(await page(db), { status: 'unsupported' }, patch);
    await db.exec(`update public.messages set type='text',reply_to_id=null,forwarded_from_id=null,
      bot_id=null,media_path=null,media_metadata=null,system_payload=null where id='${id(1002)}'`);
  }
  await db.exec(`update public.messages set deleted_at=now(),content='must never escape' where id='${id(1002)}'`);
  assert.deepEqual(body(await page(db)).rows.map(r => r.id), [id(1001)], 'private deletion has no slot');
  await db.exec(`update public.chats set type='group' where id='${chat}'`);
  assert.deepEqual(await page(db), { status: 'unsupported' }, 'group tombstone needs normal renderer');
});

test('whole page selection precedes own-hidden filtering and does not scan far to manufacture text', async t => {
  const db = await fixture(); t.after(() => db.close()); await seed(db, 101);
  await db.exec(`update public.messages set type='photo' where id='${id(1001)}';
    insert into public.message_hidden_for_users select id,'${owner}' from public.messages where id<>'${id(1001)}'`);
  const result = body(await page(db)); assert.equal(result.rows.length, 0); assert.equal(result.has_more, true);
});

test('fully hidden page retains raw exclusive continuation to the next visible message', async t => {
  const db = await fixture(); t.after(() => db.close()); await seed(db, 101);
  await db.exec(`insert into public.message_hidden_for_users select id,'${owner}' from public.messages where id<>'${id(1001)}'`);
  const first = body(await page(db));
  assert.deepEqual(first.rows, []); assert.equal(first.has_more, true);
  assert.equal(first.next_before_created_at, '2026-10-20T00:00:00.123456Z');
  assert.equal(first.next_before_id, id(1002));
  const next = body(await page(db, { beforeAt: first.next_before_created_at, beforeId: first.next_before_id }));
  assert.deepEqual(next.rows.map(row => row.id), [id(1001)]);
  assert.equal(next.has_more, false); assert.equal(next.next_before_id, null); assert.equal(next.next_before_created_at, null);
});

test('old window remains independent of new head but rejects mutations inside its exact tuple', async t => {
  const db = await fixture(); t.after(() => db.close()); await seed(db, 103);
  const args = { beforeAt: '2026-10-20T00:00:00.123456Z', beforeId: id(1004) };
  const older = await page(db, args);
  await db.exec(`update public.messages set content='new head text' where id='${id(1103)}'`);
  assert.equal((await page(db, { ...args, digest: older.digest })).status, 'unchanged');
  await db.exec(`delete from public.messages where id='${id(1002)}'`);
  const changed = await page(db, { ...args, digest: older.digest });
  assert.equal(changed.status, 'fresh'); assert.deepEqual(body(changed).rows.map(r => r.id), [id(1003), id(1001)]);
});

test('invalid cursor/scope/digest is refused; endpoint stays invoker/stable and not callable by anon', async t => {
  const db = await fixture(); t.after(() => db.close()); await seed(db);
  for (const args of [{ scope: 'typo' }, { scope: 'topic' }, { topic }, { beforeId: id(1002) },
    { beforeAt: '2026-10-20T00:00:00Z' }, { digest: 'invalid' }]) {
    assert.deepEqual(await page(db, args), { status: 'invalid' });
  }
  const rows = (await db.query(`select prosecdef,provolatile,
    has_function_privilege('anon',oid,'execute') as anon,
    has_function_privilege('authenticated',oid,'execute') as authenticated
    from pg_proc where oid='${signature}'::regprocedure`)).rows;
  assert.deepEqual(rows, [{ prosecdef: false, provolatile: 's', anon: false, authenticated: true }]);
  await db.exec('set role anon');
  await assert.rejects(db.query(`select public.message_text_cache_page_v1('${chat}')`), e => e.code === '42501');
  await db.exec('reset role');
});

test('nullable unsupported discriminator never becomes a certified text row', async t => {
  const db = await fixture(); t.after(() => db.close()); await seed(db);
  await db.exec('update public.messages set type=null');
  assert.deepEqual(await page(db), { status: 'unsupported' });
});

test('large or nonfinite page data falls back instead of truncating or creating an invalid cursor', async t => {
  const db = await fixture(); t.after(() => db.close()); await seed(db);
  await db.exec("update public.messages set content=repeat('x',1048576)");
  assert.deepEqual(await page(db), { status: 'unsupported' });
  await db.exec("update public.messages set content='synthetic',created_at='infinity'");
  assert.deepEqual(await page(db), { status: 'unsupported' });
});
