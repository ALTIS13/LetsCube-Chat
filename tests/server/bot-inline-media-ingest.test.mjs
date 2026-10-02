import assert from "node:assert/strict";
import test from "node:test";
import { postgres, reservation, reserveSql, commitSql, payload, object, quote, uuid,
  bot, token, chat, lease, capturedFunctions, read, stem } from "./bot-inline-media-ingest.fixture.mjs";

const reserve = async (db, r) => (await db.service(reserveSql(r))).value;
const commit = async (db, r, data) => (await db.service(commitSql(r, data))).value;
const fail = (promise, message) => assert.rejects(promise, new RegExp(message));
const fresh = (n, overrides = {}) => {
  const fingerprint = n.toString(16).padStart(64, "0");
  const r = reservation({ key: `ingest-fixture-${n}`, fingerprint, lease: uuid(100 + n), ...overrides });
  r.path = `${r.chat}/bots/${r.bot}/${r.fingerprint}.${r.mime === "application/pdf" ? "pdf" : r.mime === "audio/ogg" ? "ogg" : "mp4"}`;
  return r;
};

test("authorize rejects Storage size/MIME lies against the actual captured function", async (t) => {
  const db = await postgres(t), r = reservation();
  await object(db, r, {size: 69});
  const authorize = () => db.service(`select public.bot_upload_authorize_internal(${[r.bot,r.chat,"chat-media",r.path,r.mime,r.size,60].map(quote).join(",")}) as value`);
  await fail(authorize(), "bot_upload_object");
  await db.exec(`update storage.objects set metadata='{"size":68,"mimetype":"video/mp4"}'::jsonb;`);
  await fail(authorize(), "bot_upload_object");
  await db.exec(`update storage.objects set metadata='{"size":68,"mimetype":"application/pdf"}'::jsonb;`);
  assert.ok((await authorize()).value.grant_id);
});

test("6 MiB literal, exact admission, input binding and active token ownership", async (t) => {
  const db = await postgres(t), r = reservation({size: 6291456});
  const admitted = await reserve(db, r);
  assert.deepEqual(admitted, {duplicate:false,result:null,lease_id:lease});
  const expiry = (await db.query("select extract(epoch from lease_expires_at-created_at)::int as seconds from private.bot_media_ingests"))[0];
  assert.equal(expiry.seconds, 120);
  await fail(reserve(db, fresh(2, {size:6291457})), "bot_ingest_input_invalid");
  for (const bad of [
    fresh(3, {token:uuid(12)}), fresh(4, {token:uuid(99)}),
    {...fresh(5),path:r.path}, fresh(6, {digest:"B".repeat(64)}),
    fresh(7, {fingerprint:"g".repeat(64)}), fresh(8,{method:"sendPhoto",mime:"application/pdf"}),
  ]) await assert.rejects(reserve(db, bad));
  await db.exec(`update private.bot_tokens set revoked_at=now() where id='${token}';`);
  await fail(reserve(db, fresh(9)), "bot_media_ingest_token_revoked");
  assert.equal((await db.query("select count(*)::int as n from private.bot_media_ingests"))[0].n, 1);
});

test("immutable reservation conflicts precede Storage; a live equal retry is rate limited", async (t) => {
  const db = await postgres(t), r = reservation();
  await reserve(db,r);
  for (const delta of [{fingerprint:"c".repeat(64)},{digest:"c".repeat(64)},{size:69},{chat:uuid(11)}]) {
    const next = {...r,...delta,lease:uuid(7)};
    next.path = `${next.chat}/bots/${next.bot}/${next.fingerprint}.pdf`;
    await fail(reserve(db,next), "bot_ingest_conflict");
  }
  await assert.rejects(reserve(db,{...r,lease:uuid(7)}), (error) => {
    assert.equal(error.code,"55000"); assert.match(error.message,/bot_media_ingest_busy/);
    assert.match(error.detail,/^[0-9]+$/); assert.ok(Number(error.detail)>=1 && Number(error.detail)<=120);
    return true;
  });
  assert.equal((await db.query("select count(*)::int as n from storage.objects"))[0].n,0);
});

