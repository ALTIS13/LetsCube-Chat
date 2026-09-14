/**
 * A person can refuse another person, and can report a message or a person.
 *
 * WHAT EXISTS. Moderation in this product is entirely administrative: `bans`
 * and `mutes` are issued by staff, and `is_banned` / `is_muted` are enforced by
 * restrictive policies on `public.messages`. There is nothing an ordinary
 * person can do about somebody who bothers them, and nothing they can do to
 * bring a message to anybody's attention. Read on production on 2026-09-14:
 * `public.messages` carries «Chat members can send messages» permissive and
 * three restrictive policies, two of which are exactly this shape for the
 * administrative case.
 *
 * This matters beyond the product: the Microsoft Store age-rating questionnaire
 * asks whether the application lets people block users and report users or
 * content, and both answers were «no».
 *
 * WHAT THIS ADDS.
 *
 *   - `public.user_blocks` — one row per «I do not want to hear from this
 *     person». A block is **one-directional and private**: you read and write
 *     only your own rows, and nobody can ask who blocked them. That is why the
 *     guard below is SECURITY DEFINER: the policy has to see a row the sender
 *     is not allowed to read.
 *   - `public.blocked_from_chat(cid, sender)` — whether the other member of a
 *     **private** chat has blocked the sender. Groups and channels are
 *     deliberately outside it: a group is somebody else's room and silencing a
 *     member of it is the administrator's decision, which `mutes` already is.
 *   - A restrictive INSERT policy on `public.messages` in the same vocabulary
 *     as «block muted/banned from sending». The blocked person keeps their
 *     history and their chat; what they lose is the ability to add to it.
 *   - `public.content_reports` — a report about one message or one person.
 *     Inserted by the person making it and **never readable by them**: a queue
 *     you can read is a queue you can audit for who else complained. Staff read
 *     and resolve it through `is_manager_or_admin`.
 *
 * WHAT THIS DOES NOT DO. It does not hide the blocked person's existing
 * messages, their profile or their name — Telegram does not either, and hiding
 * history would rewrite a conversation somebody may need. It does not stop a
 * blocked person creating a chat row; it stops them writing in it, which is the
 * thing that reaches a person. And it does not notify anybody that they were
 * blocked or reported.
 *
 * A WORD ON THE REFUSAL. A blocked sender's insert fails rather than silently
 * disappearing, so the client can say «Пользователь ограничил переписку.» That
 * does tell them something was restricted. The alternative — accepting the row
 * and not delivering it — is a lie told by the product to its own user, and
 * this project does not do that elsewhere either.
 *
 * OWNER. Apply as the owner of `public.messages` (postgres on this deployment).
 *
 * Lock: CREATE POLICY takes ACCESS EXCLUSIVE on `public.messages` for the
 * length of this transaction; `lock_timeout` gives up after five seconds rather
 * than queue behind a long one.
 *
 * Rollback: 20260914120000_personal_blocks_and_reports.rollback.sql.
 */

begin;

set local lock_timeout = '5s';

-- ── who a person will not hear from ──────────────────────────────────────────

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

-- The guard below looks a sender up among the people who blocked them, so this
-- is the direction the index has to serve.
create index if not exists user_blocks_blocked_id_idx
  on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

-- **Revoke first.** This deployment's default privileges hand `anon` and
-- `authenticated` `arwd` on every new table in `public` — read off
-- `pg_default_acl` on 2026-09-14 — so a `create table` alone publishes it, and a
-- narrower grant afterwards adds nothing because the wide one is already there.
-- The self-check below caught exactly this on the first rehearsal.
revoke all on public.user_blocks from anon, authenticated;
grant select, insert, delete on public.user_blocks to authenticated;

drop policy if exists "Own blocks are yours alone" on public.user_blocks;
create policy "Own blocks are yours alone"
  on public.user_blocks
  for all
  to authenticated
  using (blocker_id = (select auth.uid()))
  with check (blocker_id = (select auth.uid()));

