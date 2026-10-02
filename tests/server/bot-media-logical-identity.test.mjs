import assert from "node:assert/strict";
import test from "node:test";
import {
  identityFixture, next, reserve, begin, receipt, attempts, quote, trusted, refused,
  baseline, identitySource, identityRollback, uuid, finish, commit, object, rotate, authorize, authorizeSql,
  reserveSql, beginSql, grants, identities, attemptBindings, grantBindings, identityTables,
  snapshot, allBindings, identityFor, assertSnapshot, waitForLock, mutateFunction,
} from "./bot-media-logical-identity.fixture.mjs";

const gated = (name, body) => test(name, { skip: baseline ? "explicit baseline RED excludes identity-only cases" : false }, body);
const deniedAccess = operation => assert.rejects(operation, { code: "42501" });

async function noIdentityTables(db) {
  for (const name of identityTables) {
    assert.equal((await db.query(`select to_regclass('private.${name}') as relation`))[0].relation, null,
      "failed bootstrap leaves no partial " + name);
  }
}

async function functionCatalog(db) {
  return db.query(`select p.oid,p.oid::regprocedure::text as signature,prosrc,proacl::text,proconfig::text,proowner,prosecdef,provolatile
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','storage') order by p.oid`);
}

test("accepted base known control permits trusted receipt path and attempt snapshot rewrites inside rollback", async t => {
  const db = await identityFixture(t, { applyIdentity: false }), r = next(1);
  t.diagnostic("actual PostgreSQL " + db.version + "; accepted receipt/attempt migrations, no identity SQL");
  await reserve(db, r); await begin(db, r);
  const initialReceipt = await receipt(db, r), initialAttempts = await attempts(db);
  const changedPath = r.path + ".changed";
  const observed = JSON.parse(await trusted(db, `begin;
    update private.bot_media_ingests set object_path=${quote(changedPath)};
    update private.bot_media_upload_attempts set object_path=${quote(changedPath)};
    select jsonb_build_object('receipt_changed',(select object_path from private.bot_media_ingests)=${quote(changedPath)},
      'attempt_changed',(select object_path from private.bot_media_upload_attempts)=${quote(changedPath)});
    rollback;`));
  assert.deepEqual(observed, { receipt_changed: true, attempt_changed: true });
  assert.deepEqual(await receipt(db, r), initialReceipt);
  assert.deepEqual(await attempts(db), initialAttempts);
});

test("trusted receipt path rewrite is rejected without changing original charge or receipt", async t => {
  const db = await identityFixture(t), r = next(2);
  await reserve(db, r);
  const original = await receipt(db, r);
  await refused(trusted(db, `update private.bot_media_ingests set object_path=${quote(r.path + ".changed")};`));
  assert.deepEqual(await receipt(db, r), original);
});

test("trusted attempt snapshot rewrite is rejected while pending attempt remains retained", async t => {
  const db = await identityFixture(t), r = next(3);
  await reserve(db, r); await begin(db, r);
  const original = await attempts(db);
  await refused(trusted(db, `update private.bot_media_upload_attempts set object_path=${quote(r.path + ".changed")};`));
  assert.deepEqual(await attempts(db), original);
});

gated("backfill preserves exact complete/reserved receipts, pending/unknown attempts and matching managed grants", async t => {
  const db = await identityFixture(t, { applyIdentity: false }), complete = next(10), pending = next(11);
  await reserve(db, complete); await begin(db, complete); await finish(db, complete); await object(db, complete);
  await commit(db, complete);
  await reserve(db, pending); await begin(db, pending); await finish(db, pending, "unknown");
  const fresh = await rotate(db, pending, uuid(1001)); await begin(db, fresh); await object(db, pending);
  await authorize(db, pending);
  const ordinary = next(12); await object(db, ordinary); await authorize(db, ordinary);
  const before = await snapshot(db);
  await db.exec(identitySource());
  assert.deepEqual(await snapshot(db), before, "backfill must not rewrite accounting, receipts, attempts or grants");
  assert.equal((await identities(db)).length, 2);
  for (const r of [complete, pending]) assertSnapshot(await identityFor(db, r), r, await receipt(db, r));
  const boundAttempts = await attemptBindings(db);
  assert.equal(boundAttempts.length, 3);
  for (const a of before.attempts) {
    const r = a.idempotency_key === complete.key ? complete : pending;
    assert.equal(boundAttempts.find(row => row.attempt_id === a.attempt_id).generation_id, (await identityFor(db, r)).generation_id);
  }
  const boundGrants = await grantBindings(db);
  assert.equal(boundGrants.length, 2, "only the two matching managed grants are bound");
  for (const g of before.grants.filter(g => g.object_path !== ordinary.path)) {
    const r = g.object_path === complete.path ? complete : pending;
    const b = boundGrants.find(row => row.grant_id === g.id);
    assert.equal(b.generation_id, (await identityFor(db, r)).generation_id);
    assert.equal(b.issued_at, g.created_at);
  }
  assert.ok(!boundGrants.some(b => b.grant_id === before.grants.find(g => g.object_path === ordinary.path).id));
  assert.deepEqual((await allBindings(db)).grantClaims.map(row => row.grant_id).sort(), before.grants.map(row => row.id).sort(),
    "all legacy grant UUIDs receive immutable claims, including unmanaged grants");
});

