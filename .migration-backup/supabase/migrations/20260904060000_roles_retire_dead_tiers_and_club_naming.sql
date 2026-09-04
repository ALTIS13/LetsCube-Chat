-- Roles cleanup: retire the tier nothing evaluates, drop the club branding,
-- and finish the legacy backfill — without changing anybody's access.
--
-- Proposal only. Do not apply automatically from Codex.
-- Apply manually in Supabase SQL Editor after review.
--
-- Measured against production on 2026-09-04 before this file was written. The
-- numbers below are the reason each change is safe; re-measure before applying
-- if the shape has moved.
--
-- What decides access today (this is the point the cleanup turns on):
--
--   has_permission(u, k) resolves in three tiers, in this order:
--     1. has_global_role(u,'owner') or has_global_role(u,'tech_admin')
--        -> returns true for EVERY permission, without reading role_permissions;
--     2. any global-scope role in user_global_roles whose role_permissions
--        contains k;
--     3. otherwise _legacy_role_has_permission(profiles.role, k) — a hardcoded
--        list inside the function, NOT read from role_permissions.
--
--   Consequences, all verified in production:
--     - owner and tech_admin are identical because tier 1 short-circuits. Their
--       40 role_permissions rows are decorative. They cannot be told apart by
--       editing data; that needs a change to has_permission and an owner
--       decision. This migration deliberately does not touch it.
--     - the `admin` role's 23 role_permissions rows are held by nobody. Both
--       live administrators carry profiles.role='admin' AND a global
--       owner/tech_admin assignment, so they resolve at tier 1.
--     - all 14 accounts resolve to exactly two permission sets: 40 (4 accounts)
--       or 1, `chats.invite` (10 accounts). Nothing lands on 23 or 9.
--     - chat-scope roles are never evaluated anywhere: has_permission filters
--       scope='global' and has_location_permission filters scope='location'.
--       Chat access comes from chat_members.role via is_chat_admin/chat_role_of.
--     - location-scope roles ARE load-bearing: has_location_permission reads
--       their role_permissions, and _task_visible_to_current_user_v3 (the tasks
--       SELECT policy) calls it. 4 locations, 15 members, 40 tasks depend on it.
--       They are renamed here, never removed.
--
-- What this migration changes:
--   1. names/descriptions only, to remove «клуб» wording (CLAUDE.md section 7);
--   2. deactivates the three chat-scope roles that nothing evaluates;
--   3. backfills the global `user` role for 7 legacy accounts that predate the
--      trg_profiles_default_user_global_role trigger;
--   4. backfills one location_members.role_id that is NULL.
--
-- What this migration deliberately does NOT change:
--   - profiles.role for anybody. The two live administrators keep
--     profiles.role='admin' before and after, and keep their global owner /
--     tech_admin assignment, so both resolve to all 40 permissions before and
--     after. Draining profiles.role is impossible anyway while
--     trg_prevent_demoting_last_admin exists, and is_admin()/
--     is_manager_or_admin() still read it (24 RLS policies transitively).
--   - the `admin`, `manager`, `user`, `owner` or `tech_admin` role rows'
--     is_active or permissions.
--   - the one location_members row whose role text is 'staff' while its role_id
--     points at location_client. "Correcting" it would ADD tasks.view and
--     tasks.claim to that account. Widening access is out of scope; see the
--     report at the end of this file.
--
-- Every change is idempotent and re-runnable. Section 6 recomputes the full
-- effective permission matrix and aborts the transaction if a single
-- (user, permission) or (user, location, permission) cell moved.

begin;

-- ---------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.has_permission(uuid,text)') is null then
    raise exception 'has_permission(uuid,text) is missing; apply 20260514_dynamic_roles_permissions.sql first';
  end if;
  if to_regprocedure('public.has_location_permission(uuid,uuid,text)') is null then
    raise exception 'has_location_permission(uuid,uuid,text) is missing; apply 20260520_role_cleanup_task_filters_sanctions.sql first';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Before-snapshot of every effective permission decision
-- ---------------------------------------------------------------------
-- Section 6 compares against these. They are the contract: this migration is
-- permitted to change labels and bookkeeping, and nothing else.

create temporary table _roles_cleanup_global_before on commit drop as
select p.id as user_id, perm.key as permission_key
  from public.profiles p
  cross join public.permissions perm
 where public.has_permission(p.id, perm.key);

create temporary table _roles_cleanup_location_before on commit drop as
select lm.user_id, lm.location_id, perm.key as permission_key
  from public.location_members lm
  cross join public.permissions perm
 where public.has_location_permission(lm.user_id, lm.location_id, perm.key);

-- ---------------------------------------------------------------------
-- 2. Remove the computer-club branding from user-facing role names
-- ---------------------------------------------------------------------
-- These names are what the UI actually renders: getRoleLabel() in
-- artifacts/kub/src/lib/rolePermissions.ts prefers role.name over its own
-- SYSTEM_ROLE_LABEL map, so the DB string wins in the admin panel, the users
-- list and the profile panel. The replacements below are exactly the strings
-- already sitting in SYSTEM_ROLE_LABEL, so DB and client stop disagreeing.
-- name/description only — no scope, no is_active, no permissions.

