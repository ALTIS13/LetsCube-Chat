import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { postgres, reservation, reserveSql, commitSql, object, payload, capturedFunctions, quote, uuid, bot, token, chat, read, stem } from "./bot-inline-media-ingest.fixture.mjs";

const reserve = async (db,r) => (await db.service(reserveSql(r))).value;
const quotaDenied = (db,r) => assert.rejects(reserve(db,r),error=>{
  assert.equal(error.code,"54000"); assert.match(error.message,/bot_media_ingest_quota_exceeded/); return true;
});
const next = (n, overrides={}) => {
  const r=reservation({key:`concurrent-ingest-${n}`,fingerprint:n.toString(16).padStart(64,"0"),lease:uuid(100+n),size:1,...overrides});
  r.path=`${r.chat}/bots/${r.bot}/${r.fingerprint}.pdf`;
  return r;
};

async function seed(db,{bytes,count=Math.ceil(bytes/6291456),global=false,old=false}) {
  const owner=global?uuid(999):bot;
  await db.exec(`
    insert into private.bot_media_ingests(bot_id,idempotency_key,owner_token_id,chat_id,method,
      request_fingerprint,object_path,content_sha256,content_type,byte_size,lease_id,lease_expires_at,created_at)
    select '${owner}','seed-fixture-'||i,'${token}','${chat}','sendDocument','f'||lpad(to_hex(i),63,'0'),
      '${chat}/bots/${owner}/f'||lpad(to_hex(i),63,'0')||'.pdf',repeat('b',64),'application/pdf',
      ${bytes===count?"1":`least(6291456,${bytes}::bigint-(i-1)::bigint*6291456)`},
      ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
      now()-interval '1 second',now()-interval '${old?"25 hours":"1 minute"}'
    from generate_series(1,${count}) i;
  `);
}

async function waiting(db,pid) {
  for(let attempt=0;attempt<25;attempt++) {
    const [row]=await db.query(`select wait_event='advisory' as waiting from pg_stat_activity where pid=${pid}`);
    if(row?.waiting) return;
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  throw new Error("second PostgreSQL connection did not reach the advisory lock");
}

test("all six literal quota boundaries reject +1, counting failed/old admissions appropriately",async(t)=>{
  const db=await postgres(t);
  const cases=[
    {bytes:62914559},                         // bot rolling: 60 MiB - 1
    {bytes:268435455,old:true},               // bot lifetime: 256 MiB - 1
    {bytes:999,count:999,old:true},           // bot lifetime objects: 1000 - 1
    {bytes:629145599,global:true},            // global rolling: 600 MiB - 1
    {bytes:2147483647,global:true,old:true},   // global lifetime: 2 GiB - 1
    {bytes:19999,count:19999,global:true,old:true}, // global lifetime objects: 20000 - 1
  ];
  for(let i=0;i<cases.length;i++) {
    await db.exec("delete from private.bot_media_ingests;");
    await seed(db,cases[i]);
    assert.equal((await reserve(db,next(50+i*2))).duplicate,false);
    await quotaDenied(db,next(51+i*2));
  }
  await db.exec("delete from private.bot_media_ingests;");
  await seed(db,{bytes:629145600,global:true,old:true});
  assert.equal((await reserve(db,next(99))).duplicate,false,"expired rolling charge still counts only towards lifetime");
});

test("two real connections serialize equal and conflicting reservations before Storage",async(t)=>{
  const db=await postgres(t), a=db.session(), b=db.session(), r=next(1);
  const pidA=Number(await a.send("select pg_backend_pid();")),pidB=Number(await b.send("select pg_backend_pid();"));
  assert.notEqual(pidA,pidB);
  await a.send(`begin; set local role service_role; ${reserveSql(r)};`);
  const equal=b.send(`set role service_role; ${reserveSql({...r,lease:uuid(800)})};`);
  const rejected=assert.rejects(equal,/bot_media_ingest_busy/);
  await waiting(db,pidB); await a.send("commit;"); await rejected;
  const c=db.session(),pidC=Number(await c.send("select pg_backend_pid();"));
  const r2=next(2);
  await a.send(`begin; set local role service_role; ${reserveSql(r2)};`);
  const changed={...next(3),key:r2.key};
  const conflict=assert.rejects(c.send(`set role service_role; ${reserveSql(changed)};`),/bot_ingest_conflict/);
  await waiting(db,pidC); await a.send("commit;"); await conflict;
  assert.equal((await db.query("select count(*)::int as n from private.bot_media_ingests"))[0].n,2);
  assert.equal((await db.query("select count(*)::int as n from storage.objects"))[0].n,0);
});

test("global quota lock prevents two bots from both taking the last byte",async(t)=>{
  const db=await postgres(t),a=db.session(),b=db.session();
  await seed(db,{bytes:629145599,global:true});
  const r=next(1),other=next(2,{bot:uuid(10),token:uuid(12)});
  const pid=Number(await b.send("select pg_backend_pid();"));
  await a.send(`begin; set local role service_role; ${reserveSql(r)};`);
  const failure=assert.rejects(b.send(`set role service_role; ${reserveSql(other)};`),/bot_media_ingest_quota_exceeded/);
  await waiting(db,pid); await a.send("commit;"); await failure;
  assert.equal(Number((await db.query("select sum(byte_size) as bytes from private.bot_media_ingests"))[0].bytes),629145600);
});

test("legacy command cannot bypass a concurrently reserved key with another fingerprint",async(t)=>{
  const db=await postgres(t),a=db.session(),b=db.session(),r=next(1);
  const pid=Number(await b.send("select pg_backend_pid();"));
  await a.send(`begin; set local role service_role; ${reserveSql(r)};`);
  const send=`select public.bot_message_command_internal('${bot}','${chat}','sendMessage','{"text":"fixture"}'::jsonb,'${r.key}','${"d".repeat(64)}');`;
  const failure=assert.rejects(b.send(`set role service_role; ${send}`),/bot_ingest_conflict/);
  await waiting(db,pid); await a.send("commit;"); await failure;
  assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n,0);
});

