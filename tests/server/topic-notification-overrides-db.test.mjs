import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import { fixture, hasContract, authenticated, setPreference, claims, quote, id,
  user, other, sender, session, topic, general, archived, foreignTopic, chat, message } from "./topic-notification-overrides.fixture.mjs";
import {proposal} from "./topic-notification-overrides.fixture.mjs";

async function scoped(t) { const db = await fixture(); t.after(() => db.close()); await hasContract(db); return db; }
const allowed = async db => (await db.query(`select public._notification_push_allowed('${user}','message',
  jsonb_build_object('chat_id','${chat}','message_id','${message}','sender_id','${sender}')) as value`)).rows[0].value;

test("the shipped producer gate refuses a muted parent even for a requested enabled child", async t => {
  const db = await fixture({ baseline: true }); t.after(() => db.close());
  assert.equal(await allowed(db), true, "positive control: readable fixture message must be allowed first");
  await db.exec(`insert into public.chat_notification_preferences values('${chat}','${user}',false,null);`);
  assert.equal(await allowed(db), false, "baseline confirms chat-only policy; new feature must change this case");
});

test("persisted enabled child bypasses only parent mute in the actual producer gate", async t => {
  const db = await scoped(t);
  await db.exec(`insert into public.chat_notification_preferences values('${chat}','${user}',false,null);`);
  assert.equal(await allowed(db), false);
  assert.deepEqual((await authenticated(db,setPreference("enabled")))[0].value,
    { status: "applied", scope_key: topic, mode: "enabled", revision: 1 });
  assert.equal(await allowed(db), true);
  await db.exec(`update public.notification_preferences set push_enabled=false where user_id='${user}';`);
  assert.equal(await allowed(db), false, "child does not bypass global push-off");
});

test("disabled child denies an unmuted parent without changing another account", async t => {
  const db = await scoped(t);
  await authenticated(db,setPreference("disabled"));
  assert.equal(await allowed(db), false);
  const own = await authenticated(db,`select mode,revision::int from public.topic_notification_preferences`);
  assert.deepEqual(own,[{mode:"disabled",revision:1}]);
  await db.exec(claims(other,id(31)));
  assert.deepEqual(await authenticated(db,"select * from public.topic_notification_preferences"),[]);
  assert.deepEqual((await authenticated(db,`select public.topic_notification_preferences_read('${chat}') as value`))[0].value,[]);
});

test("CAS rejects stale writes and retains a revision across disabled-to-inherit ABA", async t => {
  const db = await scoped(t);
  await authenticated(db,setPreference("disabled"));
  assert.deepEqual((await authenticated(db,setPreference("enabled",0)))[0].value,
    {status:"conflict",scope_key:topic,mode:"disabled",revision:1});
  assert.deepEqual((await authenticated(db,setPreference("inherit",1)))[0].value,
    {status:"applied",scope_key:topic,mode:"inherit",revision:2});
  assert.deepEqual((await authenticated(db,setPreference("enabled",1)))[0].value,
    {status:"conflict",scope_key:topic,mode:"inherit",revision:2});
  assert.equal((await db.query("select count(*)::int as n from public.topic_notification_preferences")).rows[0].n,1);
});

test("both general aliases address exactly one row and one revision", async t => {
  const db = await scoped(t);
  assert.deepEqual((await authenticated(db,setPreference("disabled",0,null)))[0].value,
    {status:"applied",scope_key:"general",mode:"disabled",revision:1});
  assert.deepEqual((await authenticated(db,setPreference("inherit",1,general)))[0].value,
    {status:"applied",scope_key:"general",mode:"inherit",revision:2});
  assert.equal((await db.query("select count(*)::int as n from public.topic_notification_preferences")).rows[0].n,1);
});

test("an archived general row makes both message and preference aliases unavailable",async t=>{
  const db=await scoped(t);
  for(const tid of [null,general]) {
    await db.exec(`update public.messages set topic_id=${tid===null?"null":quote(tid)} where id='${message}';`);
    assert.equal(await allowed(db),true);
  }
  await db.exec(`update public.topics set archived=true where id='${general}';`);
  for(const tid of [null,general]) {
    await db.exec(`update public.messages set topic_id=${tid===null?"null":quote(tid)} where id='${message}';`);
    assert.equal(await allowed(db),false);
    await assert.rejects(authenticated(db,setPreference("enabled",0,tid)),/topic_notification_scope_unavailable/);
  }
});

