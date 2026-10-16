import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deliveryFixture, sendFixtureMessage, claimFixtureTarget } from "./topic-notification-delivery.fixture.mjs";
import { id, user, other, quote } from "./topic-notification-overrides.fixture.mjs";

const proposal = new URL("../../docs/proposals/2026-10-16-bound-push-delivery.sql", import.meta.url);
const signature = "public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)";
const originalHash = "7f2cce6f0dda421d386e98e4d3a51113e221ca79314515d342698a2e5f3caa9f";
const endpoint = "https://provider.invalid/\u00e9/\u{1f9ca}?x=1#f", key = "a\u{1f9ca}:bc", auth = "auth:\u00e9";
const descriptor = [id(50), user, endpoint, key, auth];
function fingerprint(fields = descriptor) {
  const framed = Buffer.concat(fields.flatMap(value => { const bytes = Buffer.from(value, "utf8"); return [Buffer.from(bytes.length + ":"), bytes]; }));
  return "v1:" + createHash("sha256").update(framed).digest("hex");
}
async function setup(t, { sql, apply = true } = {}) {
  const db = await deliveryFixture({ baseline: true, native: process.env.LETSCUBE_TOPIC_DELIVERY_PG17 === "1", t }); t.after(() => db.close());
  await db.exec(`alter table public.push_subscriptions add column endpoint text, add column p256dh text, add column auth text;
    update public.push_subscriptions set endpoint=${quote(endpoint)},p256dh=${quote(key)},auth=${quote(auth)};
    alter table public.push_subscriptions enable row level security;
    alter table public.notifications_push_outbox enable row level security;`);
  if (apply) {
    let source = sql;
    if (source === undefined) { try { source = await readFile(proposal, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; } }
    if (source) await db.exec(source);
    assert.equal((await db.query(`select to_regprocedure('${signature}') is not null as present`)).rows[0].present,
      true, "descriptor-bound recheck is missing");
  }
  return db;
}
async function target(db) {
  await sendFixtureMessage(db, 160);
  return claimFixtureTarget(db, "public.notifications_push_outbox", `subscription_id='${id(50)}'`);
}
async function call(db, claim, { token = claim.token, subscription = id(50), hash = fingerprint() } = {}) {
  return (await db.query(`select public.push_outbox_delivery_recheck_bound('${claim.id}','${token}','${subscription}',${quote(hash)}) as status`)).rows[0].status;
}
async function state(db, claim) {
  return (await db.query(`select claim_token,claimed_until,suppressed_at,sent_at,attempt_count,last_error from public.notifications_push_outbox where id='${claim.id}'`)).rows[0];
}
test("captured unbound RPC accepts a same-id descriptor replacement: actual baseline control", async t => {
  const db = await setup(t, { apply: false }); const claim = await target(db);
  await db.exec(`update public.push_subscriptions set endpoint='https://provider.invalid/B' where id='${id(50)}'`);
  assert.equal((await db.query(`select public.push_outbox_delivery_recheck('${claim.id}','${claim.token}') as status`)).rows[0].status, "deliver");
});
test("actual SQL matches literal Unicode byte-framed v1 fingerprint and keeps old ABI/hash", async t => {
  assert.equal(fingerprint(), "v1:31a3586636684d806e71ae039a72c602302f7be949c8a4de4b491d7e4cd16f29");
  const db = await setup(t); const claim = await target(db);
  assert.equal(await call(db, claim, { hash: "v1:31a3586636684d806e71ae039a72c602302f7be949c8a4de4b491d7e4cd16f29" }), "deliver");
  assert.equal((await state(db, claim)).claim_token, claim.token);
  assert.equal((await db.query(`select encode(sha256(convert_to(pg_get_functiondef('public.push_outbox_delivery_recheck(uuid,uuid)'::regprocedure),'UTF8')),'hex') as hash`)).rows[0].hash, originalHash);
});
for (const column of ["endpoint", "p256dh", "auth"]) {
  test(`same S/UID changed ${column} releases only exact claim without suppression/attempt`, async t => {
    const db = await setup(t); const claim = await target(db);
    await db.exec(`update public.push_subscriptions set ${column}='descriptor-B' where id='${id(50)}'`);
    assert.equal(await call(db, claim), "subscription_changed");
    const after = await state(db, claim);
    assert.equal(after.claim_token, null); assert.equal(after.claimed_until, null);
    assert.equal(after.suppressed_at, null); assert.equal(after.sent_at, null); assert.equal(after.attempt_count, 0);
    assert.equal(after.last_error, null);
  });
}
for (const options of [{ token: id(99) }, { subscription: id(51) }]) {
  test(`wrong token/binding ${JSON.stringify(options)} does not mutate either claim`, async t => {
    const db = await setup(t); const claim = await target(db); const before = await state(db, claim);
    const allBefore = (await db.query("select id,claim_token,claimed_until,suppressed_at,sent_at,attempt_count from public.notifications_push_outbox order by id")).rows;
    assert.equal(await call(db, claim, options), "claim_lost"); assert.deepEqual(await state(db, claim), before);
    assert.deepEqual((await db.query("select id,claim_token,claimed_until,suppressed_at,sent_at,attempt_count from public.notifications_push_outbox order by id")).rows, allBefore);
  });
}
test("same subscription reassigned to a different recipient refuses without mutation", async t => {
  const db = await setup(t); const claim = await target(db); const before = await state(db, claim);
  await db.exec(`update public.push_subscriptions set user_id='${other}' where id='${id(50)}'`);
  assert.equal(await call(db, claim), "claim_lost"); assert.deepEqual(await state(db, claim), before);
});
test("matching descriptor still delegates actual current DND/global/visibility policy", async t => {
  const db = await setup(t); const claim = await target(db);
  await db.exec(`insert into public.privacy_preferences(user_id,manual_status) values('${user}','dnd');`);
  assert.equal(await call(db, claim), "not_eligible");
  assert.notEqual((await state(db, claim)).suppressed_at, null);
});
test("service-only definer works without caller table grants; public/anon/authenticated cannot call", async t => {
  const db = await setup(t); const claim = await target(db);
  await db.exec(`alter table public.push_subscriptions enable row level security;
    alter table public.notifications_push_outbox enable row level security;
    revoke all on public.push_subscriptions,public.notifications_push_outbox from public,service_role,anon,authenticated;`);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(() => call(db, claim), error => error.code === "42501");
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  assert.equal(await call(db, claim), "deliver"); await db.exec("reset role");
  const row = (await db.query(`select p.prosecdef,r.rolname,p.proconfig from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='${signature}'::regprocedure`)).rows[0];
  assert.equal(row.prosecdef, true); assert.equal(row.rolname, "postgres");
  assert.deepEqual(row.proconfig, ["search_path=pg_catalog"]);
});

for (const hash of ["v1:" + "0".repeat(64), "bad", "v1:" + "A".repeat(64)]) {
  test(`fingerprint ${hash.slice(0, 10)} never admits a descriptor`, async t => {
    const db = await setup(t); const claim = await target(db); const before = await state(db, claim);
    assert.equal(await call(db, claim, { hash }), hash === "v1:" + "0".repeat(64) ? "subscription_changed" : "claim_lost");
    const after = await state(db, claim);
    assert.equal(after.suppressed_at, null); assert.equal(after.attempt_count, 0);
    if (hash !== "v1:" + "0".repeat(64)) assert.deepEqual(after, before);
  });
}
const securityMutations = [
  ["PUBLIC ACL revoke", "FROM PUBLIC,anon,authenticated,service_role;", "FROM anon,authenticated,service_role;"],
  ["definer", "LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog", "LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog"],
  ["fixed path", "SECURITY DEFINER SET search_path = pg_catalog", "SECURITY DEFINER"],
  ["postgres owner", `ALTER FUNCTION ${signature} OWNER TO postgres;`, ""],
  ["service grant", `GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`, ""],
  ["RLS preservation", "DO $selfcheck$", "ALTER TABLE public.push_subscriptions DISABLE ROW LEVEL SECURITY;\nDO $selfcheck$"],
];
for (const [name, needle, replacement] of securityMutations) {
  test(`transaction selfcheck rejects actual SQL omission: ${name}`, async t => {
    const source = await readFile(proposal, "utf8"); assert.equal(source.split(needle).length - 1, 1);
    const db = await setup(t, { apply: false });
    await db.exec("set role supabase_admin;");
    await assert.rejects(() => db.exec(source.replace(needle, replacement)), /bound_push_delivery_selfcheck_failed/);
    await db.exec("rollback; reset role;");
    assert.equal((await db.query(`select to_regprocedure('${signature}') is null as absent`)).rows[0].absent, true);
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.push_subscriptions'::regclass")).rows[0].relrowsecurity, true);
  });
}
for (const [name, needle, replacement] of [
  ["UTF8 byte length", "octet_length(v_part)::text", "length(v_field)::text"],
  ["auth field", "v_subscription.endpoint,v_subscription.p256dh,v_subscription.auth]", "v_subscription.endpoint,v_subscription.p256dh]"],
  ["descriptor equality", "IF 'v1:' || encode(sha256(v_framed),'hex') IS DISTINCT FROM p_subscription_fingerprint THEN", "IF false THEN"],
]) {
  test(`actual SQL behavioral omission is detected: ${name}`, async t => {
    const source = await readFile(proposal, "utf8"); assert.equal(source.split(needle).length - 1, 1);
    const db = await setup(t, { sql: source.replace(needle, replacement) }); const claim = await target(db);
    if (name === "descriptor equality") await db.exec(`update public.push_subscriptions set auth='changed' where id='${id(50)}'`);
    const expected = name === "descriptor equality" ? "subscription_changed" : "deliver";
    await assert.rejects(async () => assert.equal(await call(db, claim), expected, "literal descriptor authority"), error => {
      assert.equal(error.code, "ERR_ASSERTION", "SQL/setup failures cannot kill behavior mutants");
      assert.equal(error.message.split("\n")[0], "literal descriptor authority"); return true;
    });
  });
}
test("prestate rejects changed old policy body without adding an alternate bypass", async t => {
  const db = await setup(t, { apply: false }); const sql = await readFile(proposal, "utf8");
  await db.exec("alter function public.push_outbox_delivery_recheck(uuid,uuid) set search_path=pg_catalog;");
  await assert.rejects(() => db.exec(sql), /bound_push_delivery_prestate_drift/);
  await db.exec("rollback;");
  assert.equal((await db.query(`select to_regprocedure('${signature}') is null as absent`)).rows[0].absent, true);
});
test("valid draft created by supabase_admin transfers ownership and still admits exact bytes", async t => {
  const db = await setup(t, { apply: false });
  await db.exec("set role supabase_admin;"); await db.exec(await readFile(proposal, "utf8"));
  await db.exec("reset role;"); const claim = await target(db);
  assert.equal(await call(db, claim, { hash: "v1:31a3586636684d806e71ae039a72c602302f7be949c8a4de4b491d7e4cd16f29" }), "deliver");
});
