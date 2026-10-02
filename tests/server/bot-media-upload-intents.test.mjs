import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { postgres,read,reservation,reserveSql,commitSql,object,quote,uuid,bot,token,chat } from "./bot-inline-media-ingest.fixture.mjs";

const stem="supabase/migrations/20261002155123_bot_media_upload_intents";
const beginSignature="public.bot_media_upload_begin_internal(uuid,uuid,uuid,text,text,uuid,text,text,bigint,text)";
const finishSignature="public.bot_media_upload_finish_internal(uuid,text,uuid,text)";
const source=()=>read(stem+".sql");
const sha=value=>createHash("sha256").update(value).digest("hex");
const sqlValue=value=>value===null?"null":quote(value);
const beginSql=r=>"select public.bot_media_upload_begin_internal("+
  [r.bot,r.token,r.chat,r.key,r.fingerprint,r.lease,r.path,r.mime,r.size,r.digest].map(sqlValue).join(",")+") as value";
const finishSql=(r,outcome="acknowledged")=>"select public.bot_media_upload_finish_internal("+
  [r.bot,r.key,r.lease,outcome].map(sqlValue).join(",")+") as value";
const begin=async(db,r)=>(await db.service(beginSql(r))).value;
const finish=async(db,r,outcome)=>(await db.service(finishSql(r,outcome))).value;
const reserve=async(db,r)=>(await db.service(reserveSql(r))).value;
const next=(n,overrides={})=>{const r=reservation({key:`upload-intent-${n}`,fingerprint:n.toString(16).padStart(64,"0"),lease:uuid(100+n),...overrides});
  r.path=`${r.chat}/bots/${r.bot}/${r.fingerprint}.pdf`; return r;};
