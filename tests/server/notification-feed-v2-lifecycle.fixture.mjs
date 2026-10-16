import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {feedFixture,id,user,other,put,quote} from './notification-feed-v2.fixture.mjs';
export {id,user,other,put,quote};
export const lifecycleProposal=new URL('../../docs/proposals/2026-10-17-notification-feed-v2-lifecycle.sql',import.meta.url);
export async function lifecycleFixture({candidate=true,sql,prepare}={}) {
  const frozen=await readFile(new URL('../../docs/proposals/2026-10-17-notification-feed-v2.sql',import.meta.url));
  assert.equal(createHash('sha256').update(frozen).digest('hex'),'50133c513fb8e86d15e3dfd45066cc4e20c550e37ef85de84845b5ce9b001c89');
  const db=await feedFixture();
  try {
    if(prepare) await prepare(db);
    if(candidate) {
      if(sql===undefined) try {sql=await readFile(lifecycleProposal,'utf8');} catch(error) {if(error.code!=='ENOENT') throw error;}
      if(sql) await db.exec(sql);
    }
    return db;
  } catch(error) {await db.close();throw error;}
}
export async function service(db,fn,args='') {
  await db.exec('set role service_role');
  try {return (await db.query(`select public.${fn}(${args}) as value`)).rows[0].value;}
  finally {await db.exec('reset role');}
}
export const sweep=(db,state={})=>service(db,'notification_feed_maintenance_v2',
  `${state.after_fence?quote(state.after_fence):'null'},${state.after_event?quote(state.after_event):'null'},ARRAY[${(state.pending??[]).map(quote).join(',')}]::uuid[]`);
export async function orphan(db,n,{fence=true,events=1,age="interval '1 hour'"}={}) {
  const uid=id(n);
  if(fence) await db.exec(`insert into private.notification_feed_fences_v2(recipient_id) values('${uid}')`);
  await db.exec(`insert into public.notification_feed_events_v2(recipient_id,event_kind,created_at)
    select '${uid}','invalidate',clock_timestamp()-${age} from generate_series(1,${events})`);
  return uid;
}
