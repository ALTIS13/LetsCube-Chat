import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../../supabase/migrations/20260926085544_album_push_outbox.sql",
  import.meta.url,
);
const activationUrl = new URL(
  "../../supabase/migrations/20260926091149_album_push_activate.sql",
  import.meta.url,
);

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

async function fixture() {
  const db = await new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.messages (
      id uuid primary key, chat_id uuid not null, user_id uuid, bot_id uuid,
      type text, media_url text, media_metadata jsonb not null default '{}'::jsonb,
      deleted_at timestamptz, created_at timestamptz not null default now()
    );
    create table public.notifications (
      id uuid primary key, user_id uuid not null, kind text not null,
      payload jsonb not null, read_at timestamptz, created_at timestamptz not null default now()
    );
    create table public.chat_members (
      chat_id uuid not null, user_id uuid not null, hidden_at timestamptz,
      cleared_at timestamptz, primary key (chat_id, user_id)
    );
    create table public.message_hidden_for_users (
      message_id uuid not null, user_id uuid not null,
      primary key (message_id, user_id)
    );
    create table public.push_subscriptions (
      id uuid primary key, user_id uuid not null, is_active boolean not null
    );
    create table public.user_push_devices (
      id uuid primary key, user_id uuid not null, platform text not null,
      provider text not null, enabled boolean not null, revoked_at timestamptz
    );
    create table public.push_foreground_sessions (
      user_id uuid not null, expires_at timestamptz not null
    );
    create function public._notification_push_allowed(uuid,text,jsonb)
    returns boolean language sql as $$ select true $$;
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.query("update public.album_push_runtime set enabled = true");
  const chat = id(1);
  const sender = id(2);
  const recipient = id(3);
  await db.query(
    "insert into public.chat_members(chat_id,user_id) values ($1,$2)",
    [chat, recipient],
  );
  await db.query(
    "insert into public.push_subscriptions(id,user_id,is_active) values ($1,$2,true)",
    [id(4), recipient],
  );
  await db.query(
    "insert into public.user_push_devices(id,user_id,platform,provider,enabled) values ($1,$2,'android','fcm',true)",
    [id(5), recipient],
  );
  return { db, chat, sender, recipient };
}

async function insertPart(db, { chat, sender, recipient }, messageNumber, index, count = 2, albumId = "album-12345678") {
  const messageId = id(messageNumber);
  const notificationId = id(messageNumber + 100);
  await db.query(
    `insert into public.messages(id,chat_id,user_id,type,media_url,media_metadata)
     values ($1,$2,$3,'image','fixture',jsonb_build_object(
       'album_id',$6::text,'album_index',$4::integer,'album_count',$5::integer))`,
    [messageId, chat, sender, index, count, albumId],
  );
  await db.query(
    `insert into public.notifications(id,user_id,kind,payload)
     values ($1,$2,'message',jsonb_build_object(
       'message_id',$3::text,'chat_id',$4::text,'sender_kind','user','sender_id',$5::text))`,
    [notificationId, recipient, messageId, chat, sender],
  );
  return { messageId, notificationId };
}

test("one album queues one Web and one native target while retaining exact members", async () => {
  const { db, ...context } = await fixture();
  try {
    const first = await insertPart(db, context, 10, 0);
    const second = await insertPart(db, context, 11, 1);
    assert.equal((await db.query("select public.album_push_enqueue($1) as handled", [first.notificationId])).rows[0].handled, true);
    assert.equal((await db.query("select public.album_push_enqueue($1) as handled", [second.notificationId])).rows[0].handled, true);

    const groups = (await db.query(`
      select expected_count, observed_count, ready_at <= now() as ready
      from public.album_push_groups
    `)).rows;
    assert.deepEqual(groups, [{ expected_count: 2, observed_count: 2, ready: true }]);
    const members = (await db.query(`
      select notification_id, album_index from public.album_push_members order by album_index
    `)).rows;
    assert.deepEqual(members, [
      { notification_id: first.notificationId, album_index: 0 },
      { notification_id: second.notificationId, album_index: 1 },
    ]);
    const targets = (await db.query(`
      select subscription_id is not null as web, device_id is not null as native
      from public.notifications_album_push_outbox order by web desc
    `)).rows;
    assert.deepEqual(targets, [{ web: true, native: false }, { web: false, native: true }]);
  } finally {
    await db.close();
  }
});

