/**
 * Rollback for 20260919180000_the_rail_already_says_who_is_in_the_channel.sql:
 * a group's conversation is told about a call again.
 *
 * **This is not `20260918200000_a_call_says_so_in_the_conversation.sql` run a
 * second time, and the difference is the whole point of the file.** That
 * migration's writer announced a call in *any* chat with a `voice_channels`
 * row, which was right when only a group could have one. `20260918250000`
 * then put a room in every private chat anybody calls in, and the owner read
 * five lines about a call they had cancelled;
 * `20260918280000_a_private_chat_has_no_channel_to_announce.sql` repaired it by
 * making the writer return early for a private chat. Replaying 200000 here
 * would reinstate that defect silently -- a restore that looks like it worked
 * and did not.
 *
 * So the three functions below are restored **as production had them at the
 * moment of the removal**: 200000's rule and copy, 280000's writer. The
 * self-check asserts the private-chat early return specifically, and
 * `tests/server/voice-call-service-message-db.test.mjs` proves it by driving a
 * private chat's room through a whole call and finding the conversation silent.
 *
 * ── What is restored, and in what order ───────────────────────────────────
 *
 * The column first, because the writer latches it; then the rule and the copy,
 * which are pure; then the writer, which calls them; then the grants and the
 * ownership; then the trigger, last, so nothing can reach a half-built writer.
 *
 * `call_announced_at` comes back with the grants production actually had rather
 * than with the ones 200000 left. 200000 revoked UPDATE on the column from
 * `authenticated` and granted nothing;
 * `20260918230000_a_ring_cannot_be_forged.sql` later rewrote a table-wide
 * INSERT grant into a column list which named it, so the live state was
 * «INSERT yes, UPDATE no» and that is what is restored. Whether a client has
 * any business inserting that column at all is a real question and 230000's own
 * header says so; it is not this file's question, because a rollback that
 * quietly improves something is a rollback whose result nobody can predict.
 *
 * ── What it cannot restore ────────────────────────────────────────────────
 *
 * The rows. Twenty-five were deleted after the removal, on the owner's
 * instruction, from a verified export kept on the server. This file puts the
 * mechanism back; it does not re-write history, and restoring from that export
 * would be a separate, deliberate act.
 *
 * Nor the latch of the call that was open when the removal ran. A call in
 * progress when this file runs has `call_announced_at` null, so its ending
 * announces nothing -- which is the same «incomplete rather than false» shape
 * 200000 chose, and the reason `voice_call_transition`'s end arm requires an
 * announced call.
 *
 * Locks: `add column` with no default is catalog-only, and `create trigger`
 * takes ACCESS EXCLUSIVE briefly. `lock_timeout = '5s'` bounds the wait, which
 * matters because `private.voice_channel_recount` writes to this table on every
 * join and leave. Every statement is guarded, so a second run does no DDL at
 * all and the self-check still passes.
 *
 * **As `supabase_admin`**: `public.voice_channels` is owned by it rather than
 * by `postgres`. Enforced below rather than described.
 */

begin;

set local lock_timeout = '5s';

-- ── the role, enforced rather than described ────────────────────────────────

do $role$
declare
  v_owner text;
begin
  if pg_catalog.to_regclass('public.voice_channels') is null then
    raise exception
      'public.voice_channels does not exist, so 20260913150000 has not been applied here';
  end if;
  if pg_catalog.to_regclass('public.messages') is null then
    raise exception 'public.messages does not exist; this is not a LETSCUBE database';
  end if;

  select pg_catalog.pg_get_userbyid(relowner) into v_owner
    from pg_catalog.pg_class where oid = 'public.voice_channels'::regclass;

  if not pg_catalog.pg_has_role(
       current_user,
       (select relowner from pg_catalog.pg_class where oid = 'public.voice_channels'::regclass),
       'USAGE'
     ) then
    raise exception
      'this file adds a column and a trigger to public.voice_channels, which % owns, and % is not a member of it: run it as supabase_admin',
      v_owner, current_user;
  end if;
end
$role$;

-- ── the latch ───────────────────────────────────────────────────────────────

do $column$
declare
  v_filenode_before oid;
  v_filenode_after oid;
begin
  if exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.voice_channels'::regclass
       and attname = 'call_announced_at'
       and not attisdropped
  ) then
    raise notice 'public.voice_channels.call_announced_at was already there';
    return;
  end if;

  select pg_catalog.pg_relation_filenode('public.voice_channels'::regclass)
    into v_filenode_before;

  alter table public.voice_channels add column call_announced_at timestamptz;

  select pg_catalog.pg_relation_filenode('public.voice_channels'::regclass)
    into v_filenode_after;
  if v_filenode_after <> v_filenode_before then
    raise exception
      'adding call_announced_at rewrote the table (filenode % -> %); 20260918200000 is documented as catalog-only and that claim would now be false',
      v_filenode_before, v_filenode_after;
  end if;
  raise notice 'public.voice_channels.call_announced_at restored without a rewrite';
