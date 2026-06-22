-- LETSCUBE registration invite codes / links.
--
-- Proposal only. Do not apply automatically from Codex.
--
-- Goal:
-- - Admins can create invite codes/links with limited uses and expiry.
-- - Invites can pre-assign a global role and/or a location role.
-- - Signup submits the code through auth-yandex-gateway; the DB applies the
--   invite from auth.users.raw_user_meta_data when the profile is created.
-- - No service_role is required in frontend.
--
-- Optional hard gate:
--   alter database postgres set app.registration_invites_required = 'on';
-- Revert:
--   alter database postgres reset app.registration_invites_required;

begin;

create extension if not exists pgcrypto;

create table if not exists public.registration_invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  global_role_id uuid null references public.roles(id) on delete set null,
  location_id uuid null references public.locations(id) on delete set null,
  location_role_id uuid null references public.roles(id) on delete set null,
  primary_admin_id uuid null references public.profiles(id) on delete set null,
  max_uses integer not null default 1,
  uses_count integer not null default 0,
  expires_at timestamptz null,
  revoked_at timestamptz null,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registration_invites_code_check check (code ~ '^[A-Z0-9_-]{6,64}$'),
  constraint registration_invites_label_check check (length(btrim(label)) between 2 and 120),
  constraint registration_invites_max_uses_check check (max_uses between 1 and 1000),
  constraint registration_invites_uses_count_check check (uses_count >= 0 and uses_count <= max_uses)
);