gated("bootstrap refuses mismatched attempt/grant snapshots atomically without partial tables or function changes", async t => {
  const db = await identityFixture(t, { applyIdentity: false }), r = next(20);
  await reserve(db, r); await begin(db, r); await object(db, r); await authorize(db, r);
  for (const [table, field, changed, original] of [
    ["bot_media_upload_attempts", "object_path", r.path + ".drift", r.path],
    ["bot_media_upload_attempts", "content_sha256", "c".repeat(64), r.digest],
    ["bot_upload_grants", "byte_size", 69, r.size],
    ["bot_upload_grants", "chat_id", uuid(11), r.chat],
  ]) {
    await trusted(db, `update private.${table} set ${field}=${quote(changed)};`);
    const before = await snapshot(db), functions = await functionCatalog(db);
    await refused(db.exec(identitySource()));
    assert.deepEqual(await snapshot(db), before);
    assert.deepEqual(await functionCatalog(db), functions);
    await noIdentityTables(db);
    await trusted(db, `update private.${table} set ${field}=${quote(original)};`);
  }
  await db.exec(identitySource());
  assertSnapshot(await identityFor(db, r), r, await receipt(db, r));
});

gated("registry is uniquely keyed and bindings have no lease or prunable-grant dependency", async t => {
  const db = await identityFixture(t), r = next(30);
  await reserve(db, r); await begin(db, r); await object(db, r); await authorize(db, r);
  const schema = await db.query(`select c.relname,a.attname,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    where n.nspname='private' and c.relname in ('bot_media_object_identities','bot_media_attempt_bindings','bot_media_grant_bindings')
      and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum`);
  assert.equal(schema.find(row => row.relname === "bot_media_object_identities" && row.attname === "generation_id").type, "uuid");
  assert.equal(schema.find(row => row.relname === "bot_media_attempt_bindings" && row.attname === "attempt_id").type, "uuid");
  assert.equal(schema.find(row => row.relname === "bot_media_grant_bindings" && row.attname === "issued_at").type, "timestamp with time zone");
  assert.ok(schema.every(row => !/lease/.test(row.attname)), "logical identity is not rotating lease identity");
  const keys = await db.query(`select conrelid::regclass::text as relation,contype,
    pg_get_constraintdef(oid) as definition,confrelid::regclass::text as target from pg_constraint
    where conrelid in ('private.bot_media_object_identities'::regclass,'private.bot_media_attempt_bindings'::regclass,
      'private.bot_media_grant_bindings'::regclass) order by 1,2,3`);
  for (const [relation, definition] of [
    ["private.bot_media_object_identities", "PRIMARY KEY (generation_id)"],
    ["private.bot_media_attempt_bindings", "PRIMARY KEY (attempt_id)"],
    ["private.bot_media_grant_bindings", "PRIMARY KEY (grant_id)"],
  ]) assert.ok(keys.some(row => row.relation === relation && row.definition === definition));
  const bindingFKs = keys.filter(row => row.relation.includes("bindings") && row.contype === "f");
  assert.ok(bindingFKs.every(row => ["private.bot_media_object_identities", "private.bot_media_grant_claims"].includes(row.target)),
    "bindings survive prunable attempts/grants and rotating leases");
  assert.equal(bindingFKs.filter(row => row.target === "private.bot_media_object_identities").length, 2);
  assert.equal(bindingFKs.filter(row => row.target === "private.bot_media_grant_claims").length, 1);
  for (const change of ["generation_id=gen_random_uuid()", "generation_id=gen_random_uuid(),object_path=object_path||'.new'",
    "generation_id=gen_random_uuid(),idempotency_key=idempotency_key||'-new'"]) {
    const fields = schema.filter(row => row.relname === "bot_media_object_identities").map(row => row.attname);
    const replacements = Object.fromEntries(change.split(",").map(part => part.split(/=(.*)/s).slice(0, 2)));
    await assert.rejects(trusted(db, `insert into private.bot_media_object_identities(${fields.join(",")})
      select ${fields.map(field => replacements[field] ?? field).join(",")} from private.bot_media_object_identities;`),
      { code: "23505" });
  }
});

