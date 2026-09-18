/**
 * A device can refuse calls, and the person can say so from any of them.
 *
 * Slice F of `docs/proposals/2026-09-18-one-to-one-calls.md`, asked for by the
 * owner in their own words: «возможности отключить принятие звонков на
 * определённое авторизированное в аккаунт устройство», and answered by them on
 * 2026-09-18 as shape **B** — a registry, like Telegram's «Активные сеансы» —
 * rather than shape A, a switch stored on the device it governs. Their reason
 * is the one this project keeps: A can only be operated *from* the device it
 * silences, which is the lesser function wearing the larger one's name.
 *
 * ── The registry already exists, and it is not the one §4a expected ────────
 *
 * §4a recommended building on `user_push_devices` «by finally giving
 * `device_id` a value rather than by adding a fourth notion of a device». Two
 * measurements retired that: the table holds no client grants at all (every
 * write goes through an RPC, and it carries a token and a token hash that must
 * never leave), and — the real objection — **it is keyed on a push token**. No
 * push, no row. A browser tab signed in without notification permission still
 * rings while it is open, and its owner still needs to silence it from their
 * phone.
 *
 * `auth.sessions` is the inventory and costs nothing: GoTrue writes a row per
 * authorisation with `user_agent`, `ip` and `refreshed_at`, on every shell,
 * with no registration code anywhere. «Авторизированное в аккаунт устройство»
 * is a description of a row in it.
 *
 * ── What «active» means, measured rather than chosen ───────────────────────
 *
 *     freshness taken as            sessions in 30 days   per person avg / max
 *     refreshed_at                            24                 2.0 / 7
 *     coalesce(refreshed_at, created_at)     298                19.9 / 127
 *
 * **318 of 342 sessions have never been refreshed.** A session that came back
 * for a token is a living installation; one that never did is a sign-in that
 * went nowhere. So the window is `refreshed_at` within thirty days, which gives
 * a person two entries on average — and the other definition gives one person a
 * hundred and twenty-seven, which is a log rather than a device list.
 *
 * ── The claim this rests on, and what happens if it is absent ──────────────
 *
 * A device has to recognise **itself**, and the natural answer is the
 * `session_id` claim in the access token. Nothing in this repository reads it
 * today; measured against the deployed `gotrue:v2.189.0` binary it carries the
 * same struct-tag multiplicity as `user_metadata`, `aal`, `amr` and
 * `is_anonymous`, which is strong evidence and not proof.
 *
 * So **nothing here fails if the claim is missing.** `voice_calls_allowed_here`
 * answers `true` when it cannot tell which session it is, and `is_current` in
 * the listing is simply false for every row. The feature degrades to «you can
 * see your devices and silence any of them», losing only the ability to point
 * at «this one» — and a device that cannot identify itself goes on ringing,
 * which is the safe direction: a call that rings when it should not is a
 * nuisance, and one that silently does not is a missed call nobody can explain.
 *
 * ── Deliberately not here ──────────────────────────────────────────────────
 *
 * **Ending a session from the list.** «Активные сеансы» has it and this does
 * not: signing another device out is a security action with its own failure
 * modes, and the owner asked for the call switch. Adding a `delete from
 * auth.sessions` to a slice about ringing would be scope wearing a feature's
 * name.
 *
 * **Pruning the 318.** Something is creating far more sessions than there are
 * devices and nothing removes them. The window hides them from this list; it
 * does not fix them, and that is recorded in the proposal rather than papered
 * over with a delete here.
 */

begin;

-- ── The flag, beside the session rather than on it ──────────────────────────

/**
 * `auth.sessions` belongs to GoTrue, which recreates and migrates it on its own
 * schedule, so a column added there is a column that disappears on an upgrade.
 * The flag lives in a table of ours keyed on the session, and follows it out of
 * existence through the cascade.
 */
