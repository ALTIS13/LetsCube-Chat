import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const proposal = new URL("../../supabase/migration-proposals/native_message_preview.sql", import.meta.url);
const visibilitySource = new URL("../../supabase/migrations/20261001180000_member_mentions.sql", import.meta.url);
const albumSource = new URL("../../supabase/migrations/20260926085544_album_push_outbox.sql", import.meta.url);
const uuid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const recipient = uuid(1), sender = uuid(2), other = uuid(3);
const session = uuid(4), device = uuid(5), chat = uuid(6), message = uuid(7), notification = uuid(8);
const rpc = "public.native_message_notification_preview(uuid,uuid)";

async function fixture(sql) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create role outsider;
    create schema auth; create schema private;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key, user_id uuid not null,
      created_at timestamptz not null, not_after timestamptz);
    create table public.profiles(id uuid primary key, full_name text);
    create table public.bots(id uuid primary key, display_name text);
    create table public.chats(id uuid primary key, type text, name text);
    create table public.messages(id uuid primary key, chat_id uuid not null, user_id uuid,
      bot_id uuid, content text, type text, deleted_at timestamptz, created_at timestamptz,
      topic_id uuid);
    create table public.chat_members(chat_id uuid, user_id uuid, joined_at timestamptz,
      hidden_at timestamptz, cleared_at timestamptz);
    create table public.topics(id uuid primary key, chat_id uuid);
    create table public.message_hidden_for_users(message_id uuid, user_id uuid);
    create table public.user_blocks(blocker_id uuid, blocked_id uuid);
    create table public.fixture_banned(user_id uuid primary key);
    create function public.is_banned(p_user uuid) returns boolean language sql stable as $$
      select exists(select 1 from public.fixture_banned where user_id=p_user)
    $$;
    create table public.notifications(id uuid primary key, user_id uuid not null,
      kind text not null, payload jsonb not null, read_at timestamptz, created_at timestamptz);
    create table public.user_push_devices(id uuid primary key, user_id uuid not null,
      session_id uuid, platform text, provider text, enabled boolean, revoked_at timestamptz);
    create table public.notifications_native_push_outbox(id uuid primary key, notification_id uuid,
      device_id uuid, user_id uuid, payload jsonb);
    create table public.fixture_push_policy(user_id uuid primary key, allowed boolean);
    create table public.push_subscriptions(id uuid primary key);
    -- A controlled policy boundary, not a replacement or proof of the live push policy.
    create function public._notification_push_allowed(p_user uuid,p_kind text,p_payload jsonb)
    returns boolean language sql stable as $$
      select p_kind='message' and exists(select 1 from public.fixture_push_policy f
        join public.messages m on m.id::text=p_payload->>'message_id'
        where f.user_id=p_user and f.allowed and m.chat_id::text=p_payload->>'chat_id'
          and m.user_id::text is not distinct from p_payload->>'sender_id')
    $$;
    insert into auth.users values ('${recipient}'),('${sender}'),('${other}');
    insert into auth.sessions values ('${session}','${recipient}',now()-interval '2 hours',null);
    insert into public.profiles values ('${sender}','Fixture sender'),('${other}','Other fixture sender');
    insert into public.chats values ('${chat}','group','Fixture group');
    insert into public.chat_members values ('${chat}','${recipient}',now()-interval '3 hours',null,null);
    insert into public.messages values ('${message}','${chat}','${sender}',null,
      'Current fixture text','text',null,now()-interval '1 minute',null);
    insert into public.notifications values ('${notification}','${recipient}','message',
      '{"message_id":"${message}","chat_id":"${chat}","sender_id":"${other}","body":"STALE","title":"STALE"}',
      null,now()-interval '1 minute');
    insert into public.user_push_devices values ('${device}','${recipient}','${session}',
      'android','fcm',true,null);
    insert into public.notifications_native_push_outbox values ('${uuid(9)}','${notification}',
      '${device}','${recipient}','{"body":"STALE OUTBOX"}');
    insert into public.fixture_push_policy values ('${recipient}',true);
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid(),auth.jwt() to authenticated;
  `);
  const source = await readFile(visibilitySource, "utf8");
  const start = source.indexOf("CREATE FUNCTION private.message_notification_visible_to(");
  const end = source.indexOf("$fn$;", start) + "$fn$;".length;
  assert.ok(start >= 0 && end > start, "the fixture must load the actual visibility function");
  await db.exec(source.slice(start, end));
  const album = await readFile(albumSource,"utf8");
  const albumStart = album.indexOf("create table public.album_push_groups (");
  const albumEnd = album.indexOf("create unique index album_push_outbox_web_unique",albumStart);
  assert.ok(albumStart >= 0 && albumEnd > albumStart,"fixture must load actual album association DDL");
  await db.exec(album.slice(albumStart,albumEnd));
  if (sql !== undefined) await db.exec(sql);
  await claims(db);
  return db;
}

async function albumDelivery(db) {
  await db.exec(`
    delete from public.notifications_native_push_outbox;
    update public.messages set type='image';
    insert into public.messages select '${uuid(20)}',chat_id,user_id,bot_id,
      'https://fixture.invalid/second-object','image',null,now()-interval '30 seconds',null from public.messages;
    insert into public.notifications values('${uuid(21)}','${recipient}','message',
      '{"message_id":"${uuid(20)}","chat_id":"${chat}"}',null,now()-interval '30 seconds');
    insert into public.album_push_groups(id,user_id,chat_id,sender_kind,sender_id,album_id,expected_count,observed_count)
      values('${uuid(22)}','${recipient}','${chat}','user','${sender}','fixture-album',2,2);
    insert into public.album_push_members values('${uuid(22)}','${notification}','${message}',0),
      ('${uuid(22)}','${uuid(21)}','${uuid(20)}',1);
    insert into public.notifications_album_push_outbox(id,group_id,device_id)
      values('${uuid(23)}','${uuid(22)}','${device}');
    insert into public.user_push_devices values('${uuid(10)}','${other}',null,'android','fcm',true,null);
    insert into public.push_subscriptions values('${uuid(25)}');
  `);
}

async function claims(db, overrides = {}) {
  const jwt = { sub: recipient, session_id: session, role: "authenticated", is_anonymous: false,
    exp: Math.floor(Date.now() / 1000) + 3600, ...overrides };
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(jwt)]);
}
async function preview(db, d = device, n = notification) {
  await db.exec("set role authenticated");
  try {
    return (await db.query("select * from public.native_message_notification_preview($1,$2)", [d, n])).rows;
  } finally {
    await db.exec("reset role");
  }
}
async function capability(db, d = device) {
  await db.exec("set role authenticated");
  try {
    return (await db.query("select * from public.native_message_preview_capability($1)", [d])).rows;
  } finally { await db.exec("reset role"); }
}
async function consent(db, level = "message", user = recipient) {
  await db.query("insert into public.notification_preview_preferences(user_id,preview_level) values($1,$2)", [user, level]);
}
async function sourceSql() {
  try { return await readFile(proposal, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

test("recipient preview capability is explicitly available, not inferred from voice or visibility", async () => {
  const db = await fixture(await sourceSql());
  try {
    const row = (await db.query("select to_regprocedure($1) is not null as present", [rpc])).rows[0];
    assert.equal(row.present, true, "a separate recipient-authenticated preview RPC is missing");
  } finally { await db.close(); }
});

test("device capability exists independently of message consent and discloses only its current bound choice", async () => {
  const db = await fixture(await sourceSql());
  try {
    assert.equal((await db.query("select to_regprocedure('public.native_message_preview_capability(uuid)') is not null as present")).rows[0].present,
      true, "a separately authenticated device capability is missing");
    assert.deepEqual(await capability(db), [{ preview_v: 1, recipient_id: recipient, session_id: session,
      device_id: device, preview_level: "none" }]);
    assert.deepEqual(await preview(db), [], "capability alone must never grant message display");
    await consent(db, "sender");
    assert.equal((await capability(db))[0].preview_level, "sender");
    await db.query("update public.notification_preview_preferences set preview_level='message' where user_id=$1", [recipient]);
    assert.equal((await capability(db))[0].preview_level, "message");
    await db.exec("begin read only");
    assert.equal((await capability(db))[0].device_id, device);
    await db.exec("rollback");
  } finally { await db.close(); }
});

test("capability refuses stale sessions and mismatched, disabled or non-Android FCM devices", async (t) => {
  for (const [name, change] of [
    ["foreign owner", `update public.user_push_devices set user_id='${other}'`],
    ["foreign session", `update public.user_push_devices set session_id='${uuid(31)}'`],
    ["missing session", "update public.user_push_devices set session_id=null"],
    ["revoked device", "update public.user_push_devices set revoked_at=now()"],
    ["disabled device", "update public.user_push_devices set enabled=false"],
    ["non Android", "update public.user_push_devices set platform='windows'"],
    ["non FCM", "update public.user_push_devices set provider='wns'"],
    ["revoked auth", "delete from auth.sessions"],
    ["expired auth", "update auth.sessions set not_after=now()-interval '1 second'"],
  ]) {
    await t.test(name, async () => {
      const db = await fixture(await sourceSql());
      try {
        assert.equal((await capability(db)).length, 1, "positive control must precede refusal");
        await db.exec(change);
        assert.deepEqual(await capability(db), []);
      } finally { await db.close(); }
    });
  }
});

test("capability rejects absent device and anonymous, service or expired JWT contexts", async () => {
  const db = await fixture(await sourceSql());
  try {
    assert.deepEqual(await capability(db, null), []);
    assert.deepEqual(await capability(db, other), []);
    for (const override of [{ is_anonymous: true }, { role: "service_role" }, { exp: 1 }, { session_id: other }]) {
      await claims(db, override);
      assert.deepEqual(await capability(db), []);
    }
    for (const role of ["anon", "service_role", "outsider"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from public.native_message_preview_capability($1)", [device]), /permission denied/);
      await db.exec("reset role");
    }
  } finally { await db.close(); }
});

test("compiled capability guards must refuse owner/session/device and default-choice mutations", async (t) => {
  const original = await readFile(proposal, "utf8");
  const start = original.indexOf("create function public.native_message_preview_capability(");
  const end = original.indexOf("alter function public.native_message_preview_capability(", start);
  assert.ok(start >= 0 && end > start);
  const body = original.slice(start, end);
  for (const [name, before, after, change, verify] of [
    ["exact device", "d.id = p_device_id", "true", "", async db => assert.deepEqual(await capability(db, other), [])],
    ["owner", "d.user_id = v_recipient", "true", `update public.user_push_devices set user_id='${other}'`],
    ["session", "d.session_id = v_session", "true", `update public.user_push_devices set session_id='${other}'`],
    ["platform", "d.platform = 'android'", "true", "update public.user_push_devices set platform='windows'"],
    ["provider", "d.provider = 'fcm'", "true", "update public.user_push_devices set provider='wns'"],
    ["enabled", "d.enabled is true", "true", "update public.user_push_devices set enabled=false"],
    ["revoked", "d.revoked_at is null", "true", "update public.user_push_devices set revoked_at=now()"],
    ["default none", "coalesce(pref.preview_level,'none')", "coalesce(pref.preview_level,'message')", "",
      async db => assert.equal((await capability(db))[0].preview_level, "none")],
  ]) {
    await t.test(name, async () => {
      assert.equal(body.split(before).length, 2, "capability mutation anchor must be unique");
      const mutation = original.slice(0, start) + body.replace(before, after) + original.slice(end);
      const db = await fixture(mutation);
      try {
        await db.exec(change);
        await assert.rejects((verify ?? (async db => assert.deepEqual(await capability(db), [])))(db),
          error => error instanceof assert.AssertionError, "compiled behavioral mutant must fail a literal oracle");
      } finally { await db.close(); }
    });
  }
});

test("preview defaults to none; explicit sender/message choice uses fresh source and exact identities", async () => {
  const db = await fixture(await sourceSql());
  try {
    assert.deepEqual(await preview(db), []);
    await consent(db, "none");
    assert.deepEqual(await preview(db), []);
    await db.query("update public.notification_preview_preferences set preview_level='sender' where user_id=$1", [recipient]);
    const [senderOnly] = await preview(db);
    assert.equal(senderOnly.title, "Fixture sender");
    assert.equal(senderOnly.body, "Новое сообщение");
    assert.equal(senderOnly.preview_level, "sender");
    assert.equal(senderOnly.sender_name, "Fixture sender");
    await db.query("update public.notification_preview_preferences set preview_level='message' where user_id=$1", [recipient]);
    const [full] = await preview(db);
    assert.equal(full.body, "Current fixture text");
    assert.equal(full.title, "Fixture sender");
    assert.equal(full.preview_v, 1);
    assert.deepEqual([full.recipient_id,full.session_id,full.device_id,full.notification_id,full.chat_id,full.message_id],
      [recipient,session,device,notification,chat,message]);
    const ttl = (await db.query("select expires_at-statement_timestamp() as ttl from public.native_message_notification_preview($1,$2)", [device, notification])).rows[0].ttl;
    assert.equal(ttl, "00:00:15", "preview lease must be exactly 15 seconds from the authorization statement");
    assert.deepEqual(Object.keys(full).sort(), ["preview_v","recipient_id","session_id","device_id","notification_id",
      "chat_id","message_id","preview_level","sender_name","title","body","expires_at"].sort());
    assert.equal(JSON.stringify(full).includes("STALE"), false);
  } finally { await db.close(); }
});

const denials = [
  ["revoked auth session", "delete from auth.sessions"],
  ["expired auth session", "update auth.sessions set not_after=now()-interval '1 second'"],
  ["session owner changed", `update auth.sessions set user_id='${other}'`],
  ["disabled device", "update public.user_push_devices set enabled=false"],
  ["revoked device", "update public.user_push_devices set revoked_at=now()"],
  ["device owner changed", `update public.user_push_devices set user_id='${other}'`],
  ["device session changed", `update public.user_push_devices set session_id='${uuid(10)}'`],
  ["device binding missing", "update public.user_push_devices set session_id=null"],
  ["unsupported native platform", "update public.user_push_devices set platform='windows',provider='wns'"],
  ["notification read", "update public.notifications set read_at=now()"],
  ["notification owner changed", `update public.notifications set user_id='${other}'`],
  ["old-session notification", "update public.notifications set created_at=now()-interval '3 hours'"],
  ["different notification kind", "update public.notifications set kind='task'"],
  ["message mapping changed", `update public.notifications set payload=jsonb_set(payload,'{message_id}','"${uuid(11)}"')`],
  ["chat mapping changed", `update public.notifications set payload=jsonb_set(payload,'{chat_id}','"${uuid(11)}"')`],
  ["no device delivery association", "delete from public.notifications_native_push_outbox"],
  ["outbox owner mismatch", `update public.notifications_native_push_outbox set user_id='${other}'`],
  ["outbox device mismatch", `update public.notifications_native_push_outbox set device_id='${uuid(10)}'`],
  ["outbox notification mismatch", `update public.notifications_native_push_outbox set notification_id='${uuid(10)}'`],
  ["push policy denies", "update public.fixture_push_policy set allowed=false"],
  ["message deleted", "update public.messages set deleted_at=now()"],
  ["no chat membership", "delete from public.chat_members"],
  ["chat hidden", "update public.chat_members set hidden_at=now()"],
  ["history cleared", "update public.chat_members set cleared_at=now()"],
  ["pre-join message", "update public.chat_members set joined_at=now()"],
  ["recipient blocked sender", `insert into public.user_blocks values('${recipient}','${sender}')`],
  ["message hidden for recipient", `insert into public.message_hidden_for_users values('${message}','${recipient}')`],
  ["recipient banned", `insert into public.fixture_banned values('${recipient}')`],
  ["missing topic", `update public.messages set topic_id='${uuid(10)}'`],
  ["self-authored message", `update public.messages set user_id='${recipient}'`],
];
test("authorization denies revoked/read/stale/cross-owner and current visibility failures", async (t) => {
  const db = await fixture(await sourceSql());
  try {
    await consent(db);
    assert.equal((await preview(db)).length, 1, "every denial must start from a working authorized fixture");
    for (const [name, change] of denials) {
      await t.test(name, async () => {
        await db.exec("begin");
        try {
          await db.exec(change);
          assert.deepEqual(await preview(db), [], name);
        } finally { await db.exec("rollback"); }
      });
    }
    assert.equal((await preview(db)).length, 1, "denial cases must not corrupt the positive control");
  } finally { await db.close(); }
});

test("expired, anonymous, malformed or missing JWT claims cannot authorize preview", async () => {
  const db = await fixture(await sourceSql());
  try {
    await consent(db);
    for (const override of [{ exp: 0 },{ exp: "not-a-date" },{ exp: "99999999999999999999999999" },
      { exp: null },{ role: "service_role" },{ role: "anon" },{ is_anonymous: true },{ is_anonymous: null },
      { session_id: null },{ session_id: "bad" },{ session_id: uuid(10) },{ sub: other },{ sub: null },{ sub: "bad" }]) {
      await claims(db, override);
      assert.deepEqual(await preview(db), []);
    }
    await claims(db);
    assert.equal((await preview(db)).length, 1);
    assert.deepEqual(await preview(db, uuid(10)), []);
    assert.deepEqual(await preview(db, device, uuid(10)), []);
    assert.deepEqual(await preview(db, null), []);
  } finally { await db.close(); }
});

test("album-only delivery retains exact notification/message/device and privacy boundaries", async (t) => {
  const db = await fixture(await sourceSql());
  try {
    await consent(db);
    await albumDelivery(db);
    for (const [n,m] of [[notification,message],[uuid(21),uuid(20)]]) {
      const [row] = await preview(db,device,n);
      assert.ok(row,"an own unread album notification has no ordinary native outbox");
      assert.equal(row.notification_id,n);
      assert.equal(row.message_id,m);
      assert.equal(row.body,"Фото");
    }
    const ordinaryOnly = new Set(["no device delivery association","outbox owner mismatch","outbox device mismatch","outbox notification mismatch"]);
    const albumDenials = [
      ...denials.filter(([name]) => !ordinaryOnly.has(name)),
      ["album group owner mismatch", `update public.album_push_groups set user_id='${other}'`],
      ["album group chat mismatch", `update public.album_push_groups set chat_id='${uuid(10)}'`],
      ["album group sender mismatch", `update public.album_push_groups set sender_id='${other}'`],
      ["album group actor kind mismatch", "update public.album_push_groups set sender_kind='bot'"],
      ["album member message mismatch", `update public.album_push_members set message_id='${uuid(20)}' where notification_id='${notification}'`],
      ["album member missing", `delete from public.album_push_members where notification_id='${notification}'`],
      ["album receipt absent", "delete from public.notifications_album_push_outbox"],
      ["album receipt belongs to another device", `update public.notifications_album_push_outbox set device_id='${uuid(10)}'`],
      ["album receipt suppressed", "update public.notifications_album_push_outbox set suppressed_at=now()"],
      ["web-only album receipt", `update public.notifications_album_push_outbox set device_id=null,subscription_id='${uuid(25)}'`],
    ];
    for (const [name,change] of albumDenials) {
      await t.test(name,async () => {
        await db.exec("begin");
        try { await db.exec(change); assert.deepEqual(await preview(db),[],name); }
        finally { await db.exec("rollback"); }
      });
    }
    assert.equal((await preview(db)).length,1);
    await db.exec(`insert into public.bots values('${uuid(26)}','Fixture album bot');
      update public.messages set user_id=null,bot_id='${uuid(26)}';
      update public.album_push_groups set sender_kind='bot',sender_id='${uuid(26)}';`);
    const [botAlbum] = await preview(db,device,uuid(21));
    assert.equal(botAlbum.sender_name,"Fixture album bot");
    assert.equal(botAlbum.body,"Фото");
  } finally { await db.close(); }
});

test("fresh edits are reflected; media and malformed source do not expose object URLs", async () => {
  const db = await fixture(await sourceSql());
  try {
    await consent(db);
    await db.query("update public.messages set content=$1", ["Changed fixture text"]);
    assert.equal((await preview(db))[0].body, "Changed fixture text");
    await db.query("update public.profiles set full_name=$1", ["  New\nfixture\tsender  "]);
    assert.equal((await preview(db))[0].sender_name, "New fixture sender");
    for (const type of ["image","video","audio","voice","file","unknown"]) {
      await db.query("update public.messages set type=$1,content=$2", [type, "https://fixture.invalid/object?secret=FICTIONAL"]);
      const [row] = await preview(db);
      assert.equal(row.body.includes("fixture.invalid"), false);
      assert.ok(row.body.length > 0 && row.body.length <= 240);
    }
    await db.query("update public.messages set type='text',content=$1", ["x".repeat(400)]);
    assert.equal((await preview(db))[0].body.length, 240);
    await db.query("update public.profiles set full_name=$1", ["y".repeat(200)]);
    assert.equal((await preview(db))[0].title.length, 96);
    await db.query("update public.messages set user_id=null,bot_id=$1", [uuid(10)]);
    assert.deepEqual(await preview(db), [], "missing sender source must deny rather than use cached title");
    await db.query("insert into public.bots values($1,$2)", [uuid(10), "Fixture bot"]);
    assert.equal((await preview(db))[0].sender_name, "Fixture bot");
  } finally { await db.close(); }
});

test("recipient RPC is read-only and consent is owner-only with fail-closed schema ACLs", async () => {
  const db = await fixture(await sourceSql());
  try {
    await consent(db);
    const before = (await db.query("select to_jsonb(n) as n from public.notifications n")).rows;
    await db.exec("begin read only");
    try { assert.equal((await preview(db)).length, 1); }
    finally { await db.exec("rollback"); }
    assert.deepEqual((await db.query("select to_jsonb(n) as n from public.notifications n")).rows, before);
    const acl = (await db.query(`select
      has_function_privilege('authenticated','${rpc}','execute') as authenticated,
      has_function_privilege('anon','${rpc}','execute') as anon,
      has_function_privilege('service_role','${rpc}','execute') as service,
      has_function_privilege('outsider','${rpc}','execute') as outsider,
      (select prosecdef and provolatile='s' and proconfig @> array['search_path=pg_catalog']
       from pg_proc where oid='${rpc}'::regprocedure) as pinned,
      (select relrowsecurity from pg_class where oid='public.notification_preview_preferences'::regclass) as rls
    `)).rows[0];
    assert.deepEqual(acl, {authenticated:true,anon:false,service:false,outsider:false,pinned:true,rls:true});
    await db.query("delete from public.notification_preview_preferences where user_id=$1", [recipient]);
    await db.query("insert into public.notification_preview_preferences(user_id) values($1)", [recipient]);
    assert.equal((await db.query("select preview_level from public.notification_preview_preferences where user_id=$1", [recipient])).rows[0].preview_level,"none");
    await db.exec("set role authenticated");
    try {
      assert.equal((await db.query("select * from public.notification_preview_preferences")).rows.length, 1);
      await assert.rejects(db.query("insert into public.notification_preview_preferences(user_id,preview_level) values($1,'message')", [other]), /row-level security/);
      await assert.rejects(db.query("update public.notification_preview_preferences set user_id=$1", [other]), /row-level security/);
      await assert.rejects(db.exec("update public.notification_preview_preferences set preview_level='anything'"), /check constraint/);
    } finally { await db.exec("reset role"); }
    await claims(db,{sub:other});
    await db.exec("set role authenticated");
    try {
      assert.deepEqual((await db.query("select * from public.notification_preview_preferences")).rows, []);
      assert.equal((await db.exec("update public.notification_preview_preferences set preview_level='message'"))[0].affectedRows, 0);
    } finally { await db.exec("reset role"); }
  } finally { await db.close(); }
});

const mutations = [
  ["notification read guard", "and n.read_at is null", "", async (db) => {
    await db.exec("update public.notifications set read_at=now()");
    assert.deepEqual(await preview(db), []);
  }],
  ["exact device", "d.id = p_device_id", "true", async (db) => {
    assert.deepEqual(await preview(db, uuid(10)), []);
  }],
  ["exact notification", "n.id = p_notification_id", "true", async (db) => {
    assert.deepEqual(await preview(db, device, uuid(10)), []);
  }],
  ["device/session binding", "d.session_id = s.id", "true", async (db) => {
    await db.query("update public.user_push_devices set session_id=$1", [uuid(10)]);
    assert.deepEqual(await preview(db), []);
  }],
  ["device owner", "and d.user_id = s.user_id", "", async (db) => {
    await db.query("update public.user_push_devices set user_id=$1", [other]);
    assert.deepEqual(await preview(db), []);
  }],
  ["revoked device", "and d.revoked_at is null", "", async (db) => {
    await db.exec("update public.user_push_devices set revoked_at=now()");
    assert.deepEqual(await preview(db), []);
  }],
  ["outbox owner", "and o.user_id = v_recipient", "", async (db) => {
    await db.query("update public.notifications_native_push_outbox set user_id=$1", [other]);
    assert.deepEqual(await preview(db), []);
  }],
  ["visibility", "and private.message_notification_visible_to(m.id,v_recipient)", "", async (db) => {
    await db.exec("update public.messages set deleted_at=now()");
    assert.deepEqual(await preview(db), []);
  }],
  ["push policy", "and public._notification_push_allowed(v_recipient,'message',jsonb_build_object(\n      'message_id',m.id,'chat_id',m.chat_id,'sender_id',m.user_id))", "", async (db) => {
    await db.exec("update public.fixture_push_policy set allowed=false");
    assert.deepEqual(await preview(db), []);
  }],
  ["old-session notification", "and n.created_at >= s.created_at", "", async (db) => {
    await db.exec("update public.notifications set created_at=now()-interval '3 hours'");
    assert.deepEqual(await preview(db), []);
  }],
  ["JWT expiry", "if (v_claims->>'exp')::bigint <= extract(epoch from v_now)", "if false", async (db) => {
    await claims(db, {exp:0});
    assert.deepEqual(await preview(db), []);
  }],
  ["anonymous JWT", "or v_claims->>'is_anonymous' is distinct from 'false'", "", async (db) => {
    await claims(db, {is_anonymous:true});
    assert.deepEqual(await preview(db), []);
  }],
  ["consent session revocation", "if not exists (select 1 from auth.sessions s where s.id=v_session and s.user_id=v_recipient\n    and s.created_at <= v_now and (s.not_after is null or s.not_after > v_now))", "if false", async (db) => {
    await db.exec("delete from auth.sessions; set role authenticated");
    try { assert.deepEqual((await db.query("select * from public.notification_preview_preferences")).rows, []); }
    finally { await db.exec("reset role"); }
  }],
  ["owner consent", "user_id = public.native_message_preview_recipient()", "true", async (db) => {
    await claims(db,{sub:other});
    await db.exec("set role authenticated");
    try { assert.deepEqual((await db.query("select * from public.notification_preview_preferences")).rows, []); }
    finally { await db.exec("reset role"); }
  }],
  ["sender-only redaction", "when pref.preview_level = 'sender'", "when false", async (db) => {
    await db.exec("update public.notification_preview_preferences set preview_level='sender'");
    assert.equal((await preview(db))[0].body, "Новое сообщение");
  }],
  ["fresh source instead of cached text", "when 'text' then m.content", "when 'text' then n.payload->>'body'", async (db) => {
    assert.equal((await preview(db))[0].body, "Current fixture text");
  }],
  ["media URL suppression", "case m.type", "case 'text'", async (db) => {
    await db.exec("update public.messages set type='image',content='https://fixture.invalid/private-object'");
    assert.equal((await preview(db))[0].body, "Фото");
  }],
  ["body limit", "'g')),240)", "'g')),241)", async (db) => {
    await db.query("update public.messages set content=$1", ["x".repeat(400)]);
    assert.equal((await preview(db))[0].body.length,240);
  }],
  ["sender limit", "' ','g')),96)", "' ','g')),97)", async (db) => {
    await db.query("update public.profiles set full_name=$1", ["x".repeat(200)]);
    assert.equal((await preview(db))[0].sender_name.length,96);
  }],
  ["lease length", "interval '15 seconds'", "interval '16 seconds'", async (db) => {
    assert.equal((await db.query("select expires_at-statement_timestamp() as ttl from public.native_message_notification_preview($1,$2)", [device,notification])).rows[0].ttl,"00:00:15");
  }],
  ["default consent", "default 'none'", "default 'message'", async (db) => {
    await db.exec("delete from public.notification_preview_preferences");
    await db.query("insert into public.notification_preview_preferences(user_id) values($1)", [recipient]);
    assert.deepEqual(await preview(db), []);
  }],
  ["album capability missing", "member.notification_id = n.id", "false", async (db) => {
    await albumDelivery(db);
    assert.equal((await preview(db))[0]?.body,"Фото");
  }],
  ["album owner", "album.user_id = v_recipient", "true", async (db) => {
    await albumDelivery(db);
    await db.query("update public.album_push_groups set user_id=$1", [other]);
    assert.deepEqual(await preview(db),[]);
  }],
  ["album chat", "and album.chat_id = m.chat_id", "", async (db) => {
    await albumDelivery(db);
    await db.query("update public.album_push_groups set chat_id=$1", [uuid(10)]);
    assert.deepEqual(await preview(db),[]);
  }],
  ["album exact message", "and member.message_id = m.id", "", async (db) => {
    await albumDelivery(db);
    await db.query("update public.album_push_members set message_id=$1 where notification_id=$2", [uuid(20),notification]);
    assert.deepEqual(await preview(db),[]);
  }],
  ["album device", "delivery.device_id = d.id", "true", async (db) => {
    await albumDelivery(db);
    await db.query("update public.notifications_album_push_outbox set device_id=$1", [uuid(10)]);
    assert.deepEqual(await preview(db),[]);
  }],
  ["album sender", "and album.sender_id = m.user_id", "", async (db) => {
    await albumDelivery(db);
    await db.query("update public.album_push_groups set sender_id=$1", [other]);
    assert.deepEqual(await preview(db),[]);
  }],
  ["album actor kind", "album.sender_kind = 'user'", "true", async (db) => {
    await albumDelivery(db);
    await db.exec("update public.album_push_groups set sender_kind='bot'");
    assert.deepEqual(await preview(db),[]);
  }],
  ["suppressed album", "and delivery.suppressed_at is null", "", async (db) => {
    await albumDelivery(db);
    await db.exec("update public.notifications_album_push_outbox set suppressed_at=now()");
    assert.deepEqual(await preview(db),[]);
  }],
];

test("compiled SQL mutants must fail literal authorization and privacy assertions", async (t) => {
  const original = await readFile(proposal,"utf8");
  for (const [name, before, after, assertion] of mutations) {
    await t.test(name, async () => {
      assert.ok(original.includes(before), "mutation anchor is missing");
      const mutated = original.replaceAll(before,after);
      assert.notEqual(mutated,original);
      const db = await fixture(mutated);
      try {
        await consent(db);
        await assert.rejects(assertion(db), error => error instanceof assert.AssertionError,
          "mutant survived or failed for a non-assertion reason");
      } finally { await db.close(); }
    });
  }
});

test("raising SQL self-check refuses weakened RLS, function mode and ACL before commit", async (t) => {
  const original = await readFile(proposal,"utf8");
  for (const [before,after] of [
    ["enable row level security", "disable row level security"],
    ["stable security definer", "stable security invoker"],
    ["language plpgsql stable security definer", "language plpgsql volatile security definer"],
    ["set search_path = pg_catalog", "set search_path = public"],
    ["grant execute on function public.native_message_notification_preview(uuid,uuid) to authenticated;",
      "grant execute on function public.native_message_notification_preview(uuid,uuid) to authenticated, anon;"],
    ["grant execute on function public.native_message_preview_recipient() to authenticated;",
      "grant execute on function public.native_message_preview_recipient() to authenticated, outsider;"],
    ["grant execute on function public.native_message_preview_capability(uuid) to authenticated;",
      "grant execute on function public.native_message_preview_capability(uuid) to authenticated, outsider;"],
    ["grant select, insert, update, delete on public.notification_preview_preferences to authenticated;",
      "grant select, insert, update, delete on public.notification_preview_preferences to authenticated, outsider;"],
  ]) {
    await t.test(before, async () => {
      const db = await fixture();
      try {
        assert.ok(original.includes(before));
        await assert.rejects(db.exec(original.replaceAll(before,after)), /native_message_preview_self_check_failed/);
        await db.exec("rollback");
        const state = (await db.query("select to_regprocedure($1) is null as no_rpc,to_regclass('public.notification_preview_preferences') is null as no_consent", [rpc])).rows[0];
        assert.deepEqual(state,{no_rpc:true,no_consent:true});
      } finally { await db.close(); }
    });
  }
});

test("documented rollback removes only the new contract and leaves generic delivery data intact", async () => {
  const sql = await readFile(proposal,"utf8");
  const db = await fixture(sql);
  try {
    await consent(db);
    const match = sql.match(/-- BEGIN;\n([\s\S]*?)-- COMMIT;/);
    assert.ok(match, "rollback header is missing");
    const rollback = `begin;\n${match[1].replace(/^-- /gm,"")}commit;`;
    await db.exec(rollback);
    const state = (await db.query("select to_regprocedure($1) is null as no_rpc,to_regclass('public.notification_preview_preferences') is null as no_consent,to_regprocedure('public.native_message_preview_recipient()') is null as no_helper,to_regprocedure('public.native_message_preview_capability(uuid)') is null as no_capability", [rpc])).rows[0];
    assert.deepEqual(state,{no_rpc:true,no_consent:true,no_helper:true,no_capability:true});
    assert.equal((await db.query("select count(*)::int as n from public.notifications")).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int as n from public.notifications_native_push_outbox")).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int as n from public.user_push_devices")).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int as n from auth.sessions")).rows[0].n,1);
  } finally { await db.close(); }
});

test("revoked or expired sessions cannot read or change preview consent", async () => {
  const db = await fixture(await sourceSql());
  try {
    await consent(db, "none");
    for (const change of ["delete from auth.sessions", "update auth.sessions set not_after=now()-interval '1 second'"]) {
      await db.exec("begin");
      try {
        await db.exec(change);
        await db.exec("set role authenticated");
        try {
          assert.deepEqual((await db.query("select * from public.notification_preview_preferences")).rows, []);
          assert.equal((await db.exec("update public.notification_preview_preferences set preview_level='message'"))[0].affectedRows, 0);
          assert.equal((await db.exec("delete from public.notification_preview_preferences"))[0].affectedRows, 0);
        } finally { await db.exec("reset role"); }
      } finally { await db.exec("rollback"); }
    }
    await db.exec("set role authenticated");
    try {
      assert.equal((await db.exec("update public.notification_preview_preferences set preview_level='message'"))[0].affectedRows, 1);
    } finally { await db.exec("reset role"); }
    assert.equal((await preview(db)).length, 1);
    await db.exec("delete from public.notification_preview_preferences; delete from auth.sessions");
    await db.exec("set role authenticated");
    try {
      await assert.rejects(db.query("insert into public.notification_preview_preferences(user_id,preview_level) values($1,'message')", [recipient]), /row-level security/);
    } finally { await db.exec("reset role"); }
  } finally { await db.close(); }
});
