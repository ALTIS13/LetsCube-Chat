/**
 * Search by telephone number for everybody — tracker item 74 (2026-09-30).
 *
 * A tester: «поиск по номеру нужен». The owner approved it the same day, on
 * the condition that it is done as Telegram does it. Telegram, read on
 * 2026-09-30:
 *
 *   - `contacts.resolvePhone`: «Resolve a phone number to get user info, if
 *     their privacy settings allow it», with a client-side limit of one call
 *     every three seconds; a number nobody holds answers PHONE_NOT_OCCUPIED
 *     (core.telegram.org/method/contacts.resolvePhone).
 *   - `inputPrivacyKeyAddedByPhone`: «Whether people can add you to their
 *     contact list by your phone number» (core.telegram.org/constructor/…).
 *   - The Android client's privacy screen offers it as «who can find me by my
 *     number» with two answers, everybody and my contacts, and with no stored
 *     rule the answer is everybody (`PrivacyControlActivity.java`, master).
 *     It is offered when nobody may see the number — which is always so here:
 *     this product never shows a telephone number to anybody but staff.
 *
 * So: a whole verified number finds its owner for any signed-in account,
 * unless its owner has answered «Мои контакты» and the searcher is not in
 * their contacts. The same empty answer for a number nobody holds and for one
 * whose owner does not allow it, so the answer cannot be used to learn which
 * numbers are registered. The result is the profile — never the number.
 *
 * Beyond the reference, because this product's directory is small enough to
 * walk: at most 10 lookups a minute and 100 a day per account, counted for
 * every well-formed number asked about, and a person who has blocked the
 * searcher is not found by them. The log keeps who asked and when, never what.
 * Staff with `users.view` keep the lookup they had — every verified number, no
 * limit — since they can read the numbers themselves under
 * `profile_contacts`' own policy.
 *
 * `profile_contacts.phone_discoverable` and `profile_phone_set_discoverable`
 * were the first attempt at this (2026-08-10) and nothing ever read or called
 * them (audit F-4, 2026-09-15). They are left in place, marked superseded.
 *
 * Rollback: 20260930235000_phone_search_for_everybody.rollback.sql.
 * Read-only prestate, PG17.6, 2026-10-01: RPC owner postgres;
 * SHA256 of UTF8 pg_get_functiondef(text,integer):
 * 53e17a81ab737d08e419aeaffbef8a16593c76ecd4e80c88afdb59b77006bbe6.
 * Recheck with tests/rehearsal/phone-search-item74/prestate.mjs before apply.
 */
begin;
set local lock_timeout = '5s';
set local search_path = pg_catalog, pg_temp;

alter table public.privacy_preferences
  add column if not exists phone_findable_by text not null default 'everybody';
alter table public.privacy_preferences drop constraint if exists privacy_preferences_phone_findable_by_check;
alter table public.privacy_preferences add constraint privacy_preferences_phone_findable_by_check
  check (phone_findable_by in ('everybody', 'contacts'));

create table if not exists private.phone_lookups (
  user_id uuid not null references auth.users(id) on delete cascade,
  looked_up_at timestamptz not null default now()
);
create index if not exists phone_lookups_user_time on private.phone_lookups (user_id, looked_up_at desc);
-- The existing RPC belongs to postgres; apply is run as supabase_admin.
alter table private.phone_lookups owner to postgres;
revoke all on table private.phone_lookups from public, anon, authenticated, service_role;

