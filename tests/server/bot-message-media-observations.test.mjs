import assert from "node:assert/strict";
import test from "node:test";
import {
  observationFixture, known, references, observation, mediaUrl, uuid,
  authenticated, messageInsert, observations, trusted, actor, outsider, quote,
  table, signature, registered, previewPath, allObservations, legacyState,
  observationSource, observationRollback, mutateInstalled, omitResolverArgument,
  snapshot, allBindings, installForward, session, waitForRelation, waitForGate, settled,
} from "./bot-message-media-observations.fixture.mjs";

test("persisted observations follow the known resolver and permitted message write positive controls", async t => {
  const db = await observationFixture(t), a = await known(db, 40), id = uuid(7100);
  t.diagnostic("actual local PostgreSQL " + db.version + "; fictional focused fixture, not production");
  const expected = [
    observation("canonical", "chat-media", a.receipt.path, a.identity.generation_id, "registered", null),
    observation("legacy_url", "chat-media", a.receipt.path, a.identity.generation_id, "registered", null),
  ];
  assert.deepEqual(await references(db, { bucket: "chat-media", path: a.receipt.path, url: mediaUrl(a.receipt.path) }), expected,
    "accepted resolver positive control must resolve both known pointers before feature RED");
  const sourceId = uuid(7101);
  await trusted(db, messageInsert(sourceId, { path: a.receipt.path }) + ";");
  await authenticated(db, messageInsert(id, { path: a.receipt.path, url: mediaUrl(a.receipt.path), forward: sourceId }) + ";");
  assert.equal((await db.query(`select count(*)::int as n from public.messages where id='${id}'`))[0].n, 1,
    "authenticated message INSERT must succeed before checking the new persistence feature");
  t.diagnostic("positive controls: resolver returned 2 registered references; authenticated INSERT persisted 1 fictional row");
  assert.deepEqual(await observations(db, id), expected,
    "feature-gap RED: persisted observation set must contain 2 known references, not absent-table []");
});

test("state constraints refuse unresolved or ambiguous observations with NULL hold_reason", async t => {
  const db = await observationFixture(t);
  await trusted(db, `insert into ${table}(message_id,source_kind,bucket_id,object_path,reference_state,hold_reason)
    values ('${uuid(7112)}','canonical','media','fictional-object','unresolved','unregistered_object');`);
  for (const state of ["unresolved", "ambiguous"]) {
    await assert.rejects(trusted(db, `insert into ${table}(message_id,source_kind,bucket_id,object_path,reference_state,hold_reason)
      values ('${uuid(7113)}','canonical','media','fictional-object','${state}',null);`),
    { code: "23514" }, state + " must have an explicit nonnull hold rather than pass CHECK via UNKNOWN");
  }
});

test("authenticated URL-only and preview-only UPDATE observe all final fields without broadening ownership", async t => {
  const db = await observationFixture(t), a = await known(db, 41), id = uuid(7120);
  const path = actor + "/fictional-original.pdf", preview = previewPath(path);
  await authenticated(db, messageInsert(id, { bucket: "media", path }) + ";");
  assert.deepEqual(await observations(db, id), [observation("canonical", "media", path)]);
  await authenticated(db, `update public.messages set media_url=${quote(mediaUrl(a.receipt.path))} where id='${id}';`);
  const expected = [
    observation("canonical", "media", path, null, "ambiguous", "conflicting_pointers"),
    observation("legacy_url", "chat-media", a.receipt.path, a.identity.generation_id, "ambiguous", "conflicting_pointers"),
  ];
  assert.deepEqual(await observations(db, id), expected);
  await authenticated(db, `update public.messages set media_metadata=${quote(JSON.stringify({ preview: { path: preview, bucket: "ignored" } }))}::jsonb where id='${id}';`);
  assert.deepEqual(await observations(db, id), [...expected, observation("preview", "media", preview)]);
  await authenticated(db, `update public.messages set media_url=null,media_metadata=null where id='${id}';`);
  assert.deepEqual(await observations(db, id), [observation("canonical", "media", path)]);
  await authenticated(db, `update public.messages set media_bucket=null,media_path=null where id='${id}';`);
  assert.deepEqual(await observations(db, id), [], "empty current observations is not cleanup authority");
});

