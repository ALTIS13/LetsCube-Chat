/**
 * Rollback for `20260918220000_a_private_chat_can_ring.sql`.
 *
 * Run as `supabase_admin`: `public.voice_channels` is owned by it, not by
 * `postgres`, and ownership in this deployment does not follow the schema —
 * `messages`, `chats` and `chat_channel_categories` are `postgres`'s while
 * `voice_channels`, `voice_participants` and everything in `private` are
 * `supabase_admin`'s. A migration's own sentence about its role is not evidence;
 * this was read off `pg_tables.tableowner`.
 *
 * ── What this undoes, and the one thing it cannot ───────────────────────────
 *
 * It drops the three ring columns, their constraint, the four functions and the
 * grants. Dropping the columns takes the data with them, which for a **live**
 * ring means the call in flight simply stops being a call: the two clients are
 * left with a room, no ring, and their own interfaces to reconcile. That is the
 * correct outcome — there is nothing to preserve about a ring that lasts 45
 * seconds — but it is worth saying rather than discovering.
 *
 * **Rooms created in private chats are deliberately left in place.** They are
 * ordinary `voice_channels` rows; deleting them would be a data deletion this
 * file has no mandate for, and with the RPC gone nothing creates more. If they
 * must go, the statement is at the bottom, commented out, so that removing a
 * person's call history is a decision somebody takes rather than a side effect
 * of a rollback.
 *
 * Idempotent: every drop is `if exists`, so running it twice is not an error.
 */

begin;

revoke execute on function public.voice_private_room(uuid) from authenticated;
revoke execute on function public.voice_call_ring(uuid) from authenticated;
revoke execute on function public.voice_call_answer(uuid) from authenticated;
revoke execute on function public.voice_call_stop(uuid, text) from authenticated;
revoke execute on function public.voice_ring_state(timestamptz, timestamptz, timestamptz, integer)
  from authenticated;

drop function if exists public.voice_call_stop(uuid, text);
drop function if exists public.voice_call_answer(uuid);
drop function if exists public.voice_call_ring(uuid);
drop function if exists public.voice_private_room(uuid);
drop function if exists public.voice_ring_state(timestamptz, timestamptz, timestamptz, integer);

alter table public.voice_channels
  drop constraint if exists voice_channels_ring_shape_check;

-- The grants go with the columns; naming them anyway so that a partial rollback
-- (columns kept, functions dropped) cannot leave a readable ring nobody writes.
revoke select (ring_started_at, ring_caller, ring_answered_at)
  on public.voice_channels from authenticated;

alter table public.voice_channels
  drop column if exists ring_answered_at,
  drop column if exists ring_caller,
  drop column if exists ring_started_at;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'voice_channels'
       and column_name in ('ring_started_at', 'ring_caller', 'ring_answered_at')
  ) then
    raise exception 'a ring column survived the rollback';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('voice_private_room', 'voice_call_ring', 'voice_call_answer',
                         'voice_call_stop', 'voice_ring_state')
  ) then
    raise exception 'a ring function survived the rollback';
  end if;
end;
$$;

commit;

-- Deliberately not run. A private chat's call room is an ordinary row and
-- deleting it is a data deletion, not a rollback:
--
--   delete from public.voice_channels vc
--    using public.chats c
--    where c.id = vc.chat_id and c.type = 'private';