test("foreign archived missing and unauthorized topics refuse without writes", async t => {
  const db = await scoped(t);
  for(const tid of [foreignTopic,archived,id(999)]) await assert.rejects(authenticated(db,setPreference("enabled",0,tid)), /topic_notification_scope_unavailable/);
  await db.exec(`delete from public.chat_members where user_id='${user}';`);
  await assert.rejects(authenticated(db,setPreference("enabled")),/topic_notification_access_denied/);
  assert.deepEqual(await authenticated(db,"select * from public.topic_notification_preferences"),[]);
});

test("expired or deleted sessions cannot write with a still-present JWT subject", async t => {
  const db = await scoped(t);
  await db.exec(`update auth.sessions set not_after=now()-interval '1 second' where id='${session}';`);
  await assert.rejects(authenticated(db,setPreference("enabled")),/topic_notification_session_invalid/);
  await db.exec(`delete from auth.sessions where id='${session}';`);
  await assert.rejects(authenticated(db,setPreference("enabled")),/topic_notification_session_invalid/);
});

test("child enable cannot bypass DND category block source visibility or read epoch", async t => {
  const db = await scoped(t);
  await authenticated(db,setPreference("enabled"));
  assert.equal(await allowed(db),true);
  const denials = [
    [`insert into public.privacy_preferences values('${user}','dnd',null)`,"delete from public.privacy_preferences"],
    [`update public.notification_preferences set message_push_enabled=false where user_id='${user}'`,`update public.notification_preferences set message_push_enabled=true where user_id='${user}'`],
    [`insert into public.user_blocks values('${user}','${sender}')`,"delete from public.user_blocks"],
    [`insert into public.message_hidden_for_users values('${message}','${user}')`,"delete from public.message_hidden_for_users"],
    [`update public.chat_members set joined_at=now()+interval '1 hour' where user_id='${user}'`,`update public.chat_members set joined_at=now()-interval '1 day' where user_id='${user}'`],
    [`insert into public.fixture_bans values('${user}')`,"delete from public.fixture_bans"],
    [`update public.topics set archived=true where id='${topic}'`,`update public.topics set archived=false where id='${topic}'`],
  ];
  for(const [deny,restore] of denials) { await db.exec(deny); assert.equal(await allowed(db),false); await db.exec(restore); assert.equal(await allowed(db),true); }
});

test("timed parent expiry and a message topic edit use actual current rows rather than payload scope",async t=>{
  const db=await scoped(t);
  await db.exec(`insert into public.chat_notification_preferences values('${chat}','${user}',true,now()+interval '1 hour');`);
  assert.equal(await allowed(db),false);
  await db.exec("update public.chat_notification_preferences set muted_until=now()-interval '1 second';");
  assert.equal(await allowed(db),true);
  await db.exec("update public.chat_notification_preferences set push_enabled=false;");
  assert.equal(await allowed(db),false);
  await authenticated(db,setPreference("enabled"));
  assert.equal(await allowed(db),true);
  await db.exec(`update public.messages set topic_id=null where id='${message}';`);
  assert.equal(await allowed(db),false,"an enable for the old topic must not carry into general");
  await authenticated(db,setPreference("disabled",0,null));
  await db.exec("update public.chat_notification_preferences set push_enabled=true;");
  assert.equal(await allowed(db),false,"current general disable wins despite an enabled stale payload topic");
  await db.exec(`update public.messages set topic_id='${topic}' where id='${message}';`);
  assert.equal(await allowed(db),true);
});

test("private/runtime rollback retains disabled enforcement but stops enabled bypass", async t => {
  const db = await scoped(t);
  await authenticated(db,setPreference("disabled"));
  await db.exec("update private.topic_notification_runtime set enabled=false;");
  assert.equal(await allowed(db),false);
  await assert.rejects(authenticated(db,setPreference("inherit",1)),/topic_notifications_unavailable/);
  await db.exec("update private.topic_notification_runtime set enabled=true;");
  await authenticated(db,setPreference("enabled",1));
  await db.exec(`insert into public.chat_notification_preferences values('${chat}','${user}',false,null);
    update private.topic_notification_runtime set enabled=false;`);
  assert.equal(await allowed(db),false);
});