test("existing RLS and real path guard still reject forged writes and hide unauthorized UPDATE", async t => {
  const db = await observationFixture(t), a = await known(db, 42), id = uuid(7121);
  await authenticated(db, messageInsert(id, { bucket: "media", path: actor + "/mine.pdf" }) + ";");
  const before = await allObservations(db);
  await assert.rejects(authenticated(db, messageInsert(uuid(7122), { user: outsider, path: outsider + "/forbidden.pdf" }) + ";", outsider), { code: "42501" });
  await assert.rejects(authenticated(db, messageInsert(uuid(7123), { path: a.receipt.path }) + ";"), error =>
    error.code === "42501" && error.message.includes("message_media_path_not_owned"));
  await assert.rejects(authenticated(db, messageInsert(uuid(7124), { user: outsider, path: null }) + ";"), { code: "42501" });
  const updated = await authenticated(db, `with changed as (update public.messages set media_url='unsupported' where id='${id}' returning id)
    select count(*) from changed;`, outsider);
  assert.equal(updated, "0", "unauthorized UPDATE is an actual RLS zero-row operation, not a definer bypass");
  assert.deepEqual(await allObservations(db), before);
  assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n, 1);
});

test("full conflicting set and independent malformed or unsupported holds survive trusted writes", async t => {
  const db = await observationFixture(t), a = await known(db, 43), b = await known(db, 44), id = uuid(7130);
  const preview = previewPath(a.receipt.path);
  await trusted(db, messageInsert(id, { path: a.receipt.path, url: mediaUrl(b.receipt.path),
    metadata: { preview: { path: preview, bucket: "foreign-preview-bucket" } } }) + ";");
  assert.deepEqual(await observations(db, id), [
    observation("canonical", "chat-media", a.receipt.path, a.identity.generation_id, "ambiguous", "conflicting_pointers"),
    observation("legacy_url", "chat-media", b.receipt.path, b.identity.generation_id, "ambiguous", "conflicting_pointers"),
    observation("preview", "chat-media", preview),
  ]);
  await trusted(db, `update public.messages set media_url='unsupported',media_metadata='{"preview":{}}'::jsonb where id='${id}';`);
  assert.deepEqual(await observations(db, id), [
    registered("canonical", a),
    observation("legacy_url", null, null, null, "unresolved", "unsupported_url"),
    observation("preview", "chat-media", null, null, "unresolved", "malformed_metadata"),
  ]);
  await trusted(db, `update public.messages set media_bucket=null,media_path='literal-path',media_url=null,media_metadata='{}'::jsonb where id='${id}';`);
  assert.deepEqual(await observations(db, id), [observation("canonical", null, "literal-path", null, "unresolved", "missing_bucket")]);
  await trusted(db, `update public.messages set media_bucket='avatars',media_path='literal%2Fpath' where id='${id}';`);
  assert.deepEqual(await observations(db, id), [observation("canonical", "avatars", "literal%2Fpath")]);
  assert.equal((await db.query("select count(*)::int as n from storage.objects"))[0].n, 0);
});

test("deleted moderation-retained pointers remain observed and actual final scrub removes only current edges", async t => {
  const db = await observationFixture(t), a = await known(db, 45), id = uuid(7140), report = uuid(7141);
  const preview = previewPath(a.receipt.path);
  await trusted(db, messageInsert(id, { path: a.receipt.path, url: mediaUrl(a.receipt.path), metadata: { preview: { path: preview } } }) + ";");
  const expected = [registered("canonical", a), registered("legacy_url", a), observation("preview", "chat-media", preview)];
  await trusted(db, `insert into public.content_reports values ('${report}','${id}','new');
    update public.messages set deleted_at=clock_timestamp() where id='${id}';`);
  assert.equal((await db.query(`select deleted_at is not null as deleted,media_path from public.messages where id='${id}'`))[0].deleted, true);
  assert.deepEqual(await observations(db, id), expected);
  await trusted(db, `update public.messages set media_url='forbidden-resurrection',media_path='replacement',deleted_at=null where id='${id}';`);
  assert.deepEqual(await observations(db, id), expected, "last BEFORE scrub guard retains moderation evidence rather than NEW payload");
  await trusted(db, `update public.content_reports set status='dismissed' where id='${report}';`);
  assert.deepEqual(await observations(db, id), [], "real report-closure nested UPDATE finishes final scrubbing");
  const [row] = await db.query(`select deleted_at is not null as deleted,media_bucket,media_path,media_url,media_metadata from public.messages where id='${id}'`);
  assert.deepEqual(row, { deleted: true, media_bucket: null, media_path: null, media_url: null, media_metadata: null });
  assert.equal((await db.query(`select count(*)::int as n from private.message_media_purge where message_id='${id}'`))[0].n, 3,
    "existing scrub queueing remains ordinary behavior; observation removal itself performs no purge");
});