gated("receipt immutable fields and original accounting resist owner UPDATE DELETE TRUNCATE while leases remain mutable", async t => {
  const db = await identityFixture(t), r = next(40); await reserve(db, r);
  const before = await receipt(db, r), binding = await allBindings(db);
  for (const [field, changed] of Object.entries({ bot_id: uuid(10), idempotency_key: "changed-operation", chat_id: uuid(11),
    method: "sendPhoto", request_fingerprint: "f".repeat(64), object_path: r.path + ".new", content_type: "image/png",
    byte_size: 69, content_sha256: "c".repeat(64), created_at: "2000-01-01" })) {
    await refused(trusted(db, `update private.bot_media_ingests set ${field}=${quote(changed)};`));
    assert.deepEqual(await receipt(db, r), before, "immutable receipt column " + field);
  }
  for (const sql of ["delete from private.bot_media_ingests;", "truncate private.bot_media_ingests;"]) {
    await refused(trusted(db, sql)); assert.deepEqual(await receipt(db, r), before);
  }
  await trusted(db, "update private.bot_media_ingests set lease_expires_at=clock_timestamp()-interval '1 second';");
  assert.deepEqual(await allBindings(db), binding);
});

gated("attempt immutable snapshots and indefinite pending/unknown holds cannot be rewritten removed or truncated", async t => {
  const db = await identityFixture(t), r = next(50); await reserve(db, r); await begin(db, r);
  const before = await attempts(db);
  for (const [field, changed] of Object.entries({ bot_id: uuid(10), idempotency_key: "changed-operation", attempt_id: uuid(555),
    owner_token_id: uuid(12), chat_id: uuid(11), request_fingerprint: "f".repeat(64), object_path: r.path + ".new",
    content_type: "image/png", byte_size: 69, content_sha256: "c".repeat(64), started_at: "2000-01-01" })) {
    await refused(trusted(db, `update private.bot_media_upload_attempts set ${field}=${quote(changed)};`));
    assert.deepEqual(await attempts(db), before, "immutable attempt column " + field);
  }
  await finish(db, r, "unknown"); const unknown = await attempts(db);
  for (const sql of ["delete from private.bot_media_upload_attempts;", "truncate private.bot_media_upload_attempts;"]) {
    await refused(trusted(db, sql)); assert.deepEqual(await attempts(db), unknown);
  }
  assert.equal(unknown[0].state, "unknown"); assert.notEqual(unknown[0].observed_at, null);
});

gated("private registries and bindings retain forever under owner no-op/update/delete/truncate attempts", async t => {
  const db = await identityFixture(t), r = next(60);
  await reserve(db, r); await begin(db, r); await object(db, r); await authorize(db, r);
  const before = await allBindings(db);
  for (const table of identityTables) {
    const key = table === "bot_media_path_claims" ? "object_path" : table === "bot_media_grant_claims" ? "grant_id" : "generation_id";
    for (const sql of [`update private.${table} set ${key}=${key};`, `delete from private.${table};`, `truncate private.${table} cascade;`]) {
      await refused(trusted(db, sql)); assert.deepEqual(await allBindings(db), before);
    }
  }
});

gated("same logical UUID spans token/lease takeover old and new attempts grants commit and duplicate retry", async t => {
  const db = await identityFixture(t), r = next(70); await reserve(db, r); await begin(db, r);
  const originalReceipt = await receipt(db, r), identity = await identityFor(db, r);
  await object(db, r); const firstGrant = await authorize(db, r);
  await finish(db, r, "unknown");
  await trusted(db, `insert into private.bot_tokens(id,bot_id) values ('${uuid(701)}','${r.bot}');`);
  const fresh = await rotate(db, r, uuid(702), uuid(701)); await begin(db, fresh); await finish(db, fresh);
  await trusted(db, `update private.bot_upload_grants set consumed_at=clock_timestamp() where id='${firstGrant.grant_id}';`);
  const secondGrant = await authorize(db, fresh);
  assert.notEqual(secondGrant.grant_id, firstGrant.grant_id);
  const result = await commit(db, fresh);
  assert.deepEqual(await identityFor(db, r), identity);
  assert.notEqual(identity.generation_id, r.lease); assert.notEqual(identity.generation_id, fresh.lease);
  assertSnapshot(identity, r, originalReceipt);
  const rows = await attemptBindings(db);
  assert.deepEqual(rows.map(row => row.attempt_id).sort(), [r.lease, fresh.lease].sort());
  assert.ok(rows.every(row => row.generation_id === identity.generation_id));
  assert.ok((await grantBindings(db)).every(row => row.generation_id === identity.generation_id));
  assert.equal((await grantBindings(db)).length, 2);
  const complete = await receipt(db, r);
  assert.equal(complete.created_at, originalReceipt.created_at); assert.equal(complete.byte_size, 68);
  assert.equal(complete.state, "complete"); assert.deepEqual(complete.result, result.result);
  const bindings = await allBindings(db), charged = await snapshot(db);
  assert.equal((await reserve(db, { ...fresh, lease: uuid(703) })).duplicate, true);
  assert.equal((await commit(db, fresh)).duplicate, true);
  assert.deepEqual(await snapshot(db), charged); assert.deepEqual(await allBindings(db), bindings);
  assert.deepEqual((await attempts(db)).map(row => row.state).sort(), ["acknowledged", "unknown"]);
});

