/**
 * Rollback for `20260918260000_a_missed_call_is_recorded_even_if_nobody_is_there.sql`.
 *
 * Run as `supabase_admin`, which scheduled the job and owns the function.
 *
 * **What it restores is the gap slice C was written to close.** With the sweep
 * gone, a one-to-one call that rings out while no client is present leaves no
 * line in the conversation at all: the ring sits there expired, blocking
 * nothing, recorded nowhere. Calls that ring out with somebody watching are
 * unaffected — that record is written by the client at the forty-fifth second
 * and does not go through here.
 *
 * Records already written stay. They are ordinary system messages and deleting
 * them would be a data deletion this file has no mandate for.
 *
 * Idempotent: unscheduling a job that is not scheduled is not an error here,
 * because the name is looked up first.
 */

begin;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'letscube-voice-missed-call-sweep') then
    perform cron.unschedule('letscube-voice-missed-call-sweep');
  end if;
end;
$$;

drop function if exists public.voice_rings_sweep_expired(integer, integer);

do $$
begin
  if exists (select 1 from cron.job where jobname = 'letscube-voice-missed-call-sweep') then
    raise exception 'the sweep is still scheduled';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'voice_rings_sweep_expired'
  ) then
    raise exception 'the sweep function survived the rollback';
  end if;
end;
$$;

commit;
