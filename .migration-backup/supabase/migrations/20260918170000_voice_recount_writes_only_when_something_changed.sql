/**
 * The cause behind the write loop the previous migration cleaned up after.
 *
 * `20260918160000` cleared one row whose `active_since` had been set with
 * nobody in the room since 2026-09-13, and said the reconciler would be taught
 * not to let it happen again. This is that, and it turned out to be in the
 * database rather than in the worker.
 *
 * ── What `private.voice_channel_recount` did ─────────────────────────────────
 *
 *     update public.voice_channels
 *        set participant_count = (select count(*) from voice_participants …),
 *            updated_at = now()
 *      where id = p_channel_id;
 *
 * Two things, and each is half of the loop:
 *
 * **It writes whether or not anything changed.** Recounting an empty channel to
 * zero when it is already zero still updates the row, still moves `updated_at`,
 * and still fires a Realtime broadcast to every member subscribed to that chat.
 * The reconciler calls this twice a minute for every channel its selector
 * matches. Measured before the repair: **11,867 lifetime UPDATEs on a one-row
 * table**.
 *
 * **It never clears `active_since`.** Only a `room_finished` webhook does. So a
 * flag set any other way — a direct `voice_channel_set_active` during QA, a
 * webhook lost to a restart — keeps the channel inside the reconciler's
 * selector (`participant_count.gt.0,active_since.not.is.null`) for ever, and
 * nothing in the running system can take it out.
 *
 * ── What it does now ────────────────────────────────────────────────────────
 *
 * It writes only when the row would actually differ, and it clears
 * `active_since` for a room that has been empty for longer than a grace
 * window.
 *
 * **The grace window is the whole of the care here.** `room_started` arrives
 * before anybody is counted, so a room that has just opened legitimately looks
 * «active with nobody in it» for a few seconds. Clearing on emptiness alone
 * would race every join: the flag would be dropped between the webhook and the
 * first participant row, and the rail would stop showing a room that is about
 * to fill. Two minutes is far longer than that window and far shorter than the
 * four days this one sat.
 *
 * The clear is deliberately **not** conditioned on who is calling. `recount` is
 * reached from the webhook path, from the join and leave RPCs and from the
 * reconciler, and a room that has been empty for two minutes is empty by every
 * one of those routes. A caller-specific rule would be a second place for this
 * to be wrong.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 *
 * It is not a change to what «active» means, and it does not touch the
 * `room_started` / `room_finished` path. A room with somebody in it is
 * untouched by every branch below.
 *
 * ── Applying ────────────────────────────────────────────────────────────────
 *
 * **As `supabase_admin`.** This sentence said `postgres` until the rehearsal
 * refused it with «must be owner of function voice_channel_recount»:
 * `private.voice_channel_recount` is owned by `supabase_admin`, like
 * `public.voice_channels` and unlike most of `public`. Guessing an owner from
 * the schema it lives in is what cost the previous migration a round trip too.
 * One transaction, a self-check that raises, a rollback beside it.
 */

begin;

set local lock_timeout = '5s';

/**
 * How long a room may be marked active with nobody in it before the flag is
 * treated as stale. Longer than the gap between `room_started` and the first
 * participant row by orders of magnitude.
 */
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

comment on function private.voice_channel_recount(uuid) is
  'Recount one room, writing only when the row would differ. Clears active_since '
  'for a room empty for more than two minutes; the grace window is what keeps it '
  'from racing room_started, which fires before the first participant row.';

do $$
declare
  v_body text;
  v_before integer;
  v_after integer;
  v_channel uuid;
begin
  select pg_get_functiondef(oid) into v_body
    from pg_proc
   where proname = 'voice_channel_recount'
     and pronamespace = 'private'::regnamespace;
  if v_body is null then
    raise exception 'private.voice_channel_recount is gone';
  end if;
  if v_body not like '%is distinct from%' then
    raise exception 'the recount writes unconditionally again, which is the write loop';
  end if;
  if v_body not like '%2 minutes%' then
    raise exception 'the grace window is gone, so clearing active_since races room_started';
  end if;

  -- Behavioural, not structural: recounting a channel whose count is already
  -- right must write nothing. Measured by xact_commit on the table's own
  -- statistics rather than by reading the source again.
  select id into v_channel from public.voice_channels limit 1;
  if v_channel is not null then
    select n_tup_upd into v_before from pg_stat_xact_user_tables
     where relname = 'voice_channels';
    perform private.voice_channel_recount(v_channel);
    select n_tup_upd into v_after from pg_stat_xact_user_tables
     where relname = 'voice_channels';
    if coalesce(v_after, 0) <> coalesce(v_before, 0) then
      raise exception
        'recounting an unchanged channel still wrote a row (% -> %), so the loop is not fixed',
        coalesce(v_before, 0), coalesce(v_after, 0);
    end if;
  end if;

  raise notice 'the recount is quiet when nothing changed, and an empty room stops calling itself active';
end
$$;

commit;
