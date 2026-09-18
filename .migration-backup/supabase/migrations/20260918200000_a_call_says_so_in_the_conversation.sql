/**
 * A voice room's conversation finally says that a call happened.
 *
 * Slice 3 of `docs/proposals/2026-09-13-voice-channels.md:1141-1150` asks for
 * the system message when a call starts and ends, and states its gate in one
 * sentence: **«The system message lands once per call, not once per join.»**
 * Everything below is that sentence made true.
 *
 * Today a call leaves no trace in the conversation at all. `participant_count`
 * and `active_since` tell the rail who is in a room *now*; nothing tells
 * somebody scrolling the group tomorrow that anybody ever talked, and nothing
 * tells somebody reading the chat list right now that a call is running unless
 * they look at the rail.
 *
 * ── The trap, and why «once per call» is not «once per room_started» ─────────
 *
 * Three measured facts about this deployment rule out every simpler design, and
 * each of them rules out a different one.
 *
 * **1. Asking for a token creates the room.** `docs/operations/voice.md:163-167`
 * records it: `voice_channels.active_since` is set for a minute after anybody
 * presses join, even if they never connect. So `room_started` fires for a press
 * that produced no call. A message written on `room_started` would announce
 * calls that never happened — and would announce one per press, which on a slow
 * network is several.
 *
 * **2. `room_finished` can be lost to a restart.**
 * `20260918160000_voice_rooms_many_and_the_stuck_flag.sql` cleaned up one row
 * whose `active_since` had been set with nobody in the room since 2026-09-13,
 * and `20260918170000_voice_recount_writes_only_when_something_changed.sql`
 * taught `private.voice_channel_recount` to clear a stale flag after a
 * two-minute grace window precisely because only a `room_finished` webhook ever
 * cleared it and nothing in the running system would send one. So «ended»
 * cannot depend on that webhook.
 *
 * **3. A webhook can be delivered more than once.** One thing in the current
 * path is already idempotent and it is worth being exact about what:
 * `public.voice_webhook_event_seen`, called by `receiveWebhook` before the RPC,
 * records `event.id` (or a SHA-256 of the body when LiveKit sends no id) and
 * answers `duplicate` on a redelivery. That de-duplicates a **delivery**. It
 * does not de-duplicate a **fact**: a room recreated a minute later sends a
 * second `room_started` with a second event id, and both are new deliveries of
 * the same «this room opened» claim.
 *
 * ── Where the fact lives ────────────────────────────────────────────────────
 *
 * **On the transition of `voice_channels.participant_count` through zero**, and
 * nowhere else. A call started when the room went from empty to occupied; it
 * ended when it went from occupied to empty. Not an event — a transition.
 *
 * That single choice answers all three facts at once:
 *
 * - Fact 1 dissolves: a press that connects nobody never moves the count off
 *   zero, so it writes nothing. Occupancy is the only thing that counts as a
 *   call, which is also what a person means by the word.
 * - Fact 2 dissolves: `private.voice_channel_recount` is the one funnel every
 *   occupancy path goes through — `voice_participant_joined` and
 *   `voice_participant_left` from the webhook, `voice_participants_replace`
 *   from the reconciler, `voice_participants_reap` from the residue sweep. So
 *   «ended» is driven by whichever layer notices first and needs no webhook at
 *   all. A `room_finished` lost to a restart costs the end line at most one
 *   reconciler period (`VOICE_RECONCILER_TICK_MS`, 30s) and at worst the
 *   reaper's window (`VOICE_RECONCILER_STALE_MS`, five minutes).
 * - Fact 3 dissolves: a redelivered `participant_joined` is an upsert
 *   (`on conflict … do update`), so the count does not change, so the recount
 *   writes nothing, so this trigger never fires. A redelivered `room_started`
 *   touches `active_since` only and never reaches `participant_count` at all.
 *   **The message is keyed on the transition, not on the event**, which is what
 *   makes it idempotent against a delivery the gateway's own table never saw.
 *
 * ── Two rows, appended, rather than one row edited ──────────────────────────
 *
 * The start and the end are two separate `type = 'system'` rows.
 *
 * One row rewritten when the call ends was considered and rejected on its
 * failure mode. A row that claims a call is *running* has to be corrected, and
 * if the correction never lands — a count stuck above zero, which is exactly
 * what layer 4 exists to repair and therefore exactly what can fail — the
 * conversation asserts for ever that a call is in progress. A week later that
 * is a lie sitting in the scrollback. Two appended rows cannot lie: each states
 * a past event at the point it happened. If the end row is lost, a reader sees
 * that a call started and the conversation carried on, which is true and
 * incomplete rather than false. And «is a call running right now» is answered
 * by the rail and the capsule, from `participant_count`, which is where that
 * question belongs.
 *
 * Appending also keeps `messages` append-only for this feature: no `edited_at`
 * on a row nobody edited, no Realtime UPDATE arriving for a message somebody
 * may be reading, and no interaction with the forward-only read marks.
 *
 * ── The latch, and what it is really for ────────────────────────────────────
 *
 * `voice_channels.call_announced_at` is one nullable timestamp meaning «the
 * conversation has been told a call began and has not been told it ended». It
 * is deliberately **not** a second `active_since`: `active_since` is what the
 * SFU says about a room, this is what the conversation has been told.
 *
 * Its load-bearing job is the first minute after this file is applied. A
 * channel may already hold `participant_count > 0` from a call in progress —
 * a call nobody announced. Without the latch the first drop to zero would write
 * «закончился» for a call the conversation never said had started. With it, the
 * end branch requires an announced call and writes nothing, and the next real
 * call announces itself normally. It is also the belt against a hand-written
 * repair like the one `20260918160000` had to make: a direct
 * `update … set participant_count = 0` on a channel with no announced call is
 * silent. Both halves were measured: removing the latch from the end arm turns
 * two cases of `tests/server/voice-call-service-message-db.test.mjs` red.
 *
 * **And one state is named rather than left to be discovered.** The latch is
 * released in the same statement that writes the end line, so no path through
 * the product can leave a call announced on an empty room. A hand-written
 * `update … set call_announced_at = now()` can. In that state the next arrival
 * writes no start line — the conversation already believes a call is running —
 * and the next departure writes one «закончился» with no beginning above it,
 * after which the latch is released and everything is normal again. One line,
 * once, reachable only by hand, and self-healing; the alternative was a start
 * arm that ignores the latch, which would make «the latch means a call is open»
 * untrue and would make its release unprovable. Pinned by a test either way.
 *
 * ── What this deliberately does not do ─────────────────────────────────────
 *
 * **It does not touch the webhook path.** `supabase/functions/voice-gateway/`
 * and its four RPCs are unchanged; the message falls out of writes they already
 * make. That is the point of putting the rule at the funnel.
 *
 * **It does not look up the chat.** D-166's writer does, because an AFTER
 * DELETE on `chat_members` can fire while a cascading chat delete is in
 * progress. Nothing of the sort is reachable here: `voice_channels.chat_id` is
 * `not null references public.chats(id) on delete cascade`, so a room cannot
 * outlive its chat and an UPDATE of `participant_count` implies the chat
 * exists. A guard was written, measured -- removing it turned no test red and
 * no path reaches it -- and taken back out. A foreign key is the guard.
 *
 * **`security definer` on the writer is a belt rather than today's gate, and it
 * is worth saying which.** Every path that reaches this trigger arrives inside
 * one of the four `SECURITY DEFINER` RPCs of `20260913150000`, owned by
 * `supabase_admin`, and `authenticated` holds no UPDATE on `participant_count`
 * at all -- so the insert would land today even as SECURITY INVOKER, and
 * dropping the keyword turns no test red. It stays because it makes the writer
 * independent of whoever calls it, which is the property that survives somebody
 * adding a fifth path, and the self-check pins it so it cannot be dropped by
 * accident.
 *
 * **It writes no policy and changes no grant that decides who reads anything.**
 * The audience of the new row is decided entirely by policies that already
 * exist on `public.messages`: the permissive `Chat members can view messages`
 * (`public.is_chat_member(chat_id)`) and the restrictive `block banned reads`
 * (`not public.is_banned(auth.uid())`). The row carries the channel's own
 * `chat_id`, so its readers are exactly the readers of
 * `members read voice channels` on `public.voice_channels` — the same people,
 * by the same predicate. Nothing is widened. The only grant below is a
 * `revoke`.
 *
 * **No client can write such a row, and that is structural rather than
 * conventional.** The only permissive INSERT policy on `messages` is
 * `auth.uid() = user_id and bot_id is null and is_chat_member(chat_id)`, and
 * `messages_sender_shape_check` *requires* `user_id is null` for
 * `type = 'system'`. The two cannot both hold. This is the same mechanism
 * `20260915140000_a_group_says_who_came_and_went.sql` relies on.
 *
 * **It pushes no notification.** `public.enqueue_message_notifications` returns
 * null on its first line for `user_id is null or type = 'system'`.
 *
 * **It does not record a duration.** The two rows carry their own `created_at`
 * and the conversation draws both times, so the length of the call is already
 * on screen. A duration in the text would need Russian plural agreement written
 * in SQL for the sake of something the reader can already see.
 *
 * **It does not restrict itself to `chats.type = 'group'`.** D-166's membership
 * lines do, because a private chat has no membership to narrate. A voice room
 * exists only where one was created, and wherever that is, the call is news.
 *
 * ── The copy, and a room that outlives its name ─────────────────────────────
 *
 *     Начался разговор в канале «Общая»
 *     Разговор в канале «Общая» закончился
 *
 * The room's name is **snapshotted into the text** rather than read live, and
 * that is a decision rather than an omission. A message is permanent and a room
 * is not: it can be renamed, moved between headings, archived or deleted. A
 * line that joined to `voice_channels` would rewrite last week's history when an
 * administrator renames a room, and would say nothing at all once the room was
 * gone. Snapshotting keeps each line true about the moment it records, which is
 * what `public.chat_member_service_name` already does for a person's name.
 * There is deliberately no foreign key to the channel: the line survives the
 * room.
 *
 * «в канале «Имя»» rather than «в «Имя»» because Russian wants the prepositional
 * case after «в», and a quoted proper name can only stay nominative when a
 * generic noun carries the case for it — the same reason D-166's lines introduce
 * a name with a colon. «разговор» and «канал» are the product's own two words
 * (`VoiceCallBar`: «Вернуться к разговору», «Выйти из разговора»; `ChannelRail`:
 * «Каналы», «Отключить от голосового канала?»). No status code, no room id, no
 * webhook, and nothing a person would have to be told how to read.
 *
 * ── Applying ────────────────────────────────────────────────────────────────
 *
 * Take and verify a schema backup first. One transaction, both DDL statements
 * guarded on the state they establish so a second application takes no lock
 * beyond the read, and a self-check that raises rather than committing a
 * half-applied state.
 *
 * **Run it as `supabase_admin`.** `alter table … add column` and
 * `create trigger` on `public.voice_channels` both need ownership, and that
 * table is owned by `supabase_admin` — not by `postgres`, which owns
 * `messages`, `topics`, `chats` and most of `public`. Two migrations learned
 * this the hard way within hours of each other:
 * `20260918160000`'s header records the measured failure «must be owner of
 * table voice_channels» as `postgres`, `20260918170000`'s records «must be
 * owner of function voice_channel_recount», and `20260918180000`'s records the
 * ownership read itself (`public.voice_channels | supabase_admin`) together
 * with the asymmetry that makes guessing expensive:
 * `pg_has_role('postgres', 'supabase_admin', 'MEMBER')` is false, while
 * `supabase_admin` is superuser and a member of `postgres`.
 *
 * So the role is not asserted in a comment here — **it is enforced by the first
 * statement**, which asks whether the running role is a member of the table's
 * owner and raises with the owner's name if it is not. A comment is what the
 * last three migrations had.
 *
 * **The functions end up owned by whoever owns `public.messages`, derived
 * rather than named.** `write_voice_call_service_message` is SECURITY DEFINER,
 * and its whole ability to write past the INSERT policy is that its owner owns
 * `messages` and is therefore exempt from that table's row level security.
 * Created by `supabase_admin` it would run as a superuser, which is a far
 * larger right than the job needs; `20260914140000_channel_categories.sql` set
 * the precedent by ending with `alter table … owner to postgres` for exactly
 * this reason. The block below reads the owner off `pg_class` for
 * `public.messages` and hands the functions to it, so the two can never drift
 * apart, and the self-check asserts they have not.
 *
 * **Locks.** `alter table … add column` of a nullable `timestamptz` with no
 * default takes ACCESS EXCLUSIVE but is catalog-only: since PostgreSQL 11 a
 * column with no default, and certainly one with none, adds a `pg_attribute`
 * row and nothing more. The claim is proved rather than asserted — the block
 * compares `pg_relation_filenode` across the statement and raises if it moved.
 * `create trigger` takes SHARE ROW EXCLUSIVE, which conflicts with concurrent
 * writes to the table but not with reads, so the rail keeps reading throughout.
 * `lock_timeout = '5s'` means a blocked acquisition rolls the whole transaction
 * back instead of queueing the product behind it.
 *
 * **A BEFORE trigger, not AFTER, and that is not a style choice.** The latch
 * lives on the row the trigger is already modifying, so BEFORE folds it into
 * the same write: one UPDATE, one Realtime broadcast, and no need to explain
 * why a second write of the same row does not fire the trigger again. `before
 * update of participant_count` is also why no recursion is possible even if
 * somebody later reaches for a second statement: the latch is not
 * `participant_count`. There is no other trigger on `public.voice_channels`, so
 * nothing else can change `new.participant_count` after this one has read it.
 *
 * Rollback: `20260918200000_a_call_says_so_in_the_conversation.rollback.sql`,
 * as `supabase_admin` too.
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
      'adding call_announced_at rewrote the table (filenode % -> %); this migration is documented as catalog-only and that claim is now false',
      v_filenode_before, v_filenode_after;
  end if;
  raise notice 'public.voice_channels.call_announced_at added without a rewrite';
end
$column$;

comment on column public.voice_channels.call_announced_at is
  'The conversation has been told a call began and has not been told it ended. '
  'Not a second active_since: that is what the SFU says about the room, this is '
  'what the group has been told. Null at rest, and null is what keeps a call '
  'already in progress when this was deployed from producing an end line for a '
  'start nobody wrote.';

-- The SFU owns the occupancy columns and the conversation owns this one; a
-- client owns none of the three. `authenticated` holds UPDATE per column on
-- `voice_channels` and never table-wide, so a new column arrives ungranted --
-- this is the belt, on the pattern 20260913150000 established after a
-- table-wide grant made a column revoke useless.
revoke update (call_announced_at) on public.voice_channels from authenticated;

-- ── the rule, as a function of nothing but its arguments ────────────────────

/**
 * Which line, if any, a change in occupancy calls for.
 *
 * Pure, immutable, and separated from the trigger on purpose. The whole gate of
 * slice 3 is one sentence about this function, and a rule that can only be
 * reached by driving a webhook through an SFU is a rule no test can pin. This
 * is `artifacts/kub/src/lib/supabase/config.ts` again: a check that cannot be
 * reached from a test is a gap in the module boundary rather than in the suite.
 *
 * `coalesce`, `nullif` and `case` are SQL grammar rather than functions in a
 * schema, so they take no `pg_catalog.` prefix -- qualifying them is a syntax
 * error, and an empty search_path cannot reach them anyway.
 */
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