const count=async(db)=>(await db.query("select count(*)::int as n from private.bot_media_upload_attempts"))[0].n;
const receipt=async(db,r)=>(await db.query(`select to_jsonb(i) as value from private.bot_media_ingests i where bot_id=${quote(r.bot)} and idempotency_key=${quote(r.key)}`))[0].value;
const denied=(operation,name,code)=>assert.rejects(operation,error=>{
  assert.match(error.message,new RegExp(name)); if(code) assert.equal(error.code,code); return true;
});
async function fixture(t,sql=source()) {
  const db=await postgres(t),before=await oldCatalog(db);
  if(!process.env.BOT_UPLOAD_TEST_BASELINE) await db.exec(sql);
  assert.deepEqual(await oldCatalog(db),before,"additive SQL must not change any existing function body/catalog");
  return db;
}
async function rotate(db,r,lease) {
  await db.exec(`update private.bot_media_ingests set lease_expires_at=clock_timestamp()-interval '1 second' where bot_id=${quote(r.bot)} and idempotency_key=${quote(r.key)};`);
  const fresh={...r,lease}; await reserve(db,fresh); return fresh;
}
async function waiting(db,pid) {
  for(let i=0;i<40;i++) {
    if((await db.query(`select wait_event='advisory' as waiting from pg_stat_activity where pid=${pid}`))[0]?.waiting) return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error("independent session did not reach the operation advisory lock");
}
async function oldCatalog(db) {
  return db.query(`select p.oid::regprocedure::text as signature,prosrc,proacl::text,proconfig::text,proowner,prosecdef,provolatile
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','storage')
      and p.proname not in ('bot_media_upload_begin_internal','bot_media_upload_finish_internal') order by 1`);
}
function functionBody(sql,name) { return sql.split(`CREATE FUNCTION public.${name}`)[1].split("$function$")[1]; }
function rehash(sql,mutant,name) { return mutant.replace(sha(functionBody(sql,name)),sha(functionBody(mutant,name))); }

test("pending attempt exists before simulated PUT and leaves charged receipt/result immutable",async(t)=>{
  const db=await fixture(t),r=next(1); await reserve(db,r);
  const initial=await receipt(db,r),old=await oldCatalog(db);
  assert.equal((await db.query("select count(*)::int as n from storage.objects"))[0].n,0);
  const policies=await db.query("select polname,polcmd,polroles::text,polpermissive,pg_get_expr(polqual,polrelid) as u,pg_get_expr(polwithcheck,polrelid) as c from pg_policy where polrelid='storage.objects'::regclass order by 1");
  assert.deepEqual(await begin(db,r),{attempt_id:r.lease,state:"pending"});
  const [stored]=await db.query("select * from private.bot_media_upload_attempts");
  assert.equal(stored.attempt_id,r.lease); assert.equal(stored.state,"pending"); assert.equal(stored.observed_at,null);
  for(const [column,value] of Object.entries({bot_id:r.bot,idempotency_key:r.key,owner_token_id:r.token,chat_id:r.chat,
    request_fingerprint:r.fingerprint,object_path:r.path,content_type:r.mime,byte_size:r.size,content_sha256:r.digest})) assert.equal(stored[column],value);
  assert.equal((await db.query("select count(*)::int as n from storage.objects"))[0].n,0,"begin never performs external I/O");
  await object(db,r); assert.deepEqual(await finish(db,r),{attempt_id:r.lease,state:"acknowledged"});
  assert.deepEqual(await receipt(db,r),initial); assert.deepEqual(await oldCatalog(db),old);
  assert.deepEqual(await db.query("select polname,polcmd,polroles::text,polpermissive,pg_get_expr(polqual,polrelid) as u,pg_get_expr(polwithcheck,polrelid) as c from pg_policy where polrelid='storage.objects'::regclass order by 1"),policies);
  const result=(await db.service(commitSql(r))).value;
  const complete=await receipt(db,r); await finish(db,r);
  assert.deepEqual(await receipt(db,r),complete); assert.deepEqual(complete.result,result.result);
  assert.equal(complete.created_at,initial.created_at); assert.equal(complete.byte_size,68); assert.equal(complete.state,"complete");
  await denied(begin(db,r),"bot_media_upload_reservation_invalid","42501");
});

test("begin rejects stale expired revoked removed inactive and wrong immutable snapshots",async(t)=>{
  const db=await fixture(t),r=next(2); await reserve(db,r);
  for(const changes of [{chat:uuid(11)},{fingerprint:"c".repeat(64)},{path:r.path+".other"},{mime:"image/png"},{size:69},{digest:"c".repeat(64)}])
    await denied(begin(db,{...r,...changes}),"bot_media_upload_snapshot_conflict","23505");
  await denied(begin(db,{...r,lease:uuid(999)}),"bot_media_upload_lease_invalid","42501");
  await db.exec(`insert into private.bot_tokens(id,bot_id) values ('${uuid(20)}','${bot}');`);
  await denied(begin(db,{...r,token:uuid(20)}),"bot_media_upload_lease_invalid","42501");
  for(const [change,restore,error] of [
    [`update private.bot_tokens set revoked_at=now() where id='${token}';`,`update private.bot_tokens set revoked_at=null where id='${token}';`,"bot_media_ingest_token_revoked"],
    [`update public.bots set state='disabled' where id='${bot}';`,`update public.bots set state='active' where id='${bot}';`,"bot_media_ingest_token_revoked"],
    [`update public.chat_bot_members set removed_at=now() where bot_id='${bot}';`,`update public.chat_bot_members set removed_at=null where bot_id='${bot}';`,"bot_chat_forbidden"],
  ]) {await db.exec(change); await denied(begin(db,r),error,"42501"); await db.exec(restore);}
  await db.exec("update private.bot_media_ingests set lease_expires_at=clock_timestamp();");
  await denied(begin(db,r),"bot_media_ingest_lease_expired","55000");
  for(const changes of [{bot:null},{token:null},{chat:null},{key:"short"},{key:null},{fingerprint:"x"},{lease:null},{path:null},
    {mime:null},{mime:"text/plain"},{size:0},{size:6291457},{digest:null},{digest:"A".repeat(64)}])
    await denied(begin(db,{...r,...changes}),"bot_media_upload_input_invalid","22023");
  assert.equal(await count(db),0);
});

test("one attempt per lease cannot authorize another PUT and finish authenticates exact stored identity",async(t)=>{
  const db=await fixture(t),r=next(3); await reserve(db,r); await begin(db,r);
  for(const outcome of ["pending","unknown","acknowledged"]) {
    if(outcome!=="pending") {const fresh=await rotate(db,r,uuid(outcome==="unknown"?301:302)); await begin(db,fresh); await finish(db,fresh,outcome);}
    await denied(begin(db,outcome==="pending"?r:{...r,lease:uuid(outcome==="unknown"?301:302)}),"bot_media_upload_attempt_exists","23505");
  }
  for(const change of [{bot:uuid(10)},{key:"another-key"},{lease:uuid(999)}]) await denied(finish(db,{...r,...change}),"bot_media_upload_attempt_not_found","42501");
  for(const change of [{bot:null},{key:null},{lease:null}]) await denied(finish(db,{...r,...change}),"bot_media_upload_input_invalid","22023");
  for(const outcome of [null,"pending","complete","ACKNOWLEDGED"]) await denied(finish(db,r,outcome),"bot_media_upload_input_invalid","22023");
  assert.equal(await count(db),3);
  await db.exec(`update private.bot_media_ingests set lease_expires_at=clock_timestamp()-interval '1 second';`);
  await reserve(db,{...r,lease:uuid(303)});
  const other=next(31,{lease:r.lease}); await reserve(db,other);
  await denied(begin(db,other),"bot_media_upload_attempt_exists","23505");
  assert.equal(await count(db),3,"globally reused attempt ID must not create a different receipt's intent");
});

test("unknown is an indefinite hold and late finish remains idempotent after revoke and lease transfer",async(t)=>{
  const db=await fixture(t),r=next(4); await reserve(db,r); await begin(db,r); await finish(db,r,"unknown");
  const [unknown]=await db.query("select to_jsonb(a) as value from private.bot_media_upload_attempts a");
  const fresh=await rotate(db,r,uuid(404)); await begin(db,fresh);
  await db.exec(`update private.bot_tokens set revoked_at=now() where id='${token}'; update public.chat_bot_members set removed_at=now() where bot_id='${bot}';`);
  const initial=await receipt(db,r);
  assert.deepEqual(await finish(db,r,"unknown"),{attempt_id:r.lease,state:"unknown"});
  await denied(finish(db,r,"acknowledged"),"bot_media_upload_outcome_conflict","23505");
  assert.deepEqual((await db.query(`select to_jsonb(a) as value from private.bot_media_upload_attempts a where attempt_id='${r.lease}'`))[0].value,unknown.value);
  assert.deepEqual(await finish(db,fresh),{attempt_id:fresh.lease,state:"acknowledged"});
  const [observed]=await db.query(`select observed_at from private.bot_media_upload_attempts where attempt_id='${fresh.lease}'`);
  await finish(db,fresh); assert.deepEqual((await db.query(`select observed_at from private.bot_media_upload_attempts where attempt_id='${fresh.lease}'`))[0],observed);
  await denied(finish(db,fresh,"unknown"),"bot_media_upload_outcome_conflict","23505");
  assert.deepEqual(await receipt(db,r),initial);
});

test("literal 64 attempts accepted including acknowledged; 65 refused without recharge or cross-receipt contamination",async(t)=>{
  const db=await fixture(t),r=next(5); await reserve(db,r); const initial=await receipt(db,r);
  let current=r;
  for(let i=1;i<=64;i++) {
    if(i>1) current=await rotate(db,r,uuid(500+i));
    await begin(db,current); if(i%2===0) await finish(db,current,"acknowledged");
  }
  current=await rotate(db,r,uuid(565)); await denied(begin(db,current),"bot_media_upload_attempts_exceeded","54000");
  assert.equal(await count(db),64); const after=await receipt(db,r);
  for(const field of ["created_at","byte_size","result","state","completed_at"]) assert.deepEqual(after[field],initial[field]);
  const control=next(6); await reserve(db,control); await begin(db,control);
  assert.equal(await count(db),65); assert.equal((await db.query("select sum(byte_size)::int as bytes from private.bot_media_ingests"))[0].bytes,136);
});

test("table and column ACL deny direct anon/authenticated/service access while RPCs are service only",async(t)=>{
  const db=await fixture(t),r=next(7); await reserve(db,r);
  await db.exec("grant usage on schema private to anon,authenticated,service_role;");
  for(const role of ["anon","authenticated","service_role"]) for(const sql of [
    "select * from private.bot_media_upload_attempts;","select state from private.bot_media_upload_attempts;",
    "insert into private.bot_media_upload_attempts(bot_id) values (gen_random_uuid());",
    "update private.bot_media_upload_attempts set state='unknown';","delete from private.bot_media_upload_attempts;"]) {
    await denied(db.exec(`set role ${role}; ${sql}`),"permission denied","42501");
  }
  for(const role of ["anon","authenticated"]) for(const sql of [beginSql(r),finishSql(r)]) await denied(db.exec(`set role ${role}; ${sql};`),"permission denied","42501");
  await begin(db,r); await finish(db,r);
  assert.equal((await db.query("select relrowsecurity as rls from pg_class where oid='private.bot_media_upload_attempts'::regclass"))[0].rls,true);
});

test("two actual sessions serialize begin against begin and finish on the shared operation lock",async(t)=>{
  const db=await fixture(t),a=db.session(),b=db.session(),r=next(8); await reserve(db,r);
  const pid=Number(await b.send("select pg_backend_pid();"));
  assert.notEqual(pid,Number(await a.send("select pg_backend_pid();")));
  await a.send(`begin; set local role service_role; ${beginSql(r)};`);
  const repeated=denied(b.send(`set role service_role; ${beginSql(r)};`),"bot_media_upload_attempt_exists","23505");
  await waiting(db,pid);
  const other=next(9); await reserve(db,other); await begin(db,other);
  await a.send("commit;"); await repeated;
  const c=db.session(),pidC=Number(await c.send("select pg_backend_pid();"));
  const r2=next(10); await reserve(db,r2);
  await a.send(`begin; set local role service_role; ${beginSql(r2)};`);
  const finishing=c.send(`set role service_role; ${finishSql(r2)};`); await waiting(db,pidC);
  await a.send("commit;"); assert.equal(JSON.parse(await finishing).state,"acknowledged");
  assert.equal(await count(db),3);
});

test("real lease-transfer orders preserve old pending intent and refuse stale begin/commit",async(t)=>{
  const db=await fixture(t),a=db.session(),b=db.session(),r=next(11); await reserve(db,r);
  await db.exec("update private.bot_media_ingests set lease_expires_at=clock_timestamp()+interval '400 milliseconds';");
  await a.send(`begin; set local role service_role; ${beginSql(r)};`);
  const fresh={...r,lease:uuid(1101)},pid=Number(await b.send("select pg_backend_pid();"));
  const transferring=b.send(`set role service_role; ${reserveSql(fresh)};`); await waiting(db,pid);
  await new Promise(resolve=>setTimeout(resolve,600)); await a.send("commit;"); await transferring;
  await object(db,r); await denied(db.service(commitSql(r)),"bot_ingest_lease_invalid","42501");
  await begin(db,fresh); await db.exec(`update private.bot_tokens set revoked_at=now() where id='${token}';`);
  await finish(db,r); assert.equal((await db.query(`select state from private.bot_media_upload_attempts where attempt_id='${r.lease}'`))[0].state,"acknowledged");
  await denied(db.service(commitSql(fresh)),"bot_media_ingest_token_revoked","42501");
  await db.exec(`update private.bot_tokens set revoked_at=null where id='${token}';`);
  const r2=next(12); await reserve(db,r2);
  await db.exec(`update private.bot_media_ingests set lease_expires_at=clock_timestamp()-interval '1 second' where idempotency_key=${quote(r2.key)};`);
  const newer={...r2,lease:uuid(1201)};
  await a.send(`begin; set local role service_role; ${reserveSql(newer)};`);
  const c=db.session(),pidC=Number(await c.send("select pg_backend_pid();"));
  const stale=denied(c.send(`set role service_role; ${beginSql(r2)};`),"bot_media_upload_lease_invalid","42501");
  await waiting(db,pidC); await a.send("commit;"); await stale;
  assert.equal(await count(db),2); assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n,0);
});

