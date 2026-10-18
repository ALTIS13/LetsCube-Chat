import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import ts from "typescript";
import { deliveryFixture, sendFixtureMessage } from "./topic-notification-delivery.fixture.mjs";
import { id, user, other, sender, session, chat, topic, authenticated, setPreference } from "./topic-notification-overrides.fixture.mjs";

const descriptorJs = ts.transpileModule(await readFile(new URL(
  "../../supabase/functions/send-push-notifications/web-push-descriptor.ts", import.meta.url), "utf8"),
{ compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { webPushDescriptorFingerprint } = await import("data:text/javascript;base64," + Buffer.from(descriptorJs).toString("base64"));

// Owned in-memory PostgreSQL only. Real captured visibility/push/topic SQL;
// synthetic Auth/roles/schema boundaries, not HTTP/JWT or iPhone acceptance.
const proposal = new URL("../../docs/proposals/2026-10-17-web-message-preview.sql", import.meta.url);
const rollback = new URL("../../docs/proposals/2026-10-17-web-message-preview.rollback.sql", import.meta.url);
const upgrade = new URL("../../supabase/migrations/20261018013000_web_preview_install_admission.sql", import.meta.url);
async function preSidecarSource() {
  const source = await readFile(new URL("../../supabase/migrations/20261017104253_coordinated_notification_release.sql", import.meta.url), "utf8");
  const feature = source.lastIndexOf("'letscube:web-message-preview',0)");
  const start = source.lastIndexOf("DO $prestate$", feature);
  assert.ok(feature > start && start > 0, "frozen pre-sidecar Web migration block");
  return "BEGIN;\nSET LOCAL search_path=pg_catalog;\n" + source.slice(start);
}
const sub = id(50), mid = id(141);
const contextKeys = ["preview_v", "recipient_id", "session_id", "subscription_id", "subscription_fingerprint",
  "revision", "preview_level", "installation_consent", "observed_at_epoch_ms", "expires_at_epoch_ms"].sort();
const contentKeys = ["preview_v", "recipient_id", "session_id", "subscription_id", "subscription_fingerprint",
  "revision", "notification_id", "chat_id", "message_id", "preview_level", "sender_name", "title", "body",
  "observed_at_epoch_ms", "expires_at_epoch_ms"].sort();

async function sqlSource() {
  try { return await readFile(proposal, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; return undefined; }
}
async function claims(db, who = user, sid = session, changes = {}) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({
    sub: who, session_id: sid, role: "authenticated", is_anonymous: false,
    exp: Math.floor(Date.now() / 1000) + 3600, ...changes,
  })]);
}
async function asRole(db, role, sql, params = []) {
  await db.exec(`set role ${role}`);
  try { return (await db.query(sql, params)).rows; }
  catch (error) {
    // Never expose generated grant secrets via a driver's query/params dump.
    const fixed = /^(web_preview_[a-z_]+)$/.exec(error.message)?.[1];
    throw Object.assign(new Error(fixed ?? "WEB_PREVIEW_RPC_REFUSED"), { code: error.code });
  } finally { await db.exec("reset role"); }
}
const ctx = (db, subscription = sub) => asRole(db, "authenticated",
  "select * from public.web_message_preview_context($1)", [subscription]);
async function enroll(db, revision = 0, level = "message", subscription = sub, fingerprint, ttl = 2592000,
  secret = "wpg1_" + randomBytes(32).toString("hex"), hash = createHash("sha256").update(secret, "utf8").digest("hex")) {
  const rows = await asRole(db, "authenticated", "select * from public.web_message_preview_enroll($1,$2,$3,$4,$5,$6)",
    [subscription, revision, fingerprint, level, hash, ttl]);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), contextKeys, "enroll returns no secret/hash");
  // The handle separates locally generated secret from the actual SQL wire DTO.
  return { rows, secret };
}
const revoke = (db, revision, subscription = sub) => asRole(db, "authenticated",
  "select * from public.web_message_preview_revoke($1,$2)", [subscription, revision]);
const content = (db, secret, notification) => asRole(db, "anon",
  "select * from public.web_message_preview_content($1,$2)", [secret, notification]);
async function present(db) {
  assert.equal((await db.query("select to_regprocedure('public.web_message_preview_enroll(uuid,bigint,text,text,text,integer)') is not null as present")).rows[0].present,
    true, "EXPLICIT_BROWSER_GRANT_RPC_REQUIRED");
}
async function fixture(t, { sql, baseline = false, preSidecar = false } = {}) {
  const db = await deliveryFixture({ candidate: true }); t.after(() => db.close());
  await db.exec(`create table auth.users(id uuid primary key);
    insert into auth.users select id from public.profiles;
    grant all on auth.users to postgres;
    alter table public.notification_preview_preferences enable row level security;
    alter table public.notification_preview_preferences owner to postgres;
    revoke all on public.notification_preview_preferences from public,anon,authenticated,service_role;
    grant select,insert,update,delete on public.notification_preview_preferences to authenticated;`);
  const native = await readFile(new URL("../../supabase/migrations/20261007210924_native_message_preview.sql", import.meta.url), "utf8");
  const start = native.indexOf("create policy notification_preview_select_own");
  const end = native.indexOf("-- Server availability", start);
  assert.ok(start > 0 && end > start, "real preference RLS extraction");
  await db.exec(native.slice(start, end));
  await sendFixtureMessage(db, 141);
  await db.exec(`update public.messages set content='WEB CANARY FIXED' where id='${mid}';
    update public.profiles set full_name='Fixture sender' where id='${sender}';`);
  const note = (await db.query("select id from public.notifications where user_id=$1 and payload->>'message_id'=$2", [user, mid])).rows[0].id;
  if (!baseline) {
    const source = preSidecar ? await preSidecarSource() : sql ?? await sqlSource();
    if (source) await db.exec(source);
    await present(db);
    await db.exec("update private.web_message_preview_runtime set enabled=true where singleton");
  }
  await claims(db);
  return { db, note };
}
async function granted(t, options) {
  const f = await fixture(t, options);
  const c = (await ctx(f.db))[0];
  const { rows, secret } = await enroll(f.db, c.revision, "message", sub, c.subscription_fingerprint);
  assert.ok(rows.length === 1 && /^wpg1_[0-9a-f]{64}$/.test(secret), "local fresh secret with one enroll ACK");
  return { ...f, grant: rows[0], secret };
}
async function expectDenied(f, secret = f.secret, note = f.note) {
  assert.equal((await content(f.db, secret, note)).length, 0, "CONTENT_MUST_BE_DENIED");
}

