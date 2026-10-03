import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageFixture, trusted, authenticated, messageInsert, mediaUrl, uuid,
  closing, accounting, objectState, messageCount, observations,
  session, settled, assertBarrier, namespace, pauseAfterRow, waitForGate, quote,
  outcomeOrWait, pauseCloserAcquisition,
} from "./bot-media-coverage.fixture.mjs";
import { begin, finish, object, commit } from "./bot-media-logical-identity.fixture.mjs";

test("closed-state feature gap refuses a trusted canonical reference with full rollback", async t => {
  const db = await coverageFixture(t), before = await accounting(db), id = uuid(8001);
  t.diagnostic("actual PostgreSQL " + db.version + "; fictional close state only, no physical deletion eligibility");
  assert.equal((await db.query("select count(*)::int as n from private.bot_media_object_identities"))[0].n, 2);
  await closing(db);
  assert.deepEqual(await objectState(db), [{ id: 1, closed: true }, { id: 2, closed: false }]);
  await assert.rejects(trusted(db, messageInsert(id, { path: db.a.receipt.path }) + ";"),
    error => error.code === "55000" && error.message.includes("fixture_generation_closed"),
    "feature-gap RED: shipped observations allow a reference after fictional close");
  assert.equal(await messageCount(db), 0);
  assert.deepEqual(await observations(db, id), []);
  assert.deepEqual(await accounting(db), before);
});

test("writer-first coarse barrier defers closer immediately and retains reverse-order multi-statement references", async t => {
  const db = await coverageFixture(t), before = await accounting(db), writer = await session(db);
  await writer.connection.send("begin; " + messageInsert(uuid(8010), { path: db.b.receipt.path }) + ";");
  await assertBarrier(db, writer.pid, "ShareLock");
  await assert.rejects(closing(db, [1, 2]), error => error.code === "55P03" && error.message.includes("fixture_coverage_busy"));
  await writer.connection.send(messageInsert(uuid(8011), { path: db.a.receipt.path }) + "; commit;");
  await assert.rejects(closing(db, [2, 1]), error => error.code === "55000" && error.message.includes("fixture_reference_present"));
  assert.equal(await messageCount(db), 2);
  assert.deepEqual(await objectState(db), [{ id: 1, closed: false }, { id: 2, closed: false }]);
  assert.deepEqual(await accounting(db), before);
});

test("closer-first barrier refuses writer without waiting then refuses its committed closed generation", async t => {
  const db = await coverageFixture(t), before = await accounting(db), closer = await session(db);
  await closer.connection.send("begin; select fixture_coverage.close_objects(array[1]);");
  await assertBarrier(db, closer.pid, "ExclusiveLock");
  await assert.rejects(authenticated(db, messageInsert(uuid(8020), { url: mediaUrl(db.a.receipt.path) }) + ";"),
    error => error.code === "55P03" && error.message.includes("fixture_coverage_busy"));
  await closer.connection.send("commit;");
  await assert.rejects(authenticated(db, messageInsert(uuid(8021), { url: mediaUrl(db.a.receipt.path) }) + ";"),
    error => error.code === "55000" && error.message.includes("fixture_generation_closed"));
  assert.equal(await messageCount(db), 0);
  assert.deepEqual(await accounting(db), before);
});

