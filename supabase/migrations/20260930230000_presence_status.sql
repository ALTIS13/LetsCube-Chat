/**
 * A status beside presence — tracker item 37, first phase (2026-09-30).
 *
 * The owner's menu, from his screenshots: «В сети», «Неактивен», «Не
 * беспокоить», «Невидимый», a status with a duration — 15 минут, 1 час,
 * 8 часов, 24 часа, 3 дня, навсегда — and an idle that comes by itself.
 * Discord's idle, read in its bundle (`reference-clients.md` §25): 10 minutes
 * without input or speech.
 *
 * What others are told, and what only the person is:
 *
 *   - `profiles.presence_status`, readable by everybody beside `online_at`:
 *     `idle` or `dnd`, or nothing for plain presence. There is no «invisible»
 *     in it: an invisible person publishes nothing at all.
 *   - `privacy_preferences.manual_status` and `manual_status_until`, the status
 *     chosen and when it runs out, and `last_active_at`, the latest activity any
 *     of the person's devices has reported — theirs alone, under the table's
 *     own-row policies.
 *
 * **Presence is published here, from those rules, and not by each device.**
 *
 *   1. Somebody with two devices. If each client wrote the status, a laptop
 *      left idle would write «неактивен» while the phone in use said nothing,
 *      and the laptop would win; a status chosen on the phone would be
 *      overwritten by the laptop's next idle. Here each device reports only
 *      when its person last did something, the latest report wins, and the
 *      status is computed from the stored choice: the device in use decides,
 *      and a choice made on one device holds on all of them. (Reasoned from the
 *      first draft of this change, which wrote the status from the client; not
 *      observed in production, where no status existed.)
 *   2. Presence turned off was published anyway — one `online_at`, every time
 *      the application opened — because the heartbeat started from a privacy
 *      answer that belonged to no account yet. Reproduced on 2026-09-30 in
 *      `tests/e2e/presence-status.spec.ts`. The client is fixed, and the beat
 *      now reads the preference itself, so a client that gets it wrong
 *      publishes nothing either.
 *
 * Both functions are SECURITY INVOKER: every write is to the caller's own
 * rows, which the caller may already write, so row-level security applies
 * unchanged — the ban on a banned person's profile writes included — and
 * nothing is escalated.
 *
 * Rollback: 20260930230000_presence_status.rollback.sql. Roll the client back
 * first: it calls these functions.
 */
begin;
set local lock_timeout = '5s';

alter table public.profiles
  add column if not exists presence_status text;
alter table public.profiles drop constraint if exists profiles_presence_status_check;
alter table public.profiles add constraint profiles_presence_status_check
  check (presence_status is null or presence_status in ('idle', 'dnd'));

alter table public.privacy_preferences
  add column if not exists manual_status text not null default 'online',
  add column if not exists manual_status_until timestamptz,
  add column if not exists last_active_at timestamptz;
alter table public.privacy_preferences drop constraint if exists privacy_preferences_manual_status_check;
alter table public.privacy_preferences add constraint privacy_preferences_manual_status_check
  check (manual_status in ('online', 'idle', 'dnd', 'invisible')
         and (manual_status <> 'online' or manual_status_until is null));

/**
 * One device's heartbeat: «my person last did something at p_active_at».
 * Publishes `online_at` and the status others see, or clears both for somebody
 * who has turned presence off or chosen «Невидимый». Returns what it
 * published: 'online', 'idle', 'dnd' or 'hidden'.
 */
create or replace function public.presence_beat(p_active_at timestamptz default null)
returns text
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  -- A device's clock can run ahead of the server's; activity is never later
  -- than now.
  v_active timestamptz := least(coalesce(p_active_at, now()), now());
  v_row public.privacy_preferences%rowtype;
  v_manual text;
  v_status text;
begin
  if v_user is null then
    raise exception 'presence_beat_needs_a_person' using errcode = '42501';
  end if;

  -- The latest report from any device wins; an idle device's older one does
  -- not move it back.
  insert into public.privacy_preferences as stored (user_id, last_active_at)
  values (v_user, v_active)
  on conflict (user_id) do update
    set last_active_at = excluded.last_active_at
    where stored.last_active_at is null or stored.last_active_at < excluded.last_active_at;

  select * into v_row from public.privacy_preferences where user_id = v_user;

  -- A chosen status that has run out is no status.
  v_manual := case
    when v_row.manual_status_until is not null and v_row.manual_status_until <= now() then 'online'
    else v_row.manual_status
  end;

  if not v_row.presence_visible or v_manual = 'invisible' then
    update public.profiles
       set online_at = null, presence_status = null
     where id = v_user and (online_at is not null or presence_status is not null);
    return 'hidden';
  end if;

  -- A chosen status wins while it lasts: «Не беспокоить» is never turned into
  -- «Неактивен» by a quiet mouse. Only with none chosen does idle come by
  -- itself, after Discord's ten minutes.
  v_status := case
    when v_manual in ('idle', 'dnd') then v_manual
    when now() - least(v_row.last_active_at, now()) >= interval '10 minutes' then 'idle'
  end;

  update public.profiles
     set online_at = now(), presence_status = v_status
   where id = v_user;
  return coalesce(v_status, 'online');
end;
$function$;

/**
 * A status chosen on one device, for all of them, and published at once
 * rather than at the next beat. «В сети» takes no end: it is the absence of a
 * choice.
 */
create or replace function public.presence_set_status(p_status text, p_until timestamptz default null)
returns text
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_until timestamptz := case when p_status = 'online' then null else p_until end;
begin
  if v_user is null then
    raise exception 'presence_set_status_needs_a_person' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('online', 'idle', 'dnd', 'invisible') then
    raise exception 'presence_status_unknown' using errcode = '22023';
  end if;
  if v_until is not null and v_until <= now() then
    raise exception 'presence_status_already_over' using errcode = '22023';
  end if;

  insert into public.privacy_preferences as stored (user_id, manual_status, manual_status_until)
  values (v_user, p_status, v_until)
  on conflict (user_id) do update
    set manual_status = excluded.manual_status,
        manual_status_until = excluded.manual_status_until;

  -- Choosing is itself something the person did.
  return public.presence_beat(now());
end;
$function$;

-- EXECUTE comes from PUBLIC by default, and `authenticated` holds it only
-- through PUBLIC: revoking that without granting it back is how the
-- 2026-09-04 upload outage happened. So both, in this order.
revoke all on function public.presence_beat(timestamptz) from public, anon;
grant execute on function public.presence_beat(timestamptz) to authenticated;
revoke all on function public.presence_set_status(text, timestamptz) from public, anon;
grant execute on function public.presence_set_status(text, timestamptz) to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'presence_status')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'privacy_preferences' and column_name = 'manual_status')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'privacy_preferences' and column_name = 'manual_status_until')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'privacy_preferences' and column_name = 'last_active_at')
     or not has_column_privilege('authenticated', 'public.profiles', 'presence_status', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.privacy_preferences', 'manual_status', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.privacy_preferences', 'last_active_at', 'UPDATE')
     or not has_function_privilege('authenticated', 'public.presence_beat(timestamptz)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.presence_set_status(text, timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.presence_beat(timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.presence_set_status(text, timestamptz)', 'EXECUTE')
     or exists (select 1 from pg_proc where oid in ('public.presence_beat(timestamptz)'::regprocedure, 'public.presence_set_status(text, timestamptz)'::regprocedure) and prosecdef) then
    raise exception 'presence_status_migration_incomplete';
  end if;
end;
$$;

commit;