create table if not exists public.user_session_settings (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  calls_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.user_session_settings is
  'Per-authorisation preferences. One row per auth.sessions row, created on first change.';

create index if not exists user_session_settings_user_idx
  on public.user_session_settings (user_id);

alter table public.user_session_settings enable row level security;

/**
 * No policy, and that is the design rather than an omission.
 *
 * Every read and write goes through the three functions below, which are
 * `SECURITY DEFINER` because they must join `auth.sessions` — a table no client
 * may read. With RLS on and no policy, a client that reached this table
 * directly would see nothing and write nothing, which is exactly right.
 */

revoke all on public.user_session_settings from authenticated, anon;

-- ── Which sessions count as devices ─────────────────────────────────────────

/**
 * The freshness window, as one function so that the listing and any later
 * pruning cannot disagree about it.
 *
 * `immutable` and both inputs explicit, like `voice_ring_state`: the rule is
 * then assertable without a session, a clock or a login.
 */
create or replace function public.session_is_active(
  p_refreshed_at timestamptz,
  p_now timestamptz,
  p_days integer default 30
) returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  select p_refreshed_at is not null
     and p_refreshed_at > p_now - make_interval(days => greatest(p_days, 0));
$$;

comment on function public.session_is_active(timestamptz, timestamptz, integer) is
  'True for a session that has come back for a token inside the window. A session that never refreshed is a sign-in that went nowhere.';

-- ── The three functions a client uses ───────────────────────────────────────

/**
 * The person's own devices, and nothing about anybody else's.
 *
 * `ip` is returned because it is the reader's own and because «where» is half
 * of what makes such a list useful — the same half Telegram shows. It is never
 * to appear in a screenshot, a test fixture or a report; the interface shows it
 * to the one person entitled to see it and no further.
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
         s.refreshed_at::timestamptz,
         coalesce(st.calls_enabled, true),
         -- False for every row when the claim is absent, which costs the
         -- listing a highlight and nothing else.
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

/**
 * Turn calls on or off for one of the person's own devices, from any of them.
 *
 * The session is checked to belong to the caller rather than trusted: this is
 * the one function here a client passes an id to, and an id is the easiest
 * thing in the world to change in a request.
 */
create or replace function public.session_device_set_calls(
  p_session_id uuid,
  p_enabled boolean
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_enabled is null then
    raise exception 'bad_request' using errcode = '22023';
  end if;

  select s.user_id into v_owner from auth.sessions as s where s.id = p_session_id;
  if v_owner is null then
    raise exception 'no_such_device' using errcode = 'P0002';
  end if;
  if v_owner <> v_me then
    -- Deliberately the same refusal as a missing row would give, so that this
    -- function cannot be used to discover whether a session id exists.
    raise exception 'no_such_device' using errcode = 'P0002';
  end if;

  insert into public.user_session_settings (session_id, user_id, calls_enabled, updated_at)
  values (p_session_id, v_me, p_enabled, pg_catalog.now())
  on conflict (session_id) do update
     set calls_enabled = excluded.calls_enabled,
         updated_at = excluded.updated_at;

  return p_enabled;
end;
$$;

comment on function public.session_device_set_calls(uuid, boolean) is
  'Set whether one of the caller''s own devices accepts calls. Refuses somebody else''s session as though it did not exist.';

/**
 * May this device ring?
 *
 * Asked by the client before it shows or sounds an incoming call. Answers
 * **true** when it cannot tell which session it is — see the note at the head of
 * this file on why that is the safe direction.
 */
create or replace function public.voice_calls_allowed_here()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $$
  select coalesce(
    (select st.calls_enabled
       from public.user_session_settings as st
      where st.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and st.user_id = auth.uid()),
    true
  );
$$;

comment on function public.voice_calls_allowed_here() is
  'Whether this authorisation accepts calls. True when the session cannot be identified.';

revoke all on function public.session_devices_list() from public;
revoke all on function public.session_device_set_calls(uuid, boolean) from public;
revoke all on function public.voice_calls_allowed_here() from public;
revoke all on function public.session_is_active(timestamptz, timestamptz, integer) from public;

grant execute on function public.session_devices_list() to authenticated;
grant execute on function public.session_device_set_calls(uuid, boolean) to authenticated;
grant execute on function public.voice_calls_allowed_here() to authenticated;
grant execute on function public.session_is_active(timestamptz, timestamptz, integer) to authenticated;

-- ── The self-check ──────────────────────────────────────────────────────────

do $$
begin
  -- The window, at its edges.
  if public.session_is_active(null, pg_catalog.now())
     or not public.session_is_active(pg_catalog.now() - interval '29 days', pg_catalog.now())
     or public.session_is_active(pg_catalog.now() - interval '31 days', pg_catalog.now()) then
    raise exception 'session_is_active does not answer its own cases';
  end if;

  -- The table is reachable only through the functions.
  if exists (
    select 1 from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'user_session_settings'
       and grantee in ('authenticated', 'anon')
  ) then
    raise exception 'a client holds a direct privilege on user_session_settings';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.user_session_settings'::regclass) then
    raise exception 'row level security is not enabled on user_session_settings';
  end if;

  -- And the three functions a client does hold.
  if not (
    has_function_privilege('authenticated', 'public.session_devices_list()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.session_device_set_calls(uuid, boolean)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.voice_calls_allowed_here()', 'EXECUTE')
  ) then
    raise exception 'a client cannot run the functions this feature is made of';
  end if;
end;
$$;

commit;