for (const kind of ["nested", "upsert"]) {
  test(kind + " statement interleaving retains one shared barrier and cannot deadlock a try-closer", async t => {
    const db = await coverageFixture(t), before = await accounting(db);
    if (kind === "nested") {
      await db.exec(`create function fixture_coverage.nested_insert() returns trigger language plpgsql as $$
        begin if new.id='${uuid(8030)}' then ${messageInsert(uuid(8031), { path: db.b.receipt.path })}; end if; return null; end $$;
        create trigger fixture_nested_insert after insert on public.messages
          for each row execute function fixture_coverage.nested_insert();`);
    } else {
      await trusted(db, messageInsert(uuid(8031), { path: null }) + ";");
    }
    await pauseAfterRow(db, uuid(8030));
    const barrier = await session(db), writer = await session(db);
    await barrier.connection.send(`begin; select pg_advisory_xact_lock(${namespace},99);`);
    const sql = kind === "nested" ? messageInsert(uuid(8030), { path: db.a.receipt.path }) :
      `insert into public.messages(id,chat_id,user_id,type,media_bucket,media_path) values
       ('${uuid(8031)}','${uuid(3)}','${uuid(7001)}','file','chat-media',${quote(db.b.receipt.path)}),
       ('${uuid(8030)}','${uuid(3)}','${uuid(7001)}','file','chat-media',${quote(db.a.receipt.path)})
       on conflict(id) do update set media_path=excluded.media_path`;
    const writing = settled(writer.connection.send("begin; " + sql + "; commit;"));
    await waitForGate(db, writer.pid, barrier.pid);
    await assertBarrier(db, writer.pid, "ShareLock");
    await assert.rejects(closing(db, [1, 2]), { code: "55P03" });
    await barrier.connection.send("commit;");
    assert.equal((await writing).error, undefined, "writer completes; neither 40P01 nor timeout is acceptable");
    assert.equal(await messageCount(db), 2);
    await assert.rejects(closing(db, [1, 2]), { code: "55000" });
    assert.deepEqual(await accounting(db), before);
  });
}

test("unknown coverage blocks all close and new unknown references after any close", async t => {
  const db = await coverageFixture(t), id = uuid(8040);
  await trusted(db, messageInsert(id, { url: "unsupported" }) + ";");
  await assert.rejects(closing(db, [2]), error => error.code === "55000" && error.message.includes("fixture_unknown_coverage"));
  await trusted(db, `delete from public.messages where id='${id}';`);
  await closing(db, [1]);
  await assert.rejects(trusted(db, messageInsert(uuid(8041), { url: "unsupported" }) + ";"),
    error => error.code === "55000" && error.message.includes("fixture_unknown_after_close"));
  await assert.rejects(trusted(db, messageInsert(uuid(8042), { metadata: { preview: {} } }) + ";"),
    error => error.code === "55000" && error.message.includes("fixture_unknown_after_close"));
  assert.equal(await messageCount(db), 0);
});

for (const isolation of ["repeatable read", "serializable"]) {
  test(isolation + " old-snapshot writer and closer are refused rather than admitting a closed generation", async t => {
    const db = await coverageFixture(t), before = await accounting(db), writer = await session(db), closer = await session(db);
    await writer.connection.send("begin isolation level " + isolation + "; select closed from fixture_coverage.objects where id=1;");
    await closer.connection.send("begin isolation level " + isolation + "; select closed from fixture_coverage.objects where id=1;");
    await closing(db);
    await assert.rejects(writer.connection.send(messageInsert(uuid(8050), { path: db.a.receipt.path }) + "; commit;"),
      error => error.code === "0A000" && error.message.includes("fixture_isolation_unsupported"));
    await assert.rejects(closer.connection.send("select fixture_coverage.close_objects(array[2]); commit;"),
      error => error.code === "0A000" && error.message.includes("fixture_isolation_unsupported"));
    assert.equal(await messageCount(db), 0);
    assert.deepEqual(await objectState(db), [{ id: 1, closed: true }, { id: 2, closed: false }]);
    assert.deepEqual(await accounting(db), before);
  });
}

test("late READ COMMITTED RPC resumes after an old source read but checks fresh close state", async t => {
  const db = await coverageFixture(t), before = await accounting(db);
  await db.exec(`create function fixture_coverage.read_pause_insert() returns void language plpgsql volatile as $$
    begin perform closed from fixture_coverage.objects where id=1;
      perform pg_advisory_xact_lock(${namespace},99);
      ${messageInsert(uuid(8060), { path: db.a.receipt.path })}; end $$;`);
  const barrier = await session(db), writer = await session(db);
  await barrier.connection.send(`begin; select pg_advisory_xact_lock(${namespace},99);`);
  const writing = settled(writer.connection.send("begin; select fixture_coverage.read_pause_insert(); commit;"));
  await waitForGate(db, writer.pid, barrier.pid);
  await closing(db);
  await barrier.connection.send("commit;");
  const result = await writing;
  assert.equal(result.error?.code, "55000");
  assert.match(result.error.message, /fixture_generation_closed/);
  assert.equal(await messageCount(db), 0);
  assert.deepEqual(await accounting(db), before);
});