end
$column$;

comment on column public.voice_channels.call_announced_at is
  'The conversation has been told a call began and has not been told it ended. '
  'Not a second active_since: that is what the SFU says about the room, this is '
  'what the group has been told. Null at rest, and null is what keeps a call '
  'already in progress when this was deployed from producing an end line for a '
  'start nobody wrote.';

-- The live grants at the moment of removal, restored exactly: INSERT from
-- 20260918230000's column list, no UPDATE. See the header.
revoke update (call_announced_at) on public.voice_channels from authenticated;
grant insert (call_announced_at) on public.voice_channels to authenticated;

-- ── the rule, as a function of nothing but its arguments ────────────────────

create or replace function public.voice_call_transition(
  p_before integer,
  p_after integer,
  p_announced boolean
)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    -- The room filled from empty and the conversation has not been told about a
    -- call. This is the only thing that writes a start line, and it is a
    -- transition rather than an arrival: the second, third and tenth joiner all
    -- leave `p_before` above zero and write nothing. That is the whole of «once
    -- per call, not once per join», and it is also why a redelivered
    -- `participant_joined` -- an upsert that moves no count -- is silent.
    when coalesce(p_before, 0) = 0
     and coalesce(p_after, 0) > 0
     and not coalesce(p_announced, false)
    then 'start'
    -- The last person left a call the conversation knows about. Reached from the
    -- leave webhook, from the reconciler's replace and from the reaper alike, so
    -- it never waits for `room_finished`. The `p_announced` half is what keeps a
    -- call that was already running when this was deployed, or a count zeroed by
    -- hand, from producing an end line for a start nobody wrote.
    when coalesce(p_before, 0) > 0
     and coalesce(p_after, 0) = 0
     and coalesce(p_announced, false)
    then 'end'
    else null
  end
$function$;

comment on function public.voice_call_transition(integer, integer, boolean) is
  'start, end or nothing, from the occupancy before, the occupancy after and '
  'whether a call is already announced. Pure so that «once per call, not once '
  'per join» can be asserted without an SFU.';

-- ── the copy ────────────────────────────────────────────────────────────────

create or replace function public.voice_call_service_line(
  p_transition text,
  p_room_name text
)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_name text := nullif(pg_catalog.btrim(coalesce(p_room_name, '')), '');
begin
  if p_transition = 'start' then
    if v_name is null then
      return 'Начался разговор в голосовом канале';
    end if;
    return 'Начался разговор в канале «' || v_name || '»';
  end if;
  if p_transition = 'end' then
    if v_name is null then
      return 'Разговор в голосовом канале закончился';
    end if;
    return 'Разговор в канале «' || v_name || '» закончился';
  end if;
  return null;
end
$function$;

comment on function public.voice_call_service_line(text, text) is
  'The two Russian sentences a call puts in the conversation. The room name is '
  'the caller''s snapshot, never a live read: a message is permanent and a room '
  'can be renamed, archived or deleted.';

-- ── the writer, as 20260918280000 left it ───────────────────────────────────

create or replace function public.write_voice_call_service_message()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_transition text;
  v_line text;
  v_type text;
begin
  -- A private chat's room is a telephone call, not a channel. Slice B writes
  -- that call down — outcome, direction and length — from `voice_call_stop`, so
  -- announcing it here as well is two mechanisms describing one thing, and the
  -- sentence would name a «канал» that exists only as an implementation detail.
  --
  -- Checked first, before the transition arithmetic, so that the private case
  -- costs one lookup and nothing else.
  select c.type into v_type from public.chats as c where c.id = new.chat_id;
  if v_type = 'private' then
    return new;
  end if;

  v_transition := public.voice_call_transition(
    old.participant_count,
    new.participant_count,
    old.call_announced_at is not null
  );
  if v_transition is null then
    return new;
  end if;

  -- `new.name` rather than a join: the sentence keeps the name the room had at
  -- the moment of the call, because the message outlives the room.
  v_line := public.voice_call_service_line(v_transition, new.name);
  if v_line is null then
    return new;
  end if;

  insert into public.messages (chat_id, type, content)
    values (new.chat_id, 'system', v_line);

  -- The latch, folded into the row this trigger is already modifying. An AFTER
  -- trigger would need a second UPDATE of the same row, a second Realtime
  -- broadcast to every member of the group, and an argument about why that
  -- second write does not fire this trigger again.
  new.call_announced_at := case when v_transition = 'start' then pg_catalog.now() else null end;

  return new;
