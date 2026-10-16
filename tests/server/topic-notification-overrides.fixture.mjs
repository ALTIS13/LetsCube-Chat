import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pathToFileURL } from "node:url";

export const proposal = new URL("../../docs/proposals/2026-10-16-topic-notification-overrides.sql", import.meta.url);
export const id = n => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const user = id(1), other = id(2), sender = id(3), chat = id(10), foreignChat = id(11);
export const topic = id(20), general = id(21), archived = id(22), foreignTopic = id(23);
export const session = id(30), message = id(40);
export const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
export const claims = (who = user, sid = session) => `select set_config('request.jwt.claims',${quote(JSON.stringify({ sub: who, session_id: sid, role: "authenticated" }))},false);`;
export const setPreference = (mode, revision = 0, tid = topic, cid = chat) =>
  `select public.topic_notification_preference_set('${cid}',${tid === null ? "null" : quote(tid)},${quote(mode)},${revision}) as value`;

export async function fixture({ baseline = false, native = false, t } = {}) {
  let db;
  if (native) {
    const driverPath = process.env.LETSCUBE_TOPIC_PG17_DRIVER;
    assert.ok(driverPath, "explicit isolated PG17 fixture driver is required; no production fallback");
    const driver = await import(pathToFileURL(driverPath));
    db = await driver.connect(t);
    const metadata = await db.metadata();
    assert.match(metadata.version, /^17\./);
    assert.equal(metadata.network, "none");
    assert.equal(metadata.syntheticOnly, true);
    assert.equal(metadata.productionVolumes, false);
  } else db = new PGlite();
  await db.exec(`
    do $roles$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
      if not exists(select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin superuser; end if;
      if not exists(select 1 from pg_roles where rolname='postgres') then create role postgres bypassrls; end if;
    end $roles$;
    create schema auth; create schema private authorization postgres;
    alter schema public owner to postgres;
    alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table public.profiles(id uuid primary key);
    create table public.chats(id uuid primary key,type text,is_forum boolean default false);
    create table public.chat_members(chat_id uuid,user_id uuid,joined_at timestamptz default now()-interval '1 day',
      hidden_at timestamptz,cleared_at timestamptz,primary key(chat_id,user_id));
    create table public.topics(id uuid primary key,chat_id uuid,is_general boolean not null default false,archived boolean not null default false);
    create unique index uniq_topics_general on public.topics(chat_id) where is_general;
    create table public.messages(id uuid primary key,chat_id uuid,user_id uuid,bot_id uuid,type text,
      topic_id uuid references public.topics(id) on delete cascade,deleted_at timestamptz,created_at timestamptz default now());
    create table public.chat_notification_preferences(chat_id uuid,user_id uuid,push_enabled boolean,
      muted_until timestamptz,primary key(chat_id,user_id));
    create table public.notification_preferences(user_id uuid primary key,push_enabled boolean,
      message_push_enabled boolean default true,task_push_enabled boolean default true,invite_push_enabled boolean default true);
    create table public.privacy_preferences(user_id uuid primary key,manual_status text,manual_status_until timestamptz);
    create table public.user_blocks(blocker_id uuid,blocked_id uuid);
    create table public.message_hidden_for_users(message_id uuid,user_id uuid);
    create table public.fixture_bans(user_id uuid primary key);
    create function public.is_banned(p_user uuid) returns boolean language sql stable as $$
      select exists(select 1 from public.fixture_bans where user_id=p_user)
    $$;
    create function public.is_chat_member(p_chat uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.chat_members where chat_id=p_chat and user_id=auth.uid())
    $$;
    alter table public.chat_members owner to postgres;
    grant select on public.chat_members to authenticated;
    grant select on public.topics to authenticated;
    grant usage on schema auth,public to authenticated,anon,service_role;
    grant usage on schema private,auth to postgres;
    grant all on all tables in schema public,auth to postgres;
    insert into public.profiles values('${user}'),('${other}'),('${sender}');
    insert into auth.sessions values('${session}','${user}',null),('${id(31)}','${other}',null);
    insert into public.chats values('${chat}','group',false),('${foreignChat}','group',false);
    insert into public.chat_members(chat_id,user_id) values('${chat}','${user}'),('${chat}','${other}'),('${chat}','${sender}');
    insert into public.topics values('${topic}','${chat}',false,false),('${general}','${chat}',true,false),
      ('${archived}','${chat}',false,true),('${foreignTopic}','${foreignChat}',false,false);
    insert into public.messages(id,chat_id,user_id,type,topic_id) values('${message}','${chat}','${sender}','text','${topic}');
    insert into public.notification_preferences(user_id,push_enabled) values('${user}',true),('${other}',true);
  `);
  await db.exec(await readFile(new URL("./topic-notification-baseline.sql", import.meta.url), "utf8"));
  // These definitions are the real captured visibility/global/category policy,
  // not a true-returning policy stub. Ban storage and Auth are scoped fixtures.
  await db.exec(`alter function public._notification_push_allowed(uuid,text,jsonb) owner to postgres;
    alter function private.message_notification_visible_to(uuid,uuid) owner to postgres;`);
  if (!baseline) {
    let sql;
    try { sql = await readFile(proposal, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (sql) {
      await db.exec(sql);
      await db.exec("update private.topic_notification_runtime set enabled=true where singleton;");
    }
  }
  await db.exec(claims());
  return db;
}

export async function authenticated(db, sql) {
  await db.exec("set role authenticated;");
  try { return (await db.query(sql)).rows; }
  finally { await db.exec("reset role;"); }
}

export async function hasContract(db) {
  const row = (await db.query("select to_regprocedure('public.topic_notification_preference_set(uuid,uuid,text,bigint)') is not null as present")).rows[0];
  assert.equal(row.present, true, "account-owned CAS preference RPC is missing");
}
