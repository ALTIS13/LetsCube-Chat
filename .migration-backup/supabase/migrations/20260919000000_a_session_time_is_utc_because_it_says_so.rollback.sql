/**
 * Rollback for `20260919000000_a_session_time_is_utc_because_it_says_so.sql`.
 *
 * Run as `supabase_admin`.
 *
 * **It restores a latent defect rather than a behaviour anybody wants.** With
 * the `::timestamptz` cast back, `auth.sessions.refreshed_at` — a naked
 * timestamp — is interpreted in whatever `TimeZone` the reading session carries.
 * Proved on production before the fix: a session refreshed 29 days 20 hours ago
 * is listed for a reader in UTC and **absent** for one in Asia/Tokyo or UTC+14.
 *
 * It is harmless on this deployment today, where the server is UTC and no role
 * overrides it — which is exactly why it went unnoticed. Roll this back only to
 * roll back `20260918290000` with it.
 */

begin;

create or replace function public.session_devices_list()
returns table (
  session_id uuid,
  user_agent text,
  ip text,
  created_at timestamptz,
  refreshed_at timestamptz,
  calls_enabled boolean,
  is_current boolean
)
language sql
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $$
  select s.id,
         s.user_agent,
         host(s.ip),
         s.created_at,
         s.refreshed_at::timestamptz,
         coalesce(st.calls_enabled, true),
         s.id::text = nullif(auth.jwt() ->> 'session_id', '')
    from auth.sessions as s
    left join public.user_session_settings as st on st.session_id = s.id
   where s.user_id = auth.uid()
     and auth.uid() is not null
     and public.session_is_active(s.refreshed_at::timestamptz, pg_catalog.now())
   order by s.refreshed_at desc nulls last;
$$;

comment on function public.session_devices_list() is
  'The caller''s own active authorisations, with whether each accepts calls.';

commit;
