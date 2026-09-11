/**
 * The message-action migrations, their rollbacks and their rehearsals, run in a
 * real PostgreSQL.
 *
 * The five message-action migrations of 20260911140000–20260911144000, and the
 * two after them that close who reads reactions and earned achievements
 * (20260911150000, 20260911151000), are written to be applied to production by
 * the main session after a rehearsal on a throwaway copy of production's schema.
 * That rehearsal is `.migration-backup/supabase/rehearsal/`.
 * This file does not replace it and cannot: it runs the same SQL in PGlite —
 * PostgreSQL in process, no Docker — over a STUB of production's objects, copied
 * from the migrations in `.migration-backup` rather than from the database. So
 * it proves the SQL parses, the self-checks pass and refuse what they should,
 * the rollbacks remove what the migrations add, and every rehearsal assertion
 * holds against the policies as the migrations record them. It proves nothing
 * about a table, trigger or policy production has and the migrations do not
 * show; that is what the rehearsal on the schema copy is for.
 *
 * The stub's policies are the recorded ones, permissive and restrictive as
 * written, because that difference is what the visibility assertions rest on
 * (see `chat-media-counts-parity.test.mjs`). `auth.uid()` is Supabase's own
 * definition, which reads either claim.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

const root = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS = [
  "20260911140000_chat_read_marks_forward_only",
  "20260911141000_message_read_events",
  "20260911142000_one_reaction_per_person",
  "20260911143000_delete_messages_for_everyone",
  "20260911144000_forward_message_with_media",
  "20260911150000_reactions_visible_to_chat_members",
  "20260911151000_user_achievements_signed_in_only",
];

const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const migrationSql = (name) => read(`.migration-backup/supabase/migrations/${name}.sql`);
const rollbackSql = (name) => read(`.migration-backup/supabase/migrations/${name}.rollback.sql`);
const rehearsalSql = (name) => read(`.migration-backup/supabase/rehearsal/${name}.test.sql`);

const STUB = String.raw`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key,
  aud text,
  role text,
  email text,
  email_confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);
-- Supabase's auth.uid(): the legacy claim first, then the claims object.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema private;
revoke all on schema private from public;

grant usage on schema public to anon, authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  username text unique,
  avatar_url text
);

create table public.bans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  expires_at timestamptz,
  issued_by uuid,
  created_at timestamptz not null default now()
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('private', 'group', 'channel')),
  name text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mutes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  chat_id uuid references public.chats(id) on delete cascade,
  reason text not null,
  expires_at timestamptz,
  issued_by uuid,
  created_at timestamptz not null default now()
);

create table public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  last_delivered_at timestamptz,
  hidden_at timestamptz,
  cleared_at timestamptz,
  primary key (chat_id, user_id)
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  bot_id uuid,
  content text,
  type text default 'text' check (type in ('text', 'image', 'video', 'audio', 'file', 'sticker', 'system')),
  media_url text,
  media_bucket text,
  media_path text,
  media_metadata jsonb default '{}'::jsonb check (media_metadata is null or jsonb_typeof(media_metadata) = 'object'),
  reply_to_id uuid references public.messages(id) on delete set null,
  forwarded_from_id uuid references public.messages(id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  pinned boolean default false,
  client_message_id uuid,
  client_sent_at timestamptz,
  bot_reply_markup jsonb,
  created_at timestamptz not null default now(),
  constraint messages_sender_shape_check check (
    (type = 'system' and user_id is null and bot_id is null)
    or (coalesce(type, 'text') <> 'system' and not (user_id is not null and bot_id is not null))
  )
);
create unique index messages_client_message_id_unique_idx
  on public.messages (chat_id, user_id, client_message_id)
  where client_message_id is not null;

create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

-- 20260903210000_profile_achievements_cosmetics.sql, with the evidence column of 20260903230000
create table public.achievements (
  key text primary key,
  title text not null,
  description text not null,
  icon text not null default 'crown',
  grant_kind text not null default 'auto' check (grant_kind in ('auto', 'manual')),
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_achievements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_key text not null references public.achievements(key) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  primary key (user_id, achievement_key)
);

create table public.message_hidden_for_users (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table public.media_variants (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages(id) on delete cascade,
  chat_id uuid references public.chats(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete cascade,
  source_bucket text not null default 'media',
  source_path text not null,
  variant_kind text not null check (variant_kind in ('image_preview', 'image_thumb', 'video_poster', 'video_720p', 'avatar_128', 'avatar_256')),
  variant_bucket text not null default 'media',
  variant_path text not null,
  mime_type text not null,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  status text not null default 'ready' check (status in ('ready', 'failed', 'stale')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_variants_message_or_profile_scope check (
    (message_id is not null and chat_id is not null and profile_id is null)
    or (message_id is null and chat_id is null and profile_id is not null)
    or (message_id is null and chat_id is not null and profile_id is null)
  )
);
create unique index media_variants_message_kind_uidx
  on public.media_variants (message_id, variant_kind)
  where message_id is not null and status = 'ready';

create table public.privacy_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  presence_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- 20260504_roles_admin.sql
create function public.is_banned(uid uuid default auth.uid())
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.bans where user_id = uid and (expires_at is null or expires_at > now()))
$$;
create function public.is_muted(uid uuid, cid uuid default null)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.mutes
     where user_id = uid and (chat_id is null or chat_id = cid) and (expires_at is null or expires_at > now())
  )
$$;

-- 20260504_chats_membership_hardening.sql
create function public.is_chat_member(cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.chat_members where chat_id = cid and user_id = auth.uid())
$$;
create function public.is_chat_admin(cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.chat_members where chat_id = cid and user_id = auth.uid() and role in ('owner', 'admin')
  )
$$;
create function public.add_chat_creator_as_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into public.chat_members (chat_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (chat_id, user_id) do nothing;
  end if;
  return new;
end $$;
create trigger trg_add_chat_creator_as_owner
  after insert on public.chats
  for each row execute function public.add_chat_creator_as_owner();

-- 20260714_push_foreground_sessions.sql
create function public.notifications_mark_chat_messages_read(p_chat_id uuid, p_read_until timestamptz default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_chat_id is null then
    raise exception 'invalid_chat_id' using errcode = '22023';
  end if;
  update public.notifications n
     set read_at = coalesce(n.read_at, now())
   where n.user_id = v_user_id
     and n.read_at is null
     and n.kind like '%message%'
     and n.payload->>'chat_id' = p_chat_id::text
     and (
       p_read_until is null
       or not (n.payload ? 'message_id')
       or not ((n.payload->>'message_id') ~* '^[0-9a-f-]{36}$')
       or exists (
         select 1 from public.messages m
          where m.id = (n.payload->>'message_id')::uuid
            and m.chat_id = p_chat_id
            and m.created_at <= p_read_until
       )
     );
end
$$;

-- 20260714090000_chat_read_notification_sync.sql
create function public.mark_chat_read(p_chat_id uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
declare
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  update public.chat_members
     set last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), v_now),
         last_delivered_at = greatest(coalesce(last_delivered_at, '-infinity'::timestamptz), v_now)
   where chat_id = p_chat_id and user_id = auth.uid();
  if not found then
    raise exception 'chat_member_required' using errcode = '42501';
  end if;
  perform public.notifications_mark_chat_messages_read(p_chat_id, v_now);
end
$$;

-- Row-level security as the migrations record it.
alter table public.profiles enable row level security;
create policy "Profiles are viewable by everyone" on public.profiles for select using (true);

alter table public.bans enable row level security;
alter table public.mutes enable row level security;

alter table public.chats enable row level security;
create policy "Chat members can view chats" on public.chats for select to authenticated using (public.is_chat_member(id));

alter table public.chat_members enable row level security;
create policy "chat_members select" on public.chat_members for select to authenticated
  using (user_id = auth.uid() or public.is_chat_member(chat_id));
create policy "chat_members insert" on public.chat_members for insert to authenticated
  with check (public.is_chat_admin(chat_id) and role = 'member');
create policy "chat_members update" on public.chat_members for update to authenticated
  using (user_id = auth.uid() or public.is_chat_admin(chat_id))
  with check (user_id = auth.uid() or public.is_chat_admin(chat_id));
create policy "block banned writes (update)" on public.chat_members as restrictive for update to authenticated
  using (not public.is_banned(auth.uid())) with check (not public.is_banned(auth.uid()));
create policy "block banned reads" on public.chat_members as restrictive for select to authenticated
  using (not public.is_banned(auth.uid()));

alter table public.topics enable row level security;
create policy "members read topics" on public.topics for select to authenticated using (public.is_chat_member(chat_id));

alter table public.messages enable row level security;
create policy "Chat members can view messages" on public.messages for select to authenticated
  using (public.is_chat_member(chat_id));
create policy "Chat members can send messages" on public.messages for insert to authenticated
  with check ((select auth.uid()) = user_id and bot_id is null and public.is_chat_member(chat_id));
create policy "Users can edit own messages" on public.messages for update using (user_id = auth.uid());
create policy "block muted/banned from sending" on public.messages as restrictive for insert
  with check (not public.is_banned(auth.uid()) and not public.is_muted(auth.uid(), chat_id));
create policy "block banned writes (update)" on public.messages as restrictive for update to authenticated
  using (not public.is_banned(auth.uid())) with check (not public.is_banned(auth.uid()));
create policy "block banned reads" on public.messages as restrictive for select
  using (not public.is_banned(auth.uid()));

alter table public.reactions enable row level security;
create policy "Anyone in chat can view reactions" on public.reactions for select using (true);
create policy "Users can add reactions" on public.reactions for insert with check (auth.uid() = user_id);
create policy "Users can remove own reactions" on public.reactions for delete using (auth.uid() = user_id);
create policy "block banned writes (insert)" on public.reactions as restrictive for insert
  with check (not public.is_banned(auth.uid()));
create policy "block banned writes (delete)" on public.reactions as restrictive for delete
  using (not public.is_banned(auth.uid()));

alter table public.achievements enable row level security;
create policy "achievements readable" on public.achievements for select using (true);
alter table public.user_achievements enable row level security;
create policy "user achievements readable" on public.user_achievements for select using (true);
grant select on public.achievements, public.user_achievements to anon, authenticated;

alter table public.message_hidden_for_users enable row level security;
create policy "message_hidden_for_users select own" on public.message_hidden_for_users for select to authenticated
  using (user_id = (select auth.uid()));
create policy "message_hidden_for_users delete own" on public.message_hidden_for_users for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.media_variants enable row level security;
create policy "media variants chat members can read" on public.media_variants for select to authenticated
  using (chat_id is not null and public.is_chat_member(chat_id) and not public.is_banned(auth.uid()));

alter table public.privacy_preferences enable row level security;
create policy "privacy_preferences own select" on public.privacy_preferences for select using (auth.uid() = user_id);
create policy "privacy_preferences own update" on public.privacy_preferences for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.notifications enable row level security;
create policy "notifications own select" on public.notifications for select to authenticated using (user_id = auth.uid());

grant select on public.profiles, public.chats, public.topics, public.media_variants, public.notifications to authenticated;
grant select, insert, update, delete on public.chat_members, public.messages, public.reactions,
  public.message_hidden_for_users, public.privacy_preferences to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;

-- 20260621_revoke_anon_public_function_execute.sql
do $$
declare
  fn record;
begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke execute on function %s from public', fn.signature);
    execute format('revoke execute on function %s from anon', fn.signature);
    execute format('grant execute on function %s to authenticated, service_role', fn.signature);
  end loop;
end $$;
`;

async function freshDatabase() {
  const db = await new PGlite();
  await db.exec(STUB);
  return db;
}

/** A failed statement leaves PGlite inside the aborted transaction; close it before the next test. */
async function execOrRollback(db, sql) {
  try {
    return await db.exec(sql);
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    throw error;
  }
}

