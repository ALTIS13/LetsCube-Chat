import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fixture,id,user,other,sender,chat,topic,quote} from "./topic-notification-overrides.fixture.mjs";

// Exact pg_proc read-only capture, 2026-10-17; no application rows or credentials.
const readAllDdl=`CREATE OR REPLACE FUNCTION public.notifications_mark_all_read()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.notifications
     set read_at = now()
   where user_id = v_caller and read_at is null;
end $function$
`;
if(createHash('sha256').update(readAllDdl).digest('hex')!=='cbf5a03bd43fd7f886412d877b0763a4ca21cd911a0b266311cdd60fc2620977')
  throw Error('read-all captured DDL drift');

// The policy, fanout, enqueue and rechecks stay real. Only display-name,
// avatar/payload formatting and mention recognition are fixture boundaries.
export async function deliveryFixture(options={}) {
  const db=await fixture(options);
  await db.exec(`
    alter table public.topics add constraint fixture_topics_chat_fkey
      foreign key(chat_id) references public.chats(id) on delete cascade;
    alter table public.chat_notification_preferences add constraint fixture_parent_preference_chat_fkey
      foreign key(chat_id) references public.chats(id) on delete cascade;
    alter table public.profiles add column full_name text,add column username text,add column avatar_url text;
    alter table public.chats add column name text;
    alter table public.messages add column content text,add column media_url text,
      add column media_metadata jsonb not null default '{}'::jsonb,
      add column mention_entities jsonb not null default '[]'::jsonb;
    create table public.bots(id uuid primary key,display_name text,username text,avatar_url text);
    create function public._sanitize_notification_avatar_url(text) returns text language sql immutable as $$select $1$$;
    create function public.micro_group_drawn_name(uuid,uuid) returns text language sql stable as $$select 'Fictional'::text$$;
    create function private.message_mentions_targeted(jsonb,text,uuid) returns boolean language sql stable as $$select false$$;
    create function public._notification_push_payload(text,jsonb) returns jsonb language sql immutable as $$
      select jsonb_build_object('kind',$1,'title','LETSCUBE','body','Fictional',
        'chatId',$2->>'chat_id','messageId',$2->>'message_id','tag',$2->>'group_tag')
    $$;
    create table public.notifications(id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.profiles(id) on delete cascade,kind text not null,
      payload jsonb not null,read_at timestamptz,created_at timestamptz not null default now());
    create table public.push_subscriptions(id uuid primary key,user_id uuid not null,is_active boolean not null);
    create table public.user_push_devices(id uuid primary key,user_id uuid not null,platform text not null,
      provider text not null,enabled boolean not null,revoked_at timestamptz);
    create table public.push_foreground_sessions(user_id uuid not null,expires_at timestamptz not null);
    create table public.notifications_push_outbox(id uuid primary key default gen_random_uuid(),
      notification_id uuid not null references public.notifications(id) on delete cascade,
      subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
      user_id uuid not null,payload jsonb not null,created_at timestamptz not null default now(),
      sent_at timestamptz,attempt_count integer not null default 0,last_error text,
      suppressed_at timestamptz,suppression_reason text,claim_token uuid,claimed_until timestamptz,
      unique(notification_id,subscription_id),
      constraint notifications_push_outbox_suppression_reason_check
        check(suppression_reason is null or suppression_reason in ('read','coalesced','subscription_inactive')));
    create table public.notifications_native_push_outbox(id uuid primary key default gen_random_uuid(),
      notification_id uuid not null references public.notifications(id) on delete cascade,
      device_id uuid not null references public.user_push_devices(id) on delete cascade,
      user_id uuid not null,payload jsonb not null,attempt_count integer not null default 0,
      sent_at timestamptz,last_error text,created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),claim_token uuid,claimed_until timestamptz,
      unique(notification_id,device_id));
    insert into public.push_subscriptions values('${id(50)}','${user}',true),('${id(51)}','${other}',true);
    insert into public.user_push_devices values('${id(52)}','${user}','android','fcm',true,null),
      ('${id(53)}','${other}','android','fcm',true,null);
  `);
  await db.exec(await readFile(new URL("../../supabase/migrations/20260926085544_album_push_outbox.sql",import.meta.url),"utf8"));
  await db.exec("grant all on all tables in schema public to postgres; update public.album_push_runtime set enabled=true;");
  await db.exec(await readFile(new URL("./topic-notification-delivery-baseline.sql",import.meta.url),"utf8"));
  await db.exec(`create trigger fixture_message_notifications after insert on public.messages
      for each row execute function public.enqueue_message_notifications();
    create trigger fixture_notification_push after insert on public.notifications
      for each row execute function public._enqueue_push_after_notification_insert();`);
  if(options.candidate) {
    try {
    // Load the real preview bodies, not a permissive preview/session stub.
    await db.exec(`alter table auth.sessions add column created_at timestamptz default now()-interval '1 day';
      alter table public.user_push_devices add column session_id uuid;
      create table public.notification_preview_preferences(user_id uuid primary key,preview_level text not null);
      update public.user_push_devices set session_id='${id(30)}' where user_id='${user}';
      insert into public.notification_preview_preferences values('${user}','message');
      update public.profiles set full_name='Fictional';
      alter table public.push_subscriptions add column endpoint text default 'https://fictional.invalid/push',
        add column p256dh text default 'fictional-key',add column auth text default 'fictional-auth';
      alter table public.push_subscriptions enable row level security;
      alter table public.notifications_push_outbox enable row level security;
      alter table public.notifications enable row level security;
      -- Match the production-owned ALTER targets, not the QA driver superuser.
      alter table public.notifications owner to postgres;
      alter table public.album_push_groups owner to postgres;
      alter table public.notifications_album_push_outbox owner to postgres;
      grant all on all tables in schema public,auth to postgres;`);
    // Catalog controls only: replica wal_level is not logical/WS acceptance.
    await db.exec(`create publication supabase_realtime for table public.topics,public.notifications;
      alter publication supabase_realtime owner to postgres;
      create publication supabase_realtime_messages_publication;
      alter publication supabase_realtime_messages_publication owner to supabase_admin;`);
    const preview=await readFile(new URL('../../supabase/migrations/20261007210924_native_message_preview.sql',import.meta.url),'utf8');
    for(const name of ['native_message_preview_recipient','native_message_notification_preview']) {
      const start=preview.indexOf(`create function public.${name}(`);
      const end=preview.indexOf('$fn$;',preview.indexOf('as $fn$',start))+6;
      if(start<0||end<start) throw Error('preview source extraction drift');
      await db.exec(preview.slice(start,end));
      await db.exec(`alter function public.${name}(${name.endsWith('_recipient')?'':'uuid,uuid'}) owner to postgres;`);
      await db.exec(`revoke all on function public.${name}(${name.endsWith('_recipient')?'':'uuid,uuid'}) from public,anon,authenticated,service_role;
        grant execute on function public.${name}(${name.endsWith('_recipient')?'':'uuid,uuid'}) to authenticated;`);
    }
    await db.exec(readAllDdl);
    await db.exec(`alter function public.notifications_mark_all_read() owner to postgres;
      revoke all on function public.notifications_mark_all_read() from public,anon,authenticated,service_role;
      grant execute on function public.notifications_mark_all_read() to postgres,authenticated,service_role;`);
    await db.exec(await readFile(new URL('../../docs/proposals/2026-10-16-bound-push-delivery.sql',import.meta.url),'utf8'));
    let candidate=options.candidateSql;
    if(candidate===undefined) {
      try {candidate=await readFile(new URL('../../docs/proposals/2026-10-16-topic-notification-delivery.sql',import.meta.url),'utf8');}
      catch(error) {if(error.code!=='ENOENT') throw error;}
    }
    if(candidate) await db.exec(candidate);
    } catch(error) {
      await db.close();
      throw Object.assign(new Error(error.message),{code:error.code,where:error.where});
    }
  }
  return db;
}

export async function sendFixtureMessage(db,n,{albumIndex,topicId=topic}={}) {
  const mid=id(n);
  const metadata=albumIndex===undefined?{}:{album_id:"fixture-album-1234",album_count:2,album_index:albumIndex};
  await db.exec(`insert into public.messages(id,chat_id,user_id,type,topic_id,content,media_url,media_metadata)
    values('${mid}','${chat}','${sender}',${albumIndex===undefined?"'text'":"'image'"},
      ${topicId===null?"null":quote(topicId)},'Fictional',${albumIndex===undefined?"null":"'fixture.invalid/image'"},${quote(JSON.stringify(metadata))}::jsonb);`);
  return mid;
}

export async function claimFixtureTarget(db,table,where) {
  const token=id(90);
  const rows=(await db.query(`select id from ${table} where ${where} order by id`)).rows;
  await db.exec(`update ${table} set claim_token='${token}',claimed_until=clock_timestamp()+interval '5 minutes' where ${where};`);
  return {id:rows[0]?.id,token};
}