test("AFTER ROW nested UPDATE supersedes outer transition values and nested DELETE cannot resurrect edges", async t => {
  const db = await observationFixture(t), a = await known(db, 46), b = await known(db, 47);
  const changed = uuid(7150), removed = uuid(7151);
  await trusted(db, `create function public.fixture_nested_message_write() returns trigger language plpgsql as $$
    begin
      if new.id='${changed}' then update public.messages set media_url=${quote(mediaUrl(b.receipt.path))} where id=new.id;
      elsif new.id='${removed}' then delete from public.messages where id=new.id;
      end if;
      return null;
    end $$;
    create trigger fixture_nested_message_write after insert on public.messages for each row
      execute function public.fixture_nested_message_write();
    ${messageInsert(changed, { path: null, url: mediaUrl(a.receipt.path) })};
    ${messageInsert(removed, { path: a.receipt.path })};`);
  assert.equal((await db.query(`select media_url from public.messages where id='${changed}'`))[0].media_url, mediaUrl(b.receipt.path));
  assert.deepEqual(await observations(db, changed), [registered("legacy_url", b)], "outer INSERT transition image must not overwrite nested final URL");
  assert.equal((await db.query(`select count(*)::int as n from public.messages where id='${removed}'`))[0].n, 0);
  assert.deepEqual(await observations(db, removed), []);
});

test("self-FK nested UPDATE preserves the remaining message and DELETE removes only the deleted ID", async t => {
  const db = await observationFixture(t), a = await known(db, 48), b = await known(db, 49), parent = uuid(7152), child = uuid(7153);
  await trusted(db, messageInsert(parent, { path: a.receipt.path }) + ";" + messageInsert(child, { path: b.receipt.path }) + ";" +
    `update public.messages set reply_to_id='${parent}' where id='${child}'; delete from public.messages where id='${parent}';`);
  assert.equal((await db.query(`select reply_to_id from public.messages where id='${child}'`))[0].reply_to_id, null);
  assert.deepEqual(await observations(db, parent), []);
  assert.deepEqual(await observations(db, child), [registered("canonical", b)]);
});

test("mixed ON CONFLICT INSERT UPDATE and zero-row statements keep exact idempotent current observations", async t => {
  const db = await observationFixture(t), a = await known(db, 50), b = await known(db, 51), existing = uuid(7160), inserted = uuid(7161);
  await trusted(db, messageInsert(existing, { path: a.receipt.path }) + ";");
  await trusted(db, `insert into public.messages(id,chat_id,type,media_bucket,media_path) values
    ('${existing}','${a.receipt.chat}','file','chat-media',${quote(b.receipt.path)}),
    ('${inserted}','${a.receipt.chat}','file','chat-media',${quote(a.receipt.path)})
    on conflict(id) do update set media_path=excluded.media_path;`);
  assert.deepEqual(await observations(db, existing), [registered("canonical", b)]);
  assert.deepEqual(await observations(db, inserted), [registered("canonical", a)]);
  const before = await allObservations(db);
  await trusted(db, messageInsert(existing, { path: a.receipt.path }) + " on conflict(id) do nothing;" +
    "update public.messages set media_url='unsupported' where false; delete from public.messages where false;" +
    "insert into public.messages(chat_id) select '" + a.receipt.chat + "'::uuid where false;");
  assert.deepEqual(await allObservations(db), before, "empty UPDATE/INSERT transition sets and DO NOTHING are no-ops");
  const fresh = uuid(7162);
  await trusted(db, messageInsert(fresh, { path: b.receipt.path }) + " on conflict(id) do update set media_path=excluded.media_path;");
  assert.deepEqual(await observations(db, fresh), [registered("canonical", b)], "ON CONFLICT with no conflict still observes INSERT");
});