/**
 * What the conversation says, in the product's own two words.
 *
 * Separate from the rule above so the sentences can be pinned exactly. D-166's
 * first attempt at a service line was ungrammatical and a loose regex would
 * have passed it, so both the wording and the room's name are asserted
 * character for character in the self-check and in
 * `tests/server/voice-call-service-message-db.test.mjs`.
 *
 * The blank-name arms are unreachable through the trigger --
 * `voice_channels_name_length_check` guarantees 1 to 64 non-blank characters --
 * and exist because a function that can be called with anything must not
 * produce «в канале «»».
 */
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

-- ── the writer ──────────────────────────────────────────────────────────────

create or replace function public.write_voice_call_service_message()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_transition text;
  v_line text;
begin
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
  'message. A trigger rather than a door: nobody may call it, and no client can '
  'write a type = system row at all.';

revoke all on function public.voice_call_transition(integer, integer, boolean)
  from public, anon, authenticated;
revoke all on function public.voice_call_service_line(text, text)
  from public, anon, authenticated;
revoke all on function public.write_voice_call_service_message()
  from public, anon, authenticated;

/**
 * The functions are handed to whoever owns `public.messages`, read off the
 * catalogue rather than named.
 *
 * This file runs as `supabase_admin`, so without this block the writer would be
 * SECURITY DEFINER as a superuser -- far more right than inserting one row
 * needs. The owner of `messages` is exempt from that table's row level security
 * and is therefore exactly enough, and deriving it means the definer and the
 * table it writes to cannot drift apart. `20260914140000_channel_categories.sql`
 * ended the same way and for the same reason.
 */
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

