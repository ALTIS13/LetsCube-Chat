/**
 * Rollback for 20260918190000_voice_limits_bind_the_deployment.sql.
 *
 * Run as `supabase_admin`, the same role that applied it — dropping a function
 * and a table requires owning them, and the header of the forward file explains
 * at length why that role is `supabase_admin` here and not `postgres`.
 *
 * **What comes back with it.** Exactly the state of 2026-09-18 before that
 * file: token minting has no limit beyond one Edge Function isolate's `Map`,
 * the two moderation routes have only that same per-isolate limit, and nothing
 * bounds how many simultaneous participants this deployment will agree to
 * carry. The per-isolate layer is real but it is (isolates × 20) with no bound
 * on the first factor, and it forgets a caller as soon as the isolate holding
 * them is recycled.
 *
 * **It is safe to run under a live gateway, which is the point.** The gateway
 * reads a missing function, an error, or an answer it does not recognise as
 * «allow, and warn once» (`readVoiceRateLimitAnswer` in
 * `supabase/functions/voice-gateway/admission.mjs`), so this drop degrades the
 * limit to per-isolate rather than refusing calls. Nothing here touches the
 * checks that decide whether somebody may be in a call at all — `is_banned`,
 * the membership row, the per-channel cap — and all of those still fail closed
 * in the gateway.
 *
 * `VOICE_ENABLED` is untouched by this file in either direction. The kill
 * switch is an environment value the running function reads and has no row,
 * function or table behind it, deliberately: a switch that needed a working
 * database would be unusable in the outage it exists for.
 *
 * **Locks.** `drop function` takes an object lock on that function alone;
 * `drop table` takes ACCESS EXCLUSIVE on a table only these functions ever
 * touched, and nothing else references it — no foreign key points at it and no
 * view reads it. No existing table is locked and nothing is rewritten.
 * `if exists` on every statement, so running this twice is a no-op.
 */

begin;

set local lock_timeout = '5s';

drop function if exists public.voice_rate_limit_prune(timestamptz);
drop function if exists public.voice_active_participants(integer);
drop function if exists public.voice_rate_limit_consume(uuid, text, integer, integer);
drop table if exists private.voice_rate_limit_signals;

do $check$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.voice_rate_limit_consume(uuid,text,integer,integer)',
    'public.voice_active_participants(integer)',
    'public.voice_rate_limit_prune(timestamptz)'
  ]
  loop
    if pg_catalog.to_regprocedure(v_signature) is not null then
      raise exception '% is still there, so this rollback did not complete', v_signature;
    end if;
  end loop;

  if pg_catalog.to_regclass('private.voice_rate_limit_signals') is not null then
    raise exception 'private.voice_rate_limit_signals is still there, so this rollback did not complete';
  end if;

  -- The things this rollback must NOT have taken with it. A `drop … cascade`
  -- typed in a hurry, or a dependency nobody expected, would show up here
  -- rather than as a silent hole in the voice path.
  if pg_catalog.to_regclass('private.voice_webhook_events') is null
     or pg_catalog.to_regclass('public.voice_participants') is null
     or pg_catalog.to_regclass('public.voice_channels') is null
     or pg_catalog.to_regprocedure('public.voice_webhook_event_seen(uuid)') is null
     or pg_catalog.to_regprocedure('private.voice_channel_recount(uuid)') is null
  then
    raise exception 'this rollback removed something it does not own; restore from the schema backup';
  end if;

  raise notice
    'the deployment-wide voice limit and the concurrency cap are gone; the gateway is back to one isolate''s Map';
end
$check$;

commit;
