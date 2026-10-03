import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageFixture, trusted, authenticated, messageInsert, mediaUrl, quote, uuid,
  actor, outsider, observations, closing, accounting, objectState, messageCount,
  installForward,
} from "./bot-media-coverage.fixture.mjs";

const registered = (kind, a) => ({
  source_kind: kind, bucket_id: "chat-media", object_path: a.receipt.path,
  generation_id: a.identity.generation_id, reference_state: "registered", hold_reason: null,
});
const hasError = (code, name) => error => error.code === code && error.message.includes(name);

async function fixture(t) {
  const db = await coverageFixture(t);
  t.diagnostic("actual local PostgreSQL " + db.version + "; fictional coverage/close state, not production eligibility or physical generation");
  return db;
}

async function referencesSnapshot(db) {
  return db.query("select * from private.bot_message_media_observations order by message_id,source_kind");
}

async function forceReadableSourceClosed(db) {
  // A real closer must refuse these existing references. Only test-owned state
  // injection can exercise the already-readable-source closed writer boundary.
  await assert.rejects(closing(db, [1]), hasError("55000", "fixture_reference_present"));
  assert.deepEqual(await objectState(db), [{ id: 1, closed: false }, { id: 2, closed: false }]);
  await trusted(db, "update fixture_coverage.objects set closed=true where id=1;");
  assert.deepEqual(await objectState(db), [{ id: 1, closed: true }, { id: 2, closed: false }]);
}

test("all client roles really lack coverage helper EXECUTE and fictional close-table authority", async t => {
  const db = await fixture(t), before = await accounting(db);
  const helpers = [
    ["fixture_coverage.before_write()", "fixture_coverage.before_write()"],
    ["fixture_coverage.after_write()", "fixture_coverage.after_write()"],
    ["fixture_coverage.check_refs(jsonb)", "fixture_coverage.check_refs('[]'::jsonb)"],
    ["fixture_coverage.close_objects(integer[])", "fixture_coverage.close_objects(array[1])"],
  ];
  const catalog = await db.query(`select p.oid::regprocedure::text as signature,
    pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig
    from pg_proc p where p.pronamespace='fixture_coverage'::regnamespace order by 1`);
  assert.deepEqual(catalog, helpers.map(([signature]) => ({ signature, owner: "postgres", prosecdef: true,
    proconfig: ['search_path=""'] })).sort((a, b) => a.signature.localeCompare(b.signature)));
  // Separate missing schema USAGE from the function/table ACLs being tested.
  await db.exec("grant usage on schema fixture_coverage to anon,authenticated,service_role;");
  for (const role of ["anon", "authenticated", "service_role"]) {
    const [privileges] = await db.query(`select
      has_schema_privilege('${role}','fixture_coverage','USAGE') as usage,
      has_table_privilege('${role}','fixture_coverage.objects','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as table_access`);
    assert.deepEqual(privileges, { usage: true, table_access: false });
    await assert.rejects(db.exec(`set role ${role}; select closed from fixture_coverage.objects;`), { code: "42501" });
    await assert.rejects(db.exec(`set role ${role}; update fixture_coverage.objects set closed=true where id=1;`), { code: "42501" });
    for (const [signature, call] of helpers) {
      const [capability] = await db.query(`select has_function_privilege('${role}',${quote(signature)},'EXECUTE') as allowed`);
      assert.equal(capability.allowed, false, role + " must have no helper entrypoint: " + signature);
      await assert.rejects(db.exec(`set role ${role}; select ${call};`), { code: "42501" });
    }
  }
  const id = uuid(8200);
  await authenticated(db, messageInsert(id, { path: null, url: mediaUrl(db.a.receipt.path) }) + ";");
  assert.deepEqual(await observations(db, id), [registered("legacy_url", db.a)],
    "the trigger executes internally for an authorized message despite absent client helper EXECUTE");
  assert.deepEqual(await objectState(db), [{ id: 1, closed: false }, { id: 2, closed: false }]);
  assert.deepEqual(await accounting(db), before);
});