/**
 * `before update of participant_count`, with a WHEN clause that admits only a
 * crossing of zero.
 *
 * Two layers on purpose. The WHEN clause is the coarse filter and costs nothing:
 * `update of participant_count` already excludes `voice_channel_set_active`,
 * which writes `active_since` alone, and the clause excludes the recount's
 * quiet passes and its stale-flag clear, which leave the count where it was.
 * The rule itself -- the latch, and which of the two lines -- lives in
 * `voice_call_transition`, so a WHEN clause widened by mistake still writes
 * nothing. That is measured rather than hoped for: deleting the whole WHEN
 * clause, and separately widening `update of participant_count` to `update`,
 * each turn no test in
 * `tests/server/voice-call-service-message-db.test.mjs` red. Both are
 * therefore pre-filters and neither is a correctness gate, which is why the
 * rule is where it is.
 */
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
  v_secdef boolean;
  v_pinned boolean;
  v_forced boolean;
  v_triggers integer;
  v_written integer;
  v_chat uuid;
  v_channel uuid;
  v_latch timestamptz;
begin
  -- 1. Structure: the column, the trigger and the writer's rights.

  if not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.voice_channels'::regclass
       and attname = 'call_announced_at' and not attisdropped
  ) then
    raise exception 'call_announced_at is missing, so nothing latches a call as announced';
  end if;

  if pg_catalog.has_column_privilege('authenticated', 'public.voice_channels', 'call_announced_at', 'update') then
    raise exception 'authenticated can write call_announced_at, so a member can make the group announce a call';
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
         )
    into v_secdef, v_pinned
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'write_voice_call_service_message';
  if not coalesce(v_secdef, false) then
    raise exception 'the writer is not security definer, so it cannot write past the INSERT policy on messages';
  end if;
  if not coalesce(v_pinned, false) then
    raise exception 'the writer does not pin an empty search_path';
  end if;

  if pg_catalog.has_function_privilege('authenticated', 'public.write_voice_call_service_message()', 'execute')
     or pg_catalog.has_function_privilege('anon', 'public.write_voice_call_service_message()', 'execute') then
    raise exception 'the writer is reachable as a function, and it is a trigger rather than a door';
  end if;

  -- The definer's right is ownership of `messages`, so the two must be the same
  -- role. Asked of the catalogue rather than of this file's own `alter`.
  select pg_catalog.pg_get_userbyid(relowner) into v_messages_owner
    from pg_catalog.pg_class where oid = 'public.messages'::regclass;
  select pg_catalog.pg_get_userbyid(proowner) into v_writer_owner
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'write_voice_call_service_message';
  if v_writer_owner is distinct from v_messages_owner then
    raise exception
      'the writer is owned by % while public.messages is owned by %, so its insert will be refused by the INSERT policy',
      v_writer_owner, v_messages_owner;
  end if;

  -- Owner exemption from RLS is what the line above relies on, and FORCE ROW
  -- LEVEL SECURITY would remove it silently.
  select relforcerowsecurity into v_forced
    from pg_catalog.pg_class where oid = 'public.messages'::regclass;
  if coalesce(v_forced, false) then
    raise exception 'public.messages forces row level security, so owning it no longer lets the writer insert';
  end if;

  -- Publishing nothing and widening nobody: the row's audience is the chat's.
  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'messages'
       and permissive = 'PERMISSIVE' and cmd in ('SELECT', 'ALL')
  ) then
    raise exception 'no permissive read policy is left on public.messages';
  end if;

  -- 2. The rule, executed rather than read. Six calls, and the middle two are
  --    the gate of slice 3: a second and a third joiner write nothing.

  if public.voice_call_transition(0, 1, false) is distinct from 'start' then
    raise exception 'an empty room filling no longer starts a call';
  end if;
  if public.voice_call_transition(1, 2, true) is not null then
    raise exception 'a second joiner writes a line, so the message lands once per join rather than once per call';
  end if;
  if public.voice_call_transition(9, 10, true) is not null then
    raise exception 'a tenth joiner writes a line, so the message lands once per join rather than once per call';
  end if;
  if public.voice_call_transition(2, 1, true) is not null then
    raise exception 'somebody leaving a call that is still running ends it';
  end if;
  if public.voice_call_transition(1, 0, true) is distinct from 'end' then
    raise exception 'the last person leaving no longer ends the call';
  end if;
  if public.voice_call_transition(1, 0, false) is not null then
    raise exception
      'a room emptying with no announced call writes an end line, so a call already running when this was applied will announce an ending nobody saw begin';
  end if;
  if public.voice_call_transition(0, 1, true) is not null then
    raise exception 'a room filling while a call is already announced writes a second start line';
  end if;

  -- 3. The sentences, character for character.

  if public.voice_call_service_line('start', 'Общая') is distinct from 'Начался разговор в канале «Общая»' then
    raise exception 'the start line is not the approved sentence: %',
      coalesce(public.voice_call_service_line('start', 'Общая'), 'null');
  end if;
  if public.voice_call_service_line('end', 'Общая') is distinct from 'Разговор в канале «Общая» закончился' then
    raise exception 'the end line is not the approved sentence: %',
      coalesce(public.voice_call_service_line('end', 'Общая'), 'null');
  end if;
  if public.voice_call_service_line('start', '  ') is distinct from 'Начался разговор в голосовом канале' then
    raise exception 'a blank room name no longer falls back to a sentence without one';
  end if;
  if public.voice_call_service_line(null, 'Общая') is not null then
    raise exception 'a transition of nothing still produces a sentence';
  end if;

  -- 4. Behavioural, end to end, and rolled back so that nothing is committed.
  --
  --    A synthetic group and a synthetic room are created, driven through a
  --    whole call, asserted, and abandoned by raising a sentinel inside a
  --    plpgsql block -- which is a subtransaction, so the abort discards the
  --    chat, the room, the messages and anything any other trigger wrote. A
  --    structural check on `tgqual` would pass for a trigger whose function had
  --    been simplified into writing one line per arrival, which is exactly the
  --    regression slice 3's gate names.
  --
  --    The lines are counted and matched rather than ordered. Inside one
  --    transaction `now()` is the transaction's start for every row, so both
  --    rows share a `created_at` and there is no order to read; in the product
  --    the two are minutes apart in separate transactions. What is asserted
  --    here is therefore which sentences exist and how many, at each step.

  begin
    insert into public.chats (type, name, created_by)
      values ('group', 'Проверка системного сообщения', null)
      returning id into v_chat;
    insert into public.voice_channels (chat_id, name, created_by)
      values (v_chat, 'Проверка', null)
      returning id into v_channel;

    -- Somebody arrives in an empty room.
    update public.voice_channels set participant_count = 1 where id = v_channel;
    select pg_catalog.count(*) into v_written from public.messages where chat_id = v_chat;
    if v_written <> 1 then
      raise exception 'an empty room filling wrote % lines rather than one', v_written;
    end if;
    if not exists (
      select 1 from public.messages
       where chat_id = v_chat and content = 'Начался разговор в канале «Проверка»'
    ) then
      raise exception 'the line an empty room filling wrote is not the start sentence: %',
        coalesce((select content from public.messages where chat_id = v_chat limit 1), 'nothing');
    end if;
    select call_announced_at into v_latch from public.voice_channels where id = v_channel;
    if v_latch is null then
      raise exception 'the start line was written without latching the call as announced';
    end if;

    -- Two more arrive and one of them leaves again. None of this is news, and
    -- this is the gate of slice 3.
    update public.voice_channels set participant_count = 2 where id = v_channel;
    update public.voice_channels set participant_count = 3 where id = v_channel;
    update public.voice_channels set participant_count = 2 where id = v_channel;
    select pg_catalog.count(*) into v_written from public.messages where chat_id = v_chat;
    if v_written <> 1 then
      raise exception
        'a call with three arrivals and one departure wrote % lines; the gate of slice 3 is that it writes one',
        v_written;
    end if;

    -- The last of them leaves. No `room_finished` has been involved at any
    -- point: this is the transition the reconciler and the reaper also drive.
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
    select call_announced_at into v_latch from public.voice_channels where id = v_channel;
    if v_latch is not null then
      raise exception 'the end line was written without releasing the latch, so the next call cannot announce itself';
    end if;

    -- Both rows carry no sender, which is what `messages_sender_shape_check`
    -- requires of the shape the client draws as a service line rather than as a
    -- bubble.
    if exists (
      select 1 from public.messages
       where chat_id = v_chat
         and (type is distinct from 'system' or user_id is not null or bot_id is not null)
    ) then
      raise exception 'a service line was written with a sender, which the client will draw as a bubble';
    end if;

    -- And a second call is a second pair, not a second start on the first.
    update public.voice_channels set participant_count = 1 where id = v_channel;
    select pg_catalog.count(*) into v_written from public.messages where chat_id = v_chat;
    if v_written <> 3 then
      raise exception 'a second call brought the total to % lines rather than 3', v_written;
    end if;

    raise exception 'voice_call_service_message_probe' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'voice_call_service_message_probe' then
        raise;
      end if;
      raise notice 'the end-to-end probe passed and was rolled back';
  end;

  raise notice 'a call now says so in the conversation, once when it starts and once when it ends';
end
$check$;

commit;
