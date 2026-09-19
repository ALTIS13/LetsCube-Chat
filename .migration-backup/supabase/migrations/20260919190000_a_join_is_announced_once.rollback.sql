/**
 * Rollback for 20260919190000_a_join_is_announced_once.sql: accepting an invite
 * into a group writes two system messages again.
 *
 * That is what a rollback of this change *is*, and it is written down plainly
 * because the thing being restored is a defect. The body below is
 * `20260511_invite_accept_read_baseline_and_system_notice.sql` lines 17-110,
 * byte for byte — the definition production ran from 2026-05-11 until the
 * migration this reverses was applied. That it is byte for byte was measured
 * rather than assumed: `prosrc` read off production read-only is identical to
 * those lines, all 2420 characters of it.
 *
 * ── The self-check creates nothing ────────────────────────────────────────
 *
 * An earlier draft of this pair drove a whole acceptance inside the migration —
 * two accounts, a chat, an invite — and abandoned it by raising a sentinel in a
 * subtransaction. It was correct in PGlite and impossible on production:
 * registration there is invite-only, and `handle_new_user` raises
 * `invite_required` the moment a row reaches `auth.users`. The production
 * rehearsal caught it. It would have been the wrong shape even had it worked,
 * because firing a live system's account-creation triggers is a side effect and
 * a transaction that will be rolled back is not a licence for one.
 *
 * So this file proves, from catalogues and counts alone, that it installed the
 * definition it means to and changed nothing else. The proof that a group then
 * gets two lines again lives in
 * `tests/server/group-join-announced-once.test.mjs`, where seeding accounts is
 * free and correct.
 *
 * The strongest thing here is the reconstruction: the definition this file
 * installs, with the migration's two edits put *back* into it, must equal
 * character for character the definition this transaction found. A restore that
 * had quietly become a rewrite — a lost `on conflict`, a dropped update of the
 * invite row, a reworded raise — passes every other check and fails that one.
 *
 * What it does not do:
 *
 * - It does not touch `write_membership_service_message` or its triggers. They
 *   were never changed by the migration this reverses, and restoring the
 *   duplicate means putting the second writer back, not taking the first away.
 * - It does not delete or re-write any message. The seven rows that record
 *   three real joins were kept by the migration and are kept by this; the count
 *   is compared before and after.
 *
 * Locks: `create or replace function` takes a short ACCESS EXCLUSIVE on the
 * function's own catalogue row and nothing on any table. `lock_timeout = '5s'`
 * bounds it anyway. Applying it twice is a no-op and the self-check says so
 * rather than failing.
 *
 * **As the owner of the function**, which production reports as `postgres`.
 * Enforced below rather than described.
 */

begin;

set local lock_timeout = '5s';

-- ── the role, enforced rather than described ────────────────────────────────

do $role$
declare
  v_owner text;
begin
  if pg_catalog.to_regprocedure('public.group_invite_accept(uuid)') is null then
    raise exception 'public.group_invite_accept does not exist; this is not a LETSCUBE database';
  end if;

  select pg_catalog.pg_get_userbyid(proowner) into v_owner
    from pg_catalog.pg_proc where oid = 'public.group_invite_accept(uuid)'::regprocedure;

  if not pg_catalog.pg_has_role(
       current_user,
       (select proowner from pg_catalog.pg_proc
         where oid = 'public.group_invite_accept(uuid)'::regprocedure),
       'USAGE'
     ) then
    raise exception
      'this file replaces public.group_invite_accept, which % owns, and % is not a member of it',
      v_owner, current_user;
  end if;
end
$role$;

-- ── what was there before this file touched anything ───────────────────────
--
-- Both transaction-local, so they are gone at commit either way. The
-- definition is captured so that the self-check can state its claim exactly —
-- «these two edits and nothing else» — against the text production was
-- actually running, rather than against a copy of it in this file. The count is
-- captured so that «this removes a duplicate, not anybody's messages» is
-- checked rather than asserted.