gated("managed grant snapshot freezes while consumption and expired-grant pruning retain issuance bindings", async t => {
  const db = await identityFixture(t), r = next(80);
  await reserve(db, r); await object(db, r);
  const first = await authorize(db, r), stored = await grants(db), bindings = await grantBindings(db);
  for (const [field, changed] of Object.entries({ id: uuid(801), bot_id: uuid(10), chat_id: uuid(11), bucket_id: "media",
    object_path: r.path + ".new", content_type: "image/png", byte_size: 69, created_at: "2000-01-01" })) {
    await refused(trusted(db, `update private.bot_upload_grants set ${field}=${quote(changed)};`));
    assert.deepEqual(await grants(db), stored, "managed grant snapshot " + field);
  }
  await trusted(db, `update private.bot_upload_grants set consumed_at=clock_timestamp() where id='${first.grant_id}';`);
  await trusted(db, "delete from private.bot_upload_grants where consumed_at is not null;");
  assert.deepEqual(await grantBindings(db), bindings, "binding must outlive consumed grant cleanup");
  await refused(trusted(db, `insert into private.bot_upload_grants(id,bot_id,chat_id,bucket_id,object_path,content_type,byte_size,expires_at)
    values ('${first.grant_id}','${r.bot}','${r.chat}','chat-media',${quote(r.path + ".ordinary")},${quote(r.mime)},68,
      clock_timestamp()+interval '120 seconds');`));
  assert.deepEqual(await grantBindings(db), bindings, "pruning cannot make a historically bound grant UUID reusable");
  const second = { grant_id: uuid(802) };
  await trusted(db, `insert into private.bot_upload_grants(id,bot_id,chat_id,bucket_id,object_path,content_type,byte_size,created_at,expires_at)
    values ('${second.grant_id}','${r.bot}','${r.chat}','chat-media',${quote(r.path)},${quote(r.mime)},68,
      clock_timestamp()-interval '121 seconds',clock_timestamp()-interval '1 second');`);
  const third = await authorize(db, r);
  assert.notEqual(second.grant_id, third.grant_id);
  assert.equal((await grants(db)).length, 1); assert.equal((await grantBindings(db)).length, 3);
  assert.ok((await grantBindings(db)).every(row => row.generation_id === bindings[0].generation_id));
  const retained = await grantBindings(db);
  await trusted(db, "truncate private.bot_upload_grants;");
  assert.deepEqual(await grantBindings(db), retained, "bindings have no dependency on a prunable grant table");
});

gated("ordinary grants preserve updates expiry prune and reissue but cannot later be adopted as ingest", async t => {
  const db = await identityFixture(t), r = next(90); await object(db, r);
  const first = await authorize(db, r);
  await trusted(db, `update private.bot_upload_grants set id='${uuid(902)}',byte_size=69,expires_at=clock_timestamp()-interval '1 second'
    where id='${first.grant_id}';`);
  const second = await authorize(db, r);
  assert.notEqual(first.grant_id, second.grant_id); assert.equal((await grants(db)).length, 1);
  assert.deepEqual(await identities(db), []); assert.deepEqual(await grantBindings(db), []);
  assert.deepEqual((await allBindings(db)).grantClaims.map(row => row.grant_id).sort(),
    [first.grant_id, uuid(902), second.grant_id].sort(), "ordinary UUID update and reissue retain each old/new UUID claim");
  const before = await snapshot(db), bindings = await allBindings(db);
  await refused(reserve(db, r));
  assert.deepEqual(await snapshot(db), before); assert.deepEqual(await allBindings(db), bindings);
  assert.equal(bindings.claims[0].claim_kind, "unmanaged");
});

gated("receipt-first grant is managed and its binding survives even when no attempt has begun", async t => {
  const db = await identityFixture(t), r = next(100); await reserve(db, r); await object(db, r);
  const issued = await authorize(db, r), identity = await identityFor(db, r);
  assert.deepEqual(await attempts(db), []);
  assert.equal((await grantBindings(db))[0].grant_id, issued.grant_id);
  assert.equal((await grantBindings(db))[0].generation_id, identity.generation_id);
  assert.equal((await allBindings(db)).claims[0].claim_kind, "ingest");
});

