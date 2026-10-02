import assert from "node:assert/strict";
import test from "node:test";
import { postgres, read, reservation, reserveSql, commitSql, object, uuid, quote, bot, chat } from "./bot-inline-media-ingest.fixture.mjs";

const sql = () => read("scripts/bot-media-ingest-audit.sql");
const observe = async (db,source=sql()) => {
  const output = await db.exec(source);
  const lines = output.split("\n").filter(line=>line.trim());
  assert.equal(lines.length,1,"the audit must emit exactly one aggregate JSON row");
  return JSON.parse(lines[0]);
};
const counters = report => report.canonical_columns_and_db_metadata_candidates;
const request = n => {
  const fingerprint=n.toString(16).padStart(64,"0");
  return reservation({key:`audit-fixture-${n}`,fingerprint,lease:uuid(100+n),
    path:`${chat}/bots/${bot}/${fingerprint}.pdf`});
};

async function seed(db) {
  const rows=Array.from({length:8},(_,i)=>request(i+1));
  for (const [index,r] of rows.entries()) {
    await db.service(reserveSql(r));
    if (index!==4) await object(db,r,index===6?{mimetype:undefined,size:undefined}:index===7?{size:69}:{});
    if ([0,3,5].includes(index)) await db.service(commitSql(r));
  }
  await db.exec(`
    update public.messages set deleted_at=now() where media_path=${quote(rows[3].path)};
    delete from public.messages where media_path=${quote(rows[5].path)};
    insert into public.messages(id,chat_id,bot_id,type,media_bucket,media_path)
      values ('${uuid(70)}','${uuid(11)}','${uuid(10)}','file','chat-media',${quote(rows[5].path)});
    update private.bot_media_ingests set state='complete',result='{"message_id":"not-a-uuid"}',completed_at=now()
      where object_path=${quote(rows[6].path)};
    update private.bot_media_ingests set lease_expires_at=now()-interval '1 hour'
      where object_path in (${[2,4,7].map(i=>quote(rows[i].path)).join(",")});
    update private.bot_media_ingests set created_at=now()-interval '25 hours' where object_path=${quote(rows[4].path)};
    alter table public.messages add column media_url text;
    insert into public.messages(id,chat_id,type,media_url)
      values ('${uuid(71)}','${chat}','file',${quote("https://legacy.invalid/"+rows[6].path)});
    insert into storage.objects(bucket_id,name,metadata) values
      ('unrelated-control',${quote(rows[1].path)},'{"size":999,"mimetype":"application/pdf"}'),
      ('chat-media','outside-charged-ledger.pdf','{}');
  `);
  return rows;
}

test("audit source has literal read-only isolation, bounded timeouts/cap and final rollback",()=>{
  const source=sql(),code=source.replace(/--[^\n]*/g,"").trim();
  assert.ok(code.startsWith("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;"));
  assert.ok(code.endsWith("ROLLBACK;"));
  assert.match(code,/SET LOCAL statement_timeout = '15s';/);
  assert.match(code,/SET LOCAL lock_timeout = '2s';/);
  assert.match(code,/LIMIT 20001/); assert.match(code,/>20000/);
  assert.doesNotMatch(code,/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|COMMIT)\b/i);
  assert.doesNotMatch(code,/\b(media_url|user_id|content_sha256|owner_token_id)\b/i);
});

test("known complete/reserved controls reconcile only aggregates; deleted and reused references exclude candidates",async(t)=>{
  const db=await postgres(t),rows=await seed(db),report=await observe(db);
  assert.equal(report.report,"bot_media_ingest_candidates_v1");
  assert.equal(report.scope,"charged_receipts_only");
  assert.deepEqual(report.limits,{receipt_entries_max:20000,statement_timeout_ms:15000,lock_timeout_ms:2000});
  assert.deepEqual(report.charged,{entries:8,bytes:544,rolling_24h_entries:7,rolling_24h_bytes:476});
  assert.deepEqual(report.states,{reserved:{entries:4,bytes:272},complete:{entries:4,bytes:272}});
  assert.deepEqual(counters(report),{
    noncanonical_receipt_paths:0,storage_rows_present:7,storage_rows_missing:1,
    storage_metadata_missing:1,storage_metadata_invalid:0,storage_metadata_matches:5,storage_metadata_mismatches:1,
    receipts_with_any_canonical_reference:3,canonical_message_reference_rows:3,deleted_canonical_message_reference_rows:1,
    complete_completion_timestamp_present:4,
    complete_result_message_id_present:3,complete_result_identity_present:3,complete_result_identity_missing_or_invalid:1,
    complete_receipt_message_present:2,complete_receipt_message_missing:1,complete_receipt_message_matches:2,
    expired_reserved_leases:3,potential_unreferenced_canonical_entries:4,
    expired_reserved_potential_unreferenced_entries:2,live_reserved_potential_unreferenced_entries:1,
    complete_potential_unreferenced_entries:1,
  });
  assert.equal(report.states.reserved.entries+report.states.complete.entries,report.charged.entries);
  assert.equal(report.states.reserved.bytes+report.states.complete.bytes,report.charged.bytes);
  assert.equal(counters(report).storage_rows_present+counters(report).storage_rows_missing,report.charged.entries);
  assert.deepEqual(report.evidence,{canonical_columns_and_db_metadata_only:true,candidate_counts_are_not_orphan_proof:true,
    http_or_object_bytes_checked:false,legacy_url_fields_examined:false,cleanup_authorized:false,quota_refund_authorized:false});
  const output=JSON.stringify(report);
  for (const r of rows) for (const secret of [r.bot,r.chat,r.key,r.fingerprint,r.path,r.lease]) {
    assert.equal(output.includes(secret),false,"aggregate output exposed a receipt identifier");
  }
});

