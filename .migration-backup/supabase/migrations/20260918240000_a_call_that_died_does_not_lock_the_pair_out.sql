/**
 * A call that died does not lock the pair out of calling again.
 *
 * `20260918220000_a_private_chat_can_ring.sql` made `voice_call_ring` refuse a
 * room whose ring state is `ringing` **or** `answered`, and said nothing about
 * who clears an `answered` one. Nothing does. So:
 *
 *   A calls, B answers, they talk, and every client involved dies — a crash, a
 *   killed process, a laptop lid, a tab closed by the browser under memory
 *   pressure. `ring_answered_at` stays set. From then on **every** call between
 *   those two people is refused `already_ringing`, for ever, and nothing in any
 *   interface can clear it.
 *
 * Found while reviewing the client half rather than by running it, which is the
 * only reason it is being fixed the same day instead of being reported months
 * later as «I cannot call this person and I do not know why».
 *
 * The ordinary path was already covered and still is: the bar's «Выйти» sends
 * `voice_call_stop(id, 'answered')` before leaving. This file is about what
 * happens when nobody sends anything.
 *
 * ── Two repairs, two different clocks, and why they are not one ─────────────
 *
 * **1. `private.voice_channel_recount` clears the residue.** That function is
 * the one funnel every occupancy path already goes through — the webhook's join
 * and leave, the reconciler's replace, the residue sweep's reap — which is the
 * half of the group-call design that transfers (see
 * `20260918200000_a_call_says_so_in_the_conversation.sql`). It already clears a
 * stale `active_since` on an empty room after a **two-minute** grace, and for
 * exactly the reason a ring needs one: `room_started` fires before the first
 * participant row exists, so clearing on emptiness alone races every join. The
 * ring rides the same grace, in the same statement, and needs no new process.
 *
 * **2. `voice_call_ring` itself treats an empty answered room as over after
 * thirty seconds.** Because two minutes of «you cannot call this person» after
 * a crash is still a product defect, just a shorter one. Thirty seconds is far
 * longer than the round trip between `voice_call_answer` and the webhook that
 * makes `participant_count` non-zero, and far shorter than the recount's grace,
 * so the two never disagree about the same row.
 *
 * ── What is deliberately left alone ────────────────────────────────────────
 *
 * **An expired `ringing` ring is not cleared here.** It would be easy and it is
 * wrong: that row is the only evidence that a call was made and nobody answered,
 * and slice C exists to turn it into a «missed» record in the conversation.
 * Clearing it as residue would destroy the evidence before the feature that
 * reads it is built. It locks nothing either way — `voice_call_ring` already
 * accepts `expired`, which was verified on production before this was written.
 *
 * The consequence is stated rather than hidden: until slice C, a caller who
 * closes their laptop mid-ring leaves a row that says «ringing» to anybody
 * reading the column directly. It expires by arithmetic, every reader agrees it
 * is over, and nothing is blocked. It is residue, not a lock.
 */

begin;

-- ── 1. The residue, cleared by the funnel every occupancy path goes through ──

create or replace function private.voice_channel_recount(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_count integer;
begin
  if p_channel_id is null then
    return;
  end if;

  select pg_catalog.count(*)::integer
    into v_count
    from public.voice_participants
   where channel_id = p_channel_id;

  update public.voice_channels as channel
     set participant_count = v_count,
         -- Cleared only for a room that has been empty long enough that it
         -- cannot be one that has just opened. `room_started` fires before the
         -- first participant row exists, and clearing on emptiness alone would
         -- race every join.
         active_since = case
           when v_count = 0
            and channel.active_since is not null
            and channel.active_since < pg_catalog.now() - interval '2 minutes'
           then null
           else channel.active_since
         end,
         -- The same grace, for the ring, and only for a call that was
         -- **answered**: an empty room whose ring was answered is a call that is
         -- over, and the only question left is whether anybody said so. A ring
         -- still ringing is not touched — it is slice C's evidence that nobody
         -- picked up, and clearing it here would destroy that before the thing
         -- that reads it exists.
         ring_started_at = case
           when v_count = 0
            and channel.ring_answered_at is not null
            and channel.ring_answered_at < pg_catalog.now() - interval '2 minutes'
           then null
           else channel.ring_started_at
         end,
         ring_caller = case
           when v_count = 0
            and channel.ring_answered_at is not null
            and channel.ring_answered_at < pg_catalog.now() - interval '2 minutes'
           then null
           else channel.ring_caller
         end,
         ring_answered_at = case
           when v_count = 0
            and channel.ring_answered_at is not null
            and channel.ring_answered_at < pg_catalog.now() - interval '2 minutes'
           then null
           else channel.ring_answered_at
         end,
         updated_at = pg_catalog.now()
   where channel.id = p_channel_id
     -- The whole of the loop's fix. An unchanged row is not written, so it does
     -- not move `updated_at` and does not broadcast to every subscribed member.
     and (
       channel.participant_count is distinct from v_count
       or (
         v_count = 0
         and channel.active_since is not null
         and channel.active_since < pg_catalog.now() - interval '2 minutes'
       )
       or (
         v_count = 0
         and channel.ring_answered_at is not null
         and channel.ring_answered_at < pg_catalog.now() - interval '2 minutes'
       )
     );
end;
$function$;

-- ── 2. And the caller does not wait two minutes for it ──────────────────────

create or replace function public.voice_call_ring(p_chat_id uuid)
returns table (channel_id uuid, ring_started_at timestamptz)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $$
declare
  v_me uuid := auth.uid();
  v_room uuid;
  v_now timestamptz := pg_catalog.now();
  v_state text;
  v_count integer;
  v_answered timestamptz;
begin
  v_room := public.voice_private_room(p_chat_id);

  select public.voice_ring_state(vc.ring_started_at, vc.ring_answered_at, v_now),
         vc.participant_count,
         vc.ring_answered_at
    into v_state, v_count, v_answered
    from public.voice_channels as vc
   where vc.id = v_room
     for update;

  -- A call that was answered, whose room is empty, and whose answer is older
  -- than any join round trip, is a call that ended without anybody saying so.
  -- Thirty seconds rather than the recount's two minutes because this is the
  -- path a person is standing in front of: the row will be tidied either way,
  -- and they should not have to wait for it.
  if v_state = 'answered'
     and v_count = 0
     and v_answered < v_now - interval '30 seconds' then
    v_state := 'idle';
  end if;

  if v_state in ('ringing', 'answered') then
    raise exception 'already_ringing' using errcode = '55006';
  end if;
  if v_count > 0 then
    raise exception 'already_in_call' using errcode = '55006';
  end if;

  update public.voice_channels as vc
     set ring_started_at = v_now,
         ring_caller = v_me,
         ring_answered_at = null,
         updated_at = v_now
   where vc.id = v_room;

  return query select v_room, v_now;
end;
$$;

comment on function public.voice_call_ring(uuid) is
  'Start ringing the other participant of a private chat. Refuses a live ring and an occupied room; treats an answered ring on an empty room as over after 30 seconds.';

-- ── The self-check, on values rather than on the fact that it ran ───────────

do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'voice_channel_recount';
  if v_src is null or v_src not like '%ring_answered_at%' then
    raise exception 'the recount does not mention the ring after replacement';
  end if;
  -- And it must still do its original job, or a stale `active_since` would
  -- outlive every call: the group-call announcement reads it.
  if v_src not like '%active_since%' then
    raise exception 'the recount lost its active_since repair';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'voice_call_ring';
  if v_src is null or v_src not like '%30 seconds%' then
    raise exception 'voice_call_ring did not take the staleness rule';
  end if;
end;
$$;

commit;