test("explicit browser grant exists independently of the Android account choice", async t => {
  const { db, note } = await fixture(t);
  const [c] = await ctx(db);
  assert.deepEqual(Object.keys(c).sort(), contextKeys);
  assert.equal(c.revision, 0);
  assert.equal(c.installation_consent, false);
  assert.equal(c.preview_level, "none");
  assert.equal(c.expires_at_epoch_ms, null);
  assert.equal((await content(db, "wpg1_" + "0".repeat(64), note)).length, 0);
});

test("real current content ignores forged notification/provider text and returns the exact DTO", async t => {
  const f = await granted(t);
  await f.db.query("update public.notifications set payload=payload||$1::jsonb where id=$2",
    [JSON.stringify({ body: "FORGED", title: "FORGED", sender_name: "FORGED" }), f.note]);
  const [row] = await content(f.db, f.secret, f.note);
  assert.deepEqual(Object.keys(row).sort(), contentKeys);
  assert.deepEqual([row.recipient_id, row.session_id, row.subscription_id, row.notification_id, row.chat_id, row.message_id],
    [user, session, sub, f.note, chat, mid]);
  assert.equal(row.title, "Fixture sender"); assert.equal(row.body, "WEB CANARY FIXED");
  assert.equal(row.preview_level, "message"); assert.equal(row.revision, 1);
  assert.ok(row.expires_at_epoch_ms > row.observed_at_epoch_ms && row.expires_at_epoch_ms - row.observed_at_epoch_ms <= 15000);
  assert.ok(f.grant.expires_at_epoch_ms - f.grant.observed_at_epoch_ms <= 2592000000);
  const meta = (await asRole(f.db, "postgres", "select octet_length(grant_hash)::int as bytes,grant_hash=sha256(convert_to($1,'UTF8')) as matches from private.web_message_preview_grants", [f.secret]))[0];
  assert.deepEqual(meta, { bytes: 32, matches: true });
  assert.equal("grant_secret" in (await ctx(f.db))[0], false);
  await expectDenied(f, "wpg1_" + createHash("sha256").update(f.secret, "utf8").digest("hex"));
});

test("sender consent produces no message content and session not_after caps a long grant", async t => {
  const { db, note } = await fixture(t);
  await db.exec(`update public.notification_preview_preferences set preview_level='sender';
    update auth.sessions set not_after=clock_timestamp()+interval '2 days' where id='${session}';`);
  const [c] = await ctx(db);
  const { rows: [g], secret } = await enroll(db, c.revision, "sender", sub, c.subscription_fingerprint);
  const [row] = await content(db, secret, note);
  assert.equal(row.body, "Новое сообщение"); assert.equal(row.preview_level, "sender");
  assert.ok(g.expires_at_epoch_ms - g.observed_at_epoch_ms <= 172800000);
});

test("DB descriptor uses the actual provider's exact UTF8 length-framed fingerprint", async t => {
  const { db } = await fixture(t);
  const descriptor = { id: sub, user_id: user, endpoint: "https://fictional.invalid/путь:2", p256dh: "key:é", auth: "fictional:auth" };
  await db.query("update public.push_subscriptions set endpoint=$1,p256dh=$2,auth=$3 where id=$4",
    [descriptor.endpoint, descriptor.p256dh, descriptor.auth, sub]);
  const expected = await webPushDescriptorFingerprint(descriptor);
  const [c] = await ctx(db);
  assert.equal(c.subscription_fingerprint, expected);
  assert.equal((await enroll(db, c.revision, "message", sub, expected)).rows.length, 1);
});

test("CAS rotation is once-only and stale enroll/revoke cannot replace a newer grant", async t => {
  const f = await granted(t); const g = f.grant;
  await assert.rejects(enroll(f.db, 0, "message", sub, g.subscription_fingerprint), /web_preview_revision_conflict/);
  const { rows: [next], secret } = await enroll(f.db, 1, "message", sub, g.subscription_fingerprint);
  assert.equal(next.revision, 2);
  assert.ok(secret !== f.secret, "client rotation uses a different secret");
  await expectDenied(f);
  await assert.rejects(revoke(f.db, 1), /web_preview_revision_conflict/);
  assert.equal((await content(f.db, secret, f.note)).length, 1);
  const [retired] = await revoke(f.db, 2);
  assert.deepEqual(Object.keys(retired).sort(), contextKeys);
  assert.equal(retired.revision, 3); assert.equal(retired.installation_consent, false);
  await expectDenied(f, secret);
  await assert.rejects(enroll(f.db, 3, "message", sub, g.subscription_fingerprint, 2592000, secret), /web_preview_rotation_refused/);
});