test("begin checks server wall time after actual operation-lock wait",async(t)=>{
  const db=await fixture(t),a=db.session(),b=db.session(),r=next(13); await reserve(db,r);
  await db.exec("update private.bot_media_ingests set lease_expires_at=clock_timestamp()+interval '400 milliseconds';");
  await a.send(`begin; select pg_advisory_xact_lock(hashtextextended('${bot}:${r.key}',0));`);
  const pid=Number(await b.send("select pg_backend_pid();"));
  const expired=denied(b.send(`set role service_role; ${beginSql(r)};`),"bot_media_ingest_lease_expired","55000");
  await waiting(db,pid); await new Promise(resolve=>setTimeout(resolve,650)); await a.send("commit;"); await expired;
  assert.equal(await count(db),0);
});

test("migration old body/ACL drift and raising self-check roll back the entire new install",async(t)=>{
  const db=await postgres(t),sql=source(),old=await oldCatalog(db);
  const changed=sql.replace("v_count >= 64","v_count >= 65"); assert.notEqual(changed,sql);
  await denied(db.exec(changed),"bot_media_upload_function_drift");
  assert.equal((await db.query("select to_regclass('private.bot_media_upload_attempts')::text as value"))[0].value,null);
  assert.deepEqual(await oldCatalog(db),old);
  await denied(db.exec(sql.replaceAll("LANGUAGE plpgsql SECURITY DEFINER SET search_path", "LANGUAGE plpgsql SECURITY INVOKER SET search_path")),"bot_media_upload_function_drift");
  const signature="public.bot_media_ingest_reserve_internal(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid)";
  await db.exec(`grant execute on function ${signature} to authenticated;`);
  await denied(db.exec(sql),"bot_media_upload_existing_function_drift");
  await db.exec(`revoke execute on function ${signature} from authenticated;`);
  const ddl=(await db.query(`select pg_get_functiondef('${signature}'::regprocedure) as ddl`))[0].ddl;
  await db.exec(ddl.replace("$function$","$function$\n-- isolated source drift\n"));
  await denied(db.exec(sql),"bot_media_upload_existing_function_drift");
  const grant=sql.replace("DO $selfcheck$","GRANT SELECT (state) ON private.bot_media_upload_attempts TO service_role;\nDO $selfcheck$");
  await db.exec(ddl); await denied(db.exec(grant),"bot_media_upload_table_drift");
  await db.exec(sql); assert.equal(await count(db),0);
});