gated("private base and identity ledgers deny raw anon authenticated and service-role access", async t => {
  const db = await identityFixture(t), r = next(110);
  await reserve(db, r); await begin(db, r); await object(db, r); await authorize(db, r);
  await db.exec("grant usage on schema private to anon,authenticated,service_role;");
  const tables = [...identityTables, "bot_media_ingests", "bot_media_upload_attempts", "bot_upload_grants"];
  for (const role of ["anon", "authenticated", "service_role"]) for (const table of tables) {
    for (const sql of [`select * from private.${table};`, `insert into private.${table} default values;`,
      `delete from private.${table};`, `truncate private.${table};`]) await deniedAccess(db.exec(`set role ${role}; ${sql}`));
    const field = table === "bot_media_grant_claims" ? "grant_id" : ["bot_media_path_claims", "bot_upload_grants"].includes(table) ? "object_path" :
      table.includes("bindings") || table === "bot_media_object_identities" ? "generation_id" : "bot_id";
    await deniedAccess(db.exec(`set role ${role}; update private.${table} set ${field}=${field};`));
    await deniedAccess(db.exec(`set role ${role}; select ${field} from private.${table};`));
  }
  const states = await db.query(`select relname,relrowsecurity,relowner::regrole::text as owner from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and relname in (${identityTables.map(quote).join(",")})`);
  assert.equal(states.length, 5); assert.ok(states.every(row => row.relrowsecurity && row.owner === "postgres"));
});

gated("grant-first concurrent path claim blocks later ingest without any successful unbound managed grant", async t => {
  const db = await identityFixture(t), r = next(120); await object(db, r);
  const writer = db.session(), ingest = db.session();
  await writer.send(`begin; set local role service_role; ${authorizeSql(r)};`);
  const pid = Number(await ingest.send("select pg_backend_pid();"));
  const refusal = refused(ingest.send(`set role service_role; ${reserveSql(r)};`));
  await waitForLock(db, pid); await writer.send("commit;"); await refusal;
  assert.equal((await grants(db)).length, 1); assert.deepEqual(await identities(db), []); assert.deepEqual(await grantBindings(db), []);
  assert.equal((await allBindings(db)).claims[0].claim_kind, "unmanaged");
  assert.equal((await snapshot(db)).receipts.length, 0);
});

gated("receipt-first concurrent path claim makes grant bind the admitted generation after actual wait", async t => {
  const db = await identityFixture(t), r = next(130); await object(db, r);
  const ingest = db.session(), issuer = db.session();
  await ingest.send(`begin; set local role service_role; ${reserveSql(r)};`);
  const pid = Number(await issuer.send("select pg_backend_pid();"));
  const issuance = issuer.send(`set role service_role; ${authorizeSql(r)};`);
  await waitForLock(db, pid); await ingest.send("commit;"); await issuance;
  assert.equal((await grants(db)).length, 1); assert.equal((await grantBindings(db)).length, 1);
  assert.equal((await grantBindings(db))[0].generation_id, (await identityFor(db, r)).generation_id);
  assert.equal((await allBindings(db)).claims[0].claim_kind, "ingest");
});

gated("bootstrap locks existing writers and includes their committed snapshots before backfill", async t => {
  const db = await identityFixture(t, { applyIdentity: false }), r = next(140);
  const writer = db.session(), installer = db.session();
  await writer.send(`begin; set local role service_role; ${reserveSql(r)}; ${beginSql(r)};`);
  await installer.send("set default_transaction_isolation='repeatable read';");
  const pid = Number(await installer.send("select pg_backend_pid();"));
  let sql = identitySource();
  if (process.env.BOT_MEDIA_IDENTITY_BOOTSTRAP_BASELINE === "1") {
    const original = sql;
    sql = sql.replace("SET TRANSACTION ISOLATION LEVEL READ COMMITTED;", "-- pre-isolation proposal: use session default")
      .replace(/IF current_setting\('transaction_isolation'\)<>'read committed' THEN[\s\S]*?END IF;/,
        "-- pre-isolation proposal: no isolation assertion");
    assert.notEqual(sql, original, "baseline must restore the pre-fix bootstrap isolation behavior");
  }
  const install = installer.send(sql);
  await waitForLock(db, pid, "private.bot_media_ingests");
  await writer.send("commit;"); await install;
  assertSnapshot(await identityFor(db, r), r, await receipt(db, r));
  assert.equal((await attemptBindings(db))[0].generation_id, (await identityFor(db, r)).generation_id);
  assert.equal((await attempts(db))[0].state, "pending");
});