test("a revoke before initial enroll leaves a tombstone against held revision zero", async t => {
  const { db } = await fixture(t); const [before] = await ctx(db);
  assert.equal((await revoke(db, 0))[0].revision, 1);
  await assert.rejects(enroll(db, 0, "message", sub, before.subscription_fingerprint), /web_preview_revision_conflict/);
});

test("account choice ABA and descriptor ABA cannot revive a queued grant", async t => {
  for (const kind of ["choice", "descriptor"]) await t.test(kind, async t => {
    const f = await granted(t);
    if (kind === "choice") await f.db.exec("update public.notification_preview_preferences set preview_level='none'; update public.notification_preview_preferences set preview_level='message';");
    else await f.db.exec(`update public.push_subscriptions set endpoint='https://fictional.invalid/replaced' where id='${sub}'; update public.push_subscriptions set endpoint='https://fictional.invalid/push' where id='${sub}';`);
    await expectDenied(f);
    const [c] = await ctx(f.db);
    assert.equal(c.installation_consent, false); assert.ok(c.revision > f.grant.revision);
    await assert.rejects(enroll(f.db, f.grant.revision, "message", sub, c.subscription_fingerprint), /web_preview_revision_conflict/);
  });
});

test("lookup denies malformed tokens and foreign selectors without disclosing content", async t => {
  const f = await granted(t);
  for (const secret of [null, "", "x".repeat(4096), "wpg1_" + "g".repeat(64), "wpg1_" + "0".repeat(64)]) await expectDenied(f, secret);
  for (const selector of [null, id(999)]) await expectDenied(f, f.secret, selector);
  await f.db.query("update public.notifications set payload=jsonb_set(payload,'{message_id}',to_jsonb($1::text)) where id=$2", ["not-a-uuid", f.note]);
  await expectDenied(f);
  await f.db.query("update public.notifications set payload=jsonb_set(payload,'{message_id}',to_jsonb($1::text)) where id=$2", [mid, f.note]);
  await f.db.query("update public.notifications set user_id=$1 where id=$2", [other, f.note]);
  await expectDenied(f);
});

test("another installation of the same account cannot use an unassociated notification selector", async t => {
  const f = await granted(t); const otherSub = id(55);
  await f.db.exec(`insert into public.push_subscriptions(id,user_id,is_active,endpoint,p256dh,auth)
    select '${otherSub}',user_id,is_active,endpoint||'/other-install',p256dh,auth
      from public.push_subscriptions where id='${sub}'`);
  const [c] = await ctx(f.db, otherSub);
  const { secret } = await enroll(f.db, 0, "message", otherSub, c.subscription_fingerprint);
  await expectDenied(f, secret);
  assert.equal((await content(f.db, f.secret, f.note)).length, 1);
});

test("current session owner expiry subscription owner active keys and grant deadline are rechecked", async t => {
  const cases = [
    ["session deleted", `delete from auth.sessions where id='${session}'`],
    ["session expiry", `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${session}'`],
    ["session owner", `update auth.sessions set user_id='${other}' where id='${session}'`],
    ["future session", `update auth.sessions set created_at=clock_timestamp()+interval '1 day' where id='${session}'`],
    ["inactive subscription", `update public.push_subscriptions set is_active=false where id='${sub}'`],
    ["descriptor", `update public.push_subscriptions set auth='changed' where id='${sub}'`],
    ["foreign subscription", `update public.push_subscriptions set user_id='${other}' where id='${sub}'`],
    ["expired grant", "update private.web_message_preview_grants set expires_at=clock_timestamp()-interval '1 second'"],
  ];
  for (const [name, change] of cases) await t.test(name, async t => { const f = await granted(t); await f.db.exec(change); await expectDenied(f); });
});

test("current read hidden block membership DND category topic and suppression gates remain real", async t => {
  const cases = [
    ["read", f => f.db.query("update public.notifications set read_at=clock_timestamp() where id=$1", [f.note])],
    ["deleted", f => f.db.exec(`update public.messages set deleted_at=now() where id='${mid}'`)],
    ["hidden", f => f.db.exec(`insert into public.message_hidden_for_users values('${mid}','${user}')`)],
    ["block", f => f.db.exec(`insert into public.user_blocks values('${user}','${sender}')`)],
    ["membership", f => f.db.exec(`delete from public.chat_members where user_id='${user}' and chat_id='${chat}'`)],
    ["DND", f => f.db.exec(`insert into public.privacy_preferences values('${user}','dnd',null)`)],
    ["category", f => f.db.exec(`update public.notification_preferences set message_push_enabled=false where user_id='${user}'`)],
    ["topic", f => authenticated(f.db, setPreference("disabled", 0, topic, chat))],
    ["suppressed", f => f.db.query("update public.notifications set alert_suppressed_at=clock_timestamp() where id=$1", [f.note])],
    ["no delivery", f => f.db.query("delete from public.notifications_push_outbox where notification_id=$1", [f.note])],
  ];
  for (const [name, change] of cases) await t.test(name, async t => {
    const f = await granted(t); assert.equal((await content(f.db, f.secret, f.note)).length, 1);
    await change(f); await expectDenied(f);
  });
});