test("rollback disables RPCs but preserves ledger rows/RLS/ACL and rejects function/table drift or reapply",async(t)=>{
  const db=await fixture(t),r=next(14); await reserve(db,r); await begin(db,r); await finish(db,r,"unknown");
  const capture=()=>db.query("select relowner,relrowsecurity,relacl::text,(select jsonb_agg(to_jsonb(a) order by attempt_id) from private.bot_media_upload_attempts a) as rows from pg_class where oid='private.bot_media_upload_attempts'::regclass");
  const before=await capture(),rollback=read(stem+".rollback.sql");
  await db.exec("grant select(state) on private.bot_media_upload_attempts to service_role;");
  await denied(db.exec(rollback),"bot_media_upload_table_drift");
  await db.exec("revoke select(state) on private.bot_media_upload_attempts from service_role;");
  await db.exec(`alter function ${finishSignature} set search_path=public;`);
  await denied(db.exec(rollback),"bot_media_upload_function_drift");
  await db.exec(`alter function ${finishSignature} set search_path='';`);
  for(const [change,restore,error] of [
    ["alter table private.bot_media_upload_attempts owner to supabase_admin;","alter table private.bot_media_upload_attempts owner to postgres;","bot_media_upload_table_drift"],
    ["alter table private.bot_media_upload_attempts force row level security;","alter table private.bot_media_upload_attempts no force row level security;","bot_media_upload_table_drift"],
    ["alter table private.bot_media_upload_attempts drop constraint bot_media_upload_attempts_size_check; alter table private.bot_media_upload_attempts add constraint bot_media_upload_attempts_size_check check (byte_size >= 1);",
      "alter table private.bot_media_upload_attempts drop constraint bot_media_upload_attempts_size_check; alter table private.bot_media_upload_attempts add constraint bot_media_upload_attempts_size_check check (byte_size between 1 and 6291456);","bot_media_upload_table_constraint_drift"],
  ]) {await db.exec(change); await denied(db.exec(rollback),error); assert.equal(await count(db),1); await db.exec(restore);}
  await db.exec(rollback); assert.deepEqual(await capture(),before);
  assert.equal((await db.query(`select to_regprocedure('${beginSignature}')::text as a,to_regprocedure('${finishSignature}')::text as b`))[0].a,null);
  await denied(db.service(beginSql(r)),"does not exist","42883");
  await denied(db.exec(source()),"bot_media_upload_prestate_exists"); assert.deepEqual(await capture(),before);
});