test("open coverage preserves authenticated ownership path guard and RLS zero-row UPDATE semantics", async t => {
  const db = await fixture(t), before = await accounting(db), id = uuid(8210), path = actor + "/coverage-owned.pdf";
  await authenticated(db, messageInsert(id, { bucket: "media", path }) + ";");
  const expected = [{ source_kind: "canonical", bucket_id: "media", object_path: path,
    generation_id: null, reference_state: "unresolved", hold_reason: "unregistered_object" }];
  assert.deepEqual(await observations(db, id), expected);
  await assert.rejects(authenticated(db, messageInsert(uuid(8211), { user: outsider, path: outsider + "/not-a-member.pdf" }) + ";", outsider),
    { code: "42501" });
  await assert.rejects(authenticated(db, messageInsert(uuid(8212), { user: outsider, path: null }) + ";"), { code: "42501" });
  await assert.rejects(authenticated(db, messageInsert(uuid(8213), { path: db.a.receipt.path }) + ";"),
    hasError("42501", "message_media_path_not_owned"));
  await assert.rejects(authenticated(db, `update public.messages set media_path=${quote(db.a.receipt.path)} where id='${id}';`),
    hasError("42501", "message_media_path_not_owned"));
  const updated = await authenticated(db, `with changed as (
    update public.messages set media_url='unsupported' where id='${id}' returning id
  ) select count(*) from changed;`, outsider);
  assert.equal(updated, "0", "fixture nonmember UPDATE must still affect no visible rows");
  assert.deepEqual(await observations(db, id), expected);
  assert.equal(await messageCount(db), 1);
  await assert.rejects(closing(db, [2]), hasError("55000", "fixture_unknown_coverage"));
  assert.deepEqual(await accounting(db), before);
});

test("closed coverage refuses permitted references without replacing existing row authorization or blocking another open generation", async t => {
  const db = await fixture(t), before = await accounting(db);
  await closing(db, [1]);
  await assert.rejects(authenticated(db, messageInsert(uuid(8220), { user: outsider, path: outsider + "/nonmember.pdf" }) + ";", outsider),
    { code: "42501" });
  await assert.rejects(authenticated(db, messageInsert(uuid(8221), { user: outsider, path: null }) + ";"), { code: "42501" });
  await assert.rejects(authenticated(db, messageInsert(uuid(8222), { path: db.a.receipt.path }) + ";"),
    hasError("42501", "message_media_path_not_owned"));
  const rejected = uuid(8223);
  await assert.rejects(authenticated(db, messageInsert(rejected, { path: null, url: mediaUrl(db.a.receipt.path) }) + ";"),
    hasError("55000", "fixture_generation_closed"));
  await assert.rejects(db.exec("set role service_role; " + messageInsert(uuid(8224), { path: db.a.receipt.path }) + ";"),
    hasError("55000", "fixture_generation_closed"), "service_role BYPASSRLS must not skip the prototype trigger");
  assert.deepEqual(await observations(db, rejected), []);
  assert.equal(await messageCount(db), 0);
  const open = uuid(8225);
  await authenticated(db, messageInsert(open, { path: null, url: mediaUrl(db.b.receipt.path) }) + ";");
  assert.deepEqual(await observations(db, open), [registered("legacy_url", db.b)]);
  assert.equal(await messageCount(db), 1);
  assert.deepEqual(await objectState(db), [{ id: 1, closed: true }, { id: 2, closed: false }]);
  assert.deepEqual(await accounting(db), before);
});