gated("REPEATABLE READ conflicts refuse invisible path claims rather than issue an unbound grant or receipt", async t => {
  const db = await identityFixture(t);
  for (const [n, first] of [[150, "grant"], [151, "receipt"]]) {
    const r = next(n); await object(db, r);
    const writer = db.session(), loser = db.session();
    await writer.send(`begin; set local role service_role; ${first === "grant" ? authorizeSql(r) : reserveSql(r)};`);
    await loser.send("begin isolation level repeatable read; set local statement_timeout='10s'; set local role service_role; select count(*) from storage.objects;");
    const pid = Number(await loser.send("select pg_backend_pid();"));
    const conflict = assert.rejects(loser.send((first === "grant" ? reserveSql(r) : authorizeSql(r)) + ";"), { code: "40001" });
    await waitForLock(db, pid); await writer.send("commit;"); await conflict;
    const graph = await allBindings(db), stored = await snapshot(db);
    if (first === "grant") {
      assert.ok(!stored.receipts.some(row => row.idempotency_key === r.key));
      assert.ok(!graph.identities.some(row => row.idempotency_key === r.key));
      const g = stored.grants.find(row => row.object_path === r.path);
      assert.ok(g); assert.ok(!graph.grants.some(row => row.grant_id === g.id));
      assert.equal(graph.claims.find(row => row.object_path === r.path).claim_kind, "unmanaged");
    } else {
      assert.ok(!stored.grants.some(row => row.object_path === r.path));
      const issued = await authorize(db, r);
      assert.equal((await grantBindings(db)).find(row => row.grant_id === issued.grant_id).generation_id,
        (await identityFor(db, r)).generation_id);
    }
  }
});

gated("new attempt/grant snapshot mismatches fail atomically instead of creating unbound managed rows", async t => {
  const db = await identityFixture(t), r = next(160);
  await reserve(db, r); await begin(db, r); await object(db, r);
  const charged = await snapshot(db), graph = await allBindings(db);
  await refused(trusted(db, `insert into private.bot_media_upload_attempts(bot_id,idempotency_key,attempt_id,owner_token_id,chat_id,
    request_fingerprint,object_path,content_type,byte_size,content_sha256,state,started_at)
    select bot_id,idempotency_key,'${uuid(1601)}',owner_token_id,chat_id,request_fingerprint,object_path||'.wrong',
      content_type,byte_size,content_sha256,'pending',clock_timestamp() from private.bot_media_upload_attempts;`));
  assert.deepEqual(await snapshot(db), charged); assert.deepEqual(await allBindings(db), graph);
  for (const changes of [ { bot: uuid(10) }, { chat: uuid(11) }, { mime: "image/png" }, { size: 69 } ]) {
    const wrong = { ...r, ...changes };
    await refused(trusted(db, `insert into private.bot_upload_grants(bot_id,chat_id,bucket_id,object_path,content_type,byte_size,expires_at)
      values ('${wrong.bot}','${wrong.chat}','chat-media',${quote(r.path)},${quote(wrong.mime)},${wrong.size},clock_timestamp()+interval '120 seconds');`));
    assert.deepEqual(await snapshot(db), charged); assert.deepEqual(await allBindings(db), graph);
  }
});

gated("complete receipts and terminal attempts freeze all result/state fields while repeated finish is idempotent", async t => {
  const db = await identityFixture(t), r = next(170);
  await reserve(db, r); await begin(db, r); await finish(db, r, "unknown"); await object(db, r); await commit(db, r);
  const complete = await receipt(db, r), terminal = await attempts(db), graph = await allBindings(db);
  for (const change of ["owner_token_id='" + uuid(12) + "'", "lease_id='" + uuid(1701) + "'",
    "lease_expires_at='2000-01-01'", "result='{}'::jsonb", "completed_at='2000-01-01'",
    "state='reserved',result=null,completed_at=null"]) {
    await refused(trusted(db, `update private.bot_media_ingests set ${change};`));
    assert.deepEqual(await receipt(db, r), complete);
  }
  for (const change of ["state='acknowledged'", "observed_at='2000-01-01'", "state='pending',observed_at=null"]) {
    await refused(trusted(db, `update private.bot_media_upload_attempts set ${change};`));
    assert.deepEqual(await attempts(db), terminal);
  }
  assert.deepEqual(await finish(db, r, "unknown"), { attempt_id: r.lease, state: "unknown" });
  assert.deepEqual(await attempts(db), terminal); assert.deepEqual(await receipt(db, r), complete);
  assert.deepEqual(await allBindings(db), graph);
});

gated("unmanaged grant cannot be promoted onto an existing managed path by trusted UPDATE", async t => {
  const db = await identityFixture(t), managed = next(180), ordinary = next(181);
  await reserve(db, managed); await object(db, ordinary); await authorize(db, ordinary);
  const before = await snapshot(db), graph = await allBindings(db);
  await refused(trusted(db, `update private.bot_upload_grants set object_path=${quote(managed.path)};`));
  assert.deepEqual(await snapshot(db), before); assert.deepEqual(await allBindings(db), graph);
});