test("empty ledger gives a known zero control without counting unrelated Storage objects",async(t)=>{
  const db=await postgres(t);
  await db.exec("insert into storage.objects(bucket_id,name,metadata) values ('unrelated-control','control','{}');");
  const report=await observe(db);
  assert.deepEqual(report.charged,{entries:0,bytes:0,rolling_24h_entries:0,rolling_24h_bytes:0});
  assert.ok(Object.values(counters(report)).every(value=>value===0));
});

test("the actual 20000 receipt boundary accepts equality and rejects one more admission",async(t)=>{
  const db=await postgres(t),r=request(1);
  await db.service(reserveSql(r));
  const extend = (first,last) => db.exec(`
    insert into private.bot_media_ingests(
      bot_id,idempotency_key,owner_token_id,chat_id,method,request_fingerprint,
      object_path,content_sha256,content_type,byte_size,lease_id,lease_expires_at,created_at
    ) select i.bot_id,'audit-cap-'||n,i.owner_token_id,i.chat_id,i.method,
      lpad(to_hex(n),64,'0'),i.chat_id::text||'/bots/'||i.bot_id::text||'/'||lpad(to_hex(n),64,'0')||'.pdf',
      i.content_sha256,i.content_type,i.byte_size,gen_random_uuid(),i.lease_expires_at,i.created_at
    from private.bot_media_ingests i cross join generate_series(${first},${last}) n
    where i.idempotency_key=${quote(r.key)};
  `);
  await extend(2,20000);
  const atLimit=await observe(db);
  assert.equal(atLimit.charged.entries,20000);
  assert.equal(atLimit.charged.bytes,1360000);
  assert.equal(counters(atLimit).storage_rows_missing,20000);
  await extend(20001,20001);
  await assert.rejects(observe(db),/bot_media_ingest_audit_ledger_limit_exceeded/);
  const raisedLimit=sql().replace("LIMIT 20001","LIMIT 20002").replace(">20000",">20001");
  assert.notEqual(raisedLimit,sql());
  assert.equal((await observe(db,raisedLimit)).charged.entries,20001);
});

test("schema/index/state drift and RLS-filtered roles fail loudly instead of returning zeros",async(t)=>{
  const db=await postgres(t);
  for (const [change,restore,reason] of [
    ["alter table private.bot_media_ingests rename column state to state_drift;",
      "alter table private.bot_media_ingests rename column state_drift to state;","column_drift"],
    ["alter table private.bot_media_ingests alter column result type text using result::text;",
      "alter table private.bot_media_ingests alter column result type jsonb using result::jsonb;","column_drift"],
    ["alter table private.bot_media_ingests drop constraint bot_media_ingests_state_check;",
      "alter table private.bot_media_ingests add constraint bot_media_ingests_state_check check(state in ('reserved','complete'));","state_contract_drift"],
    ["alter table storage.objects drop constraint objects_bucket_id_name_key;",
      "alter table storage.objects add constraint objects_bucket_id_name_key unique(bucket_id,name);","index_drift"],
    ["alter table storage.objects owner to postgres;",
      "alter table storage.objects owner to supabase_storage_admin;","relation_drift"],
  ]) {
    await db.exec(change); await assert.rejects(observe(db),new RegExp(`bot_media_ingest_audit_${reason}`));
    await db.exec(restore);
  }
  await db.exec("grant usage on schema private to authenticated; grant select on private.bot_media_ingests to authenticated;");
  await assert.rejects(db.exec("set role authenticated;"+sql()),/bot_media_ingest_audit_bypassrls_required/);
  assert.equal((await observe(db)).charged.entries,0);
});