test("failed commit retains its charged receipt; expiry permits exact retry without recharge", async (t) => {
  const db = await postgres(t), r = reservation();
  await reserve(db,r);
  await fail(commit(db,r), "bot_ingest_object_attributes_invalid");
  const before = (await db.query("select created_at,byte_size from private.bot_media_ingests"))[0];
  await db.exec("update private.bot_media_ingests set lease_expires_at=clock_timestamp()-interval '1 second';");
  await assert.rejects(commit(db,r), error => {
    assert.equal(error.code,"55000"); assert.match(error.message,/bot_media_ingest_lease_expired/);
    assert.equal(error.detail,"1"); return true;
  });
  await assert.rejects(commit(db,{...r,lease:uuid(99)}), error => error.code==="42501" && /bot_ingest_lease_invalid/.test(error.message));
  await db.exec(`insert into private.bot_tokens(id,bot_id) values ('${uuid(98)}','${bot}');`);
  await assert.rejects(commit(db,{...r,token:uuid(98)}), error => error.code==="42501" && /bot_ingest_lease_invalid/.test(error.message));
  const recovered = {...r,lease:uuid(7)};
  assert.equal((await reserve(db,recovered)).lease_id,uuid(7));
  assert.deepEqual((await db.query("select created_at,byte_size from private.bot_media_ingests"))[0],before);
  await object(db,recovered);
  await assert.rejects(commit(db,r), error => error.code==="42501" && /bot_ingest_lease_invalid/.test(error.message));
  assert.equal((await commit(db,recovered)).duplicate,false);
});

test("commit is atomic; response loss and legacy idempotency expiry never replay a completed ingest", async (t) => {
  const db = await postgres(t), r = reservation();
  await reserve(db,r); await object(db,r);
  await fail(commit(db,r,payload(r,{size_bytes:69})), "bot_ingest_payload_invalid");
  await fail(commit(db,r,{...payload(r),topic_id:uuid(99)}), "bot_topic_forbidden");
  assert.equal((await db.query("select count(*)::int as n from private.bot_upload_grants"))[0].n,0);
  assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n,0);
  assert.equal((await db.query("select commit_xid::text as xid from private.bot_media_ingests"))[0].xid,null,
    "the inner command failure must roll back its transaction-bound admission marker");
  const sent = await commit(db,r); // Intentionally discard the transport outcome and retry.
  assert.equal(sent.duplicate,false);
  assert.equal((await db.query("select commit_xid::text as xid from private.bot_media_ingests"))[0].xid,null);
  assert.deepEqual(await commit(db,r),{...sent,duplicate:true});
  await db.exec("delete from private.bot_operation_idempotency; delete from private.bot_message_idempotency;");
  assert.deepEqual(await reserve(db,{...r,lease:uuid(7)}),{duplicate:true,result:sent.result,lease_id:null});
  assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n,1);
  assert.equal((await db.query("select count(*)::int as n from private.bot_media_ingests"))[0].n,1);
});

test("canonical media metadata survives new send and file_id resend, without recharging bytes", async (t) => {
  const db = await postgres(t), r = fresh(1,{method:"sendVoice",mime:"audio/ogg"});
  await reserve(db,r); await object(db,r);
  const sent = await commit(db,r,payload(r,{duration_ms:1500,file_name:"fixture.ogg",width:1,height:1}));
  const rows = await db.query("select media_metadata from public.messages");
  assert.equal(rows[0].media_metadata.duration_ms,1500);
  assert.equal(rows[0].media_metadata.size_bytes,68);
  const resent = await db.service(`select public.bot_message_command_internal('${bot}','${chat}','sendVoice',${quote(JSON.stringify({file_id:sent.result.message_id}))}::jsonb,'fixture-resend-0001','${"d".repeat(64)}') as value`);
  assert.equal(resent.value.duplicate,false);
  const copied = (await db.query(`select media_metadata from public.messages where id='${resent.value.result.message_id}'`))[0].media_metadata;
  assert.equal(copied.duration_ms,1500); assert.equal(copied.size_bytes,68); assert.equal(copied.size,68);
  assert.equal((await db.query("select count(*)::int as n from private.bot_media_ingests"))[0].n,1);
  await db.exec(`update public.chat_bot_members set removed_at=now() where bot_id='${bot}';`);
  await fail(reserve(db,r), "bot_chat_forbidden");
});

