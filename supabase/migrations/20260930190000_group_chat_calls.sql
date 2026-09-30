/**
 * The group chat's call — tracker item 45, second phase (2026-09-30).
 *
 * THE OWNER'S DESIGN, from 2026-09-20: the group is made, «и в неё по сути
 * созваниваются заново люди которые были в изначальном войс чате в лс +
 * происходит дозвон до добавленного человека». A group chat has a call, not a
 * voice channel: «начать голосовой звонок», and a history line that names a
 * duration.
 *
 * WHAT DISCORD DOES, read in its web bundle on 2026-09-30
 * (`docs/operations/reference-clients.md` §27):
 *
 *   - A call is one message. `CALL_CREATE` carries the call's `messageId` and
 *     its `ongoingRings`, an object keyed by the people being rung. The message
 *     is given `participants` and `ended_timestamp` afterwards, and its
 *     duration is the end minus the message's own time.
 *   - Missed is the reader's: `!isCallActive && !call.participants.includes(me)`,
 *     and a call still running offers a join to whoever is not in it.
 *   - Declining stops one's own ring (`stopRinging`); a ring is per person.
 *   - People added to a group DM whose call the adder is in are rung, and only
 *     they (`ring(channel, added, "dm_invite")`).
 *
 * WHAT THIS DOES WITH IT:
 *
 *   - A group chat has one room, ten seats (`voice_group_room`), and its call
 *     state lives on it: `call_started_at`, `call_started_by`, `call_message_id`
 *     and `call_ringing`, `{person: when their ring began}`. The room is read
 *     through the subscription every client already holds, so a ring reaches an
 *     open client as a private chat's does. System messages send no push, the
 *     same as a private chat's call record.
 *   - `voice_group_call_start` writes the call's message and rings everybody
 *     else; taking a seat stops that person's ring and makes them a
 *     participant; the last one out ends the call and writes its length.
 *     `voice_group_call_decline` stops one's own ring.
 *   - Born from a call: when the two were talking in the private chat,
 *     `micro_group_create` writes that call down there as any answered call is,
 *     starts the group's call ringing only the people added, and points the
 *     private room at the group's (`call_moved_to`), so both devices move.
 *   - Added during a call: `micro_group_add` rings the people added.
 *   - A group chat's crown is an owner, so «admins manage …» let it make rooms,
 *     topics and channel categories in a group chat. Restrictive policies close
 *     that: its one room comes from its functions, and it has neither topics
 *     nor categories.
 *   - `voice_group_calls_sweep`, every minute: rings older than 45 seconds, a
 *     call nobody ever sat in, and moves older than two minutes.
 *
 * NOT HERE: a push for a ring to a closed application. The Android call
 * delivery is private-chat only and is not switched on in production; a group
 * ring reaches an open client, as a private one does on the web.
 *
 * Run as `supabase_admin`: the triggers go on `voice_channels` and
 * `voice_participants`, which belong to it.
 *
 * Lock: ALTER TABLE on `voice_channels` (a few dozen rows) and policy changes
 * take ACCESS EXCLUSIVE briefly; `lock_timeout` keeps them from queueing.
 *
 * Rollback: 20260930190000_group_chat_calls.rollback.sql
 */
begin;
set local lock_timeout = '5s';

-- ── 1. The call, on its room ─────────────────────────────────────────────────
alter table public.voice_channels
  add column if not exists call_started_at timestamptz,
  add column if not exists call_started_by uuid,
  add column if not exists call_message_id uuid,
  add column if not exists call_ringing jsonb not null default '{}'::jsonb,
  add column if not exists call_moved_to uuid,
  add column if not exists call_moved_at timestamptz;

alter table public.voice_channels drop constraint if exists voice_channels_call_shape_check;
alter table public.voice_channels add constraint voice_channels_call_shape_check check (
  (call_message_id is null or call_started_at is not null)
  and pg_catalog.jsonb_typeof(call_ringing) = 'object'
  and ((call_moved_to is null) = (call_moved_at is null))
);

