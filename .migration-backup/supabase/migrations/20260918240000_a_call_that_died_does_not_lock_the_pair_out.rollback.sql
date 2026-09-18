/**
 * Rollback for `20260918240000_a_call_that_died_does_not_lock_the_pair_out.sql`.
 *
 * Run as `supabase_admin`, which owns both functions.
 *
 * It puts back the two bodies as they stood after
 * `20260918220000_a_private_chat_can_ring.sql` — `private.voice_channel_recount`
 * without the ring clauses (read off `pg_get_functiondef` before it was
 * replaced, not reconstructed from a migration file), and `public.voice_call_ring`
 * without the thirty-second staleness rule.
 *
 * **What it restores is a defect, and that is what a rollback is for.** With
 * these bodies back, a call whose clients all die leaves `ring_answered_at` set
 * for ever, and every later call between those two people is refused
 * `already_ringing` with nothing in any interface able to clear it. Do not run
 * this file unless you are also rolling back `20260918220000`, which removes the
 * ring columns and makes the question moot.
 *
 * If you must run it alone — because the recount is misbehaving and the ring
 * clauses are suspected — the manual repair for a locked pair is at the bottom.
 */

begin;

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
     );
end;
$function$;

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
begin
  v_room := public.voice_private_room(p_chat_id);

  select public.voice_ring_state(vc.ring_started_at, vc.ring_answered_at, v_now),
         vc.participant_count
    into v_state, v_count
    from public.voice_channels as vc
   where vc.id = v_room
     for update;

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
  'Start ringing the other participant of a private chat. Refuses a live ring and an occupied room.';

do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'voice_channel_recount';
  if v_src like '%ring_answered_at%' then
    raise exception 'the recount still mentions the ring after the rollback';
  end if;
  if v_src not like '%active_since%' then
    raise exception 'the rollback dropped the recount''s active_since repair';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'voice_call_ring';
  if v_src like '%30 seconds%' then
    raise exception 'voice_call_ring still carries the staleness rule';
  end if;
end;
$$;

commit;

-- The manual repair, for a pair locked out while these bodies are in place.
-- It clears a ring that was answered on a room nobody is in, which is the only
-- state that locks. Read the row first; this is a write.
--
--   update public.voice_channels
--      set ring_started_at = null, ring_caller = null, ring_answered_at = null,
--          updated_at = now()
--    where chat_id = '<the private chat>'
--      and participant_count = 0
--      and ring_answered_at is not null;