/** @type {PGlite} */
let db;

before(async () => {
  db = await freshDatabase();
  for (const name of MIGRATIONS) await execOrRollback(db, migrationSql(name));
});

after(async () => {
  await db?.close();
});

test("each migration applies again over itself", async () => {
  for (const name of MIGRATIONS) await execOrRollback(db, migrationSql(name));
});

for (const name of MIGRATIONS) {
  test(`the rehearsal of ${name} passes and leaves nothing behind`, async () => {
    const results = await execOrRollback(db, rehearsalSql(name));
    const passLine = results
      .flatMap((result) => result.rows ?? [])
      .map((row) => String(row.result ?? ""))
      .find((line) => line.startsWith("rehearsal passed:"));
    assert.equal(passLine, `rehearsal passed: ${name}`, "the rehearsal never reached its pass line");
    const leftovers = await db.query("select count(*)::int as n from auth.users where email like 'rehearsal-%'");
    assert.equal(leftovers.rows[0].n, 0, "the rehearsal committed its fixtures");
  });
}

test("each rollback removes its migration, and the migrations apply again afterwards", async () => {
  const scratch = await freshDatabase();
  try {
    for (const name of MIGRATIONS) await execOrRollback(scratch, migrationSql(name));
    for (const name of [...MIGRATIONS].reverse()) await execOrRollback(scratch, rollbackSql(name));
    const { rows } = await scratch.query(`
      select
        to_regprocedure('public.mark_chat_read_through(uuid,timestamp with time zone)') is null as read_through_gone,
        to_regprocedure('public.message_read_times(uuid)') is null as read_times_gone,
        to_regprocedure('public.set_message_reaction(uuid,text)') is null as reaction_gone,
        to_regprocedure('public.delete_messages_for_everyone(uuid[])') is null as delete_gone,
        to_regprocedure('public.forward_message(uuid,uuid,uuid,timestamp with time zone,uuid)') is null as forward_gone,
        to_regclass('private.message_read_events') is null as events_gone,
        to_regclass('private.message_deletions') is null as deletions_gone,
        (select count(*)::int from pg_trigger where not tgisinternal and tgname in (
          'trg_guard_chat_member_read_marks', 'trg_record_message_read_event', 'trg_enforce_reaction_limit'
        )) as triggers_left,
        exists (
          select 1 from pg_policies
           where schemaname = 'public' and tablename = 'reactions' and policyname = 'Anyone in chat can view reactions'
        ) as reactions_open_again,
        exists (
          select 1 from pg_policies
           where schemaname = 'public' and tablename = 'user_achievements' and policyname = 'user achievements readable'
        ) as achievements_open_again
    `);
    assert.deepEqual(rows[0], {
      read_through_gone: true,
      read_times_gone: true,
      reaction_gone: true,
      delete_gone: true,
      forward_gone: true,
      events_gone: true,
      deletions_gone: true,
      triggers_left: 0,
      reactions_open_again: true,
      achievements_open_again: true,
    });
    for (const name of MIGRATIONS) await execOrRollback(scratch, migrationSql(name));
  } finally {
    await scratch.close();
  }
});