test("multirow reversed-object UPDATE and source removal replace only affected current sets", async t => {
  const db = await observationFixture(t), a = await known(db, 52), b = await known(db, 53);
  const x = uuid(7170), y = uuid(7171), untouched = uuid(7172);
  await trusted(db, `insert into public.messages(id,chat_id,type,media_bucket,media_path,media_url) values
    ('${x}','${a.receipt.chat}','file','chat-media',${quote(a.receipt.path)},${quote(mediaUrl(a.receipt.path))}),
    ('${y}','${a.receipt.chat}','file','chat-media',${quote(b.receipt.path)},${quote(mediaUrl(b.receipt.path))}),
    ('${untouched}','${a.receipt.chat}','file','media','unchanged-object',null);
    update public.messages set media_path=case id when '${x}' then ${quote(b.receipt.path)} else ${quote(a.receipt.path)} end,
      media_url=null where id in ('${x}','${y}');`);
  assert.deepEqual(await observations(db, x), [registered("canonical", b)]);
  assert.deepEqual(await observations(db, y), [registered("canonical", a)]);
  assert.deepEqual(await observations(db, untouched), [observation("canonical", "media", "unchanged-object")]);
  assert.deepEqual(await db.query(`select reference_state,count(*)::int as n from ${table} group by reference_state order by reference_state`),
    [{ reference_state: "registered", n: 2 }, { reference_state: "unresolved", n: 1 }]);
  await trusted(db, `delete from public.messages where id in ('${x}','${y}');`);
  assert.deepEqual(await observations(db, x), []); assert.deepEqual(await observations(db, y), []);
  assert.deepEqual(await observations(db, untouched), [observation("canonical", "media", "unchanged-object")]);
});

test("unreferenced UUID ID changes clear OLD ID and existing FK rejection leaves observations unchanged", async t => {
  const db = await observationFixture(t), a = await known(db, 54), oldId = uuid(7180), newId = uuid(7181), child = uuid(7182);
  await trusted(db, messageInsert(oldId, { path: a.receipt.path, url: mediaUrl(a.receipt.path) }) + ";" +
    `update public.messages set id='${newId}' where id='${oldId}';`);
  assert.deepEqual(await observations(db, oldId), []);
  assert.deepEqual(await observations(db, newId), [registered("canonical", a), registered("legacy_url", a)]);
  await trusted(db, messageInsert(child, { path: null, bucket: null }) + ";" +
    `update public.messages set reply_to_id='${newId}' where id='${child}';`);
  const before = await allObservations(db);
  await assert.rejects(trusted(db, `update public.messages set id='${oldId}' where id='${newId}';`), { code: "23503" });
  assert.deepEqual(await allObservations(db), before, "no new ledger FK changes ordinary self-FK semantics");
});

test("message transaction ROLLBACK and TRUNCATE ROLLBACK restore current observations atomically", async t => {
  const db = await observationFixture(t), a = await known(db, 55), id = uuid(7190), fresh = uuid(7191);
  await trusted(db, messageInsert(id, { path: a.receipt.path }) + ";");
  const before = await allObservations(db), charged = await snapshot(db), bindings = await allBindings(db);
  await trusted(db, `begin; update public.messages set media_url='unsupported' where id='${id}';
    ${messageInsert(fresh, { path: a.receipt.path })}; delete from public.messages where id='${id}'; rollback;`);
  assert.deepEqual(await allObservations(db), before);
  const writer = await session(db, "set role postgres;");
  await writer.connection.send(`begin; truncate public.messages;
    select (select count(*) from public.messages)||':'||(select count(*) from ${table});`)
    .then(value => assert.equal(value, "0:0", "TRUNCATE must clear observations in the truncating transaction"));
  await writer.connection.send("rollback;");
  assert.deepEqual(await allObservations(db), before);
  assert.deepEqual(await snapshot(db), charged); assert.deepEqual(await allBindings(db), bindings);
  await trusted(db, "truncate public.messages;");
  assert.deepEqual(await allObservations(db), []);
  assert.deepEqual(await snapshot(db), charged); assert.deepEqual(await allBindings(db), bindings);
});