test("authenticated enrollment refuses foreign session subscription choice fingerprint and TTL", async t => {
  const { db } = await fixture(t); const [c] = await ctx(db);
  for (const [r, level, subscription, fingerprint, ttl] of [
    [0, "none", sub, c.subscription_fingerprint, 30], [0, "sender", sub, c.subscription_fingerprint, 30],
    [0, "message", id(51), c.subscription_fingerprint, 30], [0, "message", sub, "v1:" + "0".repeat(64), 30],
    [0, "message", sub, c.subscription_fingerprint, 0], [0, "message", sub, c.subscription_fingerprint, 2592001],
    [-1, "message", sub, c.subscription_fingerprint, 30], [9007199254740992, "message", sub, c.subscription_fingerprint, 30],
  ]) await assert.rejects(enroll(db, r, level, subscription, fingerprint, ttl), /web_preview_/);
  for (const change of [{ is_anonymous: true }, { exp: 1 }, { session_id: id(999) }, { role: "service_role" }]) {
    await claims(db, user, session, change);
    assert.equal((await ctx(db)).length, 0);
    await assert.rejects(enroll(db, 0, "message", sub, c.subscription_fingerprint), /web_preview_/);
  }
  await claims(db);
  for (const hash of [null, "", "ABCDEF".repeat(11), "0".repeat(63), "g".repeat(64), "0".repeat(65)]) {
    await assert.rejects(enroll(db, 0, "message", sub, c.subscription_fingerprint, 30, "unused-local-secret", hash), /web_preview_input_refused/);
  }
});

test("exact function/table ACLs deny service clients and anonymous enrollment", async t => {
  const f = await granted(t);
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const table of ["private.web_message_preview_grants", "private.web_message_preview_runtime", "private.web_message_preview_install_admissions"]) {
      await assert.rejects(asRole(f.db, role, `select * from ${table}`), error => error.code === "42501");
    }
  }
  await assert.rejects(asRole(f.db, "anon", "select * from public.web_message_preview_context($1)", [sub]), error => error.code === "42501");
  for (const role of ["authenticated", "service_role"]) await assert.rejects(asRole(f.db, role,
    "select * from public.web_message_preview_content($1,$2)", [f.secret, f.note]), error => error.code === "42501");
  const columns = (await f.db.query("select column_name from information_schema.columns where table_schema='private' and table_name='web_message_preview_grants'")).rows.map(x => x.column_name);
  assert.equal(columns.includes("grant_secret"), false);
  assert.equal((await f.db.query("select bool_and(relrowsecurity) as protected from pg_class where oid in ('private.web_message_preview_grants'::regclass,'private.web_message_preview_runtime'::regclass)")).rows[0].protected, true);
  assert.equal((await f.db.query("select count(*)::int as n from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[0] where i.indrelid='private.web_message_preview_grants'::regclass and i.indisvalid and i.indisready and i.indnatts=1 and a.attname='recipient_id' and i.indpred is null")).rows[0].n, 1);
});

test("rollback disables all content and enrollment while retaining retired revision data", async t => {
  const f = await granted(t); await f.db.exec(await readFile(rollback, "utf8"));
  await expectDenied(f);
  const [c] = await ctx(f.db); assert.equal(c.installation_consent, false); assert.ok(c.revision > f.grant.revision);
  await assert.rejects(enroll(f.db, c.revision, "message", sub, c.subscription_fingerprint), /web_preview_disabled/);
  assert.equal((await f.db.query("select count(*)::int as n from private.web_message_preview_grants")).rows[0].n, 1);
});

test("Web-only revocation leaves the existing native SQL preview and account choice unchanged", async t => {
  const f = await granted(t);
  const native = () => asRole(f.db, "authenticated", "select * from public.native_message_notification_preview($1,$2)", [id(52), f.note]);
  assert.equal((await native())[0].body, "WEB CANARY FIXED");
  await revoke(f.db, f.grant.revision); await expectDenied(f);
  assert.equal((await native())[0].body, "WEB CANARY FIXED");
  assert.equal((await f.db.query("select preview_level from public.notification_preview_preferences where user_id=$1", [user])).rows[0].preview_level, "message");
});

test("long background grant is independent of the enrolling JWT expiry but not of the live session", async t => {
  const f = await granted(t); await claims(f.db, user, session, { exp: 1 });
  assert.equal((await ctx(f.db)).length, 0);
  assert.equal((await content(f.db, f.secret, f.note)).length, 1);
  await f.db.exec(`delete from auth.sessions where id='${session}'`);
  await expectDenied(f);
});

test("enrolling JWT expiry is checked after a real SQL wait, not only at statement start", async t => {
  const { db } = await fixture(t); const [c] = await ctx(db);
  await db.exec(`create function private.fixture_web_preview_wait() returns trigger language plpgsql as $$
    begin perform pg_sleep(2.1); return new; end $$;
    create trigger fixture_web_preview_wait before insert on private.web_message_preview_grants
      for each row execute function private.fixture_web_preview_wait();`);
  await claims(db, user, session, { exp: Math.floor(Date.now() / 1000) + 2 });
  await assert.rejects(enroll(db, 0, "message", sub, c.subscription_fingerprint), /web_preview_session_refused/);
  assert.equal((await db.query("select count(*)::int as n from private.web_message_preview_grants")).rows[0].n, 0);
});