test("RLS grants expose only own reads and forbid direct writes or anonymous RPC", async t => {
  const db = await scoped(t);
  const rows = (await db.query(`select relrowsecurity as rls from pg_class where oid='public.topic_notification_preferences'::regclass`)).rows;
  assert.deepEqual(rows,[{rls:true}]);
  for(const sql of [
    `insert into public.topic_notification_preferences(user_id,chat_id,scope_key,mode) values('${user}','${chat}','general','enabled')`,
    `update public.topic_notification_preferences set mode='enabled'`,
    "delete from public.topic_notification_preferences",
  ]) await assert.rejects(authenticated(db,sql),/permission denied/);
  await db.exec("set role anon;");
  try { await assert.rejects(db.query(setPreference("enabled")),/permission denied/); }
  finally { await db.exec("reset role;"); }
});

test("archived deleted and reclassified topic preferences remain stored but are unavailable to reads", async t => {
  const db=await scoped(t);
  await authenticated(db,setPreference("disabled"));
  for(const change of [
    `update public.topics set archived=true where id='${topic}'`,
    `update public.topics set archived=false,is_general=true where id='${topic}'`,
    `delete from public.topics where id='${topic}'`,
  ]) {
    if(change.includes("is_general")) await db.exec(`update public.topics set is_general=false where id='${general}';`);
    await db.exec(change);
    assert.deepEqual((await authenticated(db,`select public.topic_notification_preferences_read('${chat}') as value`))[0].value,[]);
    assert.deepEqual(await authenticated(db,"select * from public.topic_notification_preferences"),[]);
    assert.equal((await db.query("select count(*)::int as n from public.topic_notification_preferences")).rows[0].n,1);
  }
});

test("invalid modes revisions and exhaustion never advance the confirmed choice", async t=>{
  const db=await scoped(t);
  for(const sql of [setPreference("unknown"),setPreference("enabled",-1),setPreference("enabled",9007199254740992)])
    await assert.rejects(authenticated(db,sql),/invalid_topic_notification_preference/);
  await authenticated(db,setPreference("disabled"));
  await db.exec("update public.topic_notification_preferences set revision=9007199254740991;");
  await assert.rejects(authenticated(db,setPreference("enabled",9007199254740991)),/topic_notification_revision_exhausted/);
  assert.deepEqual((await db.query("select mode,revision from public.topic_notification_preferences")).rows,
    [{mode:"disabled",revision:9007199254740991}]);
});

test("migration self-checks reject literal security omissions and roll back every new object",async t=>{
  const source=await readFile(proposal,"utf8");
  const mutations=[
    ["public RLS","ALTER TABLE public.topic_notification_preferences ENABLE ROW LEVEL SECURITY;",""],
    ["private RLS","ALTER TABLE private.topic_notification_runtime ENABLE ROW LEVEL SECURITY;",""],
    ["definer","RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''","RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''"],
    ["fixed path","RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''","RETURNS text LANGUAGE sql STABLE SECURITY DEFINER"],
    ["direct DML grants","REVOKE ALL ON public.topic_notification_preferences FROM PUBLIC,anon,authenticated,service_role;",""],
    ["read RPC ACL","REVOKE ALL ON FUNCTION public.topic_notification_preferences_read(uuid),","REVOKE ALL ON FUNCTION"],
  ];
  for(const [name,before,after] of mutations) await t.test(name,async()=>{
    assert.equal(source.split(before).length,2,`${name}: unique compiled mutation anchor`);
    const db=await fixture({baseline:true});
    try {
      await assert.rejects(db.exec(source.replace(before,after)),/topic_notification_self_check_failed/,name);
      await db.exec("rollback;");
      assert.equal((await db.query("select to_regclass('public.topic_notification_preferences') is null as absent")).rows[0].absent,true,name);
    } finally {await db.close();}
  });
});