test("private authority and exact statement transition bindings support authenticated triggers without new client access", async t => {
  const db = await observationFixture(t);
  const [fn] = await db.query(`select pg_get_userbyid(proowner) as owner,prosecdef,provolatile,proconfig,
    prorettype::regtype::text as returns,pronargs from pg_proc where oid='${signature}'::regprocedure`);
  assert.deepEqual(fn, { owner: "postgres", prosecdef: true, provolatile: "v", proconfig: ['search_path=""'], returns: "trigger", pronargs: 0 });
  const columns = await db.query(`select attname,atttypid::regtype::text as type from pg_attribute
    where attrelid='${table}'::regclass and attnum>0 and not attisdropped order by attnum`);
  assert.deepEqual(columns, [
    { attname: "message_id", type: "uuid" }, { attname: "source_kind", type: "text" },
    { attname: "bucket_id", type: "text" }, { attname: "object_path", type: "text" },
    { attname: "generation_id", type: "uuid" }, { attname: "reference_state", type: "text" }, { attname: "hold_reason", type: "text" },
  ]);
  const [relation] = await db.query(`select pg_get_userbyid(relowner) as owner,relrowsecurity,relforcerowsecurity
    from pg_class where oid='${table}'::regclass`);
  assert.deepEqual(relation, { owner: "postgres", relrowsecurity: true, relforcerowsecurity: false });
  const triggers = await db.query(`select tgname,tgtype::int,tgenabled,tgattr::text,tgoldtable::text,tgnewtable::text,
    tgfoid::regprocedure::text as function from pg_trigger where tgrelid='public.messages'::regclass
    and tgname like 'trg_bot_message_media_observations_%' order by tgname`);
  assert.deepEqual(triggers, [
    ["delete", 8, "old_messages", null], ["insert", 4, null, "new_messages"],
    ["truncate", 32, null, null], ["update", 16, "old_messages", "new_messages"],
  ].map(([event, tgtype, tgoldtable, tgnewtable]) => ({ tgname: "trg_bot_message_media_observations_" + event,
    tgtype, tgenabled: "O", tgattr: "", tgoldtable, tgnewtable, function: "private.bot_message_media_observe_statement()" })));
  await db.exec("grant usage on schema private to anon,authenticated,service_role;");
  for (const role of ["anon", "authenticated", "service_role"]) {
    const [privileges] = await db.query(`select has_function_privilege('${role}','${signature}','EXECUTE') as execute,
      has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as table_access`);
    assert.deepEqual(privileges, { execute: false, table_access: false });
    await assert.rejects(db.exec(`set role ${role}; select * from ${table};`), { code: "42501" });
    await assert.rejects(db.exec(`set role ${role}; select ${signature};`), { code: "42501" });
    await assert.rejects(db.exec(`set role ${role}; insert into ${table}(message_id,source_kind,reference_state,hold_reason)
      values ('${uuid(7200)}','canonical','unresolved','missing_bucket');`), { code: "42501" });
  }
});

test("apply backfill rollback and reapply preserve all original rows policies grants columns and function bodies", async t => {
  const db = await observationFixture(t, { applyObservations: false }), a = await known(db, 56), id = uuid(7210);
  await trusted(db, messageInsert(id, { path: a.receipt.path, url: "unsupported", metadata: { preview: {} }, deleted: true }) + ";");
  const original = await legacyState(db);
  await db.exec(observationSource());
  assert.deepEqual(await observations(db, id), [registered("canonical", a),
    observation("legacy_url", null, null, null, "unresolved", "unsupported_url"),
    observation("preview", "chat-media", null, null, "unresolved", "malformed_metadata")]);
  assert.deepEqual(await legacyState(db), original);
  await assert.rejects(db.exec(observationSource()), error => error.code === "P0001" && error.message.includes("prestate_invalid"));
  assert.deepEqual(await legacyState(db), original);
  await db.exec(observationRollback());
  assert.deepEqual(await legacyState(db), original);
  const [absent] = await db.query(`select to_regclass('${table}')::text as ledger,to_regprocedure('${signature}')::text as helper`);
  assert.deepEqual(absent, { ledger: null, helper: null });
  await db.exec(observationSource());
  assert.equal((await observations(db, id)).length, 3);
  assert.deepEqual(await legacyState(db), original);
});

test("bootstrap under session default RR waits for the actual earlier writer and includes its committed row", async t => {
  const db = await observationFixture(t, { applyObservations: false }), a = await known(db, 57), id = uuid(7220);
  const writer = await session(db, "set role postgres;"), installer = await session(db, "set default_transaction_isolation='repeatable read';");
  assert.equal(await installer.connection.send("show default_transaction_isolation;"), "repeatable read");
  await writer.connection.send("begin; " + messageInsert(id, { path: a.receipt.path, url: mediaUrl(a.receipt.path) }) + ";");
  const install = settled(installer.connection.send(observationSource()));
  try {
    await waitForRelation(db, installer.pid, writer.pid, "ShareRowExclusiveLock");
    await writer.connection.send("commit;");
    const result = await install;
    if (result.error) throw result.error;
    assert.deepEqual(await observations(db, id), [registered("canonical", a), registered("legacy_url", a)]);
    assert.equal(await installer.connection.send("show default_transaction_isolation;"), "repeatable read", "forced transaction RC must not change the session default");
  } finally {
    await writer.connection.send("rollback;");
    await install;
  }
});

