begin;
/**
 * A one-to-one call leaves a line in the conversation it happened in.
 *
 * Slice B of `docs/proposals/2026-09-18-one-to-one-calls.md`, asked for by the
 * owner in the same breath as the feature itself: «уведомления о звонках в чате
 * по аналогии с telegram/discord (с отображением того успешный ли это звонок
 * или пропущенный, сколько он длился…)».
 *
 * Run as `supabase_admin`. Two roles are involved and only one of them can do
 * both halves: `public.messages` is owned by **`postgres`** while
 * `public.voice_call_stop` is owned by **`supabase_admin`**, and this
 * deployment's `postgres` is not a superuser (`rolsuper = f`), so it could not
 * replace that function. `supabase_admin` is, so it can alter a table it does
 * not own. Ownership here does not follow the schema and was read off
 * `pg_tables` and `pg_roles` rather than inferred.
 *
 * ── The grant dance the ring needed, and why this does not need it ──────────
 *
 * On `voice_channels` a new column arrived writable because INSERT was held at
 * the table level, and closing that took a migration of its own. `messages`
 * holds INSERT, SELECT, UPDATE and DELETE at the table level too, for both
 * `anon` and `authenticated`, so `system_payload` below is likewise covered by
 * those grants — **and it does not matter here**, which was measured rather than
 * hoped:
 *
 *   «Chat members can send messages»  INSERT with check  uid() = user_id
 *   «Users can edit own messages»     UPDATE using       user_id = uid()
 *
 * A system row carries `user_id IS NULL` — `messages_sender_shape_check`
 * requires it — and `uid()` is never null on an authenticated request. So a
 * client can neither insert a system row nor update one, whatever the column
 * grants say. The payload is unreachable because the row is.
 *
 * Written down because the next person to add a column here will otherwise
 * repeat the ring's dance on a table that does not need it, and narrowing a
 * twenty-column table-level grant on `messages` is a far riskier change than
 * the one it would be protecting against.
 *
 * ── Why a payload and not a sentence ───────────────────────────────────────
 *
 * «You called / they called» needs the caller's identity, and the same row is
 * read by both of them. A sentence written at insert time would have to pick a
 * side; a payload lets each reader word it from their own. The proposal reached
 * the same conclusion by a different route — `user_id` is forbidden on a system
 * row, and making the row non-system would start it pushing and would make
 * `resolveMessageActor` answer `invalid`.
 *
 * `content` is still written, and it is not decoration: **an application that
 * has not been reloaded since this morning renders `content` verbatim** and
 * knows nothing of the payload. So the fallback is a complete, correct sentence
 * on its own, merely a neutral one — «Звонок, 3 мин 12 с» rather than «Исходящий
 * звонок».
 *
 * ── The outcome is derived, not reported ───────────────────────────────────
 *
 * `voice_call_stop` takes a reason from the client and, until now, only checked
 * that it was one of four words. It still does — no call site changes — but the
 * **record** is written from the row and the caller's identity instead:
 *
 *   answered      the ring was answered; duration is now − ring_answered_at
 *   missed        the ring ran out of time before anybody stopped it
 *   cancelled     stopped by the person who was calling
 *   declined      stopped by the person being called
 *
 * A client that sends the wrong word therefore cannot write a wrong record. It
 * is also strictly less to trust: the four cases above are decidable from state
 * the database already holds.
 *
 * **Once per call, not once per press.** The write sits above the early return
 * for an `idle` room, in the same transaction as the clear — so the second stop
 * finds the ring already gone and writes nothing. That is the latch pattern the
 * group-call migration established, using the ring row itself rather than a
 * column of its own.
 */


-- ── The payload ─────────────────────────────────────────────────────────────

alter table public.messages
  add column if not exists system_payload jsonb;

comment on column public.messages.system_payload is
  'Structured detail for a system row, read by the renderer. Null on every other row.';

alter table public.messages
  drop constraint if exists messages_system_payload_shape_check;
alter table public.messages
  add constraint messages_system_payload_shape_check check (
    system_payload is null or coalesce(type, 'text') = 'system'
  );

-- ── The fallback sentence, pure, for a client that predates the payload ─────

/**
 * What the row says on its own.
 *
 * Neutral by necessity rather than by taste: one row is read by both people, so
 * the fallback cannot say «you called». The renderer has the payload and says
 * that; this is what an application from before this migration shows, and what
 * a search result or a chat-list preview falls back to.
 *
 * `immutable`, inputs explicit, `search_path` empty — the same shape as
 * `voice_call_service_line`, and for the same reason: the wording is a decision,
 * and a decision that needs a call to observe is a decision with no test.
 */
create or replace function public.voice_call_record_line(
  p_outcome text,
  p_duration_ms integer
) returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_total integer := greatest(coalesce(p_duration_ms, 0), 0) / 1000;
  v_minutes integer := v_total / 60;
  v_seconds integer := v_total % 60;
