-- Proposal only. Do not apply automatically.
--
-- Adds a DB-backed registration mode that admins can toggle from the
-- application without editing database GUCs manually.
--
-- Manual apply target: Supabase SQL editor or psql against the LETSCUBE DB.

begin;

create table if not exists public.registration_invite_settings (
  id boolean primary key default true check (id),
  invite_only_enabled boolean not null default false,
  updated_by uuid null references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.registration_invite_settings (id, invite_only_enabled)
values (
  true,
  lower(coalesce(current_setting('app.registration_invites_required', true), 'off')) in ('1', 'on', 'true', 'yes')
)
on conflict (id) do nothing;

alter table public.registration_invite_settings enable row level security;

drop policy if exists "registration_invite_settings admin read" on public.registration_invite_settings;
drop policy if exists "registration_invite_settings writes blocked" on public.registration_invite_settings;
create policy "registration_invite_settings admin read"
  on public.registration_invite_settings for select to authenticated
  using (public.has_permission(auth.uid(), 'system.manage'));
create policy "registration_invite_settings writes blocked"
  on public.registration_invite_settings for all to authenticated
  using (false)
  with check (false);

revoke all on public.registration_invite_settings from public, anon, authenticated;

create or replace function public.registration_invites_required()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select invite_only_enabled from public.registration_invite_settings where id = true),
    lower(coalesce(current_setting('app.registration_invites_required', true), 'off')) in ('1', 'on', 'true', 'yes')
  )
$$;

create or replace function public.registration_invite_mode()
returns table (
  invite_only_enabled boolean,
  updated_at timestamptz,
  updated_by uuid
)
language sql
security definer
stable
set search_path = public
as $$
  select s.invite_only_enabled, s.updated_at, s.updated_by
    from public.registration_invite_settings s
   where s.id = true
  union all
  select lower(coalesce(current_setting('app.registration_invites_required', true), 'off')) in ('1', 'on', 'true', 'yes'),
         null::timestamptz,
         null::uuid
   where not exists (select 1 from public.registration_invite_settings where id = true)
   limit 1
$$;

create or replace function public.registration_invite_set_mode(p_invite_only_enabled boolean)
returns table (
  invite_only_enabled boolean,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean := coalesce(p_invite_only_enabled, false);
begin
  perform public._require_permission('system.manage');

  insert into public.registration_invite_settings (id, invite_only_enabled, updated_by, updated_at)
  values (true, v_enabled, auth.uid(), now())
  on conflict (id) do update
    set invite_only_enabled = excluded.invite_only_enabled,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (
    auth.uid(),
    'registration_invite_mode_updated',
    'registration_invite_settings',
    null,
    jsonb_build_object('invite_only_enabled', v_enabled)
  );

  return query
    select s.invite_only_enabled, s.updated_at, s.updated_by
      from public.registration_invite_settings s
     where s.id = true;
end $$;

create or replace function public.registration_invite_signup_gate(p_code text)
returns table (ok boolean, error text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_code text := public.registration_invite_normalize_code(p_code);
begin
  if v_code is null then
    if public.registration_invites_required() then
      return query select false, 'invite_required'::text;
      return;
    end if;
    return query select true, null::text;
    return;
  end if;

  return query select v.ok, v.error from public.registration_invite_validate(v_code) v;
end $$;

revoke all on function public.registration_invites_required() from public, anon, authenticated;
revoke all on function public.registration_invite_mode() from public, anon, authenticated;
revoke all on function public.registration_invite_set_mode(boolean) from public, anon, authenticated;
revoke all on function public.registration_invite_signup_gate(text) from public, anon, authenticated;

grant execute on function public.registration_invite_mode() to anon, authenticated;
grant execute on function public.registration_invite_set_mode(boolean) to authenticated;
grant execute on function public.registration_invite_signup_gate(text) to anon, authenticated;

commit;

-- Manual verification after apply:
-- 1. select * from public.registration_invite_mode();
-- 2. As tech_admin/system.manage user, call:
--      select * from public.registration_invite_set_mode(true);
-- 3. Confirm /register without invite shows invite-only banner and blocks submit before gateway call.
-- 4. Confirm /register?invite=<active-code> still creates a user and applies role/location.
-- 5. Confirm disabling mode with registration_invite_set_mode(false) restores open registration.
