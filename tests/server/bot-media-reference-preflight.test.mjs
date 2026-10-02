import assert from "node:assert/strict";
import test from "node:test";
import { postgres,read,reservation,reserveSql,commitSql,object,uuid,quote,bot,chat,token } from "./bot-inline-media-ingest.fixture.mjs";

const source=()=>read("scripts/bot-media-reference-preflight.sql");
const clock=sql=>sql.replaceAll("transaction_timestamp()","timestamptz '2030-01-01 00:00:00+00'");
const request=n=>{ const fingerprint=n.toString(16).padStart(64,"0"); return reservation({
  key:`reference-fixture-${n}`,fingerprint,lease:uuid(100+n),path:`${chat}/bots/${bot}/${fingerprint}.pdf`}); };
const publicUrl=r=>"https://core.letscube.ru/storage/v1/object/public/chat-media/"+r.path;
const observe=async(db,sql=source())=>{
  const lines=(await db.exec(sql)).split("\n").filter(line=>line.trim());
  assert.equal(lines.length,1,"preflight must emit one aggregate JSON row");
  return JSON.parse(lines[0]);
};
async function fixture(t) {
  const db=await postgres(t);
  // Supplied catalog shape, fictional rows only. The shared bootstrap is unchanged.
  await db.exec(`
    alter table public.messages add column media_url text;
    alter table public.chats add column avatar_url text;
    alter table public.bots add column avatar_url text;
    create table public.profiles(id uuid primary key,avatar_url text);
    alter table public.profiles owner to postgres; alter table public.profiles enable row level security;
    create table public.media_variants(id uuid primary key default gen_random_uuid(),source_bucket text,source_path text,
      variant_bucket text,variant_path text,message_id uuid,status text);
    alter table public.media_variants owner to supabase_admin; alter table public.media_variants enable row level security;
    create table public.content_reports(id uuid primary key default gen_random_uuid(),message_id uuid,status text);
    alter table public.content_reports owner to postgres; alter table public.content_reports enable row level security;
    create table private.message_media_purge(id uuid primary key default gen_random_uuid(),bucket text,path text,status text,
      claimed_until timestamptz,message_id uuid);
    alter table private.message_media_purge owner to postgres;
  `);
  return db;
}
async function seed(db) {
  const rows=Array.from({length:7},(_,i)=>request(i+1));
  for(const r of rows) { await db.service(reserveSql(r)); await object(db,r); }
  await db.service(commitSql(rows[0]));
  const preview=(r,bucket)=>quote(JSON.stringify({preview:{path:r.path,bucket,width:1,height:1}}));
  await db.exec(`
    update public.messages set bot_id='${uuid(10)}',chat_id='${uuid(11)}',deleted_at=now();
    insert into public.messages(id,chat_id,user_id,type,media_bucket,media_path)
      values ('${uuid(41)}','${uuid(11)}','${uuid(91)}','file','chat-media',${quote(rows[0].path)});
    insert into public.messages(id,chat_id,type,media_bucket,media_metadata,deleted_at) values
      ('${uuid(42)}','${uuid(11)}','image','chat-media',${preview(rows[1],"ignored")},now()),
      ('${uuid(49)}','${uuid(11)}','image','other-bucket',${preview(rows[1],"chat-media")},null),
      ('${uuid(48)}','${uuid(11)}','image',null,${preview(rows[6],"chat-media")},null);
    insert into public.messages(id,chat_id,type) values
      ('${uuid(43)}','${uuid(11)}','file'),('${uuid(44)}','${uuid(11)}','file'),('${uuid(45)}','${uuid(11)}','file');
    insert into public.messages(id,chat_id,type,media_url,deleted_at) values
      ('${uuid(46)}','${uuid(11)}','file',${quote(publicUrl(rows[4]))},now()),
      ('${uuid(47)}','${uuid(11)}','file',${quote(publicUrl(rows[4]).replace('/public/','/sign/')+'?token=fictional')},null),
      ('${uuid(50)}','${uuid(11)}','file',${quote(publicUrl(rows[6]).replaceAll('/bots/','%2Fbots%2F'))},null);
    insert into public.profiles(id,avatar_url) values
      ('${uuid(70)}',${quote(publicUrl(rows[5]))}),('${uuid(71)}','https://foreign.invalid/picture');
    update public.chats set avatar_url=${quote(publicUrl(rows[5]).replace('/public/','/authenticated/'))} where id='${chat}';
    update public.bots set avatar_url=${quote(publicUrl(rows[5]))} where id='${bot}';
    insert into public.media_variants(source_bucket,source_path,variant_bucket,variant_path,message_id,status) values
      ('chat-media',${quote(rows[2].path)},'other-bucket','control','${uuid(43)}','failed'),
      ('other-bucket','control','chat-media',${quote(rows[3].path)},'${uuid(44)}','ready'),
      ('other-bucket','control','chat-media',${quote(rows[3].path)},'${uuid(45)}','pending');
    insert into public.content_reports(message_id,status)
      select id,'new' from public.messages where media_path=${quote(rows[0].path)};
    insert into public.content_reports(message_id,status) values
      ('${uuid(43)}','new'),('${uuid(46)}','reviewing'),('${uuid(44)}','resolved');
    insert into private.message_media_purge(bucket,path,status,claimed_until,message_id) values
      ('chat-media',${quote(rows[0].path)},'pending',null,'${uuid(41)}'),
      ('chat-media',${quote(rows[1].path)},'pending','2030-01-01 00:00:00.000001+00','${uuid(42)}'),
      ('chat-media',${quote(rows[1].path)},'pending','2030-01-01 00:00:00+00','${uuid(49)}'),
      ('chat-media',${quote(rows[2].path)},'pending','2029-12-31 23:59:59.999999+00','${uuid(43)}'),
      ('chat-media',${quote(rows[3].path)},'done',null,'${uuid(44)}'),
      ('chat-media',${quote(rows[4].path)},'failed',null,'${uuid(46)}'),
      ('chat-media',${quote(rows[5].path)},'kept',null,null),
      ('chat-media',${quote(rows[6].path)},'unrecognized',null,null),
      ('other-bucket',${quote(rows[0].path)},'pending',null,null);
  `);
  return rows;
}
const metric=(rows,receipt_entries,charged_bytes)=>({rows,receipt_entries,charged_bytes});
function verify(report) {
  assert.equal(report.report,"bot_media_reference_preflight_v1");
  assert.deepEqual(report.limits,{receipt_entries_max:20000,statement_timeout_ms:15000,lock_timeout_ms:2000});
  assert.deepEqual(report.charged,{entries:7,bytes:476,reserved_entries:6,complete_entries:1,
    complete_result_message_id_present:1,complete_completed_at_present:1});
  assert.deepEqual(report.reference_surfaces,{
    canonical_messages:metric(2,1,68),preview_paths_in_message_bucket:metric(1,1,68),
    preview_bucket_unknown:metric(1,1,68),preview_bucket_mismatch:metric(1,1,68),
    variant_sources:metric(1,1,68),variant_targets:metric(2,1,68),legacy_message_urls:metric(2,1,68),
    profile_avatar_urls:metric(1,1,68),chat_avatar_urls:metric(1,1,68),bot_avatar_urls:metric(1,1,68),
  });
  assert.equal(report.receipts_with_observed_reference,6);
  assert.equal(report.receipts_with_observed_noncanonical_but_no_canonical_message,5);
  assert.deepEqual(report.content_report_holds,{associated_rows:5,open_rows:4,open_receipt_entries:3});
  assert.deepEqual(report.purge_overlap,{rows:8,receipt_entries:7,pending_rows:4,done_rows:1,kept_rows:1,failed_rows:1,
    unknown_status_rows:1,pending_unclaimed_rows:1,pending_claim_strictly_expired_rows:1,
    pending_claim_active_or_boundary_rows:2,receipt_entries_with_observed_reference:6});
  assert.equal(report.coverage.nonempty_url_rows,7);
  assert.equal(report.coverage.known_literal_chat_media_endpoint_rows,5);
  assert.equal(report.coverage.encoded_or_unrecognized_url_rows,2);
  assert.equal(report.coverage.encoded_or_unrecognized_urls_unresolved_for_all_receipts,true);
  assert.equal(report.coverage.preview_ui_bucket_is_parent_message_bucket,true);
  assert.equal(report.coverage.preview_purge_null_bucket_fallback_is_media,true);
  assert.equal(report.coverage.purge_claim_eligibility_proven,false);
  assert.equal(report.coverage.preview_renderer_validity_proven,false);
  assert.equal(report.coverage.exhaustive_url_decoder,false);
  assert.equal(report.coverage.deletion_authorized,false);
  assert.equal(report.coverage.quota_release_authorized,false);
}