update public.roles set name = 'Владелец локации'      where key = 'location_owner'   and name is distinct from 'Владелец локации';
update public.roles set name = 'Администратор локации' where key = 'location_admin'   and name is distinct from 'Администратор локации';
update public.roles set name = 'Менеджер локации'      where key = 'location_manager' and name is distinct from 'Менеджер локации';
update public.roles set name = 'Сотрудник локации'     where key = 'location_staff'   and name is distinct from 'Сотрудник локации';
update public.roles set name = 'Участник локации'      where key = 'location_client'  and name is distinct from 'Участник локации';

-- The owner description also sells clubs.
update public.roles
   set description = 'Полный доступ ко всем разделам и пользователям.'
 where key = 'owner'
   and description is distinct from 'Полный доступ ко всем разделам и пользователям.';

-- Two permission descriptions carry the same wording.
update public.permissions
   set description = 'Создание и изменение локаций.'
 where key = 'locations.manage'
   and description is distinct from 'Создание и изменение локаций.';

update public.permissions
   set description = 'Просмотр локаций и своих назначений.'
 where key = 'locations.view'
   and description is distinct from 'Просмотр локаций и своих назначений.';

-- ---------------------------------------------------------------------
-- 3. Retire the chat-scope roles
-- ---------------------------------------------------------------------
-- chat_owner / chat_admin / chat_member are the only genuinely dead rows in
-- public.roles. No function reads them: has_permission filters scope='global',
-- has_location_permission filters scope='location'. Real chat authority comes
-- from chat_members.role (enum owner/admin/member) through is_chat_admin() and
-- chat_role_of(). Their presence in public.roles only pads the admin picker.
--
-- Deactivating rather than deleting: user_global_roles.role_id and
-- location_members.role_id are FK ON DELETE CASCADE, so a DELETE would silently
-- drop assignment rows if any ever appeared. is_active=false is reversible and
-- is already the retirement mechanism role_delete_or_archive() uses for roles
-- that are in use. The UI honours it: UsersTab.tsx and RolesPermissionsTab.tsx
-- filter assignment pickers on is_active, and the role list badges the row
-- «Отключена» instead of hiding it.
--
-- Guarded: production has 0 chat-scope assignments in either table. If that is
-- ever untrue, this aborts rather than stranding somebody on a disabled role.

do $$
declare
  v_holders integer;
begin
  select (select count(*) from public.user_global_roles ugr
            join public.roles r on r.id = ugr.role_id where r.scope = 'chat')
       + (select count(*) from public.location_members lm
            join public.roles r on r.id = lm.role_id where r.scope = 'chat')
    into v_holders;

  if v_holders > 0 then
    raise exception
      'refusing to retire chat-scope roles: % assignment(s) exist; reassign them first', v_holders;
  end if;
end $$;

update public.roles
   set is_active = false
 where scope = 'chat'
   and is_active;

-- ---------------------------------------------------------------------
-- 4. Reassign the legacy accounts onto the current model
-- ---------------------------------------------------------------------
-- The owner's instruction: users left on old legacy roles get moved onto the
-- proper current ones. In this database that is not a role swap — nobody holds
-- a role being retired — it is a backfill.
--
-- trg_profiles_default_user_global_role gives every new profile the global
-- `user` role, but it was added in 20260516 and 7 accounts predate it. They
-- currently resolve through tier 3 (the legacy fallback), which grants exactly
-- 'chats.invite'. The global `user` role grants exactly 'chats.invite'. So this
-- is provably a no-op for access and makes user_global_roles complete, which is
-- what the admin panel reads to describe an account.
--
-- Scoped to profiles.role='user' on purpose: the two administrators and the two
-- other admin-tier accounts are left exactly as they are.

insert into public.user_global_roles (user_id, role_id, assigned_by)
select p.id, r.id, null
  from public.profiles p
  cross join public.roles r
 where r.key = 'user'
   and r.scope = 'global'
   and r.is_active
   and p.role = 'user'::public.app_role
   and not exists (
     select 1 from public.user_global_roles ugr where ugr.user_id = p.id
   )
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 5. Backfill the missing location_members.role_id
-- ---------------------------------------------------------------------
-- One row has role_id IS NULL and role='owner'. has_location_permission and
-- current_user_access_snapshot both already resolve it through the same CASE
-- fallback this UPDATE writes down, so the effective permissions are unchanged
-- by construction. Writing it makes the row self-describing and removes the
-- last dependency on the text fallback for that member.
--
-- The mapping is copied verbatim from has_location_permission.

update public.location_members lm
   set role_id = r.id
  from public.roles r
 where lm.role_id is null
   and r.scope = 'location'
   and r.is_active
   and r.key = case lm.role
                 when 'owner'   then 'location_owner'
                 when 'admin'   then 'location_admin'
                 when 'manager' then 'location_manager'
                 when 'client'  then 'location_client'
                 else 'location_staff'
               end;

