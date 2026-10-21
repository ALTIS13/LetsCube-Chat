import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

export const proposal = new URL('../../docs/proposals/2026-10-21-message-text-cache-page.sql', import.meta.url);
export const id = n => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const owner = id(1), peer = id(2), chat = id(10), foreignChat = id(11);
export const topic = id(20), general = id(21), otherTopic = id(22);
export const quote = s => "'" + String(s).replaceAll("'", "''") + "'";

// Minimal current-column/RLS fixture, not the full production catalog. Native17
// schema/wire/performance acceptance is a separate mandatory gate.
export async function fixture({ candidate = true, sql } = {}) {
  let db;
  if (process.env.LETSCUBE_HISTORY_PG17_DRIVER) {
    const driver = await import(pathToFileURL(process.env.LETSCUBE_HISTORY_PG17_DRIVER));
    db = await driver.connect();
    const metadata = await db.metadata();
    assert.match(metadata.version, /^17\./);
    assert.deepEqual([metadata.network, metadata.syntheticOnly, metadata.productionVolumes], ['none',true,false]);
  } else db = new PGlite();
  try {
    await db.exec(`
      do $roles$ begin
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      end $roles$;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      create table public.fixture_bans(user_id uuid primary key);
      create function public.is_banned(p_user uuid) returns boolean language sql stable
        security definer set search_path='' as $$
          select exists(select 1 from public.fixture_bans where user_id=p_user) $$;
      create table public.chats(id uuid primary key,type text,is_forum boolean default false);
      create table public.chat_members(chat_id uuid,user_id uuid,cleared_at timestamptz,
        primary key(chat_id,user_id));
      create function public.is_chat_member(p_chat uuid) returns boolean language sql stable
        security definer set search_path='' as $$ select exists(select 1 from public.chat_members
          where chat_id=p_chat and user_id=auth.uid()) $$;
      create table public.topics(id uuid primary key,chat_id uuid,is_general boolean default false);
      create table public.messages(id uuid primary key,chat_id uuid,user_id uuid,type text default 'text',
        content text,created_at timestamptz,edited_at timestamptz,deleted_at timestamptz,pinned boolean default false,
        topic_id uuid,reply_to_id uuid,forwarded_from_id uuid,bot_id uuid,media_url text,media_bucket text,
        media_path text,media_metadata jsonb,bot_reply_markup jsonb,system_payload jsonb,
        forward_origin_name text,forward_origin_hidden boolean,bot_input_field_placeholder text,
        client_message_id uuid,client_sent_at timestamptz,mention_entities jsonb);
      create table public.message_hidden_for_users(message_id uuid,user_id uuid,
        primary key(message_id,user_id));
      create index messages_chat_active_created_idx on public.messages(chat_id,created_at desc,id desc)
        where deleted_at is null;
      create index idx_messages_chat_created on public.messages(chat_id,created_at desc);
      create index idx_messages_topic on public.messages(topic_id);
      alter table public.chats enable row level security;
      alter table public.chat_members enable row level security;
      alter table public.topics enable row level security;
      alter table public.messages enable row level security;
      alter table public.message_hidden_for_users enable row level security;
      create policy member_chat on public.chats for select to authenticated using
        (exists(select 1 from public.chat_members where chat_id=chats.id and user_id=auth.uid()));
      create policy member_members on public.chat_members for select to authenticated using
        (user_id=auth.uid() or public.is_chat_member(chat_id));
      create policy member_topic on public.topics for select to authenticated using(public.is_chat_member(chat_id));
      create policy member_message on public.messages for select to authenticated using(public.is_chat_member(chat_id));
      create policy hidden_own on public.message_hidden_for_users for select to authenticated using(user_id=auth.uid());
      create policy banned_chat on public.chats as restrictive for select to authenticated using(not public.is_banned(auth.uid()));
      create policy banned_member on public.chat_members as restrictive for select to authenticated using(not public.is_banned(auth.uid()));
      create policy banned_message on public.messages as restrictive for select to authenticated using(not public.is_banned(auth.uid()));
      grant usage on schema auth,public to authenticated,anon;
      grant select on public.chats,public.chat_members,public.topics,public.messages,public.message_hidden_for_users to authenticated;
      insert into public.chats values('${chat}','private',false),('${foreignChat}','private',false);
      insert into public.chat_members values('${chat}','${owner}',null),('${chat}','${peer}',null);
      insert into public.topics values('${topic}','${chat}',false),('${general}','${chat}',true),('${otherTopic}','${foreignChat}',false);
    `);
    if (candidate) {
      if (sql === undefined) try { sql = await readFile(proposal, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (sql) await db.exec(sql);
    }
    return db;
  } catch (e) { await db.close(); throw e; }
}

export async function asUser(db, sql, who = owner) {
  await db.exec(`select set_config('request.jwt.claim.sub',${quote(who ?? '')},false)`);
  await db.exec('set role authenticated;');
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role;'); }
}

export async function page(db, args = {}, who = owner) {
  const val = value => value == null ? 'null' : quote(value);
  return (await asUser(db, `select public.message_text_cache_page_v1(
    ${val(args.chat ?? chat)}::uuid,${val(args.scope ?? 'all')},${val(args.topic)}::uuid,
    ${val(args.beforeAt)}::timestamptz,${val(args.beforeId)}::uuid,${val(args.digest)}) as value`, who))[0].value;
}

export async function seed(db, count = 1) {
  await db.exec(`insert into public.messages(id,chat_id,user_id,content,created_at)
    select ('71000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,
      '${chat}','${peer}','synthetic '||n,'2026-10-20T00:00:00.123456Z'::timestamptz
      from generate_series(1,${count}) as n;`);
}