end
$function$;

comment on function public.write_voice_call_service_message() is
  'Turns a crossing of zero in participant_count into one appended system '
  'message, in a group and never in a private chat. A trigger rather than a '
  'door: nobody may call it, and no client can write a type = system row at all.';

revoke all on function public.voice_call_transition(integer, integer, boolean)
  from public, anon, authenticated;
revoke all on function public.voice_call_service_line(text, text)
  from public, anon, authenticated;
revoke all on function public.write_voice_call_service_message()
  from public, anon, authenticated;

-- The writer's whole ability to insert past the INSERT policy on `messages` is
-- that it owns the table. Read off the catalogue rather than named, so the
-- definer and the table it writes to cannot drift apart.

do $own$
declare
  v_owner text := (
    select pg_catalog.pg_get_userbyid(relowner)
      from pg_catalog.pg_class where oid = 'public.messages'::regclass
  );
  v_signature text;
begin
  foreach v_signature in array array[
    'public.voice_call_transition(integer,integer,boolean)',
    'public.voice_call_service_line(text,text)',
    'public.write_voice_call_service_message()'
  ]
  loop
    execute pg_catalog.format('alter function %s owner to %I', v_signature, v_owner);
  end loop;
  raise notice 'the service-message functions are owned by %, which owns public.messages', v_owner;
end
$own$;

-- ── the trigger ─────────────────────────────────────────────────────────────

drop trigger if exists trg_voice_call_service_message on public.voice_channels;
create trigger trg_voice_call_service_message
  before update of participant_count on public.voice_channels
  for each row
  when (
    (coalesce(old.participant_count, 0) = 0) is distinct from (coalesce(new.participant_count, 0) = 0)
  )
  execute function public.write_voice_call_service_message();

-- ── the self-check, which raises rather than committing half of this ───────

do $check$
declare
  v_messages_owner text;
  v_writer_owner text;
  v_src text;
  v_secdef boolean;
  v_pinned boolean;
  v_triggers integer;
  v_written integer;
  v_chat uuid;
  v_channel uuid;
  v_private uuid;
  v_private_room uuid;
  v_latch timestamptz;