-- ---------------------------------------------------------------------
-- 6. Prove nothing moved
-- ---------------------------------------------------------------------
-- Recompute both matrices and abort on any difference in either direction.
-- A widened grant and a lost grant both fail here.

do $$
declare
  v_gained integer;
  v_lost integer;
  v_sample text;
begin
  select count(*) into v_gained
    from (
      select p.id as user_id, perm.key as permission_key
        from public.profiles p
        cross join public.permissions perm
       where public.has_permission(p.id, perm.key)
      except
      select user_id, permission_key from _roles_cleanup_global_before
    ) gained;

  select count(*) into v_lost
    from (
      select user_id, permission_key from _roles_cleanup_global_before
      except
      select p.id, perm.key
        from public.profiles p
        cross join public.permissions perm
       where public.has_permission(p.id, perm.key)
    ) lost;

  if v_gained > 0 or v_lost > 0 then
    raise exception
      'global permission drift: % gained, % lost — aborting', v_gained, v_lost;
  end if;

  select count(*) into v_gained
    from (
      select lm.user_id, lm.location_id, perm.key as permission_key
        from public.location_members lm
        cross join public.permissions perm
       where public.has_location_permission(lm.user_id, lm.location_id, perm.key)
      except
      select user_id, location_id, permission_key from _roles_cleanup_location_before
    ) gained;

  select count(*) into v_lost
    from (
      select user_id, location_id, permission_key from _roles_cleanup_location_before
      except
      select lm.user_id, lm.location_id, perm.key
        from public.location_members lm
        cross join public.permissions perm
       where public.has_location_permission(lm.user_id, lm.location_id, perm.key)
    ) lost;

  if v_gained > 0 or v_lost > 0 then
    raise exception
      'location permission drift: % gained, % lost — aborting', v_gained, v_lost;
  end if;

  -- The two live administrators must still hold everything.
  select string_agg(p.id::text, ', ') into v_sample
    from public.profiles p
   where p.role = 'admin'::public.app_role
     and exists (
       select 1 from public.permissions perm
        where not public.has_permission(p.id, perm.key)
     );

  if v_sample is not null then
    raise exception 'administrator lost a permission: %', v_sample;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------
-- Every section is a data-only change; no object is created or dropped, so a
-- rollback is a second UPDATE. Run inside begin/commit:
--
--   update public.roles set name = 'Владелец клуба'      where key = 'location_owner';
--   update public.roles set name = 'Администратор клуба' where key = 'location_admin';
--   update public.roles set name = 'Менеджер клуба'      where key = 'location_manager';
--   update public.roles set name = 'Работник клуба'      where key = 'location_staff';
--   update public.roles set name = 'Клиент клуба'        where key = 'location_client';
--   update public.roles set description = 'Полный бизнес-доступ ко всем клубам и пользователям.'
--     where key = 'owner';
--   update public.permissions set description = 'Создание и изменение клубов.'
--     where key = 'locations.manage';
--   update public.permissions set description = 'Просмотр клубов и своих назначений.'
--     where key = 'locations.view';
--   update public.roles set is_active = true where scope = 'chat';
--
-- Sections 4 and 5 need no rollback: both are additive and access-neutral, and
-- reverting them would only re-open the drift they closed. If a revert is
-- insisted on, delete only the rows this file created:
--
--   delete from public.user_global_roles ugr
--    using public.roles r
--    where r.id = ugr.role_id and r.key = 'user' and ugr.assigned_by is null;
--     -- CAUTION: this also removes rows written by
--     -- trg_profiles_default_user_global_role, which are indistinguishable.
--
-- Re-run hazard: 20260514_dynamic_roles_permissions.sql seeds public.roles with
-- `on conflict (key) do update set name = excluded.name, ..., is_active = true`.
-- Re-running that file restores the club names AND reactivates the chat roles,
-- silently undoing sections 2 and 3. If 20260514 is ever replayed, replay this
-- file after it. tests/unit/roles-cleanup-schema-contract.test.mjs asserts the
-- ordering requirement is documented.
--
-- ---------------------------------------------------------------------
-- Left alone on purpose — report, not a to-do
-- ---------------------------------------------------------------------
-- 1. One location_members row has role='staff' but role_id -> location_client,
--    so that member resolves to 2 permissions (locations.view, chats.invite)
--    while the UI labels the membership from the text column. Aligning role_id
--    to location_staff would grant tasks.view and tasks.claim. That is a
--    widening and needs the owner to say which of the two is correct.
-- 2. Two accounts have profiles.role='user' but hold global owner/tech_admin,
--    so they are full administrators that the legacy column describes as
--    ordinary users. Any headcount taken from profiles.role alone undercounts
--    administrators by two. Changing either side moves real access, so it is
--    reported rather than fixed.
-- 3. owner and tech_admin remain indistinguishable. This is a code fact, not a
--    data fact: has_permission returns true for both before it reads any table.
--    Merging them, or giving tech_admin a smaller set, means editing
--    has_permission and deciding which of the four current holders moves. That
--    is the owner's call.