gated("safe rollback pauses only new ingest RPCs while retaining identity guards outcomes ordinary grants and charged rows", async t => {
  const db = await identityFixture(t), r = next(190);
  await reserve(db, r); await begin(db, r); await object(db, r); await authorize(db, r);
  const before = await snapshot(db), graph = await allBindings(db);
  await db.exec(identityRollback());
  assert.deepEqual(await snapshot(db), before); assert.deepEqual(await allBindings(db), graph);
  for (const operation of [() => reserve(db, next(191)), () => begin(db, r), () => commit(db, r)]) await deniedAccess(operation());
  assert.deepEqual(await snapshot(db), before); assert.deepEqual(await allBindings(db), graph);
  await finish(db, r, "unknown");
  assert.equal((await attempts(db))[0].state, "unknown");
  assert.deepEqual(await receipt(db, r), before.receipts[0]); assert.deepEqual(await allBindings(db), graph);
  const ordinary = next(192); await object(db, ordinary); await authorize(db, ordinary);
  assert.ok((await grants(db)).some(row => row.object_path === ordinary.path));
  assert.equal((await grantBindings(db)).length, 1);
  await refused(trusted(db, "delete from private.bot_media_ingests;"));
  await refused(db.exec(identitySource()), "bot_media_identity_prestate_exists");
  assert.deepEqual(await identities(db), graph.identities);
});

gated("receipt and attempt guard omission mutants are caught by unchanged-snapshot literal oracles", async t => {
  const sql = mutateFunction(mutateFunction(identitySource(), "bot_media_identity_receipt_guard",
    () => "\nBEGIN RETURN NEW; END\n"), "bot_media_identity_attempt_guard", () => "\nBEGIN RETURN NEW; END\n");
  const db = await identityFixture(t, { sql }), r = next(200);
  await reserve(db, r); await begin(db, r);
  const beforeReceipt = await receipt(db, r), beforeAttempts = await attempts(db);
  await trusted(db, `update private.bot_media_ingests set object_path=object_path||'.mutant';
    update private.bot_media_upload_attempts set object_path=object_path||'.mutant';`);
  const afterReceipt = await receipt(db, r), afterAttempts = await attempts(db);
  assert.equal(afterReceipt.object_path, r.path + ".mutant");
  assert.equal(afterAttempts[0].object_path, r.path + ".mutant");
  assert.throws(() => assert.deepEqual(afterReceipt, beforeReceipt), { name: "AssertionError" });
  assert.throws(() => assert.deepEqual(afterAttempts, beforeAttempts), { name: "AssertionError" });
});

gated("managed grant binding omission mutant fails the literal one-binding issuance oracle", async t => {
  const sql = mutateFunction(identitySource(), "bot_media_identity_grant", body => body.replace(
    /INSERT INTO private\.bot_media_grant_bindings VALUES \(NEW\.id,i\.generation_id,NEW\.created_at\);/,
    "-- fixture omission: grant binding was not recorded"));
  const db = await identityFixture(t, { sql }), r = next(210);
  await reserve(db, r); await object(db, r); const issued = await authorize(db, r);
  assert.ok((await grants(db)).some(row => row.id === issued.grant_id), "real managed issuance succeeds under mutant");
  const bindings = await grantBindings(db);
  assert.equal(bindings.length, 0);
  assert.throws(() => assert.equal(bindings.length, 1, "one immutable binding for the newly issued managed grant"),
    { name: "AssertionError" });
});

gated("path reuse guard omission alone stays blocked by the independent ingest-claim FK", async t => {
  const sql = mutateFunction(identitySource(), "bot_media_identity_receipt_insert", body => body.replace(
    /IF kind<>'ingest' THEN[\s\S]*?END IF;/, "-- fixture omission: no explicit path reuse refusal"));
  const db = await identityFixture(t, { sql }), r = next(220);
  await object(db, r); await authorize(db, r);
  await assert.rejects(reserve(db, r), { code: "23503" });
  assert.equal((await snapshot(db)).receipts.length, 0);
  assert.equal((await identities(db)).length, 0);
});

gated("combined path-kind guard and FK weakening is caught by the literal zero-adopted-receipts oracle", async t => {
  const original = mutateFunction(identitySource(), "bot_media_identity_receipt_insert", body => body.replace(
    /IF kind<>'ingest' THEN[\s\S]*?END IF;/, "-- fixture omission: no explicit path reuse refusal"));
  const sql = original.replace(/FOREIGN KEY \(bucket_id,object_path,claim_kind\)\s+REFERENCES private\.bot_media_path_claims\(bucket_id,object_path,claim_kind\)/,
    "FOREIGN KEY (bucket_id,object_path) REFERENCES private.bot_media_path_claims(bucket_id,object_path)");
  assert.notEqual(sql, original, "combined mutant must also weaken the independent kind FK");
  const db = await identityFixture(t, { sql }), r = next(230);
  await object(db, r); const ordinary = await authorize(db, r); await reserve(db, r);
  const stored = await snapshot(db), graph = await allBindings(db);
  assert.equal(stored.receipts.length, 1, "the mutant really adopts a prior ordinary grant's path");
  assert.equal(graph.identities.length, 1);
  assert.equal(graph.claims[0].claim_kind, "unmanaged");
  assert.ok(!graph.grants.some(row => row.grant_id === ordinary.grant_id));
  assert.throws(() => assert.equal(stored.receipts.length, 0, "ordinary paths must never be adopted as managed ingress"),
    { name: "AssertionError" });
});

