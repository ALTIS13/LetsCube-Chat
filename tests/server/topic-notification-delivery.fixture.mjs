import {readFile} from "node:fs/promises";
import {fixture,id,user,other,sender,chat,topic,quote} from "./topic-notification-overrides.fixture.mjs";

// The policy, fanout, enqueue and rechecks stay real. Only display-name,
// avatar/payload formatting and mention recognition are fixture boundaries.
export async function deliveryFixture(options={}) {
  const db=await fixture(options);
  await db.exec(`
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