test("PostgreSQL actually rejects persistent DML/DDL; a read-write mutant fails the transaction guard",async(t)=>{
  const db=await postgres(t),r=request(1);
  await db.service(reserveSql(r)); await object(db,r);
  for (const operation of [
    "insert into public.messages(chat_id,type) values ('"+chat+"','file');",
    "update private.bot_media_ingests set byte_size=1;",
    "delete from storage.objects where false;",
    "alter table private.bot_media_ingests add column forbidden_audit_write text;",
  ]) await assert.rejects(db.exec(sql().replace("WITH receipt_rows AS MATERIALIZED",operation+"\nWITH receipt_rows AS MATERIALIZED")),
    error=>error.code==="25006" && /read-only transaction/.test(error.message));
  await assert.rejects(db.exec(sql().replace("REPEATABLE READ READ ONLY","REPEATABLE READ READ WRITE")),/bot_media_ingest_audit_transaction_required/);
  const report=await observe(db);
  assert.equal(report.charged.entries,1); assert.equal(report.charged.bytes,68);
  assert.equal(counters(report).storage_rows_present,1);
});

test("strict expiry equality and deleted-reference exclusion have observable semantic mutants",async(t)=>{
  const db=await postgres(t),r=request(1);
  await db.service(reserveSql(r)); await object(db,r);
  const atBoundary=sql().replaceAll("transaction_timestamp()","timestamptz '2030-01-01 00:00:00+00'");
  await db.exec("update private.bot_media_ingests set lease_expires_at='2030-01-01 00:00:00+00';");
  assert.equal(counters(await observe(db,atBoundary)).expired_reserved_leases,1);
  assert.equal(counters(await observe(db,atBoundary.replaceAll("lease_expires_at<=","lease_expires_at<"))).expired_reserved_leases,0);
  await db.exec("update private.bot_media_ingests set lease_expires_at='2030-01-01 00:00:00.000001+00';");
  assert.equal(counters(await observe(db,atBoundary)).expired_reserved_leases,0);
  await db.exec(`insert into public.messages(chat_id,type,media_bucket,media_path,deleted_at)
    values ('${chat}','file','chat-media',${quote(r.path)},now());`);
  assert.equal(counters(await observe(db)).potential_unreferenced_canonical_entries,0);
  const mutant=sql().replace("m.media_path=i.object_path\n  GROUP BY","m.media_path=i.object_path AND m.deleted_at IS NULL\n  GROUP BY");
  assert.notEqual(mutant,sql());
  assert.equal(counters(await observe(db,mutant)).potential_unreferenced_canonical_entries,1);
});

test("actual two-connection interleaving uses one repeatable-read snapshot, then a fresh report sees the reference",async(t)=>{
  const db=await postgres(t),r=request(1),gate=db.session(),reader=db.session();
  await db.service(reserveSql(r)); await object(db,r);
  const pid=Number(await reader.send("select pg_backend_pid();"));
  await gate.send("begin; select pg_advisory_xact_lock(829102003);");
  const source=sql().replace("$catalog_precheck$;",
    "$catalog_precheck$;\nSET LOCAL lock_timeout='10s';\nSELECT pg_advisory_xact_lock(829102003);\nSET LOCAL lock_timeout='2s';");
  const pending=reader.send(source);
  let waiting=false;
  for (let i=0;i<50;i++) {
    const [row]=await db.query(`select wait_event='advisory' as waiting from pg_stat_activity where pid=${pid}`);
    if (row?.waiting) { waiting=true; break; }
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  assert.equal(waiting,true);
  await db.exec(`insert into public.messages(chat_id,type,media_bucket,media_path)
    values ('${chat}','file','chat-media',${quote(r.path)});`);
  await gate.send("commit;");
  const snapshot=JSON.parse((await pending).trim());
  assert.equal(counters(snapshot).potential_unreferenced_canonical_entries,1);
  const next=await observe(db);
  assert.equal(counters(next).receipts_with_any_canonical_reference,1);
  assert.equal(counters(next).potential_unreferenced_canonical_entries,0);
});

test("Storage lookups remain keyed with thousands of unrelated objects, not a bucket inventory",async(t)=>{
  const db=await postgres(t),r=request(1);
  await db.service(reserveSql(r)); await object(db,r);
  await db.exec(`insert into storage.objects(bucket_id,name,metadata)
    select 'unrelated-control','control-'||i,'{}' from generate_series(1,5000) i; analyze storage.objects;`);
  const plan=JSON.parse(await db.exec(sql().replace("WITH receipt_rows AS MATERIALIZED","EXPLAIN (FORMAT JSON) WITH receipt_rows AS MATERIALIZED")));
  const nodes=[];
  const walk=node=>{ if (node["Relation Name"]==="objects") nodes.push(node); for (const child of node.Plans??[]) walk(child); };
  walk(plan[0].Plan);
  assert.ok(nodes.length>0);
  assert.ok(nodes.every(node=>["Index Scan","Index Only Scan"].includes(node["Node Type"]) && /bucket_id/.test(node["Index Cond"]) && /name/.test(node["Index Cond"])));
  assert.equal(counters(await observe(db)).storage_rows_present,1);
});
