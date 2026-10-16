import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fixture, authenticated, setPreference, claims, id, user, chat, topic, general, quote } from "./topic-notification-overrides.fixture.mjs";

async function native(t) { return fixture({ native: true, t }); }
const last = text => JSON.parse(text.trim().split("\n").at(-1));
async function waitForBarrier(db,pid,event="advisory") {
  for(let i=0;i<30;i++) {
    const rows=(await db.query(`select wait_event=${quote(event)} as waiting from pg_stat_activity where pid=${pid}`)).rows;
    if(rows[0]?.waiting) return;
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  assert.fail(`second real PG17 connection never reached the expected ${event} wait`);
}

test("native fixture retains connection context across calls and survives a refused statement",async t=>{
  const db=await native(t);
  await db.exec("select set_config('letscube.qa.context','owned',false);");
  assert.equal((await db.query("select current_setting('letscube.qa.context',true) as context")).rows[0].context,"owned");
  await db.exec("set role authenticated;");
  assert.equal((await db.query("select current_user as name")).rows[0].name,"authenticated");
  await assert.rejects(db.query("select * from private.topic_notification_runtime"),/42501/);
  await db.exec("reset role;");
  assert.equal((await db.query("select auth.uid() as id")).rows[0].id,user);
});

test("two real sessions serialize concurrent revision-zero writes without losing the first choice",async t=>{
  const db=await native(t), a=db.session(), b=db.session();
  const pidA=Number(await a.send("select pg_backend_pid();")),pidB=Number(await b.send("select pg_backend_pid();"));
  assert.notEqual(pidA,pidB);
  await a.send(`begin; ${claims()} set local role authenticated; ${setPreference("disabled")};`);
  const pending=b.send(`${claims()} set role authenticated; ${setPreference("enabled")};`);
  await waitForBarrier(db,pidB);
  await a.send("commit;");
  assert.deepEqual(last(await pending),{status:"conflict",scope_key:topic,mode:"disabled",revision:1});
  assert.deepEqual((await db.query("select mode,revision::int from public.topic_notification_preferences")).rows,[{mode:"disabled",revision:1}]);
});

test("general aliases contend on one row and stale CAS cannot revive a disabled choice",async t=>{
  const db=await native(t),a=db.session(),b=db.session();
  const pid=Number(await b.send("select pg_backend_pid();"));
  await a.send(`begin; ${claims()} set local role authenticated; ${setPreference("disabled",0,null)};`);
  const pending=b.send(`${claims()} set role authenticated; ${setPreference("enabled",0,general)};`);
  await waitForBarrier(db,pid); await a.send("commit;");
  assert.deepEqual(last(await pending),{status:"conflict",scope_key:"general",mode:"disabled",revision:1});
});

test("a rolled-back first writer leaves no phantom revision for the waiting writer",async t=>{
  const db=await native(t),a=db.session(),b=db.session();
  const pid=Number(await b.send("select pg_backend_pid();"));
  await a.send(`begin; ${claims()} set local role authenticated; ${setPreference("disabled")};`);
  const pending=b.send(`${claims()} set role authenticated; ${setPreference("enabled")};`);
  await waitForBarrier(db,pid); await a.send("rollback;");
  assert.deepEqual(last(await pending),{status:"applied",scope_key:topic,mode:"enabled",revision:1});
});

test("a stale repeatable-read transaction is refused rather than granted stale authority",async t=>{
  const db=await native(t),a=db.session();
  await a.send(`begin isolation level repeatable read; ${claims()} set local role authenticated;`);
  await assert.rejects(a.send(setPreference("enabled")+";"),/topic_notification_isolation_unavailable/);
});

test("real PostgreSQL refuses a stale epoch even when the account subject is unchanged",async t=>{
  const db=await native(t);
  await db.exec(`delete from auth.sessions where user_id='${user}';`);
  await assert.rejects(authenticated(db,setPreference("enabled")),/topic_notification_session_invalid/);
});

test("a setter waiting on the chat barrier revalidates a retired session before writing",async t=>{
  const db=await native(t),a=db.session(),b=db.session();
  const pid=Number(await b.send("select pg_backend_pid();"));
  await a.send(`begin; select private.topic_notification_lock('${user}','${chat}');`);
  const pending=b.send(`${claims()} set role authenticated; ${setPreference("enabled")};`);
  // Attach immediately so a refusal cannot become an unhandled rejection.
  const denied=assert.rejects(pending,/topic_notification_session_invalid/);
  await waitForBarrier(db,pid);
  await db.exec(`delete from auth.sessions where user_id='${user}';`);
  await a.send("commit;");
  await denied;
  assert.equal((await db.query("select count(*)::int as n from public.topic_notification_preferences")).rows[0].n,0);
});

test("group eligibility is evaluated after a concurrent chat classification update",async t=>{
  const db=await native(t),a=db.session(),b=db.session();
  const pid=Number(await b.send("select pg_backend_pid();"));
  await a.send(`begin; update public.chats set type='private',is_forum=false where id='${chat}';`);
  const pending=b.send(`${claims()} set role authenticated; ${setPreference("enabled",0,null)};`);
  const result=pending.then(value=>({value}),error=>({error}));
  await waitForBarrier(db,pid,"transactionid");
  await a.send("commit;");
  const outcome=await result;
  assert.match(String(outcome.error),/topic_notification_scope_unavailable/);
  assert.equal((await db.query("select count(*)::int as n from public.topic_notification_preferences")).rows[0].n,0);
});

test("a membership removal that wins the row lock refuses the waiting setter",async t=>{
  const db=await native(t),a=db.session(),b=db.session();
  const pid=Number(await b.send("select pg_backend_pid();"));
  await a.send(`begin; delete from public.chat_members where chat_id='${chat}' and user_id='${user}';`);
  const pending=b.send(`${claims()} set role authenticated; ${setPreference("enabled")};`);
  const denied=assert.rejects(pending,/topic_notification_access_denied/);
  await waitForBarrier(db,pid,"transactionid"); await a.send("commit;"); await denied;
  assert.equal((await db.query("select count(*)::int as n from public.topic_notification_preferences")).rows[0].n,0);
  await db.exec(`insert into public.chat_members(chat_id,user_id,joined_at) values('${chat}','${user}',now()+interval '1 minute');`);
  await authenticated(db,setPreference("enabled"));
  assert.equal((await db.query(`select private.message_topic_alert_allowed('${user}','${id(40)}') as allowed`)).rows[0].allowed,false);
});

for(const change of ["archive","delete"]) test(`a concurrent topic ${change} refuses the waiting setter without changing its scope`,async t=>{
  const db=await native(t),a=db.session(),b=db.session();
  const pid=Number(await b.send("select pg_backend_pid();"));
  await a.send(`begin; ${change==="archive"?`update public.topics set archived=true where id='${topic}'`:`delete from public.topics where id='${topic}'`};`);
  const pending=b.send(`${claims()} set role authenticated; ${setPreference("enabled")};`);
  const denied=assert.rejects(pending,/topic_notification_scope_unavailable/);
  await waitForBarrier(db,pid,"transactionid"); await a.send("commit;"); await denied;
  assert.equal((await db.query("select count(*)::int as n from public.topic_notification_preferences")).rows[0].n,0);
  if(change==="delete") assert.equal((await db.query("select count(*)::int as n from public.messages")).rows[0].n,0);
});

test("the CAS omission control actually loses the waiting writer's conflict",async t=>{
  const db=await native(t);
  const row=(await db.query("select pg_get_functiondef('public.topic_notification_preference_set(uuid,uuid,text,bigint)'::regprocedure) as source")).rows[0];
  const anchor="IF coalesce(v_old.revision,0)<>p_expected_revision THEN";
  assert.equal(row.source.split(anchor).length,2);
  await db.exec(row.source.replace(anchor,"IF false THEN"));
  await authenticated(db,setPreference("disabled"));
  const outcome=(await authenticated(db,setPreference("enabled",0)))[0].value;
  assert.notEqual(outcome.status,"conflict","a CAS guard removal must break the hand-checked conflict rule");
  assert.equal(outcome.mode,"enabled");
});