gated("old RR snapshot cannot reuse a concurrently issued and pruned managed grant UUID for an unmanaged object", async t => {
  let sql = identitySource();
  if (process.env.BOT_MEDIA_IDENTITY_GRANT_REUSE_BASELINE === "1") {
    sql = mutateFunction(sql, "bot_media_identity_grant", body => body.replace(
      "INSERT INTO private.bot_media_grant_claims VALUES (NEW.id);", "-- pre-claim proposal: no retained UUID arbitration").replace(
      /IF TG_OP='UPDATE' THEN\s+PERFORM 1 FROM private\.bot_media_grant_claims WHERE grant_id=OLD\.id;[\s\S]*?END IF;\s+END IF;/,
      "-- pre-claim proposal: no later OLD-claim visibility guard"));
    const before = sql;
    sql = sql.replace("grant_id uuid PRIMARY KEY REFERENCES private.bot_media_grant_claims(grant_id)", "grant_id uuid PRIMARY KEY");
    assert.notEqual(sql, before, "pre-claim baseline has no FK to the new UUID claim registry");
  }
  const db = await identityFixture(t, { sql }), r = next(240);
  await reserve(db, r); await object(db, r);
  const old = db.session(), issuer = db.session();
  await old.send("begin isolation level repeatable read; set local statement_timeout='10s'; select count(*) from storage.objects;");
  const issued = JSON.parse(await issuer.send("begin; set local role service_role; " +
    authorizeSql(r).replace("select * from ", "select to_jsonb(g) from ") + " g;"));
  await issuer.send(`reset role; set local role postgres;
    update private.bot_upload_grants set consumed_at=clock_timestamp() where id='${issued.grant_id}';
    delete from private.bot_upload_grants where id='${issued.grant_id}'; commit;`);
  const graph = await allBindings(db), charged = await snapshot(db);
  assert.equal(graph.grants.length, 1, "managed issuance binding survives actual pruning");
  assert.equal(graph.grants[0].generation_id, (await identityFor(db, r)).generation_id);
  assert.equal(charged.grants.length, 0);
  await assert.rejects(old.send(`set local role postgres;
    insert into private.bot_upload_grants(id,bot_id,chat_id,bucket_id,object_path,content_type,byte_size,expires_at)
    values ('${issued.grant_id}','${r.bot}','${r.chat}','media','fixture-unmanaged-new-path','application/pdf',68,
      clock_timestamp()+interval '120 seconds'); commit;`), { code: "23505" },
    "old snapshot must not commit UUID reuse after managed grant prune");
  assert.deepEqual(await allBindings(db), graph); assert.deepEqual(await snapshot(db), charged);
});

gated("pre-bootstrap RR snapshot must retry instead of rewriting a managed legacy grant as ordinary", async t => {
  const db = await identityFixture(t, { applyIdentity: false }), r = next(250);
  await reserve(db, r); await object(db, r); const legacy = await authorize(db, r);
  const old = db.session();
  await old.send("begin isolation level repeatable read; set local statement_timeout='10s'; select count(*) from public.messages;");
  let sql = identitySource();
  if (process.env.BOT_MEDIA_IDENTITY_LEGACY_UPDATE_BASELINE === "1") {
    sql = mutateFunction(sql, "bot_media_identity_grant", body => body.replace(
      /IF TG_OP='UPDATE' THEN\s+PERFORM 1 FROM private\.bot_media_grant_claims WHERE grant_id=OLD\.id;[\s\S]*?END IF;\s+END IF;/,
      "-- pre-visibility proposal: OLD UUID claim is not required to be visible"));
  }
  await db.exec(sql);
  const graph = await allBindings(db), charged = await snapshot(db);
  assert.equal(graph.grants[0].grant_id, legacy.grant_id);
  assert.equal(graph.grants[0].generation_id, (await identityFor(db, r)).generation_id);
  await assert.rejects(old.send(`set local role postgres;
    update private.bot_upload_grants set object_path=${quote(r.path + ".ordinary")} where id='${legacy.grant_id}'; commit;`),
    { code: "40001" }, "invisible bootstrap claims must not classify a managed legacy grant as ordinary");
  assert.deepEqual(await allBindings(db), graph); assert.deepEqual(await snapshot(db), charged);
});