begin
  -- 1. Structure.

  if not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.voice_channels'::regclass
       and attname = 'call_announced_at' and not attisdropped
  ) then
    raise exception 'call_announced_at is missing, so nothing latches a call as announced';
  end if;

  if pg_catalog.has_column_privilege(
       'authenticated', 'public.voice_channels', 'call_announced_at', 'update') then
    raise exception
      'authenticated can write call_announced_at, so a member can make the group announce a call';
  end if;

  select pg_catalog.count(*) into v_triggers
    from pg_catalog.pg_trigger
   where not tgisinternal
     and tgrelid = 'public.voice_channels'::regclass
     and tgname = 'trg_voice_call_service_message';
  if v_triggers <> 1 then
    raise exception 'expected one service-message trigger on voice_channels, found %', v_triggers;
  end if;

  select p.prosecdef,
         exists (
           select 1 from pg_catalog.unnest(p.proconfig) setting
            where setting like 'search_path=%'
              and pg_catalog.btrim(pg_catalog.split_part(setting, '=', 2), '"') = ''
         ),
         pg_catalog.pg_get_functiondef(p.oid)
    into v_secdef, v_pinned, v_src
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'write_voice_call_service_message';
  if not coalesce(v_secdef, false) then
    raise exception
      'the writer is not security definer, so it cannot write past the INSERT policy on messages';
  end if;
  if not coalesce(v_pinned, false) then
    raise exception 'the writer does not pin an empty search_path';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated', 'public.write_voice_call_service_message()', 'execute')
     or pg_catalog.has_function_privilege(
       'anon', 'public.write_voice_call_service_message()', 'execute') then
    raise exception 'the writer is reachable as a function, and it is a trigger rather than a door';
  end if;

  select pg_catalog.pg_get_userbyid(relowner) into v_messages_owner
    from pg_catalog.pg_class where oid = 'public.messages'::regclass;
  select pg_catalog.pg_get_userbyid(proowner) into v_writer_owner
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'write_voice_call_service_message';
  if v_writer_owner is distinct from v_messages_owner then
    raise exception
      'the writer is owned by % while public.messages is owned by %, so its insert will be refused',
      v_writer_owner, v_messages_owner;
  end if;

  -- 2. The version restored is 20260918280000's, not 200000's. This is the one
  --    thing a rollback of this shape can get wrong in a way that looks like
  --    success, so it is asserted on the catalogue's own copy of the source.

  if v_src not like '%public.chats%' or v_src not like '%private%' then
    raise exception
      'the restored writer does not look up the chat type, so 20260918200000 has been replayed and a private chat will be told about a «канал» again';
  end if;
  if v_src not like '%voice_call_transition%' or v_src not like '%voice_call_service_line%' then
    raise exception 'the restored writer lost the group-call announcement it exists for';
  end if;
  if v_src not like '%call_announced_at%' then
    raise exception 'the restored writer lost its latch, so a group would be told once per join';
  end if;

  -- 3. The rule and the sentences, executed rather than read.

  if public.voice_call_transition(0, 1, false) is distinct from 'start' then
    raise exception 'an empty room filling no longer starts a call';
  end if;
  if public.voice_call_transition(1, 2, true) is not null then
    raise exception
      'a second joiner writes a line, so the message lands once per join rather than once per call';
  end if;
  if public.voice_call_transition(1, 0, true) is distinct from 'end' then
    raise exception 'the last person leaving no longer ends the call';
  end if;
  if public.voice_call_transition(1, 0, false) is not null then
    raise exception
      'a room emptying with no announced call writes an end line, so a call already running when this was applied will announce an ending nobody saw begin';
  end if;
  if public.voice_call_service_line('start', 'Общая')
       is distinct from 'Начался разговор в канале «Общая»' then
    raise exception 'the start line is not the approved sentence';
  end if;
  if public.voice_call_service_line('end', 'Общая')
       is distinct from 'Разговор в канале «Общая» закончился' then
    raise exception 'the end line is not the approved sentence';
  end if;

  -- 4. Behavioural, end to end, and rolled back so that nothing is committed.
  --
  --    Both chat types in one probe, because the whole risk of this file is
  --    restoring the wrong writer and a structural scan of its source is only
  --    as good as the words it happens to look for. The synthetic rows are
  --    abandoned by raising a sentinel inside a plpgsql block, which is a
  --    subtransaction, so the abort discards the chats, the rooms, the messages
  --    and anything any other trigger wrote.

  begin
    insert into public.chats (type, name, created_by)
      values ('group', 'Проверка восстановления системного сообщения', null)
      returning id into v_chat;
    insert into public.voice_channels (chat_id, name, created_by)
      values (v_chat, 'Проверка', null)
      returning id into v_channel;

    update public.voice_channels set participant_count = 1 where id = v_channel;
    update public.voice_channels set participant_count = 3 where id = v_channel;
    update public.voice_channels set participant_count = 2 where id = v_channel;
    select pg_catalog.count(*) into v_written from public.messages where chat_id = v_chat;
    if v_written <> 1 then
      raise exception
        'a call with three arrivals and one departure wrote % lines; the gate is that it writes one',
        v_written;
    end if;
    select call_announced_at into v_latch from public.voice_channels where id = v_channel;
    if v_latch is null then
      raise exception 'the start line was written without latching the call as announced';
    end if;

    update public.voice_channels set participant_count = 0 where id = v_channel;
    select pg_catalog.count(*) into v_written from public.messages where chat_id = v_chat;
    if v_written <> 2 then
      raise exception 'the whole call wrote % lines rather than two', v_written;
    end if;
    if not exists (
      select 1 from public.messages
       where chat_id = v_chat and content = 'Разговор в канале «Проверка» закончился'
    ) then
      raise exception 'the room emptying did not write the end sentence';
    end if;

    -- And the repair of 20260918280000 survives the restore.
    insert into public.chats (type, created_by) values ('private', null)
      returning id into v_private;
    insert into public.voice_channels (chat_id, name, max_participants, created_by)
      values (v_private, 'Звонок', 2, null)
      returning id into v_private_room;
    update public.voice_channels set participant_count = 2 where id = v_private_room;
    update public.voice_channels set participant_count = 0 where id = v_private_room;
    select pg_catalog.count(*) into v_written from public.messages where chat_id = v_private;
    if v_written <> 0 then
      raise exception
        'a private chat was told about a «канал» % times, so 20260918200000 has been replayed over 20260918280000',
        v_written;
    end if;

    raise exception 'voice_call_line_restore_probe' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'voice_call_line_restore_probe' then
        raise;
      end if;
      raise notice 'the end-to-end probe passed and was rolled back';
  end;

  raise notice
    'a group conversation is told about a call again, once when it starts and once when it ends; a private chat is not, and the rows deleted on 2026-09-19 are not restored by this file';
end
$check$;

commit;