grant select (call_started_at, call_started_by, call_message_id, call_ringing, call_moved_to, call_moved_at)
  on public.voice_channels to authenticated;

-- ── 2. A group chat has no server furniture ─────────────────────────────────
-- Its crown is an owner, so «admins manage …» admitted it to rooms, topics and
-- channel categories. Its one room is made by `voice_group_room`, and it has
-- neither topics nor categories.
drop policy if exists "a group chat's room comes from its functions (insert)" on public.voice_channels;
create policy "a group chat's room comes from its functions (insert)" on public.voice_channels
  as restrictive for insert to authenticated
  with check (not exists (select 1 from public.chats as chat where chat.id = voice_channels.chat_id and chat.type = 'dm_group'));
drop policy if exists "a group chat's room comes from its functions (update)" on public.voice_channels;
create policy "a group chat's room comes from its functions (update)" on public.voice_channels
  as restrictive for update to authenticated
  using (not exists (select 1 from public.chats as chat where chat.id = voice_channels.chat_id and chat.type = 'dm_group'))
  with check (not exists (select 1 from public.chats as chat where chat.id = voice_channels.chat_id and chat.type = 'dm_group'));
drop policy if exists "a group chat's room comes from its functions (delete)" on public.voice_channels;
create policy "a group chat's room comes from its functions (delete)" on public.voice_channels
  as restrictive for delete to authenticated
  using (not exists (select 1 from public.chats as chat where chat.id = voice_channels.chat_id and chat.type = 'dm_group'));

drop policy if exists "a group chat has no topics (insert)" on public.topics;
create policy "a group chat has no topics (insert)" on public.topics
  as restrictive for insert to authenticated
  with check (not exists (select 1 from public.chats as chat where chat.id = topics.chat_id and chat.type = 'dm_group'));
drop policy if exists "a group chat has no topics (update)" on public.topics;
create policy "a group chat has no topics (update)" on public.topics
  as restrictive for update to authenticated
  using (not exists (select 1 from public.chats as chat where chat.id = topics.chat_id and chat.type = 'dm_group'))
  with check (not exists (select 1 from public.chats as chat where chat.id = topics.chat_id and chat.type = 'dm_group'));

drop policy if exists "a group chat has no channel categories (insert)" on public.chat_channel_categories;
create policy "a group chat has no channel categories (insert)" on public.chat_channel_categories
  as restrictive for insert to authenticated
  with check (not exists (select 1 from public.chats as chat where chat.id = chat_channel_categories.chat_id and chat.type = 'dm_group'));
drop policy if exists "a group chat has no channel categories (update)" on public.chat_channel_categories;
create policy "a group chat has no channel categories (update)" on public.chat_channel_categories
  as restrictive for update to authenticated
  using (not exists (select 1 from public.chats as chat where chat.id = chat_channel_categories.chat_id and chat.type = 'dm_group'))
  with check (not exists (select 1 from public.chats as chat where chat.id = chat_channel_categories.chat_id and chat.type = 'dm_group'));

-- ── 3. Who a call rings ──────────────────────────────────────────────────────
/**
 * The people a group chat's call rings, as Discord's call keeps them: an object
 * keyed by person (`ongoingRings`), each with the moment their ring began. Not
 * the one who calls, nobody already in the room or named in `p_skip`, nobody
 * banned, and nobody across a block with the one who calls, in either
 * direction. `p_only`, when given, narrows it to those people.
 */