test("an album key is scoped to recipient and sender, and an index cannot be reused", async () => {
  const { db, ...context } = await fixture();
  try {
    const first = await insertPart(db, context, 20, 0);
    const duplicate = await insertPart(db, context, 21, 0);
    const otherSender = await insertPart(db, { ...context, sender: id(6) }, 22, 0);
    const otherRecipient = id(7);
    await db.query("insert into public.chat_members(chat_id,user_id) values ($1,$2)", [context.chat, otherRecipient]);
    await db.query("insert into public.push_subscriptions(id,user_id,is_active) values ($1,$2,true)", [id(8), otherRecipient]);
    const sameMessageOtherRecipient = id(123);
    await db.query(
      `insert into public.notifications(id,user_id,kind,payload)
       values ($1,$2,'message',jsonb_build_object(
         'message_id',$3::text,'chat_id',$4::text,'sender_kind','user','sender_id',$5::text))`,
      [sameMessageOtherRecipient, otherRecipient, first.messageId, context.chat, context.sender],
    );
    const handled = async (notificationId) => (await db.query(
      "select public.album_push_enqueue($1) as handled",
      [notificationId],
    )).rows[0].handled;
    assert.equal(await handled(first.notificationId), true);
    assert.equal(await handled(duplicate.notificationId), false);
    assert.equal(await handled(otherSender.notificationId), true);
    assert.equal(await handled(sameMessageOtherRecipient), true);
    const groups = (await db.query(`
      select user_id, sender_id, observed_count from public.album_push_groups
      order by user_id, sender_id
    `)).rows;
    assert.deepEqual(groups, [
      { user_id: context.recipient, sender_id: context.sender, observed_count: 1 },
      { user_id: context.recipient, sender_id: id(6), observed_count: 1 },
      { user_id: otherRecipient, sender_id: context.sender, observed_count: 1 },
    ]);
  } finally {
    await db.close();
  }
});

test("album claim rechecks a fresh unread member and acknowledges only its lease", async () => {
  const { db, ...context } = await fixture();
  try {
    const first = await insertPart(db, context, 30, 0);
    const second = await insertPart(db, context, 31, 1);
    await db.query("select public.album_push_enqueue($1)", [first.notificationId]);
    await db.query("select public.album_push_enqueue($1)", [second.notificationId]);
    const token = id(200);
    const rows = (await db.query("select * from public.album_push_claim(10,$1)", [token])).rows;
    assert.equal(rows.length, 2);
    assert.equal((await db.query("select count(*)::integer as n from public.album_push_claim(10,$1)", [id(201)])).rows[0].n, 0);
    await db.query("update public.notifications set read_at=now() where id=$1", [first.notificationId]);
    const web = rows.find((row) => row.subscription_id);
    const native = rows.find((row) => row.device_id);
    const result = (await db.query("select * from public.album_push_recheck($1,$2)", [web.id, token])).rows[0];
    assert.equal(result.status, "deliver");
    assert.equal(result.payload.messageId, second.messageId);
    assert.equal(result.payload.notificationId, second.notificationId);
    assert.equal(result.payload.url, `/?chat=${context.chat}&message=${second.messageId}`);
    assert.equal(result.payload.body, "Новое сообщение");
    assert.equal(await db.query("select public.album_push_ack($1,$2,'sent',null) as ok", [web.id, id(201)]).then((r) => r.rows[0].ok), false);
    assert.equal(await db.query("select public.album_push_ack($1,$2,'sent',null) as ok", [web.id, token]).then((r) => r.rows[0].ok), true);
    await db.query("update public.notifications set read_at=now() where id=$1", [second.notificationId]);
    const noUnread = (await db.query("select * from public.album_push_recheck($1,$2)", [native.id, token])).rows[0];
    assert.equal(noUnread.status, "read");
    assert.equal(noUnread.payload, null);
    const status = (await db.query(`
      select sent_at is not null as sent, suppressed_at is not null as suppressed
      from public.notifications_album_push_outbox where id=$1
    `, [native.id])).rows[0];
    assert.deepEqual(status, { sent: false, suppressed: true });
  } finally {
    await db.close();
  }
});