drop policy if exists "block banned writes (user_blocks)" on public.user_blocks;
create policy "block banned writes (user_blocks)"
  on public.user_blocks
  as restrictive
  for all
  to authenticated
  using (not public.is_banned((select auth.uid())))
  with check (not public.is_banned((select auth.uid())));

comment on table public.user_blocks is
  'One row per «I do not want to hear from this person». One-directional, and readable only by the person who made it.';

/**
 * Has the other member of this private chat refused this sender?
 *
 * SECURITY DEFINER because the row it looks for is one the sender may not read:
 * a block nobody can detect is the only kind worth having.
 *
 * `type = 'private'` is the whole scope. A group is somebody else's room.
 */
create or replace function public.blocked_from_chat(cid uuid, sender uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.chats as chat
      join public.chat_members as other
        on other.chat_id = chat.id and other.user_id <> sender
      join public.user_blocks as block
        on block.blocker_id = other.user_id and block.blocked_id = sender
     where chat.id = cid
       and chat.type = 'private'
  )
$$;

revoke all on function public.blocked_from_chat(uuid, uuid) from public, anon;
grant execute on function public.blocked_from_chat(uuid, uuid) to authenticated;

comment on function public.blocked_from_chat(uuid, uuid) is
  'Whether the other member of a private chat has blocked this sender. Definer, because that row is not the sender''s to read.';

drop policy if exists "block writes to someone who refused you" on public.messages;
create policy "block writes to someone who refused you"
  on public.messages
  as restrictive
  for insert
  to authenticated
  with check (not public.blocked_from_chat(chat_id, (select auth.uid())));

-- ── what a person brings to somebody's attention ─────────────────────────────

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  target_user_id uuid not null references public.profiles (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  chat_id uuid references public.chats (id) on delete set null,
  reason text not null,
  note text,
  status text not null default 'new',
  handled_by uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint content_reports_kind_check check (kind in ('message', 'user')),
  constraint content_reports_reason_check
    check (reason in ('spam', 'abuse', 'violence', 'sexual', 'child_safety', 'other')),
  constraint content_reports_status_check
    check (status in ('new', 'reviewing', 'actioned', 'dismissed')),
  -- A report about a message must name one; a report about a person must not
  -- pretend to be about a message that was never chosen.
  constraint content_reports_message_present
    check ((kind = 'message') = (message_id is not null)),
  constraint content_reports_not_self check (reporter_id <> target_user_id),
  constraint content_reports_note_length check (note is null or char_length(note) <= 1000)
);

create index if not exists content_reports_status_created_idx
  on public.content_reports (status, created_at desc);
create index if not exists content_reports_target_idx
  on public.content_reports (target_user_id);

-- The same message twice from the same person is the same report, and an open
-- complaint about a person does not need a second one beside it. Both leave a
-- later report possible once the first is resolved.
create unique index if not exists content_reports_one_per_message_idx
  on public.content_reports (reporter_id, message_id)
  where message_id is not null;
create unique index if not exists content_reports_one_open_per_person_idx
  on public.content_reports (reporter_id, target_user_id)
  where kind = 'user' and status in ('new', 'reviewing');

alter table public.content_reports enable row level security;

-- The same, and here it matters more: the default privileges include UPDATE on
-- the whole row, and a column-level grant cannot carve a hole out of a
-- table-wide one — the voice tables taught this in September. Without the
-- revoke, anybody could rewrite somebody else's report text.
revoke all on public.content_reports from anon, authenticated;
grant select, insert on public.content_reports to authenticated;
grant update (status, handled_by, handled_at) on public.content_reports to authenticated;

drop policy if exists "Anybody can report" on public.content_reports;
create policy "Anybody can report"
  on public.content_reports
  for insert
  to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'new'
    and handled_by is null
    and handled_at is null
  );

/**
 * Staff read the queue; the person who reported does not.
 *
 * A queue its reporters can read is a queue that says who else complained about
 * whom, which is a worse disclosure than the one it exists to handle.
 */
