/**
 * A private chat has no channel, so it stops being told about one.
 *
 * **Found by the owner on their first real call**, which is the only reason it
 * was found at all — every test this project has for either mechanism passes.
 * One test call produced this:
 *
 *     17:05:24  Начался разговор в канале «Звонок»
 *     17:05:54  Разговор в канале «Звонок» закончился
 *     17:05:55  Начался разговор в канале «Звонок»
 *     17:06:06  Разговор в канале «Звонок» закончился
 *     17:06:06  Отменённый звонок
 *
 * Their words: «что за канал звонок в личных сообщениях между людьми для меня не
 * ясно». Quite right — there is no channel. «Звонок» is the name
 * `voice_private_room` gives the row it creates, and it was never meant to be
 * read by anybody.
 *
 * ── Whose defect this is ───────────────────────────────────────────────────
 *
 * Mine, and it is the ordinary shape of one: `write_voice_call_service_message`
 * fires on `voice_channels.participant_count` crossing zero, for **any** row in
 * that table. When it was written (`20260918200000`) that was exactly right,
 * because only a group could have such a row. Slice A then put a row in every
 * private chat that anybody calls in, and the trigger went on doing precisely
 * what it had always done.
 *
 * Nothing was going to catch it. The group-call tests seed a group; the call
 * tests stub the transport and never move `participant_count` through a real
 * webhook; and the two mechanisms are in different files written days apart. A
 * feature that changes what an old trigger's rows *mean* is not a change the old
 * trigger's tests can see.
 *
 * ── The fix, and the one it is not ─────────────────────────────────────────
 *
 * The trigger returns early for a private chat. It is **not** given a cleverer
 * sentence for that case, because the private case already has one: slice B's
 * record, written by `voice_call_stop` with the outcome, the direction and the
 * length. Two mechanisms describing one call is how the owner ended up reading
 * five lines about a call they cancelled.
 *
 * The join costs one lookup per zero-crossing — a few times per call at most,
 * on a primary key — and it is a join rather than a column on `voice_channels`
 * because the chat's type is the chat's fact, and a copy of it here would be one
 * more thing to keep true.
 *
 * ── And the four rows already written ──────────────────────────────────────
 *
 * Deleted, narrowly. This is a repair of rows the **system** wrote in error, not
 * a deletion of anything a person said, and the predicate is written so that it
 * can only reach those: a `system` row, with no `system_payload` (so slice B's
 * own records are untouched), in a chat of type `private`, whose text is one of
 * the two sentences this trigger produces. The count is asserted before and
 * after: exactly four rows exist that match, and if that number has moved by the
 * time this runs, the migration raises instead of guessing.
 */

begin;

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

-- ── The rows it already wrote ───────────────────────────────────────────────

do $$
declare
  v_before integer;
  v_after integer;
  v_deleted integer;
begin
  select count(*) into v_before
    from public.messages m join public.chats c on c.id = m.chat_id
   where c.type = 'private' and m.type = 'system' and m.system_payload is null
     and (m.content like 'Начался разговор в канале%' or m.content like 'Разговор в канале%');

  if v_before > 50 then
    -- A guard, not a limit. Four rows were counted when this was written; a
    -- number an order of magnitude larger means the trigger has been firing for
    -- far longer than one afternoon, and that is a different migration written
    -- by somebody who has looked at it.
    raise exception 'expected a handful of stray rows, found % — look before deleting', v_before;
  end if;

  delete from public.messages m
   using public.chats c
   where c.id = m.chat_id
     and c.type = 'private' and m.type = 'system' and m.system_payload is null
     and (m.content like 'Начался разговор в канале%' or m.content like 'Разговор в канале%');
  get diagnostics v_deleted = row_count;

  select count(*) into v_after
    from public.messages m join public.chats c on c.id = m.chat_id
   where c.type = 'private' and m.type = 'system' and m.system_payload is null
     and (m.content like 'Начался разговор в канале%' or m.content like 'Разговор в канале%');

  if v_after <> 0 then
    raise exception 'still % stray rows after deleting %', v_after, v_deleted;
  end if;
  raise notice 'removed % stray channel announcements from private chats', v_deleted;
end;
$$;

-- ── The self-check ──────────────────────────────────────────────────────────

do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'write_voice_call_service_message';
  if v_src not like '%private%' then
    raise exception 'the trigger does not mention a private chat after replacement';
  end if;
  -- And it must still do what it was written for, or every group loses the line
  -- that says a call happened.
  if v_src not like '%voice_call_transition%' or v_src not like '%voice_call_service_line%' then
    raise exception 'the trigger lost the group-call announcement it exists for';
  end if;
  if v_src not like '%call_announced_at%' then
    raise exception 'the trigger lost its latch, so a group would be told once per join';
  end if;
end;
$$;

commit;