test("same UID new session must explicitly rotate and cannot adopt the previous session's opt-in", async t => {
  const f = await granted(t); const nextSession = id(32);
  await f.db.exec(`insert into auth.sessions values('${nextSession}','${user}',null,now()-interval '1 day')`);
  await claims(f.db, user, nextSession);
  const [c] = await ctx(f.db);
  assert.equal(c.revision, 1); assert.equal(c.installation_consent, false); assert.equal(c.session_id, nextSession);
  const { rows: [next], secret } = await enroll(f.db, 1, "message", sub, c.subscription_fingerprint);
  assert.equal(next.session_id, nextSession); assert.equal(next.revision, 2);
  await expectDenied(f);
  assert.equal((await content(f.db, secret, f.note)).length, 1);
});

test("album delivery uses real group/member/subscription associations and safe media labels", async t => {
  const f = await granted(t);
  await sendFixtureMessage(f.db, 142, { albumIndex: 0 });
  await sendFixtureMessage(f.db, 143, { albumIndex: 1 });
  const note = (await f.db.query("select id from public.notifications where user_id=$1 and payload->>'message_id'=$2", [user, id(143)])).rows[0].id;
  assert.equal((await f.db.query("select count(*)::int as n from public.notifications_push_outbox where notification_id=$1", [note])).rows[0].n, 0);
  assert.equal((await content(f.db, f.secret, note))[0].body, "Фото");
  await f.db.query("update public.album_push_members set message_id=$1 where notification_id=$2", [mid, note]);
  await expectDenied(f, f.secret, note);
  await f.db.query("update public.album_push_members set message_id=$1 where notification_id=$2", [id(143), note]);
  assert.equal((await content(f.db, f.secret, note)).length, 1);
  await f.db.exec(`update public.notifications_album_push_outbox set suppressed_at=clock_timestamp() where subscription_id='${sub}'`);
  await expectDenied(f, f.secret, note);
});

test("formatting uses current bounded names/text without provider URLs", async t => {
  const f = await granted(t);
  await f.db.query("update public.profiles set full_name=$1 where id=$2", [" X\t\n".repeat(100), sender]);
  await f.db.query("update public.messages set content=$1 where id=$2", [" Y\t\n".repeat(300), mid]);
  const [row] = await content(f.db, f.secret, f.note);
  assert.equal(row.title.length, 96); assert.equal(row.body.length, 240);
  assert.doesNotMatch(row.title + row.body, /[\t\n\r]/);
});

test("privacy revocation remains possible at revision exhaustion, while renewal is refused", async t => {
  const f = await granted(t);
  await f.db.exec("update private.web_message_preview_grants set revision=9007199254740991");
  const [c] = await revoke(f.db, 9007199254740991);
  assert.equal(c.revision, 9007199254740991); assert.equal(c.installation_consent, false);
  await expectDenied(f);
  await assert.rejects(enroll(f.db, c.revision, "message", sub, c.subscription_fingerprint), /web_preview_input_refused/);
});

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, "literal mutation anchor must be unique");
  return source.replace(before, after);
}

test("compiled omission controls break real denial assertions, not self-read constants", async t => {
  const source = await sqlSource();
  const controls = [
    ["read check", s => replaceOnce(s, "AND x.kind='message' AND x.read_at IS NULL AND x.alert_suppressed_at IS NULL",
      "AND x.kind='message' AND x.alert_suppressed_at IS NULL"),
    f => f.db.query("update public.notifications set read_at=clock_timestamp() where id=$1", [f.note])],
    ["session owner", s => replaceOnce(s, "WHERE x.id=g.session_id AND x.user_id=g.recipient_id",
      "WHERE x.id=g.session_id"), f => f.db.exec(`update auth.sessions set user_id='${other}' where id='${session}'`)],
    ["account ABA retirement", s => replaceOnce(s,
      "IF TG_OP='DELETE' OR NEW.preview_level IS DISTINCT FROM OLD.preview_level THEN", "IF false THEN"),
    f => f.db.exec("update public.notification_preview_preferences set preview_level='none'; update public.notification_preview_preferences set preview_level='message';")],
    ["exact descriptor", s => replaceOnce(s,
      "IF private.web_message_preview_descriptor(s.id,s.user_id,s.endpoint,s.p256dh,s.auth)\n    IS DISTINCT FROM seed.subscription_fingerprint THEN RETURN; END IF; -- DESCRIPTOR_GUARD",
      "PERFORM 1; -- DESCRIPTOR_GUARD"),
    f => f.db.exec(`alter table public.push_subscriptions disable trigger web_message_preview_subscription_retire;
      update public.push_subscriptions set auth='changed' where id='${sub}'`)],
    ["actual delivery association", s => {
      const start = s.indexOf("    AND (EXISTS(SELECT 1 FROM public.notifications_push_outbox o");
      const end = s.indexOf("EXCEPTION WHEN lock_not_available", start);
      assert.ok(start > 0 && end > start);
      return s.slice(0, start) + ";\n" + s.slice(end);
    }, f => f.db.query("delete from public.notifications_push_outbox where notification_id=$1", [f.note])],
  ];
  for (const [name, mutate, change] of controls) await t.test(name, async t => {
    const f = await granted(t, { sql: mutate(source) });
    await change(f);
    await assert.rejects(expectDenied(f), error => error.code === "ERR_ASSERTION",
      "omitted production guard must fail the ordinary literal zero-row assertion");
  });
});