create or replace function public.search_profiles_by_phone(
  p_query text,
  p_limit integer default 10
)
returns table (
  id uuid,
  title text,
  subtitle text,
  avatar_url text,
  created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_phone text;
  v_staff boolean;
  v_last_minute integer;
  v_last_day integer;
  v_lookup_at timestamptz;
begin
  if v_actor is null or public.is_banned(v_actor) then
    return;
  end if;

  -- A whole number, written the ways a number is written: an international
  -- one, or a Russian one from 8. Normalised as a stored number is.
  if p_query is null or btrim(p_query) !~ '^\+?[0-9 ()-]{7,24}$' then
    return;
  end if;
  -- Do not let the shared normalizer infer +7 from a local ten-digit guess.
  -- Without an explicit +, only a whole Russian 11-digit 7/8 form is allowed.
  if left(btrim(p_query), 1) <> '+'
     and regexp_replace(btrim(p_query), '[ ()-]', '', 'g') !~ '^[78][0-9]{10}$' then
    return;
  end if;
  v_phone := public._normalize_phone_e164(btrim(p_query));
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return;
  end if;

  v_staff := coalesce(public.has_permission(v_actor, 'users.view'), false);

  if not v_staff then
    -- A fixed transaction snapshot cannot see the preceding lock holder's
    -- commit. PostgREST uses READ COMMITTED; fail closed for other callers.
    if current_setting('transaction_isolation') <> 'read committed' then
      raise exception 'phone_lookup_requires_read_committed' using errcode = '25001';
    end if;
    -- Account-scoped, held through COMMIT/ROLLBACK, and before any quota read.
    -- VOLATILE obtains a fresh READ COMMITTED snapshot after this wait.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('phone_lookup:' || v_actor::text, 0));
    v_lookup_at := clock_timestamp();
    select count(*) filter (where lookup.looked_up_at > v_lookup_at - interval '1 minute'),
           count(*)
      into v_last_minute, v_last_day
      from private.phone_lookups as lookup
     where lookup.user_id = v_actor
       and lookup.looked_up_at > v_lookup_at - interval '1 day';
    if v_last_minute >= 10 or v_last_day >= 100 then
      raise exception 'phone_lookup_rate_limited' using errcode = 'P0001';
    end if;
    insert into private.phone_lookups (user_id, looked_up_at) values (v_actor, v_lookup_at);
    -- Bounded quota cache, not history: at most 100 rows per live account.
    -- Inactive accounts retain stale timestamps until their next lookup;
    -- account deletion removes them through the auth.users FK. No phone stored.
    delete from private.phone_lookups as lookup
     where lookup.user_id = v_actor
       and lookup.looked_up_at <= v_lookup_at - interval '1 day';
  end if;

  return query
  select
    profile.id,
    coalesce(
      nullif(btrim(profile.full_name), ''),
      case when profile.username is not null then '@' || profile.username end,
      'Пользователь'
    ) as title,
    case
      when profile.username is not null then '@' || profile.username
      else 'Профиль'
    end as subtitle,
    profile.avatar_url,
    profile.updated_at as created_at
  from public.profile_contacts as contact
  join public.profiles as profile on profile.id = contact.user_id
  left join public.privacy_preferences as preference on preference.user_id = contact.user_id
  where contact.phone_verified is true
    and contact.phone = v_phone
    and (
      v_staff
      or contact.user_id = v_actor
      or (
        not public.is_banned(contact.user_id)
        and not exists (
          select 1 from public.user_blocks as block
           where block.blocker_id = contact.user_id and block.blocked_id = v_actor
        )
        and (
          coalesce(preference.phone_findable_by, 'everybody') = 'everybody'
          or exists (
            select 1 from public.user_contacts as saved
             where saved.owner_user_id = contact.user_id and saved.contact_user_id = v_actor
          )
        )
      )
    )
  order by profile.updated_at desc, profile.id
  limit least(greatest(coalesce(p_limit, 10), 1), 10);
end
$function$;