begin
  if p_outcome = 'missed' then
    return 'Пропущенный звонок';
  end if;
  if p_outcome = 'declined' then
    return 'Звонок отклонён';
  end if;
  if p_outcome = 'cancelled' then
    return 'Отменённый звонок';
  end if;
  if p_outcome <> 'answered' then
    return null;
  end if;
  -- A call answered and hung up inside a second is still a call that happened,
  -- so it says so rather than «0 с»: the duration is the detail, the fact is
  -- the line.
  if v_total < 1 then
    return 'Звонок';
  end if;
  if v_minutes = 0 then
    return 'Звонок, ' || v_seconds::text || ' с';
  end if;
  return 'Звонок, ' || v_minutes::text || ' мин ' || v_seconds::text || ' с';
end
$function$;

comment on function public.voice_call_record_line(text, integer) is
  'The neutral sentence a call record carries in `content`, for readers without the payload.';

revoke all on function public.voice_call_record_line(text, integer) from public;
grant execute on function public.voice_call_record_line(text, integer) to authenticated;

-- ── Stopping a call now writes it down ──────────────────────────────────────

create or replace function public.voice_call_stop(p_channel_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $$
declare
  v_me uuid := auth.uid();
  v_chat uuid;
  v_state text;
  v_now timestamptz := pg_catalog.now();
  v_caller uuid;
  v_answered timestamptz;
  v_outcome text;
  v_duration integer;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_reason is null or p_reason not in ('cancelled', 'declined', 'answered', 'missed') then
    raise exception 'bad_reason' using errcode = '22023';
  end if;

  select vc.chat_id,
         public.voice_ring_state(vc.ring_started_at, vc.ring_answered_at, v_now),
         vc.ring_caller,
         vc.ring_answered_at
    into v_chat, v_state, v_caller, v_answered
    from public.voice_channels as vc
   where vc.id = p_channel_id
     for update;

  if v_chat is null then
    raise exception 'no_such_room' using errcode = 'P0002';
  end if;
  if not public.is_chat_member(v_chat) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  -- The latch. A ring already gone is a call already written down, so the
  -- second press of «Выйти» — or a retry after a lost response — adds nothing.
  if v_state = 'idle' then
    return v_state;
  end if;

  -- Derived, never reported. `p_reason` is validated above and then ignored,
  -- so a client that sends the wrong word cannot write the wrong record.
  if v_state = 'answered' then
    v_outcome := 'answered';
    v_duration := greatest(
      0,
      (pg_catalog.date_part('epoch', v_now - v_answered) * 1000)::integer
    );
  elsif v_state = 'expired' then
    v_outcome := 'missed';
    v_duration := null;
  elsif v_caller = v_me then
    v_outcome := 'cancelled';
    v_duration := null;
  else
    v_outcome := 'declined';
    v_duration := null;
  end if;

  insert into public.messages (chat_id, type, content, system_payload)
  values (
    v_chat,
    'system',
    public.voice_call_record_line(v_outcome, v_duration),
    pg_catalog.jsonb_build_object(
      'kind', 'call',
      'outcome', v_outcome,
      'caller', v_caller,
      'duration_ms', v_duration
    )
  );

  update public.voice_channels as vc
     set ring_started_at = null,
         ring_caller = null,
         ring_answered_at = null,
         updated_at = v_now
   where vc.id = p_channel_id;

  return v_state;
end;
$$;

comment on function public.voice_call_stop(uuid, text) is
  'Clear a ring, write the call down once, and say what state it was in. Idempotent: an idle room writes nothing.';

-- ── The self-check ──────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'messages'
       and column_name = 'system_payload' and data_type = 'jsonb'
  ) then
    raise exception 'system_payload is missing or is not jsonb';
  end if;

  -- The four sentences, and the boundary between them. A wording nobody asserts
  -- is a wording that drifts.
  if public.voice_call_record_line('missed', null) <> 'Пропущенный звонок'
     or public.voice_call_record_line('declined', null) <> 'Звонок отклонён'
     or public.voice_call_record_line('cancelled', null) <> 'Отменённый звонок'
     or public.voice_call_record_line('answered', 0) <> 'Звонок'
     or public.voice_call_record_line('answered', 999) <> 'Звонок'
     or public.voice_call_record_line('answered', 1000) <> 'Звонок, 1 с'
     or public.voice_call_record_line('answered', 59000) <> 'Звонок, 59 с'
     or public.voice_call_record_line('answered', 60000) <> 'Звонок, 1 мин 0 с'
     or public.voice_call_record_line('answered', 192000) <> 'Звонок, 3 мин 12 с'
     or public.voice_call_record_line('nonsense', 1) is not null then
    raise exception 'voice_call_record_line does not answer its own cases';
  end if;

  -- The constraint exists, asserted by name rather than by trying to violate
  -- it: a probe insert here would depend on there being a chat and a member to
  -- hang it on, and «no rows matched» would read as «the constraint let it
  -- through». The rehearsal drives it against rows it created itself.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.messages'::regclass
       and conname = 'messages_system_payload_shape_check'
  ) then
    raise exception 'the system payload shape constraint is missing';
  end if;
end;
$$;