test("a self-check refuses to commit a half-applied state", async () => {
  // Drop the trigger the self-check of 20260911142000 requires, inside that
  // migration's own transaction, and the whole migration must roll back.
  const scratch = await freshDatabase();
  try {
    // A function replacer: in a replacement string `$$` means a literal `$`.
    const sabotaged = migrationSql("20260911142000_one_reaction_per_person").replace(
      /\ndo \$\$\ndeclare\n  v_expected record;/,
      () => "\ndrop trigger trg_enforce_reaction_limit on public.reactions;\ndo $$\ndeclare\n  v_expected record;",
    );
    assert.notEqual(sabotaged, migrationSql("20260911142000_one_reaction_per_person"), "the sabotage did not apply");
    await assert.rejects(execOrRollback(scratch, sabotaged), /reaction limit trigger is missing/);
    const { rows } = await scratch.query("select to_regprocedure('public.set_message_reaction(uuid,text)') is null as gone");
    assert.equal(rows[0].gone, true, "a refused self-check still committed the function");
  } finally {
    await scratch.close();
  }
});

test("a message's read time is one index seek however many reads were recorded", async (t) => {
  // 100 members of one chat, 500 reads each, interleaved in time: 50,000 events,
  // nearly all of which reach a message sent at the start. What is asserted is
  // the lookup the function uses; the alternative is only reported, because
  // which plan the planner picks for it depends on the data.
  await db.exec("begin");
  try {
    await db.exec(`
      insert into auth.users (id)
      select ('aaaaaaaa-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid from generate_series(1, 100) as k;
      insert into public.profiles (id)
      select ('aaaaaaaa-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid from generate_series(1, 100) as k;
      insert into public.chats (id, type) values ('cccccccc-0000-4000-8000-00000000000c', 'group');
      insert into public.chat_members (chat_id, user_id)
      select 'cccccccc-0000-4000-8000-00000000000c', ('aaaaaaaa-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid
        from generate_series(1, 100) as k;
      insert into private.message_read_events (chat_id, user_id, read_through, read_at)
      select 'cccccccc-0000-4000-8000-00000000000c',
             ('aaaaaaaa-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid,
             now() - interval '7 days' + ((i * 100 + k) * interval '1 second'),
             now() - interval '7 days' + ((i * 100 + k) * interval '1 second') + interval '1 second'
        from generate_series(1, 500) as i, generate_series(1, 100) as k;
      analyze private.message_read_events;
    `);
    const params = ["cccccccc-0000-4000-8000-00000000000c", "aaaaaaaa-0000-4000-8000-000000000050"];
    const sentAt = "now() - interval '7 days' + interval '10 seconds'";
    const explain = async (sql) => (await db.query(`explain (analyze, format json) ${sql}`, params)).rows[0]["QUERY PLAN"][0];
    const flatten = (plan) => {
      const found = [];
      const walk = (node) => {
        found.push(node);
        for (const child of node.Plans ?? []) walk(child);
      };
      walk(plan.Plan);
      return found;
    };
    const describe = (plan) => flatten(plan)
      .map((node) => `${node["Node Type"]}${node["Index Name"] ? ` on ${node["Index Name"]}` : ""}: ${node["Actual Rows"]} rows, ${node["Rows Removed by Filter"] ?? 0} filtered`)
      .join(" > ");

    const seek = await explain(
      `select e.read_at from private.message_read_events e
        where e.chat_id = $1 and e.user_id = $2 and e.read_through >= ${sentAt}
        order by e.read_through limit 1`,
    );
    const aggregate = await explain(
      `select min(e.read_at) from private.message_read_events e
        where e.chat_id = $1 and e.user_id = $2 and e.read_through >= ${sentAt}`,
    );
    t.diagnostic(`the function's lookup: ${describe(seek)}; ${seek["Execution Time"]} ms`);
    t.diagnostic(`min(read_at) instead: ${describe(aggregate)}; ${aggregate["Execution Time"]} ms`);

    const leaf = flatten(seek).find((node) => /Index/.test(node["Node Type"]));
    assert.ok(leaf, "the lookup does not use an index");
    assert.equal(leaf["Index Name"], "message_read_events_pkey");
    assert.equal(leaf["Actual Rows"], 1, "the lookup read more than the one event it returns");
    assert.equal(leaf["Rows Removed by Filter"] ?? 0, 0, "the lookup filtered rows it had read");
  } finally {
    await db.exec("rollback");
  }
});