test("new writer waits behind bootstrap until commit and then uses the installed observation hooks", async t => {
  const db = await observationFixture(t, { applyObservations: false }), a = await known(db, 58), id = uuid(7221);
  const blocker = await session(db), installer = await session(db), writer = await session(db, "set role postgres;");
  await blocker.connection.send("begin; select pg_advisory_xact_lock(74001,1);");
  const original = observationSource();
  const paused = original.replace(/COMMIT;\s*$/i, "SELECT pg_catalog.pg_advisory_xact_lock(74001,1);\nCOMMIT;");
  assert.notEqual(paused, original, "test-only barrier must pause the actual migration immediately before commit");
  const install = settled(installer.connection.send(paused));
  let write;
  try {
    await waitForGate(db, installer.pid, blocker.pid);
    write = settled(writer.connection.send("begin; " + messageInsert(id, { path: a.receipt.path }) + "; commit;"));
    await waitForRelation(db, writer.pid, installer.pid, "RowExclusiveLock");
    await blocker.connection.send("commit;");
    const installed = await install, written = await write;
    if (installed.error) throw installed.error;
    if (written.error) throw written.error;
    assert.deepEqual(await observations(db, id), [registered("canonical", a)]);
  } finally {
    await blocker.connection.send("rollback;");
    await install;
    if (write) await write;
  }
});

test("same message source and pointer retain the original nonnull logical identity across later resolver drift", async t => {
  const db = await observationFixture(t), a = await known(db, 59), b = await known(db, 60), id = uuid(7230);
  await trusted(db, messageInsert(id, { path: a.receipt.path }) + ";");
  assert.deepEqual(await observations(db, id), [registered("canonical", a)]);
  const restore = await mutateInstalled(db, "private.bot_message_media_references(text,text,text,jsonb)", body =>
    body.replace("SELECT o.source_kind,o.bucket_id,o.object_path,i.generation_id,",
      `SELECT o.source_kind,o.bucket_id,o.object_path,'${b.identity.generation_id}'::uuid,`));
  assert.equal((await references(db, { bucket: "chat-media", path: a.receipt.path }))[0].generation_id, b.identity.generation_id,
    "test-only resolver mutant must really return a different known logical UUID");
  await trusted(db, `update public.messages set content=null where id='${id}';`);
  assert.deepEqual(await observations(db, id), [registered("canonical", a)], "same-source binding is not silently reinterpreted");
  await restore();
  await trusted(db, `update public.messages set media_path=${quote(b.receipt.path)} where id='${id}';`);
  assert.deepEqual(await observations(db, id), [registered("canonical", b)], "changed pointer is a new current observation");
});

test("later registry registration changes no existing observation until the next message statement", async t => {
  const db = await observationFixture(t), id = uuid(7231);
  const path = uuid(3) + "/bots/" + uuid(1) + "/" + (361).toString(16).padStart(64, "0") + ".pdf";
  await trusted(db, messageInsert(id, { path }) + ";");
  const unresolved = [observation("canonical", "chat-media", path)];
  assert.deepEqual(await observations(db, id), unresolved);
  const a = await known(db, 61);
  assert.equal(a.receipt.path, path, "literal future-path oracle must name the new registration");
  assert.deepEqual(await observations(db, id), unresolved, "ledger is the last message observation, not a registry-wide live refcount");
  await trusted(db, `update public.messages set content=null where id='${id}';`);
  assert.deepEqual(await observations(db, id), [registered("canonical", a)]);
});

