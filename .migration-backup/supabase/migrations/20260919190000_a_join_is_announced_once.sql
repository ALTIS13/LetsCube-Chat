/**
 * A join is announced once.
 *
 * The owner, on 2026-09-19: «Также дублирование присоединения к группе убери.»
 * Accepting an invite into a group writes two system messages, a second apart
 * and worded differently, and both are drawn as the same centred pill:
 *
 *     Борис Ильин присоединился(ась) к группе      ← the trigger, 20260915140000
 *     Борис Ильин присоединился к группе           ← this function, 20260511
 *
 * ── Whose defect this is, and why nothing caught it ───────────────────────
 *
 * Nobody's, in the way that matters: `group_invite_accept` has written that
 * line since 2026-05-11, and it was the only thing writing it for four months.
 * `20260915140000_a_group_says_who_came_and_went.sql` then put an
 * `after insert on public.chat_members` trigger under **every** way of joining,
 * including this one, and the older insert went on doing exactly what it had
 * always done. That is the same shape as
 * `20260918280000_a_private_chat_has_no_channel_to_announce.sql`: a new
 * mechanism that covers an old one's ground does not make the old one stop.
 *
 * No test could see it. The trigger's coverage
 * (`tests/e2e/group-service-messages.spec.ts`) injects fixture rows and never
 * executes SQL, and nothing anywhere pins `group_invite_accept`'s wording --
 * there is not one occurrence of it in `tests/`.
 *
 * ── What was measured, read-only, on production ───────────────────────────
 *
 *   4 rows «… присоединился к группе»        (this function)
 *   3 rows «… присоединился(ась) к группе»   (the trigger)
 *   3 cross-form pairs inside ten seconds of each other
 *
 * The fourth old-form row is dated **2026-05-10**, four months before the
 * trigger existed, and has no partner. So since the trigger shipped, **every**
 * join has produced exactly a pair: three joins, six messages, no exceptions.
 * The duplication is total rather than occasional, which is what makes the
 * older insert safe to narrow.
 *
 * ── Why the insert is narrowed rather than deleted ────────────────────────
 *
 * The obvious change is to delete it, and it is very nearly right. It is not
 * right because the trigger deliberately declines two cases this function
 * accepts, and in both of them deleting the insert would replace a duplicate
 * with silence -- which is the worse defect.
 *
 * **A channel.** `group_invite_accept` admits `('group', 'channel')`; the
 * trigger returns early unless the chat type is exactly `group`. There are no
 * channels on production today -- 14 groups, 28 private chats, none of type
 * `channel`, and all 11 invites belong to groups -- so this costs nothing now
 * and would cost a silent join the day channels ship.
 *
 * **A group the joiner is now the only member of.** The trigger counts members
 * after the insert and returns early at `v_members <= 1`, because that is how
 * it tells a person joining from `trg_add_chat_creator_as_owner` writing the
 * creator's own row while the group is being made. Three groups on production
 * have **zero** members and seven have one, so a pending invite outliving its
 * chat's membership is a reachable state rather than a hypothetical: the
 * invitee accepts, the count reaches 1, and the trigger says nothing.
 *
 * So the condition below is the exact complement of the trigger's two guards,
 * and it is written out rather than inferred. The one thing it cannot do is
 * notice if the trigger's guards change underneath it; that is what
 * `tests/server/group-join-announced-once.test.mjs` is for, which drives both
 * mechanisms through every combination and asserts **exactly one** line in each,
 * so a drift in either shows up as two lines or none rather than as a comment
 * that has gone stale.
 *
 * The wording is left alone in both mechanisms. «… присоединился к группе» in a
 * channel is wrong copy and has been since 2026-05-11, but fixing copy is a
 * product decision and not this file's, and doing it here would hide a
 * deduplication inside a rewording.
 *
 * ── The rows already written ──────────────────────────────────────────────
 *
 * **Kept, and nothing here touches them.** Seven rows recording three real
 * joins that really happened: a duplicate in the past is history rather than an
 * error, and deleting somebody's conversation to tidy a log is a destructive
 * write bought with nothing. The self-check counts `public.messages` before and
 * after and raises if the number has moved, so a later edit that starts
 * deleting cannot commit quietly.
 *
 * ── Locks and roles ───────────────────────────────────────────────────────
 *
 * `create or replace function` takes a short ACCESS EXCLUSIVE on the function's
 * own catalogue row and nothing on any table; no table is touched at all.
 * `lock_timeout = '5s'` bounds it anyway.
 *
 * The body below is **the live definition**, read off production with
 * `pg_get_functiondef` and compared against the recorded
 * `20260511_invite_accept_read_baseline_and_system_notice.sql` before anything
 * was changed: the two are identical once `pg_get_functiondef`'s own rendering
 * of `set search_path` and its dollar quoting are normalised. So this is an
 * edit of what is running, not of a copy that might have drifted. Two lines
 * differ from it -- the declaration of `v_members` and the `if` -- and nothing
 * else.
 *
 * **As the owner of the function**, which production reports as `postgres`. The
 * role is enforced below rather than described, and `security definer` plus
 * `search_path` are re-asserted afterwards because a `create or replace` that
 * silently dropped either would turn a working RPC into a broken one.
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
  'kub.invite_accept_before',
  pg_catalog.pg_get_functiondef('public.group_invite_accept(uuid)'::regprocedure),
  true
);

select pg_catalog.set_config(
  'kub.messages_before_invite_accept_before',
  (select pg_catalog.count(*) from public.messages)::text,
  true
);

-- ── the function, as production runs it, with two lines changed ────────────

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
  -- Added 2026-09-19. How many members the chat has once this acceptance has
  -- put its row in — read exactly as write_membership_service_message reads it,
  -- because the whole point of the guard below is to agree with that trigger
  -- about which of the two writes the line.
  v_members bigint := 0;
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

  -- write_membership_service_message (20260915140000) already writes a line
  -- for this join, better worded, whenever the chat is of type group and has
  -- more than one member once the row is in. What follows covers exactly what
  -- that trigger declines — a channel, and a group whose only member is the
  -- person who has just joined — so that a join is announced once and never
  -- twice. Deleting this insert outright would make both of those cases silent.
  select count(*) into v_members
    from public.chat_members where chat_id = v_invite.chat_id;

  if coalesce(v_joined, false) and not (v_chat.type = 'group' and v_members > 1) then
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
  v_before text := pg_catalog.current_setting('kub.invite_accept_before');
  v_after text := pg_catalog.pg_get_functiondef('public.group_invite_accept(uuid)'::regprocedure);
  v_reverted text;
  v_rows_before bigint := pg_catalog.current_setting('kub.messages_before_invite_accept_before')::bigint;
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

  if (v_after like '%v_members%') is distinct from true then
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

  if v_before like '%v_members%' then
    if v_after is distinct from v_before then
      raise exception
        'this file was already applied and replacing the function changed it anyway';
    end if;
  else
    v_reverted := pg_catalog.replace(
      pg_catalog.replace(v_after, $dclA$  v_now timestamptz := now();
  -- Added 2026-09-19. How many members the chat has once this acceptance has
  -- put its row in — read exactly as write_membership_service_message reads it,
  -- because the whole point of the guard below is to agree with that trigger
  -- about which of the two writes the line.
  v_members bigint := 0;
$dclA$, $dclB$  v_now timestamptz := now();
$dclB$),
      $grdA$  -- write_membership_service_message (20260915140000) already writes a line
  -- for this join, better worded, whenever the chat is of type group and has
  -- more than one member once the row is in. What follows covers exactly what
  -- that trigger declines — a channel, and a group whose only member is the
  -- person who has just joined — so that a join is announced once and never
  -- twice. Deleting this insert outright would make both of those cases silent.
  select count(*) into v_members
    from public.chat_members where chat_id = v_invite.chat_id;

  if coalesce(v_joined, false) and not (v_chat.type = 'group' and v_members > 1) then
$grdA$, $grdB$  if coalesce(v_joined, false) then
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

  raise notice 'a join into a group is announced once, by the membership trigger; a channel and a memberless group are still announced by group_invite_accept';
end
$check$;

commit;