select pg_catalog.set_config(
  'kub.invite_accept_guarded',
  pg_catalog.pg_get_functiondef('public.group_invite_accept(uuid)'::regprocedure),
  true
);

select pg_catalog.set_config(
  'kub.messages_before_invite_accept_guarded',
  (select pg_catalog.count(*) from public.messages)::text,
  true
);

-- ── the function as 20260511 wrote it, restored verbatim ───────────────────

create or replace function public.group_invite_accept(p_invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_invite public.group_invites%rowtype;
  v_chat public.chats%rowtype;
  v_joined boolean := false;
  v_display_name text := 'Пользователь';
  v_now timestamptz := now();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_invite
    from public.group_invites
   where id = p_invite_id
   for update;

  if not found or v_invite.invitee_id <> v_caller then
    raise exception 'group_invite_not_found_or_unavailable' using errcode = 'P0001';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'group_invite_not_pending' using errcode = 'P0001';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= v_now then
    update public.group_invites
       set status = 'expired',
           responded_at = coalesce(responded_at, v_now)
     where id = v_invite.id
     returning * into v_invite;
    raise exception 'group_invite_expired' using errcode = 'P0001';
  end if;

  select * into v_chat from public.chats where id = v_invite.chat_id;
  if not found or v_chat.type not in ('group', 'channel') then
    raise exception 'group_invite_chat_unavailable' using errcode = 'P0001';
  end if;

  insert into public.chat_members (
    chat_id,
    user_id,
    role,
    joined_at,
    last_read_at,
    last_delivered_at
  )
  values (
    v_invite.chat_id,
    v_caller,
    'member'::public.chat_member_role,
    v_now,
    v_now,
    v_now
  )
  on conflict (chat_id, user_id) do nothing
  returning true into v_joined;

  update public.group_invites
     set status = 'accepted',
         responded_at = v_now
   where id = v_invite.id
   returning * into v_invite;

  if coalesce(v_joined, false) then
    select coalesce(nullif(full_name, ''), nullif(username, ''), 'Пользователь')
      into v_display_name
      from public.profiles
     where id = v_caller;

    insert into public.messages (chat_id, user_id, type, content)
    values (
      v_invite.chat_id,
      null,
      'system',
      coalesce(v_display_name, 'Пользователь') || ' присоединился к группе'
    );
  end if;

  update public.notifications
     set read_at = coalesce(read_at, v_now),
         payload = public._group_invite_payload(v_invite)
   where user_id = v_caller
     and kind = 'group_invite'
     and payload->>'invite_id' = v_invite.id::text;

  return v_invite.chat_id;
end $$;

revoke all on function public.group_invite_accept(uuid) from public, anon;
grant execute on function public.group_invite_accept(uuid) to authenticated;

-- ── the self-check, which raises rather than committing half of this ───────
--
-- **It creates nothing.** An earlier draft of this file drove a whole
-- acceptance here — two accounts, a chat, an invite — and it was right in
-- PGlite and impossible on production, where registration is invite-only and
-- `handle_new_user` raises `invite_required` the moment a row reaches
-- `auth.users`. The production rehearsal caught it, which is the step that
-- exists for exactly this. It would have been wrong even had it worked: firing
-- a live system's account-creation triggers is a side effect, and «inside a
-- transaction I will roll back» is not a licence for one.
--
-- So the proof is split by where it can live. Everything below is answerable
-- from `pg_proc`, `pg_trigger` and a `count(*)`. The behaviour — one line
-- instead of two for a group, one for a channel, one for a lone joiner — is
-- proved in `tests/server/group-join-announced-once.test.mjs`, where seeding
-- accounts is free and correct.

do $check$
declare
  v_before text := pg_catalog.current_setting('kub.invite_accept_guarded');
  v_after text := pg_catalog.pg_get_functiondef('public.group_invite_accept(uuid)'::regprocedure);
  v_reverted text;
  v_rows_before bigint := pg_catalog.current_setting('kub.messages_before_invite_accept_guarded')::bigint;
  v_rows_after bigint;
  v_secdef boolean;
  v_pinned boolean;
begin
  -- 1. The function is still the thing the client calls. A `create or replace`
  --    that lost `security definer`, its `search_path` or its grant would
  --    deploy and then refuse every acceptance.

  select p.prosecdef,
         exists (
           select 1 from pg_catalog.unnest(p.proconfig) setting
            where setting like 'search_path=%'
         )
    into v_secdef, v_pinned
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'group_invite_accept';

  if not coalesce(v_secdef, false) then
    raise exception
      'group_invite_accept is no longer security definer, so accepting an invite will be refused by row level security';
  end if;
  if not coalesce(v_pinned, false) then
    raise exception 'group_invite_accept no longer pins a search_path';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', 'public.group_invite_accept(uuid)', 'execute') then
    raise exception 'authenticated can no longer call group_invite_accept';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.group_invite_accept(uuid)', 'execute') then
    raise exception 'anon can call group_invite_accept';
  end if;

  -- 2. The other writer is still there. This file's whole premise is that the
  --    membership trigger covers the ground it gives up; if the trigger has
  --    gone, the premise has gone with it and a join would be unannounced.

  if pg_catalog.to_regprocedure('public.write_membership_service_message()') is null then
    raise exception
      'public.write_membership_service_message is gone, so the ground this file gives up is covered by nothing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where not tgisinternal
       and tgrelid = 'public.chat_members'::regclass
       and tgname = 'trg_membership_service_message_insert'
  ) then
    raise exception
      'trg_membership_service_message_insert is not on chat_members, so nothing else announces a join';
  end if;

  -- 3. The guard is in, or out, depending on which direction this file is.

  if (v_after like '%v_members%') is distinct from false then
    raise exception 'the installed definition is not the one this file writes';
  end if;

  -- 4. **These two edits and nothing else.** Undo them on the definition that
  --    is now installed, and what is left must be, character for character, the
  --    definition this transaction found. A third line changed anywhere in the
  --    function — a lost `on conflict`, a dropped `update` of the invite, a
  --    reworded raise — survives every check above and fails here.
  --
  --    Skipped when the file has already been applied: there is then nothing to
  --    undo, and the pair must simply be equal.

  if v_before not like '%v_members%' then
    if v_after is distinct from v_before then
      raise exception
        'this file was already applied and replacing the function changed it anyway';
    end if;
  else
    v_reverted := pg_catalog.replace(
      pg_catalog.replace(v_after, $dclA$  v_now timestamptz := now();
$dclA$, $dclB$  v_now timestamptz := now();
  -- Added 2026-09-19. How many members the chat has once this acceptance has
  -- put its row in — read exactly as write_membership_service_message reads it,
  -- because the whole point of the guard below is to agree with that trigger
  -- about which of the two writes the line.
  v_members bigint := 0;
$dclB$),
      $grdA$  if coalesce(v_joined, false) then
$grdA$, $grdB$  -- write_membership_service_message (20260915140000) already writes a line
  -- for this join, better worded, whenever the chat is of type group and has
  -- more than one member once the row is in. What follows covers exactly what
  -- that trigger declines — a channel, and a group whose only member is the
  -- person who has just joined — so that a join is announced once and never
  -- twice. Deleting this insert outright would make both of those cases silent.
  select count(*) into v_members
    from public.chat_members where chat_id = v_invite.chat_id;

  if coalesce(v_joined, false) and not (v_chat.type = 'group' and v_members > 1) then
$grdB$);
    if v_reverted is distinct from v_before then
      raise exception
        'the installed definition differs from the one this transaction found by more than the edits this file makes';
    end if;
  end if;

  -- 5. Nobody's conversation history was touched.

  select pg_catalog.count(*) into v_rows_after from public.messages;
  if v_rows_after <> v_rows_before then
    raise exception
      'this file changed the number of rows in public.messages from % to %',
      v_rows_before, v_rows_after;
  end if;

  raise notice 'a join into a group is announced twice again, which is the state this rolls back to';
end
$check$;

commit;