test("raising selfcheck refuses a literal RLS omission and the transaction leaves no feature tables", async t => {
  const { db } = await fixture(t, { baseline: true });
  const mutant = replaceOnce(await sqlSource(), "ALTER TABLE private.web_message_preview_grants ENABLE ROW LEVEL SECURITY;", "");
  await assert.rejects(db.exec(mutant), /web_preview_selfcheck_failed/);
  await db.exec("rollback");
  assert.equal((await db.query("select to_regclass('private.web_message_preview_grants') is null as absent")).rows[0].absent, true);
});

test("prestate refuses changed trusted helper bodies before creating any feature object", async t => {
  const { db } = await fixture(t, { baseline: true });
  await db.exec("create or replace function private.notification_topic_alert_allowed(p_notification uuid) returns boolean language sql stable security definer set search_path='' as $$select true$$");
  await assert.rejects(db.exec(await sqlSource()), /web_preview_dependency_drift/);
  await db.exec("rollback");
  assert.equal((await db.query("select to_regclass('private.web_message_preview_grants') is null as absent")).rows[0].absent, true);
});

const siblingInstall = id(53);

async function runtimeOff(t, { migrated = false, sql } = {}) {
  const f = await fixture(t, { preSidecar: migrated, sql });
  await f.db.exec("update private.web_message_preview_runtime set enabled=false where singleton");
  if (migrated) {
    assert.equal((await f.db.query("select to_regclass('private.web_message_preview_install_admissions') is null as absent")).rows[0].absent, true);
    await f.db.exec(await readFile(upgrade, "utf8"));
  }
  await f.db.exec(`insert into public.push_subscriptions(id,user_id,is_active) values('${siblingInstall}','${user}',true)`);
  return f;
}
async function admit(db, subscription = sub, when = "future", revoked = false) {
  const expires = when === "stale" ? "clock_timestamp() - interval '1 minute'" : "clock_timestamp() + interval '1 day'";
  await asRole(db, "service_role", `select public.web_message_preview_install_set($1, ${expires}, false)`, [subscription]);
  if (revoked) await asRole(db, "service_role", "select public.web_message_preview_install_set($1, null, true)", [subscription]);
}
async function retainedRelationLock(db, relation) {
  return (await db.query(`select exists(select 1 from pg_locks
    where pid=pg_backend_pid() and granted and relation=$1::regclass and mode='RowShareLock') as held`, [relation])).rows[0].held;
}

test("a per-install admission enrolls only that install while the global runtime stays off", async t => {
  const f = await runtimeOff(t);
  const [closed] = await ctx(f.db);
  await assert.rejects(enroll(f.db, closed.revision, "message", sub, closed.subscription_fingerprint), /web_preview_disabled/);
  await assert.rejects(asRole(f.db, "authenticated", "select public.web_message_preview_install_set($1, clock_timestamp() + interval '1 day', false)", [sub]), error => error.code === "42501");
  await assert.rejects(asRole(f.db, "service_role", "select * from private.web_message_preview_install_admissions"), error => error.code === "42501");
  await admit(f.db);
  const { rows, secret } = await enroll(f.db, closed.revision, "message", sub, closed.subscription_fingerprint);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].installation_consent, true);
  assert.equal(rows[0].preview_level, "message");
  assert.equal((await f.db.query("select enabled from private.web_message_preview_runtime where singleton")).rows[0].enabled, false);
  assert.equal((await content(f.db, secret, f.note))[0].body, "WEB CANARY FIXED");
  const [sibling] = await ctx(f.db, siblingInstall);
  await assert.rejects(enroll(f.db, sibling.revision, "message", siblingInstall, sibling.subscription_fingerprint), /web_preview_disabled/);
  assert.equal((await f.db.query("select enabled from private.web_message_preview_runtime where singleton")).rows[0].enabled, false);
});

test("a revoked or stale per-install admission falls back to the generic preview", async t => {
  const revoked = await runtimeOff(t);
  await admit(revoked.db, sub, "future", true);
  const [revokedCtx] = await ctx(revoked.db);
  await assert.rejects(enroll(revoked.db, revokedCtx.revision, "message", sub, revokedCtx.subscription_fingerprint), /web_preview_disabled/);

  const stale = await runtimeOff(t);
  await admit(stale.db, sub, "stale", false);
  const [staleCtx] = await ctx(stale.db);
  await assert.rejects(enroll(stale.db, staleCtx.revision, "message", sub, staleCtx.subscription_fingerprint), /web_preview_disabled/);

  const live = await runtimeOff(t);
  await admit(live.db);
  const [open] = await ctx(live.db);
  const { secret } = await enroll(live.db, open.revision, "message", sub, open.subscription_fingerprint);
  assert.equal((await content(live.db, secret, live.note)).length, 1);
  await asRole(live.db, "service_role", "select public.web_message_preview_install_set($1, null, true)", [sub]);
  assert.equal((await content(live.db, secret, live.note)).length, 0);
  const [generic] = await ctx(live.db);
  assert.equal(generic.installation_consent, false);
  assert.equal(generic.preview_level, "none");
});