test("source preserves literal RR READ ONLY/timeouts/cap/final rollback and no write commands",()=>{
  const code=source().replace(/--[^\n]*/g,"").trim();
  assert.ok(code.startsWith("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;"));
  assert.ok(code.endsWith("ROLLBACK;"));
  assert.match(code,/SET LOCAL statement_timeout = '15s';/); assert.match(code,/SET LOCAL lock_timeout = '2s';/);
  assert.match(code,/LIMIT 20001/); assert.match(code,/>20000/);
  assert.doesNotMatch(code,/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|COMMIT)\b/i);
  assert.doesNotMatch(code,/\b(user_id|owner_token_id|content_sha256|request_fingerprint)\b/i);
});
test("actual canonical-only RED has one receipt versus six observed references; extended literal control is GREEN",async(t)=>{
  const db=await fixture(t); await seed(db);
  const old=await observe(db,read("scripts/bot-media-ingest-audit.sql"));
  assert.equal(old.canonical_columns_and_db_metadata_candidates.receipts_with_any_canonical_reference,1);
  assert.throws(()=>assert.equal(old.canonical_columns_and_db_metadata_candidates.receipts_with_any_canonical_reference,6),{code:"ERR_ASSERTION"});
  t.diagnostic("EXPECTED RED canonical-only reference coverage: actual 1, required 6; no accepted audit edit");
  verify(await observe(db,clock(source())));
});
test("empty positive control emits zeros but never resolves URL coverage or authorizes deletion",async(t)=>{
  const db=await fixture(t),report=await observe(db);
  assert.equal(report.charged.entries,0); assert.equal(report.charged.bytes,0);
  assert.ok(Object.values(report.reference_surfaces).every(m=>m.rows===0&&m.receipt_entries===0&&m.charged_bytes===0));
  assert.equal(report.purge_overlap.rows,0); assert.equal(report.content_report_holds.open_rows,0);
  assert.equal(report.coverage.encoded_or_unrecognized_urls_unresolved_for_all_receipts,true);
  assert.equal(report.coverage.deletion_authorized,false);
});
test("parent bucket and strict purge claim equality distinguish known/mismatch/unknown observations",async(t)=>{
  const db=await fixture(t); await seed(db);
  const report=await observe(db,clock(source())); verify(report);
  const p=report.purge_overlap;
  assert.equal(p.pending_unclaimed_rows+p.pending_claim_strictly_expired_rows+p.pending_claim_active_or_boundary_rows,p.pending_rows);
  assert.equal(report.reference_surfaces.preview_bucket_unknown.receipt_entries,1);
  assert.equal(report.receipts_with_observed_reference,6,"unknown preview bucket is not a known reference");
});
test("five executable semantic mutants break independent literal counts",async(t)=>{
  const db=await fixture(t); await seed(db);
  for(const [anchor,replacement] of [
    ["FROM public.messages m\n)","FROM public.messages m WHERE m.deleted_at IS NULL\n)"],
    ["WHEN p.media_bucket='chat-media' THEN","WHEN p.media_bucket='chat-media' OR p.media_bucket IS NULL THEN"],
    ["v.source_path=r.object_path","v.source_path=r.object_path AND v.status='ready'"],
    ["u.known_literal_endpoint AND u.literal_url=t.literal_url","u.known_literal_endpoint AND u.kind<>'legacy_message_urls' AND u.literal_url=t.literal_url"],
    ["claimed_until<transaction_timestamp()","claimed_until<=transaction_timestamp()"],
  ]) {
    assert.ok(source().includes(anchor));
    const mutant=source().replace(anchor,replacement),report=await observe(db,clock(mutant));
    assert.throws(()=>verify(report),{code:"ERR_ASSERTION"},"semantic mutant must fail the literal regression oracle");
  }
});
test("catalog/role drift fails loudly, including expected non-RLS purge design",async(t)=>{
  const db=await fixture(t);
  for(const [change,restore,reason] of [
    ["alter table public.messages alter column media_metadata type text using media_metadata::text;",
      "alter table public.messages alter column media_metadata type jsonb using media_metadata::jsonb;","column_drift"],
    ["alter table public.profiles rename column avatar_url to drift_avatar_url;",
      "alter table public.profiles rename column drift_avatar_url to avatar_url;","column_drift"],
    ["alter table public.media_variants owner to postgres;","alter table public.media_variants owner to supabase_admin;","relation_drift"],
    ["alter table private.message_media_purge enable row level security;","alter table private.message_media_purge disable row level security;","relation_drift"],
  ]) { await db.exec(change); await assert.rejects(observe(db),new RegExp(`bot_media_reference_preflight_${reason}`)); await db.exec(restore); }
  await assert.rejects(db.exec("set role authenticated;"+source()),/bot_media_reference_preflight_bypassrls_required/);
  assert.equal((await observe(db)).charged.entries,0);
});
test("actual read-only refusal and aggregate output never expose identifiers or URL tokens",async(t)=>{
  const db=await fixture(t),rows=await seed(db),report=await observe(db);
  for(const write of ["update private.message_media_purge set status='done';",
    "delete from private.bot_media_ingests where false;","insert into public.profiles(id) values (gen_random_uuid());"]) {
    await assert.rejects(db.exec(source().replace("WITH receipts AS MATERIALIZED",write+"\nWITH receipts AS MATERIALIZED")),
      error=>error.code==="25006"&&/read-only transaction/.test(error.message));
  }
  await assert.rejects(db.exec(source().replace("REPEATABLE READ READ ONLY","REPEATABLE READ READ WRITE")),/bot_media_reference_preflight_transaction_required/);
  const output=JSON.stringify(report);
  for(const r of rows) for(const value of [r.bot,r.chat,r.path,r.key,r.lease,r.fingerprint,publicUrl(r),token,"?token=fictional"]) {
    assert.equal(output.includes(value),false,"aggregate output leaked a reference identifier");
  }
  assert.doesNotMatch(output,/deletion_eligible|orphan_eligible|safe_to_delete/);
  assert.equal((await observe(db)).charged.bytes,476);
});
test("literal 20000 receipt cap fails at +1, and a limit mutant demonstrably misses it",async(t)=>{
  const db=await fixture(t);
  await db.exec(`insert into private.bot_media_ingests(bot_id,idempotency_key,owner_token_id,chat_id,method,request_fingerprint,
      object_path,content_sha256,content_type,byte_size,lease_id,lease_expires_at,created_at)
    select '${bot}','preflight-cap-'||i,'${token}','${chat}','sendDocument',lpad(to_hex(i),64,'0'),
      '${chat}/bots/${bot}/'||lpad(to_hex(i),64,'0')||'.pdf',repeat('b',64),'application/pdf',1,gen_random_uuid(),now(),now()
    from generate_series(1,20001) i;`);
  await assert.rejects(observe(db),/bot_media_reference_preflight_ledger_limit_exceeded/);
  const mutant=await observe(db,source().replace("LIMIT 20001","LIMIT 20000"));
  assert.equal(mutant.charged.entries,20001);
  await db.exec("delete from private.bot_media_ingests where idempotency_key='preflight-cap-20001';");
  assert.equal((await observe(db)).charged.entries,20000);
});
