/**
 * Puts the two trigger functions back to the definitions read off production on
 * 2026-09-15, drops the two DELETE triggers this migration added, and drops the
 * helper.
 *
 * Applying this re-opens the defect deliberately: three of the five staff
 * accounts, two of them «Владелец», lose the ability to issue a ban or a mute,
 * and lifting one stops being guarded at all. Only run it if the widened matrix
 * is itself causing harm.
 */

begin;

set local lock_timeout = '5s';

drop trigger if exists trg_enforce_sanction_matrix_bans_delete on public.bans;
drop trigger if exists trg_enforce_sanction_matrix_mutes_delete on public.mutes;

create or replace function public.enforce_sanction_matrix()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  caller       uuid := auth.uid();
  caller_role  public.app_role;
  target_role  public.app_role;
begin
  if caller is null then
    return new;  -- service role / SQL session
  end if;

  if new.user_id = caller then
    raise exception 'Нельзя применять санкции к самому себе'
      using errcode = '42501';
  end if;

  select role into caller_role from public.profiles where id = caller;
  select role into target_role from public.profiles where id = new.user_id;

  if caller_role = 'admin' then
    return new;
  end if;

  if caller_role = 'manager' then
    if target_role = 'admin' then
      raise exception 'Менеджер не может применять санкции к администратору'
        using errcode = '42501';
    end if;
    return new;
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
  caller uuid := auth.uid();
  caller_role public.app_role;
begin
  -- No change → nothing to check.
  if new.role is not distinct from old.role then
    return new;
  end if;

  -- DB / SQL admin without a session: allow.
  if caller is null then
    return new;
  end if;

  select role into caller_role from public.profiles where id = caller;

  if caller_role = 'admin' then
    return new;            -- full control; last-admin guard handles edge case
  end if;

  if caller_role = 'manager' then
    -- Managers may only flip between user ↔ manager.
    if old.role = 'admin' or new.role = 'admin' then
      raise exception 'Менеджер не может изменять роль администратора'
        using errcode = '42501';
    end if;
    if new.role not in ('user','manager') then
      raise exception 'Недопустимая роль для менеджера'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Только администратор или менеджер может менять роли'
    using errcode = '42501';
end $function$;

drop function if exists public.effective_global_role_priority(uuid);

commit;
