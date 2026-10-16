import assert from 'node:assert/strict';
import test from 'node:test';
import {feedFixture,rpc,put,id,user,other,quote} from './notification-feed-v2.fixture.mjs';
import {
  parseNotificationFeedPageV2,
  parseNotificationFeedLookupV2,
  parseNotificationFeedOpenV2,
  parseNotificationFeedEventV2,
} from '../../artifacts/kub/src/lib/notificationFeedV2.ts';

const plain = value => JSON.parse(JSON.stringify(value));

// Actual SQL and the actual client parser meet here. The fixture is PGlite;
// this is not PostgREST, authenticated issuance or Realtime wire acceptance.
test('actual SQL page, cursor, lookup and open marker satisfy the versioned eight-field client contract', async t => {
  const db = await feedFixture();
  t.after(() => db.close());
  await put(db, 180, {payload: {text: 'fictional'}, at: '2026-01-01T00:00:00.123456Z'});
  await put(db, 181, {payload: {text: 'second'}, at: '2026-01-01T00:00:00.123456Z'});
  await put(db, 182, {who: other});

  const rawPage = await rpc(db, 'page', '1');
  const page = parseNotificationFeedPageV2(rawPage, user);
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].id, id(181));
  assert.deepEqual(plain(page), rawPage);
  assert.deepEqual(Object.keys(page.rows[0]).sort(),
    ['alert_suppressed_at', 'created_at', 'feed_revision', 'id', 'kind', 'payload', 'read_at', 'user_id']);
  assert.equal(page.rows[0].alert_suppressed_at, null);
  assert.equal(page.rows[0].feed_revision, 1);
  const next = parseNotificationFeedPageV2(await rpc(db, 'page',
    `1,${quote(page.next.created_at)},${quote(page.next.id)}`), user);
  assert.deepEqual(next.rows.map(row => row.id), [id(180)]);
  assert.equal(next.next, null);

  const ids = [id(180), id(182), id(199)];
  const rawLookup = await rpc(db, 'lookup', `ARRAY[${ids.map(quote).join(',')}]::uuid[]`);
  const lookup = parseNotificationFeedLookupV2(rawLookup, user, ids);
  assert.deepEqual(lookup.rows.map(row => row.id), [id(180)]);
  assert.deepEqual(lookup.unavailable_ids, [id(182), id(199)]);
  assert.deepEqual(plain(lookup), rawLookup);

  const rawOpen = await rpc(db, 'open', `30,ARRAY[${ids.map(quote).join(',')}]::uuid[]`);
  const opened = parseNotificationFeedOpenV2(rawOpen, user, ids);
  assert.deepEqual(plain(opened), rawOpen);
  const marker = (await db.query(`select to_jsonb(e) as value from public.notification_feed_events_v2 e
    where event_id=${quote(opened.barrier_event_id)}`)).rows[0].value;
  const event = parseNotificationFeedEventV2(marker, user);
  assert.equal(event.event_id, opened.barrier_event_id);
  assert.equal(event.event_kind, 'invalidate');
  assert.equal(event.notification_id, null);
  assert.deepEqual(plain(event), marker);
});

test('actual empty open and retained terminal marker remain explicit in the client envelope', async t => {
  const db = await feedFixture();
  t.after(() => db.close());
  const opened = parseNotificationFeedOpenV2(await rpc(db, 'open'), user, []);
  assert.deepEqual(opened.page.rows, []);
  assert.deepEqual(opened.lookup, {v: 2, rows: [], unavailable_ids: []});

  await put(db, 180);
  await db.exec(`update public.notifications set alert_suppressed_at=clock_timestamp() where id='${id(180)}'`);
  const row = parseNotificationFeedPageV2(await rpc(db, 'page'), user).rows[0];
  assert.equal(row.id, id(180));
  assert.equal(typeof row.alert_suppressed_at, 'string');
  assert.equal(row.read_at, null);
  assert.equal(row.feed_revision, 2);
  const lookup = parseNotificationFeedLookupV2(await rpc(db, 'lookup', `ARRAY['${id(180)}']::uuid[]`), user, [id(180)]);
  assert.equal(lookup.rows[0].alert_suppressed_at, row.alert_suppressed_at);
  assert.equal(lookup.rows[0].feed_revision, 2);
});

test('actual SQL preserves a newer revision even when payload returns to its previous value', async t => {
  const db = await feedFixture();
  t.after(() => db.close());
  await put(db, 180, {payload: {text: 'original'}});
  const first = parseNotificationFeedPageV2(await rpc(db, 'page'), user).rows[0];
  assert.equal(first.feed_revision, 1);
  await db.exec(`update public.notifications set payload='{"text":"edited"}' where id='${id(180)}'`);
  const second = parseNotificationFeedLookupV2(await rpc(db, 'lookup', `ARRAY['${id(180)}']::uuid[]`), user, [id(180)]).rows[0];
  assert.equal(second.feed_revision, 2);
  await db.exec(`update public.notifications set payload='{"text":"original"}' where id='${id(180)}'`);
  const third = parseNotificationFeedPageV2(await rpc(db, 'page'), user).rows[0];
  assert.deepEqual(plain(first.payload), plain(third.payload));
  assert.equal(third.feed_revision, 3);
  assert.notEqual(third.feed_revision, first.feed_revision);
});
