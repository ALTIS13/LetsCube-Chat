begin;
/**
 * «Last seen» stops depending on who is reading it.
 *
 * `20260918290000_a_device_can_refuse_calls.sql` reads `auth.sessions.refreshed_at`
 * and casts it `::timestamptz`. Raised by the agent building the client half,
 * and the type is the thing I had not looked at:
 *
 *     created_at    timestamp with time zone
 *     updated_at    timestamp with time zone
 *     refreshed_at  timestamp WITHOUT time zone      ← GoTrue's own choice
 *
 * A naked timestamp cast to `timestamptz` is interpreted in **the reading
 * session's `TimeZone`**. So the same row could come back as a different moment
 * to two readers, every «последний вход» line would be off by that difference,
 * and the thirty-day window would cut early or late by it.
 *
 * ── Measured before changing anything, and it is a no-op today ─────────────
 *
 *     show timezone            → UTC
 *     pg_settings.TimeZone     → UTC
 *     the shift on live rows   → 00:00:00
 *
 * and **no role carries a `TimeZone` of its own**: `anon`, `authenticated`,
 * `authenticator`, `postgres`, `supabase_admin` and `supabase_auth_admin` set
 * only timeouts, search paths and logging. So nothing is wrong on this
 * deployment right now.
 *
 * ── Why change it anyway ───────────────────────────────────────────────────
 *
 * Because «right today» is the whole of the guarantee. One `alter role …
 * set TimeZone`, one `SET TimeZone` from a client library, one restore onto a
 * server whose default is not UTC, and every device's «last seen» quietly moves
 * — with nothing failing, no error anywhere, and a thirty-day window that is
 * silently twenty-nine or thirty-one.
 *
 * `at time zone 'UTC'` says what the column means instead of inheriting it.
 * GoTrue writes these in UTC; this is that fact written down where it is read.
 *
 * Also removes an `order by … nulls last` that cannot do anything: the `where`
 * already excludes nulls through `session_is_active`. A clause that cannot fire
 * reads as a case somebody handled, and this one is a case somebody prevented.
 */


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
         -- `at time zone 'UTC'`, never `::timestamptz`: the column is a naked
         -- timestamp and the cast would read it in whatever TimeZone the caller
         -- happens to carry. See this migration's header.
         s.refreshed_at at time zone 'UTC',
         coalesce(st.calls_enabled, true),
         -- False for every row when the claim is absent, which costs the
         -- listing a highlight and nothing else.
         s.id::text = nullif(auth.jwt() ->> 'session_id', '')
    from auth.sessions as s
    left join public.user_session_settings as st on st.session_id = s.id
   where s.user_id = auth.uid()
     and auth.uid() is not null
     and public.session_is_active(s.refreshed_at at time zone 'UTC', pg_catalog.now())
   order by s.refreshed_at desc;
$$;

comment on function public.session_devices_list() is
  'The caller''s own active authorisations, with whether each accepts calls. Times are UTC because the column says so, not because the reader does.';

do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'session_devices_list';

  if v_src like '%refreshed_at::timestamptz%' then
    raise exception 'the listing still casts a naked timestamp';
  end if;
  if v_src not like '%at time zone ''UTC''%' then
    raise exception 'the listing does not say which zone it means';
  end if;
  if v_src like '%nulls last%' then
    raise exception 'the dead ordering clause survived';
  end if;

  -- And the thing that must not have changed: a client may still run it.
  if not has_function_privilege('authenticated', 'public.session_devices_list()', 'EXECUTE') then
    raise exception 'the replacement dropped the grant';
  end if;
end;
$$;



\echo == the same row read under two different TimeZones ==
alter table auth.users disable trigger on_auth_user_created;
alter table public.profiles disable trigger trg_registration_invite_apply_from_profile;
alter table public.profiles disable trigger trg_bootstrap_first_admin;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('aaaaaaaa-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tz@x.invalid','',now(),now(),'{}'::jsonb,'{}'::jsonb);
insert into public.profiles (id, full_name) values ('aaaaaaaa-0000-4000-8000-00000000000a','TZ');
insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at, user_agent, ip)
values ('11111111-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-00000000000a', now()-interval '2 days', now(), (now() - interval '3 hours')::timestamp, 'Mozilla/5.0 (Windows NT 10.0) Chrome', '10.0.0.1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}';
set local timezone = 'UTC';
select 'UTC   ' as reader, refreshed_at from public.session_devices_list();
set local timezone = 'Asia/Tokyo';
select 'Tokyo ' as reader, refreshed_at from public.session_devices_list();
set local timezone = 'America/Los_Angeles';
select 'LA    ' as reader, refreshed_at from public.session_devices_list();
reset role;

\echo == and a session right at the window edge is decided the same way by all three ==
update auth.sessions set refreshed_at = (now() - interval '29 days 23 hours')::timestamp
 where id='11111111-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}';
set local timezone = 'UTC';         select 'UTC' as reader, count(*) from public.session_devices_list();
set local timezone = 'Asia/Tokyo';  select 'Tokyo' as reader, count(*) from public.session_devices_list();
set local timezone = 'Pacific/Kiritimati'; select 'UTC+14' as reader, count(*) from public.session_devices_list();
reset role;
rollback;