create or replace function private.voice_group_ring_set(
  p_chat_id uuid, p_caller uuid, p_room uuid, p_only uuid[], p_skip uuid[], p_at timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(pg_catalog.jsonb_object_agg(member.user_id::text, pg_catalog.to_jsonb(p_at)), '{}'::jsonb)
    from public.chat_members as member
   where member.chat_id = p_chat_id
     and member.user_id is distinct from p_caller
     and (p_only is null or member.user_id = any (p_only))
     and (p_skip is null or not (member.user_id = any (p_skip)))
     and not public.is_banned(member.user_id)
     and not public.users_blocked_either(p_caller, member.user_id)
     and not exists (
       select 1 from public.voice_participants as seated
        where seated.channel_id = p_room and seated.user_id = member.user_id
     )
$$;
revoke all on function private.voice_group_ring_set(uuid, uuid, uuid, uuid[], uuid[], timestamptz) from public, anon, authenticated;
grant execute on function private.voice_group_ring_set(uuid, uuid, uuid, uuid[], uuid[], timestamptz) to postgres;

-- ── 4. The room ──────────────────────────────────────────────────────────────
/**
 * A group chat's one room: ten seats, the chat's own cap, and no speaker rank.
 * `voice_private_room`'s shape for the group chat, and the only way one is made.
 */
create or replace function public.voice_group_room(p_chat_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $$
declare
  v_me uuid := auth.uid();
  v_type text;
  v_room uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select type into v_type from public.chats where id = p_chat_id;
  if v_type is null then
    raise exception 'no_such_chat' using errcode = 'P0002';
  end if;
  if v_type <> 'dm_group' then
    raise exception 'not_a_group_chat' using errcode = '22023';
  end if;
  if not public.is_chat_member(p_chat_id) or public.is_banned(v_me) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_chat_id::text, 0));

  select id into v_room
    from public.voice_channels
   where chat_id = p_chat_id
   order by created_at, id
   limit 1;

  if v_room is not null then
    update public.voice_channels
       set max_participants = 10,
           speak_role = 'member',
           archived = false,
           updated_at = pg_catalog.now()
     where id = v_room
       and (max_participants <> 10 or speak_role <> 'member' or archived);
    return v_room;
  end if;

  insert into public.voice_channels (chat_id, name, max_participants, created_by)
  values (p_chat_id, 'Звонок', 10, v_me)
  returning id into v_room;
  return v_room;
end;
$$;
revoke all on function public.voice_group_room(uuid) from public, anon;
grant execute on function public.voice_group_room(uuid) to authenticated, postgres;

-- ── 5. The call's record: opened at the start, closed at the end ────────────
/**
 * One message per call, written when it starts, as Discord writes its call
 * message at `CALL_CREATE` and gives it `participants` and `ended_timestamp`
 * afterwards. Whether a reader missed it is theirs to see: not among the
 * participants. `content` is the neutral line an older bundle prints.
 */
