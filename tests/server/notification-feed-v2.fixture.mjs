import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deliveryFixture} from './topic-notification-delivery.fixture.mjs';
import {id,user,other,session,claims,quote} from './topic-notification-overrides.fixture.mjs';
export {id,user,other,session,quote};
export const proposal=new URL('../../docs/proposals/2026-10-17-notification-feed-v2.sql',import.meta.url);
export const ownerPolicy='(user_id = auth.uid())';
export const sourcePolicy=`((kind <> 'message'::text) OR
CASE
    WHEN ((payload ->> 'message_id'::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN public.message_notification_visible(((payload ->> 'message_id'::text))::uuid)
    ELSE false
END)`;

export function identity(who=user,sid=session,patch={}) {
  return `select set_config('request.jwt.claims',${quote(JSON.stringify({sub:who,session_id:sid,
    role:'authenticated',is_anonymous:false,exp:Math.floor(Date.now()/1000)+3600,...patch}))},false);`;
}
export async function asUser(db,sql,who=user,sid=session,patch={}) {
  await db.exec(identity(who,sid,patch)+'set role authenticated;');
  try {return (await db.query(sql)).rows;} finally {await db.exec('reset role;');}
}
export async function rpc(db,name,args='',who=user,sid=session,patch={}) {
  return (await asUser(db,`select public.notification_feed_${name}_v2(${args}) as value`,who,sid,patch))[0].value;
}
export async function put(db,n,{who=user,kind='task_assigned',payload={},at='2026-01-01T00:00:00Z'}={}) {
  await db.exec(`insert into public.notifications(id,user_id,kind,payload,created_at)
    values('${id(n)}','${who}',${quote(kind)},${quote(JSON.stringify(payload))},${quote(at)});`);
  return id(n);
}

export async function feedFixture({candidate=true,sql,prepare}={}) {
  const db=await deliveryFixture({candidate:true});
  try {
    // Actual feed-v2-catalog.json, 2026-10-17, SHA256 908cd49c...dd9eda3.
    // The shared fixture retains actual Task2/Task3 producers, policy and auth.
    await db.exec(`alter table public.notifications alter column payload set default '{}'::jsonb;
      alter table public.chat_members add constraint fixture_feed_member_chat_fkey
        foreign key(chat_id) references public.chats(id) on delete cascade;
      alter table public.chat_members add constraint fixture_feed_member_user_fkey
        foreign key(user_id) references public.profiles(id) on delete cascade;
      alter table public.messages add constraint fixture_feed_message_chat_fkey
        foreign key(chat_id) references public.chats(id) on delete cascade;
      create table auth.users(id uuid primary key);
      insert into auth.users values('${user}'),('${other}');
      grant select on auth.users to postgres;
      alter trigger fixture_notification_push on public.notifications rename to trg_enqueue_push_after_notification_insert;
      revoke all on public.notifications from anon,authenticated;
      grant select,insert,update,delete on public.notifications to anon,authenticated;
      grant all on public.notifications to service_role;
      create policy "Owner reads own notifications" on public.notifications for select to authenticated using ${ownerPolicy};`);
    // Actual captured is_banned body (catalog.json,2026-10-16): bans(user_id,
    // expires_at). Only the existing fixture's argument name differs.
    await db.exec(`create table public.bans(user_id uuid primary key,expires_at timestamptz);
      alter table public.bans enable row level security;
      revoke all on public.bans from public,anon,authenticated,service_role;
      create or replace function public.is_banned(p_user uuid) returns boolean language sql stable security definer
        set search_path='public' as $$select exists(select 1 from public.bans
          where user_id=p_user and (expires_at is null or expires_at>now()))$$;
      alter function public.is_banned(uuid) owner to postgres;`);
    const mentions=await readFile(new URL('../../supabase/migrations/20261001180000_member_mentions.sql',import.meta.url),'utf8');
    const start=mentions.indexOf('CREATE FUNCTION public.message_notification_visible(');
    const end=mentions.indexOf('$fn$;',start)+5;
    assert.ok(start>=0&&end>start,'actual public visibility wrapper required');
    await db.exec(mentions.slice(start,end));
    await db.exec(`alter function public.message_notification_visible(uuid) owner to postgres;
      revoke all on function public.message_notification_visible(uuid) from public,anon,authenticated,service_role;
      grant execute on function public.message_notification_visible(uuid) to authenticated;
      create policy "message notification source remains readable" on public.notifications as restrictive
        for select to authenticated using ${sourcePolicy};`);
    // Existing canonical read-all body is already loaded by deliveryFixture.
    await db.exec(`create function public.notifications_mark_read(p_id uuid) returns void language plpgsql security definer
      set search_path='public' as $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.notifications
     set read_at = coalesce(read_at, now())
   where id = p_id and user_id = v_caller;
end $function$;
      alter function public.notifications_mark_read(uuid) owner to postgres;
      revoke all on function public.notifications_mark_read(uuid) from public,anon,authenticated,service_role;
      grant execute on function public.notifications_mark_read(uuid) to authenticated,service_role;`);
    if(prepare) await prepare(db);
    if(candidate) {
      if(sql===undefined) try {sql=await readFile(proposal,'utf8');} catch(error) {if(error.code!=='ENOENT') throw error;}
      if(sql) await db.exec(sql);
    }
    await db.exec(identity());
    return db;
  } catch(error) {await db.close();throw error;}
}