create table if not exists public.registration_invite_uses (
  invite_id uuid not null references public.registration_invites(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  used_at timestamptz not null default now(),
  primary key (invite_id, user_id)
);

create index if not exists idx_registration_invites_active
  on public.registration_invites (revoked_at, expires_at, uses_count, max_uses);
create index if not exists idx_registration_invites_created_by
  on public.registration_invites (created_by, created_at desc);
create index if not exists idx_registration_invite_uses_user
  on public.registration_invite_uses (user_id, used_at desc);

alter table public.registration_invites enable row level security;
alter table public.registration_invite_uses enable row level security;

drop policy if exists "registration_invites admin read" on public.registration_invites;
drop policy if exists "registration_invites writes blocked" on public.registration_invites;
create policy "registration_invites admin read"
  on public.registration_invites for select to authenticated
  using (public.has_permission(auth.uid(), 'users.assign_roles') or public.has_permission(auth.uid(), 'system.manage'));
create policy "registration_invites writes blocked"
  on public.registration_invites for all to authenticated
  using (false)
  with check (false);

drop policy if exists "registration_invite_uses admin read" on public.registration_invite_uses;
drop policy if exists "registration_invite_uses writes blocked" on public.registration_invite_uses;
create policy "registration_invite_uses admin read"
  on public.registration_invite_uses for select to authenticated
  using (public.has_permission(auth.uid(), 'users.assign_roles') or public.has_permission(auth.uid(), 'system.manage'));
create policy "registration_invite_uses writes blocked"
  on public.registration_invite_uses for all to authenticated
  using (false)
  with check (false);

grant select on public.registration_invites to authenticated;
grant select on public.registration_invite_uses to authenticated;

create or replace function public.registration_invite_normalize_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_code is null then null
    when regexp_replace(upper(btrim(p_code)), '\s+', '', 'g') ~ '^[A-Z0-9_-]{6,64}$'
      then regexp_replace(upper(btrim(p_code)), '\s+', '', 'g')
    else null
  end
$$;

create or replace function public.registration_invites_required()
returns boolean
language sql
stable
set search_path = public
as $$
  select lower(coalesce(current_setting('app.registration_invites_required', true), 'off')) in ('1', 'on', 'true', 'yes')
$$;

create or replace function public.registration_invite_generate_code()
returns text
language sql
volatile
set search_path = public
as $$
  select 'LC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)) || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
$$;

create or replace function public.registration_invite_validate(p_code text)
returns table (ok boolean, error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := public.registration_invite_normalize_code(p_code);
  v_invite public.registration_invites%rowtype;
begin
  if v_code is null then
    if public.registration_invites_required() then
      return query select false, 'invite_required'::text;
      return;
    end if;
    return query select false, 'invite_invalid'::text;
    return;
  end if;

  select * into v_invite
    from public.registration_invites
   where code = v_code;

  if not found or v_invite.revoked_at is not null then
    return query select false, 'invite_invalid'::text;
    return;
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    return query select false, 'invite_expired'::text;
    return;
  end if;
  if v_invite.uses_count >= v_invite.max_uses then
    return query select false, 'invite_used'::text;
    return;
  end if;

  return query select true, null::text;
end $$;

create or replace function public.registration_invites_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_registration_invites_touch_updated_at on public.registration_invites;
create trigger trg_registration_invites_touch_updated_at
  before update on public.registration_invites
  for each row execute function public.registration_invites_touch_updated_at();

create or replace function public.registration_invites_list()
returns table (
  id uuid,
  code text,
  label text,
  global_role_id uuid,
  global_role_name text,
  location_id uuid,
  location_name text,
  location_role_id uuid,
  location_role_name text,
  primary_admin_id uuid,
  primary_admin_name text,
  max_uses integer,
  uses_count integer,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_by_name text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select i.id,
         i.code,
         i.label,
         i.global_role_id,
         gr.name as global_role_name,
         i.location_id,
         l.name as location_name,
         i.location_role_id,
         lr.name as location_role_name,
         i.primary_admin_id,
         pa.full_name as primary_admin_name,
         i.max_uses,
         i.uses_count,
         i.expires_at,
         i.revoked_at,
         i.created_by,
         cb.full_name as created_by_name,
         i.created_at,
         i.updated_at
    from public.registration_invites i
    left join public.roles gr on gr.id = i.global_role_id
    left join public.locations l on l.id = i.location_id
    left join public.roles lr on lr.id = i.location_role_id
    left join public.profiles pa on pa.id = i.primary_admin_id
    left join public.profiles cb on cb.id = i.created_by
   where public.has_permission(auth.uid(), 'users.assign_roles') or public.has_permission(auth.uid(), 'system.manage')
   order by i.created_at desc
$$;

create or replace function public.registration_invite_create(
  p_label text,
  p_max_uses integer default 1,
  p_expires_at timestamptz default null,
  p_global_role_id uuid default null,
  p_location_id uuid default null,
  p_location_role_id uuid default null,
  p_primary_admin_id uuid default null
)
returns table (id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_id uuid;
  v_global_role public.roles%rowtype;
  v_location_role public.roles%rowtype;
begin
  perform public._require_permission('users.assign_roles');

  if p_label is null or length(btrim(p_label)) < 2 or length(btrim(p_label)) > 120 then
    raise exception 'invite_label_invalid' using errcode = '22023';
  end if;
  if coalesce(p_max_uses, 1) < 1 or coalesce(p_max_uses, 1) > 1000 then
    raise exception 'invite_max_uses_invalid' using errcode = '22023';
  end if;

  if p_global_role_id is not null then
    select * into v_global_role from public.roles where id = p_global_role_id and scope = 'global' and is_active;
    if not found then
      raise exception 'invite_global_role_invalid' using errcode = '22023';
    end if;
    if v_global_role.key in ('owner', 'tech_admin') and not public.has_permission(auth.uid(), 'system.manage') then
      raise exception 'invite_critical_role_forbidden' using errcode = '42501';
    end if;
  end if;

  if p_location_id is not null then
    if not exists (select 1 from public.locations where id = p_location_id and is_active) then
      raise exception 'invite_location_invalid' using errcode = '22023';
    end if;
    if p_location_role_id is null then
      select * into v_location_role from public.roles where key = 'location_staff' and scope = 'location' and is_active limit 1;
      p_location_role_id := v_location_role.id;
    else
      select * into v_location_role from public.roles where id = p_location_role_id and scope = 'location' and is_active;
    end if;
    if not found then
      raise exception 'invite_location_role_invalid' using errcode = '22023';
    end if;
    if v_location_role.key = 'location_staff' and p_primary_admin_id is not null then
      perform public._location_assert_admin_member(p_location_id, p_primary_admin_id);
    else
      p_primary_admin_id := null;
    end if;
  else
    p_location_role_id := null;
    p_primary_admin_id := null;
  end if;

  loop
    v_code := public.registration_invite_generate_code();
    exit when not exists (select 1 from public.registration_invites i where i.code = v_code);
  end loop;

  insert into public.registration_invites (
    code, label, max_uses, expires_at, global_role_id, location_id, location_role_id, primary_admin_id, created_by
  )
  values (
    v_code,
    btrim(p_label),
    coalesce(p_max_uses, 1),
    p_expires_at,
    p_global_role_id,
    p_location_id,
    p_location_role_id,
    p_primary_admin_id,
    auth.uid()
  )
  returning registration_invites.id into v_id;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (auth.uid(), 'registration_invite_created', 'registration_invite', v_id, jsonb_build_object(
    'max_uses', coalesce(p_max_uses, 1),
    'global_role_id', p_global_role_id,
    'location_id', p_location_id,
    'location_role_id', p_location_role_id
  ));

  return query select v_id, v_code;
end $$;

create or replace function public.registration_invite_revoke(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_permission('users.assign_roles');

  update public.registration_invites
     set revoked_at = coalesce(revoked_at, now())
   where id = p_invite_id;

  if not found then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (auth.uid(), 'registration_invite_revoked', 'registration_invite', p_invite_id, '{}'::jsonb);
end $$;

create or replace function public.registration_invite_consume(
  p_code text,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := public.registration_invite_normalize_code(p_code);
  v_invite public.registration_invites%rowtype;
  v_location_role public.roles%rowtype;
  v_legacy_location_role text;
begin
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'invite_user_not_found' using errcode = 'P0002';
  end if;
  if v_code is null then
    raise exception 'invite_invalid' using errcode = '22023';
  end if;

  select * into v_invite
    from public.registration_invites
   where code = v_code
   for update;

  if not found or v_invite.revoked_at is not null then
    raise exception 'invite_invalid' using errcode = '22023';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'invite_expired' using errcode = '22023';
  end if;
  if v_invite.uses_count >= v_invite.max_uses then
    raise exception 'invite_used' using errcode = '22023';
  end if;

  insert into public.registration_invite_uses (invite_id, user_id)
  values (v_invite.id, p_user_id)
  on conflict do nothing;

  update public.registration_invites
     set uses_count = (
       select count(*)::integer from public.registration_invite_uses where invite_id = v_invite.id
     )
   where id = v_invite.id;

  if v_invite.global_role_id is not null then
    insert into public.user_global_roles (user_id, role_id, assigned_by)
    values (p_user_id, v_invite.global_role_id, v_invite.created_by)
    on conflict do nothing;

    update public.profiles p
       set role = case r.key
         when 'admin' then 'admin'::public.app_role
         when 'manager' then 'manager'::public.app_role
         else p.role
       end
      from public.roles r
     where p.id = p_user_id
       and r.id = v_invite.global_role_id
       and r.scope = 'global';
  end if;

  if v_invite.location_id is not null and v_invite.location_role_id is not null then
    select * into v_location_role
      from public.roles
     where id = v_invite.location_role_id
       and scope = 'location'
       and is_active;
    if found then
      v_legacy_location_role := case v_location_role.key
        when 'location_owner' then 'owner'
        when 'location_admin' then 'admin'
        when 'location_manager' then 'manager'
        else 'staff'
      end;

      insert into public.location_members (location_id, user_id, role, role_id, primary_admin_id)
      values (
        v_invite.location_id,
        p_user_id,
        v_legacy_location_role,
        v_invite.location_role_id,
        case when v_legacy_location_role = 'staff' then v_invite.primary_admin_id else null end
      )
      on conflict (location_id, user_id) do update
        set role = excluded.role,
            role_id = excluded.role_id,
            primary_admin_id = excluded.primary_admin_id,
            updated_at = now();
    end if;
  end if;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (v_invite.created_by, 'registration_invite_consumed', 'profile', p_user_id, jsonb_build_object(
    'invite_id', v_invite.id,
    'location_id', v_invite.location_id,
    'global_role_id', v_invite.global_role_id,
    'location_role_id', v_invite.location_role_id
  ));
end $$;

create or replace function public.registration_invite_apply_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select public.registration_invite_normalize_code(u.raw_user_meta_data ->> 'invite_code')
    into v_code
    from auth.users u
   where u.id = new.id;

  if v_code is null then
    if public.registration_invites_required() then
      raise exception 'invite_required' using errcode = '22023';
    end if;
    return new;
  end if;

  perform public.registration_invite_consume(v_code, new.id);
  return new;
end $$;

drop trigger if exists trg_registration_invite_apply_from_profile on public.profiles;
create trigger trg_registration_invite_apply_from_profile
  after insert on public.profiles
  for each row execute function public.registration_invite_apply_from_profile();

revoke all on function public.registration_invite_normalize_code(text) from public, anon, authenticated;
revoke all on function public.registration_invites_required() from public, anon, authenticated;
revoke all on function public.registration_invite_generate_code() from public, anon, authenticated;
revoke all on function public.registration_invite_validate(text) from public;
revoke all on function public.registration_invites_touch_updated_at() from public, anon, authenticated;
revoke all on function public.registration_invites_list() from public, anon;
revoke all on function public.registration_invite_create(text, integer, timestamptz, uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.registration_invite_revoke(uuid) from public, anon;
revoke all on function public.registration_invite_consume(text, uuid) from public, anon, authenticated;
revoke all on function public.registration_invite_apply_from_profile() from public, anon, authenticated;

grant execute on function public.registration_invites_list() to authenticated;
grant execute on function public.registration_invite_create(text, integer, timestamptz, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.registration_invite_revoke(uuid) to authenticated;
grant execute on function public.registration_invite_validate(text) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.registration_invites;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

commit;

-- Manual verification after apply:
-- 1. As admin/tech_admin, call registration_invite_create(...) and confirm it returns a code.
-- 2. Register via /register?invite=<code>; confirm profile is created and invite uses_count increments.
-- 3. Confirm the assigned user_global_roles/location_members row appears only according to invite settings.
-- 4. Confirm max_uses and expires_at reject additional signups with friendly gateway/UI copy.
-- 5. If you want invite-only registration, enable:
--      alter database postgres set app.registration_invites_required = 'on';
