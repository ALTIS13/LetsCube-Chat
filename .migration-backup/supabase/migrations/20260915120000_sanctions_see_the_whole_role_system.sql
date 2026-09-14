/**
 * Moderation was disabled for the majority of the people who are supposed to do
 * it, including both owners.
 *
 * Two layers guard `public.bans` and `public.mutes`, and they disagreed about
 * who is staff. Measured on production on 2026-09-15:
 *
 *   - RLS (`managers insert bans` / `managers insert mutes`) asks
 *     `is_manager_or_admin(auth.uid())`, which knows the legacy
 *     `profiles.role` column **and** the four global role keys.
 *   - `enforce_sanction_matrix()`, a BEFORE INSERT trigger, runs after RLS has
 *     admitted the row and knows only `profiles.role in ('admin','manager')`.
 *     `has_global_role` is never consulted.
 *
 * The trigger runs last, so it wins:
 *
 *     rls_says_staff | trigger_says_staff | people
 *     f              | f                  | 13
 *     t              | f                  |  3     <-- the gap
 *     t              | t                  |  2
 *
 * Three of the five staff accounts — two of them holding «Владелец», one
 * «Тех. администратор» — filled in a reason and a duration, pressed the button
 * and were told they are not an administrator. Nothing in the product could
 * repair it, because `enforce_role_change_matrix()` has the identical shape and
 * refuses them the role change that would grant the legacy column. The way out
 * was SQL.
 *
 * Rather than teach each trigger the list of role keys, both now ask how the
 * role system already ranks people. `public.roles` carries `priority`
 * (owner 100, tech_admin 100, admin 80, manager 60, user 10), and
 * `has_global_role` already folds the legacy column in for 'admin', 'manager'
 * and 'user'. So one function asks the existing predicate for every active
 * global key and keeps the highest priority; a role added later participates
 * without another migration, and the legacy column keeps working exactly as it
 * did.
 *
 * **The target side is widened too, and that is not optional.** Today
 * `target_role = 'admin'` only catches a legacy admin, so widening only the
 * caller would newly let a manager sanction an owner — closing one hole by
 * opening a worse one. Ranking both sides keeps the recorded matrix (a manager
 * may not sanction an administrator) and extends it to the roles the matrix was
 * written before.
 *
 * **DELETE is now covered.** Only INSERT carried the matrix, so a person who
 * could not issue a sanction could still lift one, and a manager could lift an
 * administrator's sanction on an administrator. The same rules now apply to
 * taking a sanction away as to giving one.
 *
 * Deliberately unchanged: `search_path = public` on the two trigger functions.
 * It is not what this migration is fixing, and changing the resolution rules of
 * a security-definer trigger while changing its logic hides one in the other.
 *
 * Rollback: `20260915120000_sanctions_see_the_whole_role_system.rollback.sql`.
 */

begin;

set local lock_timeout = '5s';

/**
 * The highest priority this person holds among the active global roles.
 *
 * Asks `has_global_role` rather than reading `user_global_roles` directly, so
 * the legacy `profiles.role` column is folded in by the same rule the rest of
 * the product uses. 0 when the person holds nothing.
 */