test("legacy command with the same fingerprint cannot bypass an active reservation or its token",async(t)=>{
  const db=await postgres(t),a=db.session(),b=db.session(),r=next(1);
  await object(db,r);
  await db.service(`select public.bot_upload_authorize_internal('${bot}','${chat}','chat-media','${r.path}','application/pdf',1,120) as value`);
  const pid=Number(await b.send("select pg_backend_pid();"));
  await a.send(`begin; set local role service_role; ${reserveSql(r)};`);
  const send=`select public.bot_message_command_internal('${bot}','${chat}','${r.method}',${quote(JSON.stringify(payload(r)))}::jsonb,'${r.key}','${r.fingerprint}');`;
  const failure=assert.rejects(b.send(`set role service_role; ${send}`),/bot_ingest_conflict/);
  await waiting(db,pid); await a.send("commit;"); await failure;
  await db.exec(`update private.bot_tokens set revoked_at=now() where id='${token}';`);
  await assert.rejects(db.service(`${send.slice(0,-1)} as value`),/bot_ingest_conflict/);
  assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n,0);
  assert.equal((await db.query("select state from private.bot_media_ingests"))[0].state,"reserved");
});

test("Storage lock wait cannot turn an expired lease into an accepted commit",async(t)=>{
  const db=await postgres(t),a=db.session(),b=db.session(),r=next(1);
  await reserve(db,r);await object(db,r);
  await a.send(`begin; select id from storage.objects where name='${r.path}' for update;`);
  await db.exec("update private.bot_media_ingests set lease_expires_at=clock_timestamp()+interval '400 milliseconds';");
  const failure=assert.rejects(b.send(`set role service_role; ${commitSql(r)};`),error=>{
    assert.equal(error.code,"55000"); assert.match(error.message,/bot_media_ingest_lease_expired/);
    assert.equal(error.detail,"1"); return true;
  });
  // Force the lease to expire while the independent transaction holds the object lock.
  await new Promise(resolve=>setTimeout(resolve,800)); await a.send("commit;"); await failure;
  assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n,0);
  assert.equal((await db.query("select count(*)::int as n from private.bot_upload_grants"))[0].n,0);
});

test("real commit outcome lost on connection close remains exactly-once on a new connection",async(t)=>{
  const db=await postgres(t),a=db.session(),r=next(1);
  await reserve(db,r);await object(db,r);
  await a.send(`begin; set local role service_role; ${commitSql(r)}; commit;`);
  await a.close();
  const duplicate=await reserve(db,{...r,lease:uuid(999)});
  assert.equal(duplicate.duplicate,true);assert.equal(duplicate.lease_id,null);
  assert.ok(duplicate.result.message_id);
  assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n,1);
});

test("mutating any literal quota, ACL or body trips transactional migration self-check",async(t)=>{
  const sql=read(stem+".sql");
  for(const [old,replacement] of [
    ["v_bot_day+p_byte_size > 62914560","v_bot_day+p_byte_size > 62914561"],
    ["v_global_count+1 > 20000","v_global_count+1 > 20001"],
    ["REVOKE ALL ON FUNCTION public.bot_media_ingest_reserve_internal(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid)\n  FROM PUBLIC,anon,authenticated,service_role;",
      "REVOKE ALL ON FUNCTION public.bot_media_ingest_reserve_internal(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid)\n  FROM anon,authenticated,service_role;"],
  ]) {
    assert.equal(sql.split(old).length,2,"mutant must have exactly one target");
    await assert.rejects(postgres(t,sql.replace(old,()=>replacement)),/bot_media_ingest_function_self_check/);
  }
});

