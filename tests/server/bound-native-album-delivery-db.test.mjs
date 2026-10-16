import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deliveryFixture, sendFixtureMessage, claimFixtureTarget } from "./topic-notification-delivery.fixture.mjs";
import { id, user, other, quote, setPreference, claims } from "./topic-notification-overrides.fixture.mjs";

const proposal = new URL("../../docs/proposals/2026-10-17-bound-native-album-delivery.sql", import.meta.url);
const tokenText = "fictional:\u00e9\u{1f9ca}";
const endpoint = "https://provider.invalid/\u00e9/\u{1f9ca}?x=1#f", key = "a\u{1f9ca}:bc", auth = "auth:\u00e9";
const hashes = {
  native: "v1:0918c37f7151f42f6571fb37e7b3ee787c9b9003267e346fae506e3f4cfec1bb",
  web: "v1:31a3586636684d806e71ae039a72c602302f7be949c8a4de4b491d7e4cd16f29",
};
const signatures = ["public.native_push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)",
  "public.album_push_recheck_bound(uuid,uuid,uuid,text)"];
async function setup(t, { sql, apply = true } = {}) {
  const db = await deliveryFixture({ candidate: true, native: process.env.LETSCUBE_TOPIC_DELIVERY_PG17 === "1", t });
  t.after(() => db.close());
  // Fixture schema supplement only: production policy/rechecks/producers are unchanged.
  await db.exec(`alter table public.user_push_devices add column token text,add column app_version text;
    update public.user_push_devices set token=${quote(tokenText)},app_version='0.1.21';
    update public.push_subscriptions set endpoint=${quote(endpoint)},p256dh=${quote(key)},auth=${quote(auth)};
    alter table public.user_push_devices enable row level security;
    alter table public.notifications_native_push_outbox enable row level security;`);
  if (apply) {
    let text = sql;
    if (text === undefined) try { text = await readFile(proposal, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (text) await db.exec(text);
    for (const signature of signatures) assert.equal((await db.query(`select to_regprocedure('${signature}') is not null as present`)).rows[0].present,
      true, "native/album bound delivery feature missing");
  }
  return db;
}
async function target(db, channel) {
  const album = channel !== "native";
  await sendFixtureMessage(db, 160, album ? { albumIndex: 0 } : {});
  if (album) await sendFixtureMessage(db, 161, { albumIndex: 1 });
  const table = album ? "public.notifications_album_push_outbox" : "public.notifications_native_push_outbox";
  const targetId = id(channel === "album-web" ? 50 : 52);
  const targetColumn = channel === "album-web" ? "subscription_id" : "device_id";
  const claim = await claimFixtureTarget(db, table, `${targetColumn}='${targetId}'`);
  assert.ok(claim.id, "captured producer must create target");
  return { ...claim, table, targetId, channel };
}
async function call(db, c, { token = c.token, targetId = c.targetId,
  fingerprint = c.channel === "album-web" ? hashes.web : hashes.native } = {}) {
  const args = `'${c.id}','${token}','${targetId}',${quote(fingerprint)}`;
  return c.channel === "native"
    ? (await db.query(`select public.native_push_outbox_delivery_recheck_bound(${args}) as status`)).rows[0]
    : (await db.query(`select * from public.album_push_recheck_bound(${args})`)).rows[0];
}
const state = async (db, c) => (await db.query(`select claim_token,claimed_until,sent_at,attempt_count,last_error${c.channel === "native" ? "" : ",suppressed_at,suppression_reason"}
  from ${c.table} where id='${c.id}'`)).rows[0];

for (const channel of ["native", "album-web", "album-native"]) {
  test(`${channel} actual postTask3 unbound baseline admits a descriptor replacement`, async t => {
    const db = await setup(t, { apply: false }), c = await target(db, channel);
    await db.exec(channel === "album-web" ? `update public.push_subscriptions set auth='B' where id='${c.targetId}'`
      : `update public.user_push_devices set token='B' where id='${c.targetId}'`);
    const status = channel === "native"
      ? (await db.query(`select public.native_push_outbox_delivery_recheck('${c.id}','${c.token}') as status`)).rows[0].status
      : (await db.query(`select status from public.album_push_recheck('${c.id}','${c.token}')`)).rows[0].status;
    assert.equal(status, "deliver");
  });
  test(`${channel} exact literal Unicode fingerprint delegates real current policy`, async t => {
    const db = await setup(t), c = await target(db, channel);
    const result = await call(db, c); assert.equal(result.status, "deliver");
    if (channel !== "native") assert.equal(result.payload.messageId, id(161));
    assert.equal((await state(db, c)).claim_token, c.token);
  });
  for (const column of channel === "album-web" ? ["endpoint", "p256dh", "auth"] : ["token", "platform", "provider", "app_version", "session_id"]) {
    test(`${channel} changed ${column} releases exact lease only`, async t => {
      const db = await setup(t), c = await target(db, channel), before = await state(db, c);
      await db.exec(channel === "album-web" ? `update public.push_subscriptions set ${column}='B' where id='${c.targetId}'`
        : `update public.user_push_devices set ${column}=${column === "session_id" ? quote(id(31)) : column === "platform" ? "'windows'" : column === "provider" ? "'wns'" : "'B'"} where id='${c.targetId}'`);
      assert.equal((await call(db, c)).status, channel === "native" ? "device_changed" : "target_changed");
      assert.deepEqual(await state(db, c), { ...before, claim_token: null, claimed_until: null });
    });
  }
  for (const mismatch of ["token", "target", "owner", "expired", "malformed"]) {
    test(`${channel} wrong ${mismatch} never mutates current claim`, async t => {
      const db = await setup(t), c = await target(db, channel);
      if (mismatch === "owner") await db.exec(`update public.${channel === "album-web" ? "push_subscriptions" : "user_push_devices"} set user_id='${other}' where id='${c.targetId}'`);
      if (mismatch === "expired") await db.exec(`update ${c.table} set claimed_until=clock_timestamp()-interval '1 second' where id='${c.id}'`);
      const before = await state(db, c);
      const options = mismatch === "token" ? { token: id(99) } : mismatch === "target" ? { targetId: id(99) }
        : mismatch === "malformed" ? { fingerprint: "v1:BAD" } : {};
      assert.equal((await call(db, c, options)).status, "claim_lost"); assert.deepEqual(await state(db, c), before);
    });
  }
  test(`${channel} terminal topic admission still suppresses with matching descriptor`, async t => {
    const db = await setup(t), c = await target(db, channel);
    await db.exec(`${claims()} set role authenticated; ${setPreference("disabled")}; reset role;`);
    assert.notEqual((await call(db, c)).status, "deliver"); assert.notEqual((await state(db, c)).sent_at ??
      (await state(db, c)).suppressed_at ?? (await state(db, c)).last_error, null);
  });
  for (const gate of ["inactive", "dnd"]) test(`${channel} matching descriptor preserves real ${gate} denial`, async t => {
    const db = await setup(t), c = await target(db, channel);
    await db.exec(gate === "dnd" ? `insert into public.privacy_preferences(user_id,manual_status) values('${user}','dnd')`
      : channel === "album-web" ? `update public.push_subscriptions set is_active=false where id='${c.targetId}'`
        : `update public.user_push_devices set enabled=false where id='${c.targetId}'`);
    assert.equal((await call(db, c)).status, gate === "dnd" ? "not_eligible" : channel === "native" ? "device_inactive" : "target_inactive");
  });
  test(`${channel} descriptor mismatch does not run a suppressing policy reconciliation`, async t => {
    const db = await setup(t), c = await target(db, channel), before = await state(db, c);
    await db.exec(`insert into public.privacy_preferences(user_id,manual_status) values('${user}','dnd');`);
    const result = await call(db, c, { fingerprint: "v1:" + "0".repeat(64) });
    assert.equal(result.status, channel === "native" ? "device_changed" : "target_changed");
    assert.deepEqual(await state(db, c), { ...before, claim_token: null, claimed_until: null }, "mismatch must release only the exact lease");
  });
}

test("both additive ABIs are service-only postgres definers with fixed path and unchanged callee pins", async t => {
  const db = await setup(t), c = await target(db, "native");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`); await assert.rejects(() => call(db, c), error => error.code === "42501"); await db.exec("reset role");
  }
  await db.exec("revoke all on public.user_push_devices,public.notifications_native_push_outbox from service_role; set role service_role;");
  assert.equal((await call(db, c)).status, "deliver"); await db.exec("reset role");
  for (const signature of signatures) {
    const row = (await db.query(`select r.rolname,p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as authenticated,
      has_function_privilege('service_role',p.oid,'execute') as service from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='${signature}'::regprocedure`)).rows[0];
    assert.deepEqual(row, { rolname: "postgres", prosecdef: true, proconfig: ["search_path=pg_catalog"], anon: false, authenticated: false, service: true });
  }
  for (const [signature, hash] of [["public.native_push_outbox_delivery_recheck(uuid,uuid)", "6ebe9a9d5eff45b2f9c8b6059547272b8f63e2e4ce1ce60753adecb30a929f28"],
    ["public.album_push_recheck(uuid,uuid)", "30042224019c97d630f1f9f83e9159095b83f92bb48d6b35e1a125b350d3d66e"]]) {
    assert.equal((await db.query(`select encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex') as hash`)).rows[0].hash, hash);
  }
});

test("SQL native typed nulls cannot alias an empty version or missing session", async t => {
  const db = await setup(t), c = await target(db, "native");
  await db.exec(`update public.user_push_devices set app_version=null,session_id=null where id='${c.targetId}'`);
  const nullable = "v1:ff065d0189973bff826ee35a0a23332bf2552e547fb355c829a0834fec8e9520";
  assert.equal((await call(db, c, { fingerprint: nullable })).status, "deliver");
  await db.exec(`update public.user_push_devices set app_version='' where id='${c.targetId}'`);
  assert.equal((await call(db, c, { fingerprint: nullable })).status, "device_changed");
});

for (const [name, from, to] of [
  ["PUBLIC revoke", "FROM PUBLIC,anon,authenticated,service_role;\nGRANT EXECUTE", "FROM anon,authenticated,service_role;\nGRANT EXECUTE"],
  ["native definer", "LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog", "LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog"],
  ["fixed path", "VOLATILE SECURITY DEFINER SET search_path = pg_catalog", "VOLATILE SECURITY DEFINER"],
  ["native owner", `ALTER FUNCTION ${signatures[0]} OWNER TO postgres;`, ""],
  ["service grant", "public.album_push_recheck_bound(uuid,uuid,uuid,text) TO service_role;", "public.album_push_recheck_bound(uuid,uuid,uuid,text) TO postgres;"],
  ["RLS", "DO $selfcheck$", "ALTER TABLE public.user_push_devices DISABLE ROW LEVEL SECURITY;\nDO $selfcheck$"],
]) test(`new SQL raising transaction selfcheck catches ${name} omission`, async t => {
  const db = await setup(t, { apply: false }), source = await readFile(proposal, "utf8");
  assert.ok(source.includes(from), "literal actual SQL mutation anchor");
  await db.exec("set role supabase_admin;");
  await assert.rejects(() => db.exec(source.replace(from, to)), /bound_native_album_selfcheck_failed/);
  await db.exec("rollback; reset role;");
  assert.equal((await db.query(`select to_regprocedure('${signatures[0]}') is null as absent`)).rows[0].absent, true);
});

for (const [name, from, to, channel, options, expected] of [
  ["native UTF8 length", "octet_length(v_part)::text", "length(v_field)::text", "native", {}, "deliver"],
  ["native descriptor compare", "IF private.native_push_descriptor_fingerprint(v_device) IS DISTINCT FROM p_device_fingerprint THEN", "IF false THEN", "native", { fingerprint: "v1:" + "0".repeat(64) }, "device_changed"],
  ["album descriptor compare", "IF v_hash IS DISTINCT FROM p_target_fingerprint THEN", "IF false THEN", "album-web", { fingerprint: "v1:" + "0".repeat(64) }, "target_changed"],
  ["native typed null", "convert_to('-1:','UTF8')", "convert_to('0:','UTF8')", "native", { nullable: true }, "deliver"],
]) test(`loaded actual SQL mutant breaks literal ${name} oracle`, async t => {
  const source = await readFile(proposal, "utf8"); assert.ok(source.includes(from));
  const db = await setup(t, { sql: source.replace(from, to) }), c = await target(db, channel);
  let input = options;
  if (options.nullable) {
    await db.exec(`update public.user_push_devices set app_version=null,session_id=null where id='${c.targetId}'`);
    input = { fingerprint: "v1:ff065d0189973bff826ee35a0a23332bf2552e547fb355c829a0834fec8e9520" };
  }
  await assert.rejects(async () => assert.equal((await call(db, c, input)).status, expected, "literal descriptor binding oracle"), error => {
    assert.equal(error.code, "ERR_ASSERTION", "SQL/setup failures cannot kill behavioral mutants");
    assert.equal(error.message.split("\n")[0], "literal descriptor binding oracle"); return true;
  });
});

test("callee source/path drift is refused transactionally, never silently wrapped", async t => {
  const db = await setup(t, { apply: false });
  await db.exec("alter function public.album_push_recheck(uuid,uuid) set statement_timeout='1s';");
  const sql = await readFile(proposal, "utf8");
  await assert.rejects(() => db.exec(sql), /bound_native_album_prestate_drift/);
  await db.exec("rollback;");
  assert.equal((await db.query(`select to_regprocedure('${signatures[0]}') is null as absent`)).rows[0].absent, true);
});