create or replace function public.effective_global_role_priority(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(pg_catalog.max(role_row.priority), 0)
    from public.roles role_row
   where role_row.scope = 'global'
     and role_row.is_active
     and public.has_global_role(p_user_id, role_row.key)
$function$;

revoke all on function public.effective_global_role_priority(uuid) from public, anon;
grant execute on function public.effective_global_role_priority(uuid) to authenticated;

create or replace function public.enforce_sanction_matrix()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  caller        uuid := auth.uid();
  subject       uuid;
  caller_rank   integer;
  subject_rank  integer;
  admin_rank    integer;
  manager_rank  integer;
begin
  -- `new` is unassigned in a DELETE trigger, and reading it there raises
  -- «record new is not assigned yet», so every reference branches on tg_op
  -- rather than leaning on coalesce.
  if tg_op = 'DELETE' then
    subject := old.user_id;
  else
    subject := new.user_id;
  end if;

  if caller is null then
    if tg_op = 'DELETE' then return old; else return new; end if;  -- service role / SQL session
  end if;

  if subject = caller then
    raise exception 'Нельзя применять санкции к самому себе'
      using errcode = '42501';
  end if;

  -- Fail closed: without the two thresholds there is no matrix to apply.
  select priority into admin_rank
    from public.roles where scope = 'global' and key = 'admin' and is_active;
  select priority into manager_rank
    from public.roles where scope = 'global' and key = 'manager' and is_active;
  if admin_rank is null or manager_rank is null then
    raise exception 'Матрица санкций не настроена' using errcode = '42501';
  end if;

  caller_rank  := public.effective_global_role_priority(caller);
  subject_rank := public.effective_global_role_priority(subject);

  if caller_rank >= admin_rank then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if caller_rank >= manager_rank then
    if subject_rank >= admin_rank then
      raise exception 'Менеджер не может применять санкции к администратору'
        using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  raise exception 'Только администратор или менеджер может применять санкции'
    using errcode = '42501';
end $function$;

create or replace function public.enforce_role_change_matrix()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  caller       uuid := auth.uid();
  caller_rank  integer;
  admin_rank   integer;
  manager_rank integer;
begin
  -- No change → nothing to check.
  if new.role is not distinct from old.role then
    return new;
  end if;

  -- DB / SQL admin without a session: allow.
  if caller is null then
    return new;
  end if;

  select priority into admin_rank
    from public.roles where scope = 'global' and key = 'admin' and is_active;
  select priority into manager_rank
    from public.roles where scope = 'global' and key = 'manager' and is_active;
  if admin_rank is null or manager_rank is null then
    raise exception 'Матрица ролей не настроена' using errcode = '42501';
  end if;

  caller_rank := public.effective_global_role_priority(caller);

  if caller_rank >= admin_rank then
    return new;            -- full control; last-admin guard handles edge case
  end if;

  if caller_rank >= manager_rank then
    -- Managers may only flip between user ↔ manager.
    if old.role = 'admin' or new.role = 'admin' then
      raise exception 'Менеджер не может изменять роль администратора'
        using errcode = '42501';
    end if;
    if new.role not in ('user', 'manager') then
      raise exception 'Недопустимая роль для менеджера'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Только администратор или менеджер может менять роли'
    using errcode = '42501';
end $function$;

drop trigger if exists trg_enforce_sanction_matrix_bans_delete on public.bans;
create trigger trg_enforce_sanction_matrix_bans_delete
  before delete on public.bans
  for each row execute function public.enforce_sanction_matrix();

drop trigger if exists trg_enforce_sanction_matrix_mutes_delete on public.mutes;
create trigger trg_enforce_sanction_matrix_mutes_delete
  before delete on public.mutes
  for each row execute function public.enforce_sanction_matrix();

do $check$
declare
  v_disagreeing bigint;
  v_missing     bigint;
  v_secdef      boolean;
  v_pinned      boolean;
  v_triggers    bigint;
begin
  -- 1. The two layers now name the same people, in both directions.
  select count(*) into v_disagreeing
    from public.profiles p
   where public.is_manager_or_admin(p.id)
     <> (public.effective_global_role_priority(p.id)
         >= (select priority from public.roles
              where scope = 'global' and key = 'manager' and is_active));
  if v_disagreeing <> 0 then
    raise exception 'RLS and the sanction matrix still disagree about % people', v_disagreeing;
  end if;

  -- 2. And nobody RLS calls staff is below the manager threshold, which is the
  --    gap this migration exists to close.
  select count(*) into v_missing
    from public.profiles p
   where public.is_manager_or_admin(p.id)
     and public.effective_global_role_priority(p.id)
         < (select priority from public.roles
             where scope = 'global' and key = 'manager' and is_active);
  if v_missing <> 0 then
    raise exception '% staff accounts still cannot sanction anybody', v_missing;
  end if;

  -- 3. The helper is a definer function with an empty search_path. `proconfig`
  --    stores it as `search_path=""`, quotes and all.
  select p.prosecdef,
         exists (
           select 1 from pg_catalog.unnest(p.proconfig) setting
            where setting like 'search_path=%'
              and pg_catalog.btrim(pg_catalog.split_part(setting, '=', 2), '"') = ''
         )
    into v_secdef, v_pinned
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'effective_global_role_priority';
  if not coalesce(v_secdef, false) then
    raise exception 'effective_global_role_priority is not security definer';
  end if;
  if not coalesce(v_pinned, false) then
    raise exception 'effective_global_role_priority does not pin an empty search_path';
  end if;

  -- 4. Taking a sanction away is guarded like giving one.
  select count(*) into v_triggers
    from pg_catalog.pg_trigger t
   where not t.tgisinternal
     and t.tgrelid in ('public.bans'::regclass, 'public.mutes'::regclass)
     and t.tgname like 'trg_enforce_sanction_matrix%';
  if v_triggers <> 4 then
    raise exception 'expected four sanction matrix triggers, found %', v_triggers;
  end if;

  raise notice 'both owners can moderate again, a manager still cannot touch an administrator, and lifting is guarded like issuing';
end
$check$;

commit;