test("URL-only UPDATE and parent-bucket preview mutation cannot attach closed pointers", async t => {
  const db = await coverageFixture(t), id = uuid(8070), before = await accounting(db);
  await trusted(db, messageInsert(id, { path: db.b.receipt.path }) + ";");
  const metadata = { preview: { path: db.b.receipt.path.replace(/\.[^./]*$/, ".preview.webp"), bucket: "wrong" } };
  const previewUpdate = `update public.messages set media_metadata=${quote(JSON.stringify(metadata))}::jsonb where id='${id}';`;
  await authenticated(db, previewUpdate);
  assert.deepEqual((await observations(db, id)).map(r => [r.source_kind, r.bucket_id, r.reference_state]),
    [["canonical", "chat-media", "registered"], ["preview", "chat-media", "unresolved"]],
    "positive control: valid derived preview uses its parent bucket, not the caller's bucket");
  await authenticated(db, `update public.messages set media_metadata='{}'::jsonb where id='${id}';`);
  await closing(db);
  await assert.rejects(authenticated(db, `update public.messages set media_url=${quote(mediaUrl(db.a.receipt.path))} where id='${id}';`),
    error => error.code === "55000" && error.message.includes("fixture_generation_closed"));
  await assert.rejects(authenticated(db, previewUpdate),
    error => error.code === "55000" && error.message.includes("fixture_unknown_after_close"));
  assert.equal((await observations(db, id)).length, 1, "failed UPDATE preserves the original canonical edge");
  assert.deepEqual(await accounting(db), before);
});

test("closer refuses an uncovered control-row owner without waiting or leaving partial close state", async t => {
  const db = await coverageFixture(t), owner = await session(db), closer = await session(db);
  await owner.connection.send("begin; select id from fixture_coverage.objects where id=2 for update;");
  const operation = settled(closer.connection.send("begin; set local lock_timeout='0'; select fixture_coverage.close_objects(array[1,2]); commit;"));
  const observed = await outcomeOrWait(db, operation, closer.pid, owner.pid);
  await owner.connection.send("commit;");
  const outcome = await operation;
  assert.equal(observed.waiting, false, "a real queued row-lock edge is forbidden, independent of elapsed time or 55P03 wrapping");
  assert.equal(outcome.error?.code, "55P03");
  assert.match(outcome.error.message, /fixture_control_busy/);
  assert.deepEqual(await objectState(db), [{ id: 1, closed: false }, { id: 2, closed: false }]);
  assert.equal(await messageCount(db), 0);
});

test("closer scans references after its actual acquisition path, not a cached pre-lock empty result", async t => {
  const db = await coverageFixture(t);
  await pauseCloserAcquisition(db);
  const barrier = await session(db), closer = await session(db);
  await barrier.connection.send(`begin; select pg_advisory_xact_lock(${namespace},98);`);
  const result = settled(closer.connection.send("begin; select fixture_coverage.close_objects(array[1]); commit;"));
  await waitForGate(db, closer.pid, barrier.pid, 98);
  await trusted(db, messageInsert(uuid(8095), { path: db.a.receipt.path }) + ";");
  await barrier.connection.send("commit;");
  const outcome = await result;
  assert.equal(outcome.error?.code, "55000");
  assert.match(outcome.error.message, /fixture_reference_present/);
  assert.deepEqual(await objectState(db), [{ id: 1, closed: false }, { id: 2, closed: false }]);
  assert.equal(await messageCount(db), 1);
});

test("writer cannot upgrade its coverage fence and closer cannot reenter message writes", async t => {
  const db = await coverageFixture(t), writer = await session(db), closer = await session(db);
  await writer.connection.send("begin; " + messageInsert(uuid(8080), { path: null }) + ";");
  await assert.rejects(writer.connection.send("select fixture_coverage.close_objects(array[1]); commit;"),
    error => error.code === "55000" && error.message.includes("fixture_coverage_upgrade"));
  assert.equal(await messageCount(db), 0, "writer's failed upgrade rolls back its entire transaction");
  await closer.connection.send("begin; select fixture_coverage.close_objects(array[1]);");
  await assert.rejects(closer.connection.send(messageInsert(uuid(8081), { path: db.b.receipt.path }) + "; commit;"),
    error => error.code === "55000" && error.message.includes("fixture_closer_cannot_write"));
  assert.deepEqual(await objectState(db), [{ id: 1, closed: false }, { id: 2, closed: false }]);
  assert.equal(await messageCount(db), 0);
});

