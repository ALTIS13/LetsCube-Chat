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

commit;