\echo == the four outcomes, each written once, each derived from the row ==
alter table auth.users disable trigger on_auth_user_created;
alter table public.profiles disable trigger trg_registration_invite_apply_from_profile;
alter table public.profiles disable trigger trg_bootstrap_first_admin;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
select u.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',u.id||'@b.invalid','',now(),now(),'{}'::jsonb,'{}'::jsonb
  from (values ('aaaaaaaa-0000-4000-8000-00000000000a'::uuid),('bbbbbbbb-0000-4000-8000-00000000000b'::uuid)) as u(id);
insert into public.profiles (id, full_name) values ('aaaaaaaa-0000-4000-8000-00000000000a','Б А'),('bbbbbbbb-0000-4000-8000-00000000000b','Б Б');
insert into public.chats (id,type,name,created_by) values ('cccccccc-0000-4000-8000-00000000000c','private',null,'aaaaaaaa-0000-4000-8000-00000000000a');
insert into public.chat_members (chat_id,user_id,role) values
 ('cccccccc-0000-4000-8000-00000000000c','aaaaaaaa-0000-4000-8000-00000000000a','owner'),
 ('cccccccc-0000-4000-8000-00000000000c','bbbbbbbb-0000-4000-8000-00000000000b','member')
on conflict (chat_id,user_id) do update set role = excluded.role;

create or replace function pg_temp.ring_as(p_who uuid) returns uuid language plpgsql as $f$
declare r uuid; begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_who, 'role','authenticated')::text, true);
  select channel_id into r from public.voice_call_ring('cccccccc-0000-4000-8000-00000000000c');
  return r;
end $f$;
create or replace function pg_temp.stop_as(p_who uuid, p_room uuid, p_reason text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_who, 'role','authenticated')::text, true);
  return public.voice_call_stop(p_room, p_reason);
end $f$;

\echo -- 1. the callee declines --
select pg_temp.stop_as('bbbbbbbb-0000-4000-8000-00000000000b', pg_temp.ring_as('aaaaaaaa-0000-4000-8000-00000000000a'), 'declined') as state;
\echo -- 2. the caller cancels --
select pg_temp.stop_as('aaaaaaaa-0000-4000-8000-00000000000a', pg_temp.ring_as('aaaaaaaa-0000-4000-8000-00000000000a'), 'cancelled') as state;
\echo -- 3. it ran out: expired, whoever presses --
select pg_temp.ring_as('aaaaaaaa-0000-4000-8000-00000000000a') as room \gset
update public.voice_channels set ring_started_at = now() - interval '46 seconds' where chat_id='cccccccc-0000-4000-8000-00000000000c';
select pg_temp.stop_as('aaaaaaaa-0000-4000-8000-00000000000a', :'room', 'missed') as state;
\echo -- 4. answered, with a duration, and the client lying about the reason --
select pg_temp.ring_as('aaaaaaaa-0000-4000-8000-00000000000a') as room2 \gset
update public.voice_channels set ring_answered_at = now() - interval '192 seconds' where chat_id='cccccccc-0000-4000-8000-00000000000c';
select pg_temp.stop_as('aaaaaaaa-0000-4000-8000-00000000000a', :'room2', 'declined') as state;

\echo == what the conversation now says ==
select content, system_payload->>'outcome' as outcome,
       (system_payload->>'caller') = 'aaaaaaaa-0000-4000-8000-00000000000a' as caller_is_a,
       system_payload->>'duration_ms' as duration_ms
  from public.messages where chat_id='cccccccc-0000-4000-8000-00000000000c' order by created_at;

\echo == and stopping twice writes only once ==
select pg_temp.ring_as('aaaaaaaa-0000-4000-8000-00000000000a') as room3 \gset
select pg_temp.stop_as('aaaaaaaa-0000-4000-8000-00000000000a', :'room3', 'cancelled') as first;
select pg_temp.stop_as('aaaaaaaa-0000-4000-8000-00000000000a', :'room3', 'cancelled') as second;
select count(*) as rows_for_that_call from public.messages
 where chat_id='cccccccc-0000-4000-8000-00000000000c' and content = 'Отменённый звонок';

\echo == a text message may not carry a payload ==
do $p$ begin
  insert into public.messages (chat_id, user_id, type, content, system_payload)
  values ('cccccccc-0000-4000-8000-00000000000c','aaaaaaaa-0000-4000-8000-00000000000a','text','нет','{"kind":"call"}'::jsonb);
  raise notice 'UNEXPECTED: a text message carried a system payload';
exception when check_violation then raise notice 'a text message may not carry a payload: refused'; end $p$;

\echo == and a client still cannot write a system row at all ==
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}';
do $p$ begin
  insert into public.messages (chat_id, type, content, system_payload)
  values ('cccccccc-0000-4000-8000-00000000000c','system','подделка','{"kind":"call","outcome":"answered"}'::jsonb);
  raise notice 'UNEXPECTED: a client forged a call record';
exception when others then raise notice 'a client cannot forge a call record: %', sqlerrm; end $p$;
reset role;
rollback;