test("captured file_id reuse produces canonical and preview observations without uploads grants or new charges", async t => {
  const db = await observationFixture(t), a = await known(db, 62), sourceId = uuid(7240), preview = previewPath(a.receipt.path);
  const [captured] = await db.query(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') as hash from pg_proc
    where oid='public.bot_send_message_internal(uuid,uuid,text,jsonb,text)'::regprocedure`);
  assert.equal(captured.hash, "7786e30e6ad6e9184fc88cf46dba8868d3bafbc7821dc088103c2c2ca3b022c8", "captured send body plus accepted ingest patch must be used, not a replacement writer");
  await trusted(db, messageInsert(sourceId, { path: a.receipt.path, url: mediaUrl(a.receipt.path),
    metadata: { kind: "file", mime_type: "application/pdf", preview: { path: preview } } }) + ";");
  const accounting = await snapshot(db), bindings = await allBindings(db);
  const send = (id, key) => db.service(`select public.bot_send_message_internal('${a.receipt.bot}','${a.receipt.chat}',
    'sendDocument',${quote(JSON.stringify({ file_id: id }))}::jsonb,${quote(key)}) as value`);
  const result = (await send(sourceId, "observation-file-id-0001")).value;
  assert.equal(result.duplicate, false);
  assert.deepEqual(await observations(db, result.message_id), [registered("canonical", a), observation("preview", "chat-media", preview)]);
  const duplicate = (await send(sourceId, "observation-file-id-0001")).value;
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.message_id, result.message_id);
  assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n, 2);
  const dead = uuid(7241), foreign = uuid(7242);
  await trusted(db, messageInsert(dead, { path: a.receipt.path, deleted: true }) + ";" +
    messageInsert(foreign, { chat: uuid(11), path: a.receipt.path }) + ";");
  await assert.rejects(send(dead, "observation-file-id-dead"), error => error.code === "P0002" && error.message.includes("bot_file_not_found"));
  await assert.rejects(send(foreign, "observation-file-id-other"), { code: "P0002" });
  assert.deepEqual(await snapshot(db), accounting); assert.deepEqual(await allBindings(db), bindings);
  assert.equal((await db.query("select count(*)::int as n from storage.objects"))[0].n, 0);
});

test("accepted forward RPC and permitted direct fallback both persist the full copied resolver set", async t => {
  const db = await observationFixture(t), a = await known(db, 63), sourceId = uuid(7250), clientId = uuid(7251), fallback = uuid(7252);
  await installForward(db);
  const preview = previewPath(a.receipt.path), metadata = { preview: { path: preview } };
  await trusted(db, messageInsert(sourceId, { path: a.receipt.path, url: mediaUrl(a.receipt.path), metadata }) + ";");
  const expected = [registered("canonical", a), registered("legacy_url", a), observation("preview", "chat-media", preview)];
  const run = () => authenticated(db, `select (public.forward_message('${sourceId}','${a.receipt.chat}','${clientId}',null,null)).id;`);
  const id = await run();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(await observations(db, id), expected);
  assert.equal(await run(), id, "idempotent forward must not duplicate current observations");
  await authenticated(db, messageInsert(fallback, { path: a.receipt.path, url: mediaUrl(a.receipt.path), metadata, forward: sourceId }) + ";");
  assert.deepEqual(await observations(db, fallback), expected);
  await assert.rejects(authenticated(db, `select public.forward_message('${sourceId}','${a.receipt.chat}',null,null,null);`, outsider),
    { code: "P0002" }, "definer forward still checks readable source membership before any insert");
});

for (const [kind, index, n] of [["legacy_url", 2, 64], ["preview", 3, 65]]) {
  test("compiled observer omission mutant loses the independent " + kind + " persistence oracle", async t => {
    const db = await observationFixture(t), a = await known(db, n), good = uuid(7260), bad = uuid(7261);
    const input = kind === "legacy_url" ? { path: null, url: mediaUrl(a.receipt.path) } :
      { path: a.receipt.path, metadata: { preview: {} } };
    const expected = kind === "legacy_url" ? [registered("legacy_url", a)] : [registered("canonical", a),
      observation("preview", "chat-media", null, null, "unresolved", "malformed_metadata")];
    await trusted(db, messageInsert(good, input) + ";");
    assert.deepEqual(await observations(db, good), expected);
    await mutateInstalled(db, signature, body => omitResolverArgument(body, index));
    await trusted(db, messageInsert(bad, input) + ";");
    const actual = await observations(db, bad);
    assert.deepEqual(actual, kind === "legacy_url" ? [] : [registered("canonical", a)]);
    assert.throws(() => assert.deepEqual(actual, expected), { name: "AssertionError" });
  });
}

test("compiled deleted-row filter mutant loses retained deleted material instead of proving absence", async t => {
  const db = await observationFixture(t), a = await known(db, 66), good = uuid(7270), bad = uuid(7271);
  await trusted(db, messageInsert(good, { path: a.receipt.path, deleted: true }) + ";");
  const expected = [registered("canonical", a)];
  assert.deepEqual(await observations(db, good), expected);
  await mutateInstalled(db, signature, body => body
    .replace("WHERE m.id=o.message_id AND r.source_kind=o.source_kind", "WHERE m.deleted_at IS NULL AND m.id=o.message_id AND r.source_kind=o.source_kind")
    .replace("WHERE m.id=ANY(v_ids)", "WHERE m.deleted_at IS NULL AND m.id=ANY(v_ids)"));
  await trusted(db, messageInsert(bad, { path: a.receipt.path, deleted: true }) + ";");
  const actual = await observations(db, bad);
  assert.deepEqual(actual, []);
  assert.throws(() => assert.deepEqual(actual, expected), { name: "AssertionError" });
});

test("compiled transition-image mutant is caught by a nested AFTER ROW final URL oracle", async t => {
  const db = await observationFixture(t), a = await known(db, 67), b = await known(db, 68), good = uuid(7272), bad = uuid(7273);
  await trusted(db, `create function public.fixture_nested_url() returns trigger language plpgsql as $$
    begin update public.messages set media_url=${quote(mediaUrl(b.receipt.path))} where id=new.id; return null; end $$;
    create trigger fixture_nested_url after insert on public.messages for each row execute function public.fixture_nested_url();
    ${messageInsert(good, { path: null, url: mediaUrl(a.receipt.path) })};`);
  const expected = [registered("legacy_url", b)];
  assert.deepEqual(await observations(db, good), expected);
  await mutateInstalled(db, signature, body => body.replaceAll("FROM public.messages m CROSS JOIN LATERAL", "FROM new_messages m CROSS JOIN LATERAL"));
  await trusted(db, messageInsert(bad, { path: null, url: mediaUrl(a.receipt.path) }) + ";");
  const actual = await observations(db, bad);
  assert.deepEqual(actual, [registered("legacy_url", a)]);
  assert.throws(() => assert.deepEqual(actual, expected), { name: "AssertionError" });
});

for (const [name, edit, reason] of [
  ["RLS disabled", sql => sql.replace("ALTER TABLE private.bot_message_media_observations ENABLE ROW LEVEL SECURITY;",
    "ALTER TABLE private.bot_message_media_observations DISABLE ROW LEVEL SECURITY;"), "table_authority_invalid"],
  ["SECURITY DEFINER omitted", sql => sql.replace("VOLATILE SECURITY DEFINER", "VOLATILE SECURITY INVOKER"), "function_authority_invalid"],
  ["known bootstrap references omitted", sql => sql.replace(
    "private.bot_message_media_references(m.media_bucket,m.media_path,m.media_url,m.media_metadata) r;",
    "private.bot_message_media_references(m.media_bucket,m.media_path,m.media_url,m.media_metadata) r WHERE false;"), "bootstrap_incomplete"],
]) {
  test("migration self-check refuses " + name + " atomically before commit", async t => {
    const db = await observationFixture(t, { applyObservations: false }), a = await known(db, 69), id = uuid(7280);
    await trusted(db, messageInsert(id, { path: a.receipt.path, url: mediaUrl(a.receipt.path) }) + ";");
    assert.deepEqual(await references(db, { bucket: "chat-media", path: a.receipt.path, url: mediaUrl(a.receipt.path) }),
      [registered("canonical", a), registered("legacy_url", a)]);
    const before = await legacyState(db), original = observationSource(), mutant = edit(original);
    assert.notEqual(mutant, original, "mutant must change the actual candidate SQL");
    await assert.rejects(db.exec(mutant), error => error.code === "P0001" && error.message.includes(reason), "named raising self-check must reject the selected defect");
    assert.deepEqual(await legacyState(db), before);
    const [catalog] = await db.query(`select to_regclass('${table}')::text as ledger,to_regprocedure('${signature}')::text as helper`);
    assert.deepEqual(catalog, { ledger: null, helper: null });
    await db.exec(original);
    assert.deepEqual(await observations(db, id), [registered("canonical", a), registered("legacy_url", a)]);
  });
}

test("omitting the raising self-check exposes the definer omission to an independent authority and permitted-write oracle", async t => {
  const db = await observationFixture(t, { applyObservations: false }), a = await known(db, 70);
  const original = observationSource(), mutant = original.replace("VOLATILE SECURITY DEFINER", "VOLATILE SECURITY INVOKER")
    .replace(/DO \$self_check\$[\s\S]*?\$self_check\$;/, "-- test-only omission of the final raising self-check");
  assert.notEqual(mutant, original);
  await authenticated(db, messageInsert(uuid(7281), { path: null, url: mediaUrl(a.receipt.path) }) + ";");
  await db.exec(mutant);
  const [authority] = await db.query(`select prosecdef from pg_proc where oid='${signature}'::regprocedure`);
  assert.equal(authority.prosecdef, false, "actual defective function must install when its check is omitted");
  assert.throws(() => assert.equal(authority.prosecdef, true), { name: "AssertionError" });
  const before = await db.query("select * from public.messages order by id");
  await assert.rejects(authenticated(db, messageInsert(uuid(7282), { path: null, url: mediaUrl(a.receipt.path) }) + ";"), { code: "42501" });
  assert.deepEqual(await db.query("select * from public.messages order by id"), before, "permission failure must roll back the otherwise permitted message INSERT");
});
