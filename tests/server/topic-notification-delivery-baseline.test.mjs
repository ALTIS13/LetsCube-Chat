import assert from "node:assert/strict";
import test from "node:test";
import {deliveryFixture,sendFixtureMessage,claimFixtureTarget} from "./topic-notification-delivery.fixture.mjs";
import {authenticated,setPreference,id,user,other,chat} from "./topic-notification-overrides.fixture.mjs";

async function scoped(t) {
  const db=await deliveryFixture({native:process.env.LETSCUBE_TOPIC_DELIVERY_PG17==="1",t});
  t.after(()=>db.close());return db;
}

test("real fanout and both single delivery projections preserve readable notifications for two recipients",async t=>{
  const db=await scoped(t),mid=await sendFixtureMessage(db,60);
  assert.deepEqual((await db.query(`select user_id,read_at from public.notifications order by user_id`)).rows,
    [{user_id:user,read_at:null},{user_id:other,read_at:null}]);
  for(const table of ["notifications_push_outbox","notifications_native_push_outbox"]) {
    assert.equal((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n,2);
    const target=await claimFixtureTarget(db,`public.${table}`,`user_id='${user}'`);
    const rpc=table==="notifications_push_outbox"?"push_outbox_delivery_recheck":"native_push_outbox_delivery_recheck";
    assert.equal((await db.query(`select public.${rpc}('${target.id}','${target.token}') as status`)).rows[0].status,"deliver");
  }
  assert.equal((await db.query(`select count(*)::int as n from public.notifications where payload->>'message_id'='${mid}'`)).rows[0].n,2);
});

test("actual message admission separates feed membership from parent and child push decisions",async t=>{
  const db=await scoped(t);
  await db.exec(`insert into public.chat_notification_preferences values('${chat}','${user}',false,null);`);
  await sendFixtureMessage(db,61);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications where user_id='${user}'`)).rows[0].n,1);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_push_outbox where user_id='${user}'`)).rows[0].n,0);
  await authenticated(db,setPreference("enabled")); await sendFixtureMessage(db,62);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_push_outbox where user_id='${user}'`)).rows[0].n,1);
  await authenticated(db,setPreference("disabled",1)); await sendFixtureMessage(db,63);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications where user_id='${user}'`)).rows[0].n,3);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_push_outbox where user_id='${user}'`)).rows[0].n,1);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_push_outbox where user_id='${other}'`)).rows[0].n,3);
});

test("baseline limitation: an unconsumed single alert survives disable then re-enable",async t=>{
  const db=await scoped(t);await sendFixtureMessage(db,64);
  const target=await claimFixtureTarget(db,"public.notifications_push_outbox",`user_id='${user}'`);
  await authenticated(db,setPreference("disabled")); await authenticated(db,setPreference("enabled",1));
  assert.equal((await db.query(`select public.push_outbox_delivery_recheck('${target.id}','${target.token}') as status`)).rows[0].status,"deliver",
    "observed pre-Task3 replay, not a desired feature acceptance assertion");
});

test("baseline limitation: denial of an incomplete album is non-terminal and later parts revive it",async t=>{
  const db=await scoped(t);await sendFixtureMessage(db,65,{albumIndex:0});
  const condition=`subscription_id='${id(50)}'`;
  let target=await claimFixtureTarget(db,"public.notifications_album_push_outbox",condition);
  assert.ok(target.id,"control: actual album enqueue must create the web target");
  await authenticated(db,setPreference("disabled"));
  assert.equal((await db.query(`select status from public.album_push_recheck('${target.id}','${target.token}')`)).rows[0].status,"not_eligible");
  assert.equal((await db.query(`select suppressed_at is null as pending from public.notifications_album_push_outbox where id='${target.id}'`)).rows[0].pending,true);
  await authenticated(db,setPreference("enabled",1));await sendFixtureMessage(db,66,{albumIndex:1});
  target=await claimFixtureTarget(db,"public.notifications_album_push_outbox",condition);
  assert.equal((await db.query(`select status from public.album_push_recheck('${target.id}','${target.token}')`)).rows[0].status,"deliver",
    "observed pre-Task3 incomplete-album resurrection, not terminal suppression proof");
});