test("missing album metadata falls back without a database error", async () => {
  const { db, ...context } = await fixture();
  try {
    const part = await insertPart(db, context, 40, 0);
    await db.query("update public.messages set media_metadata='{}'::jsonb where id=$1", [part.messageId]);
    const result = (await db.query(
      "select public.album_push_enqueue($1) as handled",
      [part.notificationId],
    )).rows[0];
    assert.equal(result.handled, false);
    assert.equal((await db.query("select count(*)::integer as n from public.album_push_groups")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("a message without a media type cannot enter the album queue", async () => {
  const { db, ...context } = await fixture();
  try {
    const part = await insertPart(db, context, 41, 0);
    await db.query("update public.messages set type=null where id=$1", [part.messageId]);
    assert.equal((await db.query(
      "select public.album_push_enqueue($1) as handled",
      [part.notificationId],
    )).rows[0].handled, false);
    assert.equal((await db.query("select count(*)::integer as n from public.album_push_groups")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("a fully read incomplete album is eventually suppressed, not left pending", async () => {
  const { db, ...context } = await fixture();
  try {
    const part = await insertPart(db, context, 42, 0);
    await db.query("select public.album_push_enqueue($1)", [part.notificationId]);
    await db.query("update public.notifications set read_at=now() where id=$1", [part.notificationId]);
    await db.query(`
      update public.album_push_groups
      set first_at=now()-interval '35 seconds',
          ready_at=now()-interval '5 seconds'
    `);
    const token = id(205);
    const claimed = (await db.query("select * from public.album_push_claim(10,$1)", [token])).rows;
    assert.equal(claimed.length, 2);
    for (const row of claimed) {
      assert.equal((await db.query(
        "select status from public.album_push_recheck($1,$2)",
        [row.id, token],
      )).rows[0].status, "read");
    }
    assert.deepEqual((await db.query(`
      select suppressed_at is not null as suppressed, suppression_reason
      from public.notifications_album_push_outbox
    `)).rows, [
      { suppressed: true, suppression_reason: "read" },
      { suppressed: true, suppression_reason: "read" },
    ]);
  } finally {
    await db.close();
  }
});

test("late parts keep in-app members but do not send a second external push", async () => {
  const { db, ...context } = await fixture();
  try {
    const first = await insertPart(db, context, 43, 0);
    await db.query("select public.album_push_enqueue($1)", [first.notificationId]);
    await db.query("update public.album_push_groups set ready_at=now()-interval '1 second'");
    const token = id(206);
    const rows = (await db.query("select * from public.album_push_claim(10,$1)", [token])).rows;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      const result = (await db.query(
        "select * from public.album_push_recheck($1,$2)", [row.id, token],
      )).rows[0];
      assert.equal(result.status, "deliver");
      assert.equal(result.payload.messageId, first.messageId);
      assert.equal((await db.query(
        "select public.album_push_ack($1,$2,'sent',null) as ok", [row.id, token],
      )).rows[0].ok, true);
    }
    const last = await insertPart(db, context, 44, 1);
    assert.equal((await db.query(
      "select public.album_push_enqueue($1) as handled", [last.notificationId],
    )).rows[0].handled, true);
    assert.equal((await db.query("select count(*)::integer as n from public.album_push_members")).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::integer as n from public.notifications_album_push_outbox")).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::integer as n from public.album_push_claim(10,$1)", [id(207)])).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("a ten-part album still creates one push per target and routes to its latest part", async () => {
  const { db, ...context } = await fixture();
  try {
    for (let index = 0; index < 10; index += 1) {
      const part = await insertPart(db, context, 1000 + index, index, 10);
      assert.equal((await db.query(
        "select public.album_push_enqueue($1) as handled", [part.notificationId],
      )).rows[0].handled, true);
    }
    assert.equal((await db.query("select observed_count from public.album_push_groups")).rows[0].observed_count, 10);
    assert.equal((await db.query("select count(*)::integer as n from public.notifications_album_push_outbox")).rows[0].n, 2);
    const token = id(208);
    const claimed = (await db.query("select * from public.album_push_claim(10,$1)", [token])).rows;
    assert.equal(claimed.length, 2);
    for (const row of claimed) {
      const result = (await db.query(
        "select * from public.album_push_recheck($1,$2)", [row.id, token],
      )).rows[0];
      assert.equal(result.status, "deliver");
      assert.equal(result.payload.messageId, id(1009));
    }
  } finally {
    await db.close();
  }
});

test("mute changes between enqueue and delivery suppress the album push", async () => {
  const { db, ...context } = await fixture();
  try {
    const first = await insertPart(db, context, 47, 0);
    const last = await insertPart(db, context, 48, 1);
    await db.query("select public.album_push_enqueue($1)", [first.notificationId]);
    await db.query("select public.album_push_enqueue($1)", [last.notificationId]);
    await db.exec(`
      create or replace function public._notification_push_allowed(uuid,text,jsonb)
      returns boolean language sql as $$ select false $$;
    `);
    const token = id(209);
    const claimed = (await db.query("select * from public.album_push_claim(10,$1)", [token])).rows;
    assert.equal(claimed.length, 2);
    for (const row of claimed) {
      assert.equal((await db.query(
        "select status from public.album_push_recheck($1,$2)", [row.id, token],
      )).rows[0].status, "not_eligible");
    }
    assert.equal((await db.query(`
      select count(*)::integer as n from public.notifications_album_push_outbox
      where suppression_reason='not_eligible'
    `)).rows[0].n, 2);
  } finally {
    await db.close();
  }
});

test("provider failures retry at most five times then suppress the target", async () => {
  const { db, ...context } = await fixture();
  try {
    const first = await insertPart(db, context, 45, 0);
    const last = await insertPart(db, context, 46, 1);
    await db.query("select public.album_push_enqueue($1)", [first.notificationId]);
    await db.query("select public.album_push_enqueue($1)", [last.notificationId]);
    const webId = (await db.query(`
      select id from public.notifications_album_push_outbox where subscription_id is not null
    `)).rows[0].id;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = id(230 + attempt);
      await db.query("update public.notifications_album_push_outbox set next_attempt_at=now()-interval '1 second' where id=$1", [webId]);
      assert.equal((await db.query("select count(*)::integer as n from public.album_push_claim(10,$1) where id=$2", [token, webId])).rows[0].n, 1);
      assert.equal((await db.query("select public.album_push_ack($1,$2,'retry','provider_error') as ok", [webId, token])).rows[0].ok, true);
    }
    assert.deepEqual((await db.query(`
      select attempt_count, suppressed_at is not null as suppressed, suppression_reason
      from public.notifications_album_push_outbox where id=$1
    `, [webId])).rows[0], {
      attempt_count: 5, suppressed: true, suppression_reason: "retry_exhausted",
    });
  } finally {
    await db.close();
  }
});

test("a rebound endpoint is suppressed and a foreground Web session is deferred", async () => {
  const { db, ...context } = await fixture();
  try {
    const first = await insertPart(db, context, 50, 0);
    const second = await insertPart(db, context, 51, 1);
    await db.query("select public.album_push_enqueue($1)", [first.notificationId]);
    await db.query("select public.album_push_enqueue($1)", [second.notificationId]);
    const token = id(210);
    const rows = (await db.query("select * from public.album_push_claim(10,$1)", [token])).rows;
    const web = rows.find((row) => row.subscription_id);
    const native = rows.find((row) => row.device_id);
    await db.query("update public.push_subscriptions set user_id=$1 where id=$2", [id(999), id(4)]);
    assert.equal((await db.query("select status from public.album_push_recheck($1,$2)", [web.id, token])).rows[0].status, "target_inactive");
    await db.query("update public.user_push_devices set user_id=$1 where id=$2", [id(999), id(5)]);
    assert.equal((await db.query("select status from public.album_push_recheck($1,$2)", [native.id, token])).rows[0].status, "target_inactive");

    await db.query("update public.push_subscriptions set user_id=$1 where id=$2", [context.recipient, id(4)]);
    await db.query("insert into public.push_foreground_sessions(user_id,expires_at) values ($1,now()+interval '1 minute')", [context.recipient]);
    const later = await insertPart(db, { ...context, sender: id(6) }, 52, 0);
    const last = await insertPart(db, { ...context, sender: id(6) }, 53, 1);
    await db.query("select public.album_push_enqueue($1)", [later.notificationId]);
    await db.query("select public.album_push_enqueue($1)", [last.notificationId]);
    const newRows = (await db.query("select * from public.album_push_claim(10,$1)", [id(211)])).rows;
    const newWeb = newRows.find((row) => row.subscription_id);
    assert.equal((await db.query("select status from public.album_push_recheck($1,$2)", [newWeb.id, id(211)])).rows[0].status, "foreground");
    assert.equal((await db.query("select claim_token is null as released from public.notifications_album_push_outbox where id=$1", [newWeb.id])).rows[0].released, true);
  } finally {
    await db.close();
  }
});

test("album queue denies client roles and rejects an invalid acknowledgement", async () => {
  const { db, ...context } = await fixture();
  try {
    const permissions = (await db.query(`
      select
        has_table_privilege('anon','public.notifications_album_push_outbox','SELECT') as anon_table,
        has_table_privilege('authenticated','public.album_push_groups','INSERT') as authenticated_table,
        has_function_privilege('anon','public.album_push_enqueue(uuid)','EXECUTE') as anon_enqueue,
        has_function_privilege('authenticated','public.album_push_claim(integer,uuid)','EXECUTE') as authenticated_claim,
        has_function_privilege('service_role','public.album_push_claim(integer,uuid)','EXECUTE') as service_claim,
        (select relrowsecurity from pg_class where oid='public.notifications_album_push_outbox'::regclass) as rls
    `)).rows[0];
    assert.deepEqual(permissions, {
      anon_table: false, authenticated_table: false, anon_enqueue: false,
      authenticated_claim: false, service_claim: true, rls: true,
    });
    const first = await insertPart(db, context, 60, 0);
    const second = await insertPart(db, context, 61, 1);
    await db.query("select public.album_push_enqueue($1)", [first.notificationId]);
    await db.query("select public.album_push_enqueue($1)", [second.notificationId]);
    const token = id(220);
    const row = (await db.query("select id from public.album_push_claim(1,$1)", [token])).rows[0];
    await assert.rejects(
      db.query("select public.album_push_ack($1,$2,$3,null)", [row.id, token, null]),
      /invalid_album_push_ack/,
    );
    assert.equal((await db.query(
      "select claim_token=$1 as still_claimed from public.notifications_album_push_outbox where id=$2",
      [token, row.id],
    )).rows[0].still_claimed, true);
  } finally {
    await db.close();
  }
});

for (const legacyWns of [false, true]) {
test(`activation preserves ${legacyWns ? "Web, FCM and WNS" : "Web and FCM"} legacy delivery while grouping new albums`, async () => {
  const { db, ...context } = await fixture();
  try {
    if (legacyWns) {
      await db.query(
        "insert into public.user_push_devices(id,user_id,platform,provider,enabled) values ($1,$2,'windows','wns',true)",
        [id(9), context.recipient],
      );
    }
    await db.exec(`
      update public.album_push_runtime set enabled=false;
      create function public._notification_push_payload(text,jsonb)
      returns jsonb language sql as $$ select jsonb_build_object('kind',$1,'tag','message:chat:' || ($2->>'chat_id')) $$;
      create table public.notifications_push_outbox (
        notification_id uuid not null, subscription_id uuid not null,
        user_id uuid not null, payload jsonb not null,
        unique(notification_id,subscription_id)
      );
      create table public.notifications_native_push_outbox (
        notification_id uuid not null, device_id uuid not null,
        user_id uuid not null, payload jsonb not null,
        unique(notification_id,device_id)
      );
      create function public._enqueue_push_after_notification_insert()
      returns trigger language plpgsql security definer set search_path=public as $$
      begin
        insert into public.notifications_push_outbox(notification_id,subscription_id,user_id,payload)
        select new.id, ps.id, new.user_id, public._notification_push_payload(new.kind,new.payload)
        from public.push_subscriptions ps where ps.user_id=new.user_id and ps.is_active;
        insert into public.notifications_native_push_outbox(notification_id,device_id,user_id,payload)
        select new.id, pd.id, new.user_id, public._notification_push_payload(new.kind,new.payload)
        from public.user_push_devices pd where pd.user_id=new.user_id and
          ((pd.platform = 'android' and pd.provider = 'fcm')${legacyWns ? " or (pd.platform = 'windows' and pd.provider = 'wns')" : ""})
          and pd.enabled and pd.revoked_at is null;
        return null;
      end $$;
      create trigger enqueue_push_after_notification_insert
      after insert on public.notifications for each row
      execute function public._enqueue_push_after_notification_insert();
    `);
    const oldFirst = await insertPart(db, context, 70, 0);
    assert.equal((await db.query("select count(*)::integer as n from public.notifications_push_outbox")).rows[0].n, 1);
    await db.exec(await readFile(activationUrl, "utf8"));
    const oldLast = await insertPart(db, context, 71, 1);
    const newFirst = await insertPart(db, context, 72, 0, 2, "album-new-12345678");
    const newLast = await insertPart(db, context, 73, 1, 2, "album-new-12345678");
    assert.equal((await db.query("select count(*)::integer as n from public.notifications_push_outbox")).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::integer as n from public.notifications_native_push_outbox")).rows[0].n, legacyWns ? 6 : 2);
    assert.equal((await db.query(`
      select count(*)::integer as n from public.notifications_native_push_outbox o
      join public.user_push_devices d on d.id=o.device_id where d.platform='windows'
    `)).rows[0].n, legacyWns ? 4 : 0);
    assert.equal((await db.query("select legacy_wns_enabled from public.album_push_runtime")).rows[0].legacy_wns_enabled, legacyWns);
    assert.equal((await db.query("select count(*)::integer as n from public.album_push_legacy_keys")).rows[0].n, 1);
    assert.deepEqual((await db.query(`
      select album_id, observed_count from public.album_push_groups
    `)).rows, [{ album_id: "album-new-12345678", observed_count: 2 }]);
    assert.deepEqual((await db.query(`
      select notification_id from public.album_push_members order by album_index
    `)).rows.map((row) => row.notification_id), [newFirst.notificationId, newLast.notificationId]);
    assert.notEqual(oldFirst.notificationId, oldLast.notificationId);

    await db.query("update public.album_push_runtime set enabled=false");
    const disabled = await insertPart(db, context, 74, 0, 2, "album-disabled-12345678");
    assert.equal((await db.query("select count(*)::integer as n from public.notifications_push_outbox")).rows[0].n, 3);
    assert.equal((await db.query("select count(*)::integer as n from public.album_push_groups")).rows[0].n, 1);

    await db.query("update public.album_push_runtime set enabled=true");
    await db.exec(`
      create or replace function public.album_push_enqueue(p_notification_id uuid)
      returns boolean language plpgsql as $$
      begin raise exception 'synthetic_album_failure'; end $$;
    `);
    const failed = await insertPart(db, context, 75, 0, 2, "album-failed-12345678");
    assert.equal((await db.query("select count(*)::integer as n from public.notifications_push_outbox")).rows[0].n, 4);
    assert.notEqual(disabled.notificationId, failed.notificationId);
  } finally {
    await db.close();
  }
});
}