test("literal rolling limit regression still rejects +1 when a mutant refreshes its own body hash",async(t)=>{
  const sql=read(stem+".sql"),oldBody=sql.split("CREATE FUNCTION public.bot_media_ingest_reserve_internal")[1].split("$function$")[1];
  const oldHash=createHash("sha256").update(oldBody).digest("hex");
  const mutated=sql.replace("v_bot_day+p_byte_size > 62914560","v_bot_day+p_byte_size > 62914561");
  const newBody=mutated.split("CREATE FUNCTION public.bot_media_ingest_reserve_internal")[1].split("$function$")[1];
  const newHash=createHash("sha256").update(newBody).digest("hex");
  const db=await postgres(t,mutated.replace(oldHash,newHash));
  await seed(db,{bytes:62914559});await reserve(db,next(1));
  // The real regression assertion fails under this mutant; the test proves that failure is observed.
  await assert.rejects(()=>quotaDenied(db,next(2)),/Missing expected rejection/);
  assert.equal(Number((await db.query("select sum(byte_size) as bytes from private.bot_media_ingests"))[0].bytes),62914561);
});

test("same-fingerprint fence regression goes red even when its mutant refreshes the function hash",async(t)=>{
  const sql=read(stem+".sql"),section=sql.split("$command_patch$")[1],tag=name=>section.split(`$${name}$`)[1];
  let body=capturedFunctions.find(fn=>fn.signature.startsWith("bot_message_command_internal(")).ddl.split("$function$")[1];
  for(const [a,r] of [["anchor","replacement"],["lock_anchor","lock_replacement"]]) body=body.replace(tag(a),()=>tag(r));
  const guard="\n        or (i.state='reserved' and i.commit_xid is distinct from pg_catalog.pg_current_xact_id())";
  assert.equal(sql.split(guard).length,2);
  const hash=s=>createHash("sha256").update(s).digest("hex");
  const mutant=sql.replace(guard,"").replace(hash(body),hash(body.replace(guard,"")));
  const db=await postgres(t,mutant),r=next(1);
  await reserve(db,r); await object(db,r);
  await db.service(`select public.bot_upload_authorize_internal('${bot}','${chat}','chat-media','${r.path}','application/pdf',1,120) as value`);
  const send=`select public.bot_message_command_internal('${bot}','${chat}','${r.method}',${quote(JSON.stringify(payload(r)))}::jsonb,'${r.key}','${r.fingerprint}') as value`;
  await assert.rejects(()=>assert.rejects(db.service(send),/bot_ingest_conflict/),/Missing expected rejection/);
  assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n,1);
  assert.equal((await db.query("select state from private.bot_media_ingests"))[0].state,"reserved");
});

test("a failed post-check rolls back every body, policy and new table; prestate drift stops early",async(t)=>{
  const db=await postgres(t,"");
  const sql=read(stem+".sql").replace("v_bot_day+p_byte_size > 62914560","v_bot_day+p_byte_size > 62914561");
  await assert.rejects(db.exec(sql),/bot_media_ingest_function_self_check/);
  assert.equal((await db.query("select to_regclass('private.bot_media_ingests')::text as value"))[0].value,null);
  assert.equal((await db.query("select encode(sha256(convert_to(prosrc,'UTF8')),'hex') as hash from pg_proc where oid='public.bot_upload_authorize_internal(uuid,uuid,text,text,text,bigint,integer)'::regprocedure"))[0].hash,
    "03db4ebafc6ff37b3d8843a85b7fed956fc20d54de35dcca965fb6e0bc1b1f29");
  await db.exec("alter function public.bot_upload_authorize_internal(uuid,uuid,text,text,text,bigint,integer) set search_path=public;");
  await assert.rejects(db.exec(read(stem+".sql")),/bot_media_ingest_prestate_drift/);
});

test("column-only ACL and weakened Storage policy mutations trip the exact self-check",async(t)=>{
  const sql=read(stem+".sql");
  const columnGrant=sql.replace("SET LOCAL ROLE supabase_storage_admin;",
    "GRANT SELECT (bot_id) ON private.bot_media_ingests TO service_role;\nSET LOCAL ROLE supabase_storage_admin;");
  await assert.rejects(postgres(t,columnGrant),/bot_media_ingest_table_policy_self_check/);
  const weak=sql.replace("FOR INSERT TO PUBLIC\n  WITH CHECK (bucket_id <> 'chat-media' OR lower(split_part(name,'/',2)) <> 'bots');",
    "FOR INSERT TO PUBLIC\n  WITH CHECK (true);");
  assert.notEqual(weak,sql);
  await assert.rejects(postgres(t,weak),/bot_media_ingest_policy_expression_self_check/);
});
