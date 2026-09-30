/**
 * Rollback of 20260930190000_group_chat_calls.sql.
 *
 * Refuses while a group chat's call is running: its state lives in the columns
 * this drops. The call messages already written stay; an older bundle prints
 * their `content`. The two micro-group functions go back to their phase-one
 * text, taken from 20260930150000_micro_groups.sql.
 */
begin;
set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from public.voice_channels where call_message_id is not null) then
    raise exception 'a group chat call is running; end it before rolling back';
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'letscube-voice-group-call-sweep') then
    perform cron.unschedule('letscube-voice-group-call-sweep');
  end if;
end;
$$;

drop trigger if exists trg_voice_group_call_joined on public.voice_participants;
drop trigger if exists trg_voice_group_call_count_changed on public.voice_channels;
drop function if exists public.voice_group_calls_sweep();
drop function if exists public.voice_group_call_decline(uuid);
drop function if exists public.voice_group_call_start(uuid);
drop function if exists private.voice_group_call_joined();
drop function if exists private.voice_group_call_count_changed();
drop function if exists private.voice_group_call_close(uuid, timestamptz, timestamptz);

create or replace function public.micro_group_create(p_private_chat_id uuid, p_user_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_type text;
  v_partner uuid;
  v_added uuid[];
  v_person uuid;
  v_chat uuid;
  v_now timestamptz := now();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_me) then
    raise exception 'banned' using errcode = '42501';
  end if;
  select chat_row.type into v_type from public.chats as chat_row where chat_row.id = p_private_chat_id;
  if v_type is null or v_type <> 'private' then
    raise exception 'micro_group_not_private' using errcode = '22023';
  end if;
  if not exists (select 1 from public.chat_members as member where member.chat_id = p_private_chat_id and member.user_id = v_me) then
    raise exception 'micro_group_not_member' using errcode = '42501';
  end if;
  select member.user_id into v_partner
    from public.chat_members as member
   where member.chat_id = p_private_chat_id and member.user_id <> v_me
   limit 1;
  if v_partner is null then
    raise exception 'micro_group_needs_partner' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct person), '{}') into v_added
    from unnest(coalesce(p_user_ids, '{}')) as person
   where person is not null and person <> v_me and person <> v_partner;
  if cardinality(v_added) = 0 then
    raise exception 'micro_group_nobody_added' using errcode = '22023';
  end if;
  if 2 + cardinality(v_added) > 10 then
    raise exception 'micro_group_full' using errcode = '54000';
  end if;

  foreach v_person in array array_prepend(v_partner, v_added) loop
    if exists (select 1 from public.user_blocks as block where block.blocker_id = v_me and block.blocked_id = v_person) then
      raise exception 'micro_group_blocked_by_you' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles as profile where profile.id = v_person)
       or public.is_banned(v_person)
       or public.users_blocked_either(v_me, v_person) then
      -- No reason given: «you were blocked» is not the blocked person's to learn.
      raise exception 'micro_group_unavailable' using errcode = '42501';
    end if;
  end loop;

  insert into public.chats (type, name, created_by) values ('dm_group', null, v_me) returning id into v_chat;
  -- `add_chat_creator_as_owner` has made the creator its owner: the crown.
  insert into public.chat_members (chat_id, user_id, role, joined_at, last_read_at, last_delivered_at)
  select v_chat, person, 'member'::public.chat_member_role, v_now, v_now, v_now
    from unnest(array_prepend(v_partner, v_added)) as person
  on conflict (chat_id, user_id) do nothing;

  return v_chat;
end
$$;
revoke all on function public.micro_group_create(uuid, uuid[]) from public, anon;
grant execute on function public.micro_group_create(uuid, uuid[]) to authenticated;

create or replace function public.micro_group_add(p_chat_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_type text;
  v_added uuid[];
  v_person uuid;
  v_count integer;
  v_now timestamptz := now();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_me) then
    raise exception 'banned' using errcode = '42501';
  end if;
  -- The row lock serialises two people adding at once, so the cap holds.
  select chat_row.type into v_type from public.chats as chat_row where chat_row.id = p_chat_id for update;
  if v_type is null or v_type <> 'dm_group' then
    raise exception 'micro_group_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.chat_members as member where member.chat_id = p_chat_id and member.user_id = v_me) then
    raise exception 'micro_group_not_member' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct person), '{}') into v_added
    from unnest(coalesce(p_user_ids, '{}')) as person
   where person is not null
     and not exists (select 1 from public.chat_members as member where member.chat_id = p_chat_id and member.user_id = person);
  if cardinality(v_added) = 0 then
    return 0;
  end if;
  select count(*)::integer into v_count from public.chat_members as member where member.chat_id = p_chat_id;
  if v_count + cardinality(v_added) > 10 then
    raise exception 'micro_group_full' using errcode = '54000';
  end if;

  foreach v_person in array v_added loop
    if exists (select 1 from public.user_blocks as block where block.blocker_id = v_me and block.blocked_id = v_person) then
      raise exception 'micro_group_blocked_by_you' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles as profile where profile.id = v_person)
       or public.is_banned(v_person)
       or public.users_blocked_either(v_me, v_person) then
      raise exception 'micro_group_unavailable' using errcode = '42501';
    end if;
  end loop;

  insert into public.chat_members (chat_id, user_id, role, joined_at, last_read_at, last_delivered_at)
  select p_chat_id, person, 'member'::public.chat_member_role, v_now, v_now, v_now
    from unnest(v_added) as person
  on conflict (chat_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.micro_group_add(uuid, uuid[]) from public, anon;
grant execute on function public.micro_group_add(uuid, uuid[]) to authenticated;

drop function if exists private.voice_group_call_open(uuid, uuid, uuid, timestamptz, jsonb);
drop function if exists private.voice_group_ring_set(uuid, uuid, uuid, uuid[], uuid[], timestamptz);
drop function if exists public.voice_group_room(uuid);
revoke execute on function public.voice_call_stop(uuid, text) from postgres;

drop policy if exists "a group chat's room comes from its functions (insert)" on public.voice_channels;
drop policy if exists "a group chat's room comes from its functions (update)" on public.voice_channels;
drop policy if exists "a group chat's room comes from its functions (delete)" on public.voice_channels;
drop policy if exists "a group chat has no topics (insert)" on public.topics;
drop policy if exists "a group chat has no topics (update)" on public.topics;
drop policy if exists "a group chat has no channel categories (insert)" on public.chat_channel_categories;
drop policy if exists "a group chat has no channel categories (update)" on public.chat_channel_categories;

alter table public.voice_channels drop constraint if exists voice_channels_call_shape_check;
alter table public.voice_channels
  drop column if exists call_started_at,
  drop column if exists call_started_by,
  drop column if exists call_message_id,
  drop column if exists call_ringing,
  drop column if exists call_moved_to,
  drop column if exists call_moved_at;

do $$
begin
  if to_regprocedure('public.voice_group_call_start(uuid)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'voice_channels' and column_name = 'call_ringing')
     or pg_catalog.pg_get_functiondef('public.micro_group_create(uuid, uuid[])'::regprocedure) like '%voice_group_call_open%' then
    raise exception 'group_chat_calls_rollback_incomplete';
  end if;
end;
$$;

commit;