create or replace function private.voice_group_call_open(
  p_room uuid, p_chat_id uuid, p_by uuid, p_at timestamptz, p_ring jsonb
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_message uuid;
begin
  insert into public.messages (chat_id, type, content, system_payload)
  values (
    p_chat_id,
    'system',
    'Звонок',
    pg_catalog.jsonb_build_object(
      'kind', 'call',
      'mode', 'group',
      'caller', p_by,
      'started_at', p_at,
      'ended_at', null,
      'duration_ms', null,
      'participants', '[]'::jsonb
    )
  )
  returning id into v_message;

  update public.voice_channels
     set call_started_at = p_at,
         call_started_by = p_by,
         call_message_id = v_message,
         call_ringing = coalesce(p_ring, '{}'::jsonb),
         updated_at = p_at
   where id = p_room;
  return v_message;
end;
$$;
revoke all on function private.voice_group_call_open(uuid, uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function private.voice_group_call_open(uuid, uuid, uuid, timestamptz, jsonb) to postgres;

/**
 * The end of a call: when it ended and how long it ran, from its start. With
 * fewer than two people ever in it nobody talked, and the neutral line says
 * «Звонок без ответа»; each reader is told whether they missed it.
 */
create or replace function private.voice_group_call_close(p_message uuid, p_started timestamptz, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_duration integer := greatest(0, (pg_catalog.date_part('epoch', p_at - coalesce(p_started, p_at)) * 1000)::integer);
  v_people integer;
begin
  if p_message is null then
    return;
  end if;
  select pg_catalog.jsonb_array_length(coalesce(message.system_payload -> 'participants', '[]'::jsonb))
    into v_people
    from public.messages as message
   where message.id = p_message;
  update public.messages as message
     set system_payload = message.system_payload
           || pg_catalog.jsonb_build_object('ended_at', p_at, 'duration_ms', v_duration),
         content = case
           when coalesce(v_people, 0) >= 2 then public.voice_call_record_line('answered', v_duration)
           else 'Звонок без ответа'
         end
   where message.id = p_message
     and message.type = 'system'
     and message.system_payload ->> 'kind' = 'call'
     and message.system_payload ->> 'ended_at' is null;
end;
$$;
revoke all on function private.voice_group_call_close(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ── 6. Starting, and saying no ───────────────────────────────────────────────
/**
 * Start a group chat's call, or find the one already running. Starting rings
 * everybody else, as a call placed in a Discord group DM rings its recipients;
 * the caller's own device then joins the room.
 */
create or replace function public.voice_group_call_start(p_chat_id uuid)
returns table(channel_id uuid, message_id uuid, started boolean)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $$
declare
  v_me uuid := auth.uid();
  v_room uuid;
  v_message uuid;
  v_now timestamptz := pg_catalog.now();
begin
  v_room := public.voice_group_room(p_chat_id);
  select vc.call_message_id into v_message from public.voice_channels as vc where vc.id = v_room for update;
  if v_message is not null then
    return query select v_room, v_message, false;
    return;
  end if;
  v_message := private.voice_group_call_open(
    v_room, p_chat_id, v_me, v_now,
    private.voice_group_ring_set(p_chat_id, v_me, v_room, null, null, v_now)
  );
  return query select v_room, v_message, true;
end;
$$;
revoke all on function public.voice_group_call_start(uuid) from public, anon;
grant execute on function public.voice_group_call_start(uuid) to authenticated;

/** Stop one's own ring, as Discord's «Отклонить» posts `stop-ringing` for oneself. */
create or replace function public.voice_group_call_decline(p_channel_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $$
declare
  v_me uuid := auth.uid();
  v_chat uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select vc.chat_id into v_chat from public.voice_channels as vc where vc.id = p_channel_id;
  if v_chat is null then
    raise exception 'no_such_room' using errcode = 'P0002';
  end if;
  if not public.is_chat_member(v_chat) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  update public.voice_channels as vc
     set call_ringing = vc.call_ringing - v_me::text,
         updated_at = pg_catalog.now()
   where vc.id = p_channel_id
     and vc.call_ringing ? v_me::text;
  return found;
end;
$$;
revoke all on function public.voice_group_call_decline(uuid) from public, anon;
grant execute on function public.voice_group_call_decline(uuid) to authenticated;

-- ── 7. Joining, and the room emptying ────────────────────────────────────────
/**
 * Somebody took a seat in a group chat's room: their ring stops and they are a
 * participant. A seat taken with no call running opens one, ringing nobody.
 */
create or replace function private.voice_group_call_joined()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_chat uuid;
  v_type text;
  v_message uuid;
  v_now timestamptz := pg_catalog.now();
begin
  select vc.chat_id, chat.type, vc.call_message_id
    into v_chat, v_type, v_message
    from public.voice_channels as vc
    join public.chats as chat on chat.id = vc.chat_id
   where vc.id = new.channel_id
     for update of vc;
  if v_type is distinct from 'dm_group' then
    return null;
  end if;
  if v_message is null then
    v_message := private.voice_group_call_open(new.channel_id, v_chat, new.user_id, v_now, '{}'::jsonb);
  else
    update public.voice_channels as vc
       set call_ringing = vc.call_ringing - new.user_id::text,
           updated_at = v_now
     where vc.id = new.channel_id
       and vc.call_ringing ? new.user_id::text;
  end if;
  update public.messages as message
     set system_payload = pg_catalog.jsonb_set(
           message.system_payload,
           '{participants}',
           coalesce(message.system_payload -> 'participants', '[]'::jsonb) || pg_catalog.to_jsonb(new.user_id::text)
         )
   where message.id = v_message
     and message.system_payload ->> 'ended_at' is null
     and not (coalesce(message.system_payload -> 'participants', '[]'::jsonb) ? new.user_id::text);
  return null;
end;
$$;
revoke all on function private.voice_group_call_joined() from public, anon, authenticated;

drop trigger if exists trg_voice_group_call_joined on public.voice_participants;
create trigger trg_voice_group_call_joined
  after insert on public.voice_participants
  for each row
  execute function private.voice_group_call_joined();

/**
 * The seat count moved. The last person out of a group chat's room ends its
 * call. Somebody coming into a room that was moved from forgets the move: a new
 * call there is not the old one.
 */
create or replace function private.voice_group_call_count_changed()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if coalesce(old.participant_count, 0) = 0 and new.participant_count > 0 and new.call_moved_to is not null then
    new.call_moved_to := null;
    new.call_moved_at := null;
  end if;
  if new.call_message_id is not null
     and new.participant_count = 0
     and coalesce(old.participant_count, 0) > 0
     and exists (select 1 from public.chats as chat where chat.id = new.chat_id and chat.type = 'dm_group') then
    perform private.voice_group_call_close(new.call_message_id, new.call_started_at, pg_catalog.now());
    new.call_started_at := null;
    new.call_started_by := null;
    new.call_message_id := null;
    new.call_ringing := '{}'::jsonb;
  end if;
  return new;
end;
$$;
revoke all on function private.voice_group_call_count_changed() from public, anon, authenticated;

drop trigger if exists trg_voice_group_call_count_changed on public.voice_channels;
create trigger trg_voice_group_call_count_changed
  before update of participant_count on public.voice_channels
  for each row
  execute function private.voice_group_call_count_changed();

-- ── 8. What nobody else tidies ───────────────────────────────────────────────
/**
 * Every minute: rings older than 45 seconds leave `call_ringing` (a client has
 * already stopped drawing them); a call nobody ever sat in ends after a
 * minute; a move older than two minutes is forgotten.
 */
create or replace function public.voice_group_calls_sweep()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_room record;
  v_ended integer := 0;
begin
  update public.voice_channels as vc
     set call_ringing = coalesce((
           select pg_catalog.jsonb_object_agg(ring.key, ring.value)
             from pg_catalog.jsonb_each(vc.call_ringing) as ring
            where (ring.value #>> '{}')::timestamptz > v_now - interval '45 seconds'
         ), '{}'::jsonb),
         updated_at = v_now
   where vc.call_ringing <> '{}'::jsonb
     and exists (
       select 1 from pg_catalog.jsonb_each(vc.call_ringing) as ring
        where (ring.value #>> '{}')::timestamptz <= v_now - interval '45 seconds'
     );

  for v_room in
    select vc.id, vc.call_message_id, vc.call_started_at
      from public.voice_channels as vc
      join public.chats as chat on chat.id = vc.chat_id
     where chat.type = 'dm_group'
       and vc.call_message_id is not null
       and vc.participant_count = 0
       and vc.call_started_at < v_now - interval '60 seconds'
     for update of vc skip locked
  loop
    perform private.voice_group_call_close(v_room.call_message_id, v_room.call_started_at, v_now);
    update public.voice_channels
       set call_started_at = null,
           call_started_by = null,
           call_message_id = null,
           call_ringing = '{}'::jsonb,
           updated_at = v_now
     where id = v_room.id;
    v_ended := v_ended + 1;
  end loop;

  update public.voice_channels
     set call_moved_to = null,
         call_moved_at = null,
         updated_at = v_now
   where call_moved_at < v_now - interval '2 minutes';

  return v_ended;
end;
$$;
revoke all on function public.voice_group_calls_sweep() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'letscube-voice-group-call-sweep') then
    perform cron.unschedule('letscube-voice-group-call-sweep');
  end if;
  perform cron.schedule('letscube-voice-group-call-sweep', '* * * * *', 'select public.voice_group_calls_sweep();');
end;
$$;

-- ── 9. Born from a call, and joined during one ──────────────────────────────
grant execute on function public.voice_call_stop(uuid, text) to postgres;

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
  v_private_room uuid;
  v_room uuid;
  v_seated uuid[];
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

  -- The call, carried over. The two were talking in the private chat: that call
  -- is written down there as any answered call is, the group's call starts
  -- ringing the people added and nobody already talking, and the private room
  -- points at the group's so both devices move.
  select vc.id into v_private_room
    from public.voice_channels as vc
   where vc.chat_id = p_private_chat_id
     and not vc.archived
     and vc.ring_answered_at is not null
     and exists (select 1 from public.voice_participants as seated where seated.channel_id = vc.id and seated.user_id = v_me)
   order by vc.created_at, vc.id
   limit 1;
  if v_private_room is not null then
    select coalesce(array_agg(seated.user_id), '{}') into v_seated
      from public.voice_participants as seated
     where seated.channel_id = v_private_room;
    v_room := public.voice_group_room(v_chat);
    perform public.voice_call_stop(v_private_room, 'answered');
    perform private.voice_group_call_open(
      v_room, v_chat, v_me, v_now,
      private.voice_group_ring_set(v_chat, v_me, v_room, null, v_seated, v_now)
    );
    update public.voice_channels
       set call_moved_to = v_room, call_moved_at = v_now, updated_at = v_now
     where id = v_private_room;
  end if;

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

  -- A call running: the people added are rung, and only they.
  update public.voice_channels as vc
     set call_ringing = vc.call_ringing || private.voice_group_ring_set(p_chat_id, v_me, vc.id, v_added, null, v_now),
         updated_at = v_now
   where vc.chat_id = p_chat_id
     and vc.call_message_id is not null;

  return v_count;
end
$$;
revoke all on function public.micro_group_add(uuid, uuid[]) from public, anon;
grant execute on function public.micro_group_add(uuid, uuid[]) to authenticated;

do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'voice_channels'
         and column_name in ('call_started_at', 'call_started_by', 'call_message_id', 'call_ringing', 'call_moved_to', 'call_moved_at')) <> 6
     or to_regprocedure('public.voice_group_room(uuid)') is null
     or to_regprocedure('public.voice_group_call_start(uuid)') is null
     or to_regprocedure('public.voice_group_call_decline(uuid)') is null
     or to_regprocedure('public.voice_group_calls_sweep()') is null
     or to_regprocedure('private.voice_group_ring_set(uuid, uuid, uuid, uuid[], uuid[], timestamptz)') is null
     or to_regprocedure('private.voice_group_call_open(uuid, uuid, uuid, timestamptz, jsonb)') is null
     or to_regprocedure('private.voice_group_call_close(uuid, timestamptz, timestamptz)') is null
     or (select count(*) from pg_catalog.pg_trigger
          where tgname in ('trg_voice_group_call_joined', 'trg_voice_group_call_count_changed')
            and tgenabled = 'O' and not tgisinternal) <> 2
     or (select count(*) from pg_catalog.pg_policies
          where schemaname = 'public'
            and policyname in (
              'a group chat''s room comes from its functions (insert)',
              'a group chat''s room comes from its functions (update)',
              'a group chat''s room comes from its functions (delete)',
              'a group chat has no topics (insert)',
              'a group chat has no topics (update)',
              'a group chat has no channel categories (insert)',
              'a group chat has no channel categories (update)'
            ) and permissive = 'RESTRICTIVE') <> 7
     or not exists (select 1 from cron.job where jobname = 'letscube-voice-group-call-sweep' and active)
     or pg_catalog.pg_get_functiondef('public.micro_group_create(uuid, uuid[])'::regprocedure) not like '%voice_group_call_open%'
     or pg_catalog.pg_get_functiondef('public.micro_group_add(uuid, uuid[])'::regprocedure) not like '%voice_group_ring_set%'
     or not has_function_privilege('postgres', 'public.voice_call_stop(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.voice_group_calls_sweep()', 'EXECUTE')
  then
    raise exception 'group_chat_calls_migration_incomplete';
  end if;
end;
$$;

commit;