for (const migrated of [false, true]) {
  const path = migrated ? "actual upgrade" : "proposal";
  test(`sidecar ${path}: admission expiry bounds context grant and content`, async t => {
    const f = await runtimeOff(t, { migrated });
    await asRole(f.db, "service_role", "select public.web_message_preview_install_set($1, clock_timestamp()+interval '5 seconds', false)", [sub]);
    const limit = (await f.db.query("select floor(extract(epoch from expires_at)*1000)::bigint as ms from private.web_message_preview_install_admissions")).rows[0].ms;
    const [before] = await ctx(f.db);
    const { rows: [ack], secret } = await enroll(f.db, before.revision, "message", sub, before.subscription_fingerprint);
    assert.ok(ack.installation_consent && ack.expires_at_epoch_ms <= limit, "enroll ACK must not outlive operator admission");
    const [row] = await content(f.db, secret, f.note);
    assert.equal(row.body, "WEB CANARY FIXED");
    assert.ok(row.expires_at_epoch_ms <= limit, "content lease must not outlive operator admission");
    assert.equal((await f.db.query("select g.expires_at<=a.expires_at as bounded from private.web_message_preview_grants g join private.web_message_preview_install_admissions a using(subscription_id)")).rows[0].bounded, true);
    assert.equal((await f.db.query("select enabled from private.web_message_preview_runtime where singleton")).rows[0].enabled, false);
  });

  test(`sidecar ${path}: admission expiry during enroll rolls back the grant`, async t => {
    const f = await runtimeOff(t, { migrated });
    const [before] = await ctx(f.db);
    await f.db.exec(`create function private.fixture_admission_enroll_wait() returns trigger language plpgsql as $$
      begin perform pg_sleep(0.6); return new; end $$;
      create trigger fixture_admission_enroll_wait before insert on private.web_message_preview_grants
        for each row execute function private.fixture_admission_enroll_wait();`);
    await asRole(f.db, "service_role", "select public.web_message_preview_install_set($1, clock_timestamp()+interval '0.4 seconds', false)", [sub]);
    await assert.rejects(enroll(f.db, before.revision, "message", sub, before.subscription_fingerprint), /web_preview_disabled/);
    assert.equal((await f.db.query("select count(*)::int as n from private.web_message_preview_grants")).rows[0].n, 0);
  });

  test(`sidecar ${path}: admission expiry during content denies the final result`, async t => {
    const f = await runtimeOff(t, { migrated });
    await admit(f.db);
    const [before] = await ctx(f.db);
    const { secret } = await enroll(f.db, before.revision, "message", sub, before.subscription_fingerprint);
    assert.equal((await content(f.db, secret, f.note)).length, 1);
    await f.db.exec(`alter function private.topic_alert_source_lock(uuid,uuid) rename to fixture_original_topic_alert_source_lock;
      create function private.topic_alert_source_lock(p_user uuid,p_chat uuid) returns void language plpgsql volatile
        security definer set search_path='' as $$ begin
          perform private.fixture_original_topic_alert_source_lock(p_user,p_chat);
          perform pg_sleep(0.6);
        end $$;
      alter function private.topic_alert_source_lock(uuid,uuid) owner to postgres;`);
    await asRole(f.db, "service_role", "select public.web_message_preview_install_set($1, clock_timestamp()+interval '0.4 seconds', false)", [sub]);
    await expectDenied(f, secret);
  });

  test(`sidecar ${path}: rollback closes operator admission and existing capability`, async t => {
    const f = await runtimeOff(t, { migrated });
    await admit(f.db);
    const [before] = await ctx(f.db);
    const { secret } = await enroll(f.db, before.revision, "message", sub, before.subscription_fingerprint);
    assert.equal((await content(f.db, secret, f.note)).length, 1);
    await f.db.exec(`create function private.fixture_rollback_admission_first() returns trigger language plpgsql as $$ begin
        if exists(select 1 from private.web_message_preview_install_admissions where revoked_at is null) then
          raise exception 'fixture_rollback_must_retire_admission_before_grant';
        end if;
        return new;
      end $$;
      create trigger fixture_rollback_admission_first before update on private.web_message_preview_grants
        for each row execute function private.fixture_rollback_admission_first();`);
    await f.db.exec(await readFile(rollback, "utf8"));
    await expectDenied(f, secret);
    const [after] = await ctx(f.db);
    assert.equal(after.installation_consent, false);
    await assert.rejects(enroll(f.db, after.revision, "message", sub, after.subscription_fingerprint), /web_preview_disabled/);
    assert.equal((await f.db.query("select count(*)::int as n from private.web_message_preview_install_admissions where revoked_at is null")).rows[0].n, 0);
  });

  test(`sidecar ${path}: subscription lock precedes every admission read in enroll and content`, async t => {
    const f = await runtimeOff(t, { migrated });
    await admit(f.db);
    const [before] = await ctx(f.db);
    // Observe the real SQL lock order at the admission read, not source-string order.
    await f.db.exec(`alter table private.web_message_preview_install_admissions rename to fixture_admission_rows;
      create function private.fixture_locked_admission_expiry(p_value timestamptz) returns timestamptz
        language plpgsql volatile as $$ begin
          if not exists(select 1 from pg_catalog.pg_locks where pid=pg_backend_pid() and granted
            and relation='public.push_subscriptions'::regclass and mode='RowShareLock') then
            raise exception 'fixture_subscription_lock_must_precede_admission';
          end if;
          return p_value;
        end $$;
      create view private.web_message_preview_install_admissions as select subscription_id,recipient_id,
        private.fixture_locked_admission_expiry(expires_at) as expires_at,revoked_at from private.fixture_admission_rows;
      alter view private.web_message_preview_install_admissions owner to postgres;`);
    const { secret, rows } = await enroll(f.db, before.revision, "message", sub, before.subscription_fingerprint);
    assert.equal(rows[0].installation_consent, true);
    assert.equal((await content(f.db, secret, f.note)).length, 1);
  });

  test(`sidecar ${path}: content retains admission read lock and setter locks subscription`, async t => {
    const f = await runtimeOff(t, { migrated });
    await admit(f.db);
    const [before] = await ctx(f.db);
    const { secret } = await enroll(f.db, before.revision, "message", sub, before.subscription_fingerprint);
    await f.db.exec("begin");
    try {
      assert.equal((await content(f.db, secret, f.note)).length, 1);
      assert.equal(await retainedRelationLock(f.db, "public.push_subscriptions"), true);
      assert.equal(await retainedRelationLock(f.db, "private.web_message_preview_install_admissions"), true);
    } finally { await f.db.exec("rollback"); }
    await f.db.exec("begin");
    try {
      await asRole(f.db, "service_role", "select public.web_message_preview_install_set($1,null,true)", [sub]);
      assert.equal(await retainedRelationLock(f.db, "public.push_subscriptions"), true);
    } finally { await f.db.exec("rollback"); }
    // Both serialized descriptor/setter orders retain their intended meaning.
    await f.db.exec(`update public.push_subscriptions set auth='replacement' where id='${sub}'`);
    const [retired] = await ctx(f.db);
    await assert.rejects(enroll(f.db, retired.revision, "message", sub, retired.subscription_fingerprint), /web_preview_disabled/);
    await admit(f.db);
    assert.equal((await enroll(f.db, retired.revision, "message", sub, retired.subscription_fingerprint)).rows[0].installation_consent, true);
    await expectDenied(f, secret);
  });
}

