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

-- ── what the conversations held before this file touched anything ──────────
--
-- Transaction-local, so it is gone at commit either way. It exists so that the
-- promise this file's header makes — that it removes a duplicate and not
-- anybody's messages — is checked rather than stated.

select pg_catalog.set_config(
  'kub.messages_before_join_dedup',
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
  -- put its row in — read exactly as `write_membership_service_message` reads
  -- it, because the whole point of the guard below is to agree with that
  -- trigger about which of the two writes the line.
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

  -- `write_membership_service_message` (20260915140000) already writes a line
  -- for this join, better worded, whenever the chat is of type `group` and has
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

do $check$
declare
  v_before bigint := pg_catalog.current_setting('kub.messages_before_join_dedup')::bigint;
  v_after bigint;
  v_src text;
  v_secdef boolean;
  v_pinned boolean;
  v_chat uuid;
  v_channel_chat uuid;
  v_empty_chat uuid;
  v_owner_id uuid;
  v_joiner uuid;
  v_invite uuid;
  v_written integer;
  v_line text;
begin
  -- 1. The function is still the thing the client calls: definer, pinned, and
  --    reachable by `authenticated` and nobody else. A `create or replace` that
  --    lost any of these would deploy and then refuse every acceptance.

  select p.prosecdef,
         exists (
           select 1 from pg_catalog.unnest(p.proconfig) setting
            where setting like 'search_path=%'
         ),
         pg_catalog.pg_get_functiondef(p.oid)
    into v_secdef, v_pinned, v_src
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'group_invite_accept';

  if v_src is null then
    raise exception 'public.group_invite_accept is gone';
  end if;
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

  -- 2. The other mechanism is still there. This file narrows one writer on the
  --    strength of the other covering the ground, so if the other has gone the
  --    premise has gone with it.

  if pg_catalog.to_regprocedure('public.write_membership_service_message()') is null then
    raise exception
      'public.write_membership_service_message is gone, so narrowing this insert would leave a join unannounced';
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

  -- 3. Behavioural, end to end, and rolled back so that nothing is committed.
  --
  --    Three chats, one acceptance each, and the whole claim of this file is
  --    the number `1` in all three. A structural scan cannot see it: the guard
  --    is a boolean expression whose correctness is entirely about what the
  --    *other* mechanism does, and the only way to know is to run both.
  --
  --    Abandoned by raising a sentinel inside a plpgsql block, which is a
  --    subtransaction, so the abort discards the chats, the invites, the
  --    memberships, the messages and anything any other trigger wrote --
  --    including the `set_config` that makes `auth.uid()` answer.

  begin
    v_owner_id := pg_catalog.gen_random_uuid();
    v_joiner := pg_catalog.gen_random_uuid();
    insert into auth.users (id) values (v_owner_id), (v_joiner);
    insert into public.profiles (id, full_name)
      values (v_owner_id, 'Проверка Владелец'), (v_joiner, 'Проверка Участник');

    perform pg_catalog.set_config('request.jwt.claim.sub', v_joiner::text, true);

    -- (a) A group with a member already in it: the trigger's case.
    insert into public.chats (type, name, created_by)
      values ('group', 'Проверка дублирования', v_owner_id) returning id into v_chat;
    insert into public.chat_members (chat_id, user_id, role)
      values (v_chat, v_owner_id, 'owner') on conflict do nothing;
    delete from public.messages where chat_id = v_chat;
    insert into public.group_invites (chat_id, inviter_id, invitee_id)
      values (v_chat, v_owner_id, v_joiner) returning id into v_invite;
    perform public.group_invite_accept(v_invite);

    select pg_catalog.count(*) into v_written from public.messages where chat_id = v_chat;
    if v_written <> 1 then
      raise exception
        'accepting an invite into a group wrote % lines rather than one; the duplication this file removes is % ',
        v_written, (select pg_catalog.string_agg(content, ' / ') from public.messages where chat_id = v_chat);
    end if;
    select content into v_line from public.messages where chat_id = v_chat;
    if v_line is distinct from 'Проверка Участник присоединился(ась) к группе' then
      raise exception
        'the one line a group join leaves is «%», which is not the trigger''s wording -- the wrong writer was kept',
        v_line;
    end if;

    -- (b) A chat of type `channel`: the trigger declines it, so this function
    --     must not. Deleting the insert instead of narrowing it would make this
    --     zero.
    insert into public.chats (type, name, created_by)
      values ('channel', 'Проверка канала', v_owner_id) returning id into v_channel_chat;
    insert into public.chat_members (chat_id, user_id, role)
      values (v_channel_chat, v_owner_id, 'owner') on conflict do nothing;
    delete from public.messages where chat_id = v_channel_chat;
    insert into public.group_invites (chat_id, inviter_id, invitee_id)
      values (v_channel_chat, v_owner_id, v_joiner) returning id into v_invite;
    perform public.group_invite_accept(v_invite);

    select pg_catalog.count(*) into v_written from public.messages where chat_id = v_channel_chat;
    if v_written <> 1 then
      raise exception
        'accepting an invite into a channel wrote % lines rather than one; the trigger does not cover a channel and this function must',
        v_written;
    end if;

    -- (c) A group whose only member afterwards is the joiner: the trigger's
    --     `v_members <= 1` guard declines it, so this function must not.
    --
    --     `created_by` is null so that `add_chat_creator_as_owner` puts nobody
    --     in. Emptying it afterwards instead is not available:
    --     `enforce_chat_member_delete` refuses to remove the last owner, which
    --     is also why the three memberless groups on production got that way by
    --     some route other than somebody leaving.
    insert into public.chats (type, name, created_by)
      values ('group', 'Проверка пустой группы', null) returning id into v_empty_chat;
    delete from public.messages where chat_id = v_empty_chat;
    insert into public.group_invites (chat_id, inviter_id, invitee_id)
      values (v_empty_chat, v_owner_id, v_joiner) returning id into v_invite;
    perform public.group_invite_accept(v_invite);

    select pg_catalog.count(*) into v_written from public.messages where chat_id = v_empty_chat;
    if v_written <> 1 then
      raise exception
        'accepting an invite into a group with no other member wrote % lines rather than one; the trigger declines that case and this function must not',
        v_written;
    end if;

    raise exception 'group_join_dedup_probe' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'group_join_dedup_probe' then
        raise;
      end if;
      raise notice 'the end-to-end probe passed and was rolled back';
  end;

  -- 4. Nobody's conversation history was deleted by this file.

  select pg_catalog.count(*) into v_after from public.messages;
  if v_after <> v_before then
    raise exception
      'this file changed the number of rows in public.messages from % to %; removing a duplicate does not delete what was already written',
      v_before, v_after;
  end if;

  raise notice
    'a join into a group is announced once, by the membership trigger; a channel and a memberless group are still announced by group_invite_accept';
end
$check$;

commit;