test("behavior mutants fail literal cap, snapshot, one-PUT and indefinite-unknown assertions even with updated hashes",async(t)=>{
  const sql=source();
  for(const [anchor,replacement,name,check] of [
    ["v_count >= 64","v_count >= 65","bot_media_upload_begin_internal",async(db,r)=>{
      for(let i=0;i<64;i++) {const current=i?await rotate(db,r,uuid(8000+i)):r; await begin(db,current); await finish(db,current);}
      const last=await rotate(db,r,uuid(8065)); await assert.rejects(()=>denied(begin(db,last),"bot_media_upload_attempts_exceeded"),/Missing expected rejection/);
      assert.equal(await count(db),65);
    }],
    ["OR v_row.byte_size IS DISTINCT FROM p_byte_size","OR false","bot_media_upload_begin_internal",async(db,r)=>{
      await assert.rejects(()=>denied(begin(db,{...r,size:69}),"bot_media_upload_snapshot_conflict"),/Missing expected rejection/);
      assert.equal(await count(db),1);
    }],
    ["IF v_attempt.state <> 'pending' THEN","IF v_attempt.state = 'acknowledged' THEN","bot_media_upload_finish_internal",async(db,r)=>{
      await begin(db,r); await finish(db,r,"unknown");
      await assert.rejects(()=>denied(finish(db,r),"bot_media_upload_outcome_conflict"),/Missing expected rejection/);
      assert.equal((await db.query("select state from private.bot_media_upload_attempts"))[0].state,"acknowledged");
    }],
  ]) {
    assert.equal(sql.split(anchor).length,2,"mutant must replace exactly one executable rule");
    const mutant=sql.replace(anchor,replacement),db=await fixture(t,rehash(sql,mutant,name)),r=next(20); await reserve(db,r); await check(db,r);
  }
  // One-PUT is protected both by the function and the durable unique identity, not only a count.
  const db=await fixture(t),r=next(21); await reserve(db,r); await begin(db,r); await finish(db,r);
  const body=functionBody(sql,"bot_media_upload_begin_internal");
  const softened=body.replace("RAISE EXCEPTION 'bot_media_upload_attempt_exists' USING ERRCODE='23505';",
    "RETURN pg_catalog.jsonb_build_object('attempt_id',p_lease_id,'state','pending');"); assert.notEqual(softened,body);
  const ddl=(await db.query(`select pg_get_functiondef('${beginSignature}'::regprocedure) as ddl`))[0].ddl;
  await db.exec(ddl.replace(body,()=>softened));
  await assert.rejects(()=>denied(begin(db,r),"bot_media_upload_attempt_exists"),/Missing expected rejection/);
});

test("frozen archives are byte-identical and rollback contains no ledger removal or reserve/commit replacement",()=>{
  for(const suffix of [".sql",".rollback.sql"]) assert.deepEqual(readFileSync(new URL("../../"+stem+suffix,import.meta.url)),
    readFileSync(new URL("../../.migration-backup/"+stem+suffix,import.meta.url)));
  const rollback=read(stem+".rollback.sql").replace(/--[^\n]*/g,"");
  assert.doesNotMatch(rollback,/\b(DELETE|TRUNCATE|DROP TABLE|ALTER TABLE|CREATE FUNCTION)\b/i);
  assert.equal((rollback.match(/DROP FUNCTION/g)||[]).length,2);
  const sql=source().replace(/--[^\n]*/g,"");
  assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1); assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
  assert.doesNotMatch(sql,/CREATE OR REPLACE|CREATE POLICY|FOREIGN KEY|CASCADE|letscube:bot-media-ingest:quota/);
});