drop policy if exists "Staff read reports" on public.content_reports;
create policy "Staff read reports"
  on public.content_reports
  for select
  to authenticated
  using (public.is_manager_or_admin((select auth.uid())));

drop policy if exists "Staff resolve reports" on public.content_reports;
create policy "Staff resolve reports"
  on public.content_reports
  for update
  to authenticated
  using (public.is_manager_or_admin((select auth.uid())))
  with check (public.is_manager_or_admin((select auth.uid())));

drop policy if exists "block banned writes (content_reports)" on public.content_reports;
create policy "block banned writes (content_reports)"
  on public.content_reports
  as restrictive
  for all
  to authenticated
  using (not public.is_banned((select auth.uid())))
  with check (not public.is_banned((select auth.uid())));

comment on table public.content_reports is
  'A report about one message or one person. Written by anybody, read only by staff.';

-- ── the self-check: raise rather than commit a half-applied state ────────────

do $check$
declare
  v_count integer;
  v_column text;
begin
  if pg_catalog.to_regclass('public.user_blocks') is null
     or pg_catalog.to_regclass('public.content_reports') is null then
    raise exception 'a table this migration creates is not there';
  end if;

  for v_count in
    select 1 from pg_catalog.pg_class c
     where c.oid in ('public.user_blocks'::regclass, 'public.content_reports'::regclass)
       and not c.relrowsecurity
  loop
    raise exception 'row-level security is off on a table this migration created';
  end loop;

  if pg_catalog.to_regproc('public.blocked_from_chat') is null then
    raise exception 'public.blocked_from_chat is missing';
  end if;
  if not (
    select p.prosecdef
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'blocked_from_chat'
  ) then
    raise exception 'public.blocked_from_chat must be SECURITY DEFINER to see a row the sender cannot read';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.blocked_from_chat(uuid, uuid)', 'EXECUTE') then
    raise exception 'anon may execute public.blocked_from_chat';
  end if;

  -- The refusal is a restrictive policy, like the two beside it. A permissive
  -- one would be an *additional* way to send rather than a bar on sending.
  select count(*) into v_count
    from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'messages'
     and policyname = 'block writes to someone who refused you'
     and permissive = 'RESTRICTIVE' and cmd = 'INSERT';
  if v_count <> 1 then
    raise exception 'the refusal on public.messages is missing or not restrictive';
  end if;

  -- Nobody but staff may read the queue.
  select count(*) into v_count
    from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'content_reports'
     and cmd = 'SELECT' and permissive = 'PERMISSIVE'
     and qual not ilike '%is_manager_or_admin%';
  if v_count <> 0 then
    raise exception 'public.content_reports has a read policy that is not staff-only';
  end if;

  -- And nobody may read somebody else's blocks.
  select count(*) into v_count
    from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'user_blocks'
     and permissive = 'PERMISSIVE'
     and (qual is null or qual not ilike '%uid()%');
  if v_count <> 0 then
    raise exception 'public.user_blocks has a policy that does not scope to the caller';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.user_blocks', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.content_reports', 'SELECT') then
    raise exception 'anon holds SELECT on a table this migration created';
  end if;

  -- The narrow grants, proved rather than assumed: the default privileges give
  -- `authenticated` UPDATE on every new table, and a report is not theirs to
  -- rewrite.
  if pg_catalog.has_table_privilege('authenticated', 'public.user_blocks', 'UPDATE') then
    raise exception 'authenticated may UPDATE public.user_blocks';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.content_reports', 'UPDATE') then
    raise exception 'authenticated holds table-wide UPDATE on public.content_reports';
  end if;
  foreach v_column in array array['status', 'handled_by', 'handled_at'] loop
    if not pg_catalog.has_column_privilege('authenticated', 'public.content_reports', v_column, 'UPDATE') then
      raise exception 'staff cannot resolve a report: % is not updatable', v_column;
    end if;
  end loop;
  if pg_catalog.has_column_privilege('authenticated', 'public.content_reports', 'note', 'UPDATE') then
    raise exception 'authenticated may rewrite the text of a report';
  end if;
end
$check$;

commit;