test("captured forward RPC and permitted fallback work open but a fresh closed-reference forward rolls back", async t => {
  const db = await fixture(t), before = await accounting(db), source = uuid(8230), firstKey = uuid(8231);
  t.diagnostic("source membership is the fictional fixture contract, not live production policy acceptance; closed source state is injected only after closer refusal");
  await installForward(db);
  await trusted(db, messageInsert(source, { path: db.a.receipt.path, url: mediaUrl(db.a.receipt.path) }) + ";");
  const forward = (key, user = actor) => authenticated(db,
    `select (public.forward_message('${source}','${db.a.receipt.chat}','${key}',null,null)).id;`, user);
  const id = await forward(firstKey);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const expected = [registered("canonical", db.a), registered("legacy_url", db.a)];
  assert.deepEqual(await observations(db, id), expected);
  const fallback = uuid(8232);
  await authenticated(db, messageInsert(fallback, { path: db.a.receipt.path, url: mediaUrl(db.a.receipt.path), forward: source }) + ";");
  assert.deepEqual(await observations(db, fallback), expected);
  await assert.rejects(forward(uuid(8233), outsider), hasError("P0002", "message_not_found"));
  assert.equal(await messageCount(db), 3);
  await forceReadableSourceClosed(db);
  const references = await referencesSnapshot(db);
  await assert.rejects(forward(uuid(8234)), hasError("55000", "fixture_generation_closed"),
    "fresh idempotency key must execute an actual INSERT and reach closed-state checking");
  await assert.rejects(authenticated(db, messageInsert(uuid(8235), {
    path: db.a.receipt.path, url: mediaUrl(db.a.receipt.path), forward: source,
  }) + ";"), hasError("55000", "fixture_generation_closed"));
  assert.equal(await forward(firstKey), id, "existing forward retry is read-only, not a new admission");
  assert.equal(await messageCount(db), 3);
  assert.deepEqual(await referencesSnapshot(db), references);
  assert.deepEqual(await accounting(db), before);
  assert.equal((await db.query("select count(*)::int as n from storage.objects"))[0].n, 0);
});

test("accepted file_id writer keeps fixture privacy membership and idempotency checks before closed-reference refusal", async t => {
  const db = await fixture(t), before = await accounting(db), source = uuid(8240), key = "coverage-file-id-open-0001";
  t.diagnostic("captured writer plus accepted ingest patch; fixture membership/privacy is not live production policy proof");
  const [body] = await db.query(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') as hash from pg_proc
    where oid='public.bot_send_message_internal(uuid,uuid,text,jsonb,text)'::regprocedure`);
  assert.equal(body.hash, "7786e30e6ad6e9184fc88cf46dba8868d3bafbc7821dc088103c2c2ca3b022c8");
  await trusted(db, messageInsert(source, { path: db.a.receipt.path }) + ";");
  const send = async idempotencyKey => (await db.service(`select public.bot_send_message_internal(
    '${db.a.receipt.bot}','${db.a.receipt.chat}','sendDocument',
    ${quote(JSON.stringify({ file_id: source }))}::jsonb,${quote(idempotencyKey)}) as value`)).value;
  const result = await send(key);
  assert.equal(result.duplicate, false);
  assert.deepEqual(await observations(db, result.message_id), [registered("canonical", db.a)]);
  const retry = await send(key);
  assert.equal(retry.duplicate, true); assert.equal(retry.message_id, result.message_id);
  await trusted(db, `update public.chat_bot_members set privacy_mode='restricted'
    where bot_id='${db.a.receipt.bot}' and chat_id='${db.a.receipt.chat}';`);
  await assert.rejects(send("coverage-file-id-privacy"), hasError("P0002", "bot_file_not_found"));
  await trusted(db, `update public.chat_bot_members set removed_at=clock_timestamp()
    where bot_id='${db.a.receipt.bot}' and chat_id='${db.a.receipt.chat}';`);
  await assert.rejects(send("coverage-file-id-membership"), hasError("42501", "bot_chat_forbidden"));
  await assert.rejects(send(key), hasError("42501", "bot_chat_forbidden"), "cached result must not bypass membership authorization");
  assert.equal(await messageCount(db), 2);
  await trusted(db, `update public.chat_bot_members set removed_at=null,privacy_mode='full'
    where bot_id='${db.a.receipt.bot}' and chat_id='${db.a.receipt.chat}';`);
  await forceReadableSourceClosed(db);
  const references = await referencesSnapshot(db), idempotency = await db.query("select * from private.bot_message_idempotency order by bot_id,idempotency_key");
  await assert.rejects(send("coverage-file-id-closed-0001"), hasError("55000", "fixture_generation_closed"));
  const closedRetry = await send(key);
  assert.equal(closedRetry.duplicate, true); assert.equal(closedRetry.message_id, result.message_id);
  assert.equal(await messageCount(db), 2);
  assert.deepEqual(await referencesSnapshot(db), references);
  assert.deepEqual(await db.query("select * from private.bot_message_idempotency order by bot_id,idempotency_key"), idempotency);
  assert.deepEqual(await accounting(db), before);
  assert.equal((await db.query("select count(*)::int as n from storage.objects"))[0].n, 0);
});