test("savepoint rollback releases only aborted coverage and preserves an earlier transaction barrier", async t => {
  const db = await coverageFixture(t), writer = await session(db);
  await writer.connection.send("begin; savepoint before_writer; " + messageInsert(uuid(8090), { path: db.a.receipt.path }) + "; rollback to before_writer;");
  await closing(db, [2]);
  await writer.connection.send(messageInsert(uuid(8091), { path: db.a.receipt.path }) + "; savepoint later; " +
    messageInsert(uuid(8092), { path: db.a.receipt.path }) + "; rollback to later;");
  await assertBarrier(db, writer.pid, "ShareLock");
  await assert.rejects(closing(db, [1]), { code: "55P03" });
  await writer.connection.send("commit;");
  assert.equal(await messageCount(db), 1);
  await assert.rejects(closing(db, [1]), { code: "55000" });
});

test("accepted ingest commit rolls back on coverage refusal while earlier charged receipt and PUT outcome remain held", async t => {
  const db = await coverageFixture(t), r = db.a.receipt;
  await begin(db, r);
  await object(db, r);
  await finish(db, r, "acknowledged");
  const before = await accounting(db), closer = await session(db);
  await closer.connection.send("begin; select fixture_coverage.close_objects(array[1]);");
  await assert.rejects(commit(db, r), error => error.code === "55P03" && error.message.includes("fixture_coverage_busy"));
  assert.equal(await messageCount(db), 0);
  assert.deepEqual(await accounting(db), before, "failed current commit does not reset an earlier receipt, attempt or immutable binding");
  await closer.connection.send("rollback;");
  const result = await commit(db, r);
  assert.equal(result.duplicate, false, "same unconsumed operation can succeed once coverage is available");
  assert.equal(await messageCount(db), 1);
  const after = await accounting(db);
  assert.deepEqual(after.rows.attempts, before.rows.attempts);
  assert.deepEqual(after.bindings.identities, before.bindings.identities);
  assert.deepEqual(after.bindings.attempts, before.bindings.attempts);
});

test("moderation-retained deleted media still blocks fixture close until the accepted final scrub", async t => {
  const db = await coverageFixture(t), id = uuid(8100), report = uuid(8101), before = await accounting(db);
  await trusted(db, messageInsert(id, { path: db.a.receipt.path }) + ";" +
    `insert into public.content_reports(id,message_id,status) values ('${report}','${id}','new');
     update public.messages set deleted_at=clock_timestamp() where id='${id}';`);
  assert.equal((await observations(db, id)).length, 1);
  await assert.rejects(closing(db), error => error.code === "55000" && error.message.includes("fixture_reference_present"));
  await trusted(db, `update public.content_reports set status='dismissed' where id='${report}';`);
  assert.deepEqual(await observations(db, id), []);
  await closing(db);
  assert.deepEqual(await accounting(db), before, "fixture close is not receipt/refund/Storage authority even after scrub");
});

for (const command of ["delete from public.messages", "truncate public.messages cascade"]) {
  test(command.split(" ")[0] + " retains transaction-wide coverage while current observations disappear", async t => {
    const db = await coverageFixture(t), before = await accounting(db), writer = await session(db);
    await trusted(db, messageInsert(uuid(8110), { path: db.a.receipt.path }) + ";");
    await writer.connection.send("begin; " + command + ";");
    await assertBarrier(db, writer.pid, "ShareLock");
    await assert.rejects(closing(db), { code: "55P03" });
    await writer.connection.send("commit;");
    assert.equal(await messageCount(db), 0);
    assert.deepEqual(await observations(db, uuid(8110)), []);
    await closing(db);
    assert.deepEqual(await accounting(db), before);
  });
}

test("closed-state feature gap refuses an authenticated URL-only reference without a trusted bypass", async t => {
  const db = await coverageFixture(t), before = await accounting(db), id = uuid(8002);
  await closing(db);
  await assert.rejects(authenticated(db, messageInsert(id, { path: null, url: mediaUrl(db.a.receipt.path) }) + ";"),
    error => error.code === "55000" && error.message.includes("fixture_generation_closed"));
  assert.equal(await messageCount(db), 0);
  assert.deepEqual(await accounting(db), before);
});