test("commit validates token, lease, fingerprint and Storage metadata without trusting caller assertions", async (t) => {
  const db = await postgres(t), r = reservation();
  await reserve(db,r); await object(db,r,{size:69});
  await fail(commit(db,r),"bot_ingest_object_attributes_invalid");
  await db.exec(`update storage.objects set metadata='{"size":68,"mimetype":"application/pdf"}'::jsonb;`);
  await assert.rejects(commit(db,{...r,lease:uuid(99)}), error => error.code==="42501" && /bot_ingest_lease_invalid/.test(error.message));
  await fail(commit(db,{...r,fingerprint:"d".repeat(64)}),"bot_ingest_conflict");
  for (const metadata of [{mime_type:"video/mp4"},{size:69},{size_bytes:69},{duration_ms:-1},{duration_ms:1.5},{width:0},{file_name:42}]) {
    await assert.rejects(commit(db,r,payload(r,metadata)));
  }
  await db.exec(`update private.bot_tokens set revoked_at=now() where id='${token}';`);
  await assert.rejects(commit(db,r), (error) => error.code==="42501" && /bot_media_ingest_token_revoked/.test(error.message));
  assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n,0);
});

test("RPC/private table ACL and restrictive Storage mutations preserve ordinary objects", async (t) => {
  const db = await postgres(t), r = reservation();
  for (const role of ["anon","authenticated"]) {
    await fail(db.exec(`set role ${role}; ${reserveSql(r)};`),"permission denied");
    await fail(db.exec(`set role ${role}; ${commitSql(r)};`),"permission denied");
  }
  await fail(db.exec("set role service_role; select * from private.bot_media_ingests;"),"permission denied");
  await fail(db.exec(`set role authenticated; insert into storage.objects(bucket_id,name) values ('chat-media','${r.path}');`),"row-level security");
  const ordinary = `${chat}/ordinary.pdf`;
  await db.exec(`set role authenticated; insert into storage.objects(bucket_id,name) values ('chat-media','${ordinary}');`);
  await fail(db.exec(`set role authenticated; update storage.objects set name='${r.path}' where name='${ordinary}';`),"row-level security");
  await object(db,r);
  await db.exec(`set role authenticated; update storage.objects set metadata='{}' where name='${r.path}'; delete from storage.objects where name='${r.path}';`);
  assert.equal((await db.query(`select count(*)::int as n from storage.objects where name='${r.path}'`))[0].n,1);
  await db.exec(`set role authenticated; update storage.objects set metadata='{}' where name='${ordinary}'; delete from storage.objects where name='${ordinary}';`);
  assert.equal((await db.query(`select count(*)::int as n from storage.objects where name='${ordinary}'`))[0].n,0);
});

test("rollback restores exact old bodies and ACL, retains charged ledger and message objects", async (t) => {
  const db = await postgres(t), r = reservation();
  await reserve(db,r); await object(db,r); await commit(db,r);
  await db.exec(read(stem+".rollback.sql"));
  for (const fn of capturedFunctions) {
    const actual = (await db.query(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') as hash,to_jsonb(proacl) as acl from pg_proc where oid='${fn.signature}'::regprocedure`))[0];
    assert.equal(actual.hash,fn.body_hash); assert.deepEqual(actual.acl,fn.acl);
  }
  assert.equal((await db.query("select count(*)::int as n from private.bot_media_ingests"))[0].n,1);
  assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n,1);
  assert.equal((await db.query("select count(*)::int as n from storage.objects"))[0].n,1);
  assert.equal((await db.query("select to_regprocedure('public.bot_media_ingest_commit_internal(uuid,uuid,text,text,uuid,jsonb)')::text as value"))[0].value,null);
});
