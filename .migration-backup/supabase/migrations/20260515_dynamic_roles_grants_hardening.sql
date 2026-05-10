-- Dynamic roles grants hardening.
--
-- Proposal only. Do not apply automatically from Codex.
--
-- Why:
-- 20260514_dynamic_roles_permissions.sql enables RLS and blocks direct writes
-- with policies, but the live project still exposes broad table privileges to
-- anon/authenticated through inherited/default grants. RLS currently prevents
-- unauthorized writes, but table grants should still follow least privilege.

revoke all on table
  public.roles,
  public.permissions,
  public.role_permissions,
  public.user_global_roles
from anon, public;

revoke all on table public.location_members from anon, public;

revoke insert, update, delete, truncate, references, trigger on table
  public.roles,
  public.permissions,
  public.role_permissions,
  public.user_global_roles,
  public.location_members
from authenticated;

grant select on table
  public.roles,
  public.permissions,
  public.role_permissions,
  public.user_global_roles,
  public.location_members
to authenticated;

-- Keep role-management writes behind SECURITY DEFINER RPC.
revoke all on function public.role_create(text, text, text, text) from public, anon;
revoke all on function public.role_update(uuid, text, text, boolean) from public, anon;
revoke all on function public.role_set_permissions(uuid, text[]) from public, anon;
revoke all on function public.role_delete_or_archive(uuid) from public, anon;
revoke all on function public.user_assign_global_role(uuid, uuid) from public, anon;
revoke all on function public.user_remove_global_role(uuid, uuid) from public, anon;
revoke all on function public.location_member_assign_role(uuid, uuid, uuid, uuid) from public, anon;

grant execute on function public.role_create(text, text, text, text) to authenticated;
grant execute on function public.role_update(uuid, text, text, boolean) to authenticated;
grant execute on function public.role_set_permissions(uuid, text[]) to authenticated;
grant execute on function public.role_delete_or_archive(uuid) to authenticated;
grant execute on function public.user_assign_global_role(uuid, uuid) to authenticated;
grant execute on function public.user_remove_global_role(uuid, uuid) to authenticated;
grant execute on function public.location_member_assign_role(uuid, uuid, uuid, uuid) to authenticated;

-- Critical role assignment hardening.
--
-- Current 20260514 RPC allows any caller with users.assign_roles to assign any
-- global role. Legacy admin fallback includes users.assign_roles, so the RPC
-- should additionally protect owner/tech_admin assignments and self-escalation.
create or replace function public.user_assign_global_role(p_user_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
  v_actor uuid := auth.uid();
  v_actor_is_critical boolean;
begin
  perform public._require_permission('users.assign_roles');
  select * into v_role from public.roles where id = p_role_id and scope = 'global' and is_active;
  if not found then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  v_actor_is_critical :=
    public.has_global_role(v_actor, 'owner')
    or public.has_global_role(v_actor, 'tech_admin');

  if v_role.key in ('owner', 'tech_admin') and not v_actor_is_critical then
    raise exception 'critical_role_protected' using errcode = '42501';
  end if;

  if p_user_id = v_actor
     and not v_actor_is_critical
     and not public.has_permission(v_actor, 'roles.manage') then
    raise exception 'self_role_escalation_blocked' using errcode = '42501';
  end if;

  insert into public.user_global_roles (user_id, role_id, assigned_by)
  values (p_user_id, p_role_id, v_actor)
  on conflict do nothing;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (v_actor, 'user_global_role_assigned', 'profile', p_user_id, jsonb_build_object('role_key', v_role.key));
end $$;

create or replace function public.user_remove_global_role(p_user_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
  v_actor uuid := auth.uid();
  v_actor_is_critical boolean;
begin
  perform public._require_permission('users.assign_roles');
  select * into v_role from public.roles where id = p_role_id and scope = 'global';
  if not found then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;

  v_actor_is_critical :=
    public.has_global_role(v_actor, 'owner')
    or public.has_global_role(v_actor, 'tech_admin');

  if v_role.key in ('owner', 'tech_admin') and not v_actor_is_critical then
    raise exception 'critical_role_protected' using errcode = '42501';
  end if;
  if v_role.key in ('owner', 'tech_admin') and public._critical_role_count(v_role.key) <= 1 then
    raise exception 'last_%', v_role.key using errcode = '42501';
  end if;

  delete from public.user_global_roles
   where user_id = p_user_id
     and role_id = p_role_id;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (v_actor, 'user_global_role_removed', 'profile', p_user_id, jsonb_build_object('role_key', v_role.key));
end $$;

revoke all on function public.user_assign_global_role(uuid, uuid) from public, anon;
revoke all on function public.user_remove_global_role(uuid, uuid) from public, anon;
grant execute on function public.user_assign_global_role(uuid, uuid) to authenticated;
grant execute on function public.user_remove_global_role(uuid, uuid) to authenticated;
