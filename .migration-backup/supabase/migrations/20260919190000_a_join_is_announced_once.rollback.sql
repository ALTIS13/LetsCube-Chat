/**
 * Rollback for 20260919190000_a_join_is_announced_once.sql: accepting an invite
 * into a group writes two system messages again.
 *
 * That is what a rollback of this change *is*, and it is written down plainly
 * because the thing being restored is a defect. The body below is
 * `20260511_invite_accept_read_baseline_and_system_notice.sql` lines 17-110,
 * byte for byte — the definition production ran from 2026-05-11 until this was
 * applied, verified against `pg_get_functiondef` before anything was changed.
 * Its self-check asserts **two** lines rather than one, so a restore that only
 * half worked cannot report success.
 *
 * What it does not do:
 *
 * - It does not touch `write_membership_service_message` or its triggers. They
 *   were never changed by the migration this reverses, and restoring the
 *   duplicate means putting the second writer back, not taking the first away.
 * - It does not delete or re-write any message. The seven rows that record
 *   three real joins were kept by the migration and are kept by this.
 *
 * Locks: `create or replace function` takes a short ACCESS EXCLUSIVE on the
 * function's own catalogue row and nothing on any table. `lock_timeout = '5s'`
 * bounds it anyway.
 *
 * **As the owner of the function**, which production reports as `postgres`.
 * Enforced below rather than described.
 */

begin;

set local lock_timeout = '5s';

do $role$
declare
  v_owner text;
begin
  if pg_catalog.to_regprocedure('public.group_invite_accept(uuid)') is null then
    raise exception 'public.group_invite_accept does not exist, so there is nothing to roll back';
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

select pg_catalog.set_config(
  'kub.messages_before_join_dedup_rollback',
  (select pg_catalog.count(*) from public.messages)::text,
  true
);

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

do $check$
declare
  v_before bigint := pg_catalog.current_setting('kub.messages_before_join_dedup_rollback')::bigint;
  v_after bigint;
  v_secdef boolean;
  v_owner_id uuid;
  v_joiner uuid;
  v_chat uuid;
  v_invite uuid;
  v_written integer;
begin
  select p.prosecdef into v_secdef
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'group_invite_accept';
  if not coalesce(v_secdef, false) then
    raise exception 'group_invite_accept is no longer security definer';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', 'public.group_invite_accept(uuid)', 'execute') then
    raise exception 'authenticated can no longer call group_invite_accept';
  end if;
  if pg_catalog.pg_get_functiondef('public.group_invite_accept(uuid)'::regprocedure) like '%v_members%' then
    raise exception 'the restored function still carries the deduplication guard, so nothing was rolled back';
  end if;

  -- The duplicate, restored and measured. Two lines is the state before
  -- 20260919190000, and a rollback that produced one would be a rollback that
  -- had not happened.
  begin
    v_owner_id := pg_catalog.gen_random_uuid();
    v_joiner := pg_catalog.gen_random_uuid();
    insert into auth.users (id) values (v_owner_id), (v_joiner);
    insert into public.profiles (id, full_name)
      values (v_owner_id, 'Проверка Владелец'), (v_joiner, 'Проверка Участник');
    perform pg_catalog.set_config('request.jwt.claim.sub', v_joiner::text, true);

    insert into public.chats (type, name, created_by)
      values ('group', 'Проверка отката', v_owner_id) returning id into v_chat;
    insert into public.chat_members (chat_id, user_id, role)
      values (v_chat, v_owner_id, 'owner') on conflict do nothing;
    delete from public.messages where chat_id = v_chat;
    insert into public.group_invites (chat_id, inviter_id, invitee_id)
      values (v_chat, v_owner_id, v_joiner) returning id into v_invite;
    perform public.group_invite_accept(v_invite);

    select pg_catalog.count(*) into v_written from public.messages where chat_id = v_chat;
    if v_written <> 2 then
      raise exception
        'accepting an invite into a group wrote % lines rather than the two this rolls back to',
        v_written;
    end if;

    raise exception 'group_join_dedup_rollback_probe' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'group_join_dedup_rollback_probe' then
        raise;
      end if;
      raise notice 'the end-to-end probe passed and was rolled back';
  end;

  select pg_catalog.count(*) into v_after from public.messages;
  if v_after <> v_before then
    raise exception 'this file changed the number of rows in public.messages from % to %', v_before, v_after;
  end if;

  raise notice 'a join into a group is announced twice again, which is the state this rolls back to';
end
$check$;

commit;