test("sidecar compiled lock omissions break the ordinary retained-lock assertions", async t => {
  const source = await sqlSource();
  const controls = [
    ["content admission read lock", s => replaceOnce(s,
      "WHERE admission.subscription_id=s.id AND admission.recipient_id=seed.recipient_id\n        AND admission.revoked_at IS NULL AND admission.expires_at>clock_timestamp()\n      FOR SHARE NOWAIT;",
      "WHERE admission.subscription_id=s.id AND admission.recipient_id=seed.recipient_id\n        AND admission.revoked_at IS NULL AND admission.expires_at>clock_timestamp();"),
    "private.web_message_preview_install_admissions", false],
    ["setter subscription lock", s => replaceOnce(s,
      "SELECT user_id INTO owner_id FROM public.push_subscriptions WHERE id=p_subscription AND is_active FOR UPDATE;",
      "SELECT user_id INTO owner_id FROM public.push_subscriptions WHERE id=p_subscription AND is_active;"),
    "public.push_subscriptions", true],
  ];
  for (const [name, mutate, relation, setter] of controls) await t.test(name, async t => {
    const f = await runtimeOff(t, { sql: mutate(source) });
    await admit(f.db);
    const [before] = await ctx(f.db);
    const { secret } = await enroll(f.db, before.revision, "message", sub, before.subscription_fingerprint);
    await assert.rejects(async () => {
      await f.db.exec("begin");
      try {
        if (setter) await asRole(f.db, "service_role", "select public.web_message_preview_install_set($1,null,true)", [sub]);
        else assert.equal((await content(f.db, secret, f.note)).length, 1);
        assert.equal(await retainedRelationLock(f.db, relation), true);
      } finally { await f.db.exec("rollback"); }
    }, error => error.code === "ERR_ASSERTION", "omitting the lock must fail its literal retained-lock assertion");
  });
});

test("sidecar rollback also disables the frozen pre-sidecar state", async t => {
  const f = await granted(t, { preSidecar: true });
  assert.equal((await f.db.query("select to_regclass('private.web_message_preview_install_admissions') is null as absent")).rows[0].absent, true);
  await f.db.exec(await readFile(rollback, "utf8"));
  await expectDenied(f);
  const [after] = await ctx(f.db);
  assert.equal(after.installation_consent, false);
  assert.equal((await f.db.query("select enabled from private.web_message_preview_runtime where singleton")).rows[0].enabled, false);
});

test("sidecar actual upgrade preserves existing grants choices sessions and ACLs", async t => {
  const f = await granted(t, { preSidecar: true });
  await f.db.exec("update private.web_message_preview_runtime set enabled=false where singleton");
  await f.db.exec(await readFile(upgrade, "utf8"));
  assert.equal((await f.db.query("select enabled from private.web_message_preview_runtime where singleton")).rows[0].enabled, false);
  assert.equal((await content(f.db, f.secret, f.note)).length, 0);
  await admit(f.db);
  assert.equal((await content(f.db, f.secret, f.note)).length, 1);
  const [after] = await ctx(f.db);
  assert.equal(after.revision, f.grant.revision);
  assert.equal(after.session_id, session);
  assert.equal((await f.db.query("select preview_level from public.notification_preview_preferences where user_id=$1", [user])).rows[0].preview_level, "message");
  await assert.rejects(asRole(f.db, "authenticated", "select public.web_message_preview_install_set($1,clock_timestamp()+interval '1 day',false)", [sub]), error => error.code === "42501");
  await assert.rejects(asRole(f.db, "service_role", "select * from private.web_message_preview_install_admissions"), error => error.code === "42501");
});

test("prestate refuses a changed definer search_path even when its trusted body is unchanged", async t => {
  const { db } = await fixture(t, { baseline: true });
  await db.exec("alter function private.notification_topic_alert_allowed(uuid) set search_path=public");
  await assert.rejects(db.exec(await sqlSource()), /web_preview_dependency_drift/);
  await db.exec("rollback");
  assert.equal((await db.query("select to_regclass('private.web_message_preview_grants') is null as absent")).rows[0].absent, true);
});