revoke all on function public.search_profiles_by_phone(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_profiles_by_phone(text, integer)
  to authenticated;

comment on function public.search_profiles_by_phone(text, integer) is
  'Item 74: a whole verified number finds its owner for any signed-in account, as their privacy_preferences.phone_findable_by allows; 10 a minute and 100 a day outside staff; never returns the number.';
comment on column public.privacy_preferences.phone_findable_by is
  'Who can find this person by their verified number: everybody (the default, as in Telegram) or contacts — people this person has saved.';
comment on column public.profile_contacts.phone_discoverable is
  'Superseded by privacy_preferences.phone_findable_by (20260930235000). Never read.';
comment on function public.profile_phone_set_discoverable(boolean) is
  'Superseded by privacy_preferences.phone_findable_by (20260930235000). Never called.';

do $$
declare
  v_rpc oid := 'public.search_profiles_by_phone(text, integer)'::regprocedure;
  v_owner name;
  v_role name;
begin
  if not exists (
       select 1 from pg_attribute as attribute
       join pg_attrdef as value on value.adrelid = attribute.attrelid and value.adnum = attribute.attnum
        where attribute.attrelid = 'public.privacy_preferences'::regclass
          and attribute.attname = 'phone_findable_by' and not attribute.attisdropped
          and attribute.atttypid = 'text'::regtype and attribute.attnotnull
          and pg_get_expr(value.adbin, value.adrelid) = '''everybody''::text'
     ) or not exists (
       select 1 from pg_constraint where conrelid = 'public.privacy_preferences'::regclass
         and conname = 'privacy_preferences_phone_findable_by_check' and convalidated
         and pg_get_constraintdef(oid) = 'CHECK ((phone_findable_by = ANY (ARRAY[''everybody''::text, ''contacts''::text])))'
     ) or not has_column_privilege('authenticated', 'public.privacy_preferences', 'phone_findable_by', 'UPDATE') then
    raise exception 'phone_search_preference_incomplete';
  end if;
  select pg_get_userbyid(proowner) into v_owner from pg_proc where oid = v_rpc;
  if to_regclass('private.phone_lookups') is null
     or (select relowner from pg_class where oid = 'private.phone_lookups'::regclass)
        is distinct from (select proowner from pg_proc where oid = v_rpc)
     or not has_schema_privilege(v_owner, 'private', 'USAGE')
     or not has_table_privilege(v_owner, 'private.phone_lookups', 'SELECT')
     or not has_table_privilege(v_owner, 'private.phone_lookups', 'INSERT')
     or not has_table_privilege(v_owner, 'private.phone_lookups', 'DELETE') then
    raise exception 'phone_search_log_owner_incomplete';
  end if;
  if not exists (
       select 1 from pg_constraint
        where conrelid = 'private.phone_lookups'::regclass and contype = 'f'
          and conname = 'phone_lookups_user_id_fkey' and convalidated
          and confrelid = 'auth.users'::regclass and confdeltype = 'c'
          and pg_get_constraintdef(oid) = 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
     ) or (select array_agg(attname::text order by attnum) from pg_attribute
            where attrelid = 'private.phone_lookups'::regclass and attnum > 0 and not attisdropped)
          is distinct from array['user_id', 'looked_up_at']::text[] then
    raise exception 'phone_search_log_shape_incomplete';
  end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role']::name[] loop
    if has_table_privilege(v_role, 'private.phone_lookups', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_any_column_privilege(v_role, 'private.phone_lookups', 'SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception 'phone_search_log_permissions_incomplete';
    end if;
  end loop;
  if not has_function_privilege('authenticated', v_rpc, 'EXECUTE')
     or has_function_privilege('anon', v_rpc, 'EXECUTE')
     or has_function_privilege('service_role', v_rpc, 'EXECUTE') then
    raise exception 'phone_search_rpc_permissions_incomplete';
  end if;
  if (select provolatile from pg_proc where oid = v_rpc) is distinct from 'v'::"char"
     or (select prosecdef from pg_proc where oid = v_rpc) is distinct from true
     or (select proconfig from pg_proc where oid = v_rpc)
        is distinct from array['search_path=pg_catalog, pg_temp']::text[] then
    raise exception 'phone_search_rpc_attributes_incomplete';
  end if;
end;
$$;

commit;
