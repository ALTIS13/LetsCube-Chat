/**
 * Rollback for `20260918290000_a_device_can_refuse_calls.sql`.
 *
 * Run as `supabase_admin`, which owns the table and the four functions.
 *
 * **It destroys the person's choices.** Dropping `user_session_settings` takes
 * every «do not ring this device» with it, and after the rollback every
 * authorisation rings again. That is the correct outcome for a rollback of this
 * feature — with the functions gone there is nothing to read the flag — but it
 * is a preference somebody set, so count them first if that matters:
 *
 *   select count(*) filter (where not calls_enabled) from public.user_session_settings;
 *
 * **Roll the client back with it.** A bundle that calls
 * `voice_calls_allowed_here` against a database without it gets an error rather
 * than a boolean, and the ring path must not be left deciding whether to sound
 * from a failed request.
 *
 * Nothing in `auth.sessions` is touched: this feature only ever read it.
 *
 * Idempotent.
 */

begin;

revoke execute on function public.session_devices_list() from authenticated;
revoke execute on function public.session_device_set_calls(uuid, boolean) from authenticated;
revoke execute on function public.voice_calls_allowed_here() from authenticated;
revoke execute on function public.session_is_active(timestamptz, timestamptz, integer) from authenticated;

drop function if exists public.voice_calls_allowed_here();
drop function if exists public.session_device_set_calls(uuid, boolean);
drop function if exists public.session_devices_list();
drop function if exists public.session_is_active(timestamptz, timestamptz, integer);

drop table if exists public.user_session_settings;

do $$
begin
  if exists (
    select 1 from pg_class where oid = to_regclass('public.user_session_settings')
  ) then
    raise exception 'user_session_settings survived the rollback';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('session_devices_list', 'session_device_set_calls',
                         'voice_calls_allowed_here', 'session_is_active')
  ) then
    raise exception 'a device function survived the rollback';
  end if;
end;
$$;

commit;
