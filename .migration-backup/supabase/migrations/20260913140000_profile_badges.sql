/**
 * A global role can be worn, and somebody else can see it.
 *
 * THE OWNER, 2026-09-13: «есть роли также глобальные которые у нас отвечают за
 * работников, админов приложения и т.п, их мы можем немного видоизменить и
 * сделать по типу лычек как опять же в дискорде, в которых написано кто такой,
 * за что получил медальку … чем выше статус тем красивее иконка».
 *
 * WHAT EXISTS, and it is nearly all of it. `roles` already carries `priority`
 * and `colour`, added 2026-09-04 for this very request; `roleHierarchy.ts`
 * already orders the ladder; the administration panel already edits it; seven
 * achievements already exist with their catalogue, their criteria, their
 * granting and their evidence, and reading `user_achievements` was opened to
 * every signed-in account on 2026-09-11.
 *
 * WHAT IS MISSING is one thing, and it is a read path rather than a subsystem.
 * Measured read-only on production today: a signed-in account reading
 * `public.roles` gets its **own** rows and nothing else — «roles select scoped»
 * admits a row only to somebody holding `roles.view`, or holding that role, or
 * holding it in a location. `user_global_roles` is the same. So nobody can see
 * anybody else's standing, and `ProfileRoleSummary` — a component that already
 * draws roles as chips — is switched off for everyone but administrators and
 * shows the word «Пользователь» to the rest.
 *
 * WHAT THIS ADDS.
 *
 *   - `roles.badge_icon`, a `KubIcon` name, bounded by a regex because a union
 *     of icon names cannot be expressed in SQL. An unknown name renders plain on
 *     the client rather than breaking the strip.
 *   - `roles.badge_public`, default **false**. This is the answer to «which
 *     roles are badges», and it defaults to no: nothing about the product
 *     changes until a row is deliberately turned on. `user`, which everybody
 *     holds, stays off — Discord does not badge @everyone either.
 *   - `public.profile_badges(uuid[])`, the read path, as an RPC rather than as a
 *     widened policy.
 *
 * WHY AN RPC AND NOT A POLICY. It returns exactly the presentation fields and
 * can never return a `role_permissions` row, an `assigned_by` or an
 * `assigned_at`; `roles.view` keeps meaning what it means today, so the
 * administration panel and the two dozen policies that call `has_permission`
 * are untouched; it adds no view, so the invariant the 2026-09-11 audit
 * recorded — no view readable without `security_invoker` — still holds; and it
 * answers for a whole member list in one round trip, which is the argument
 * `current_user_access_snapshot` already made for the current user.
 *
 * ITS GUARDS, each for a named reason:
 *   - no `auth.uid()` answers nothing. Badges are for people inside the product.
 *   - more than 200 ids raises. A `security definer` function that bypasses RLS
 *     without a cap is an enumeration tool.
 *   - a banned caller answers nothing, matching the restrictive ban policies the
 *     rest of the product carries.
 *   - only `scope = 'global'`, `is_active` and `badge_public` roles.
 *   - only `active` achievements, and none for a test account — the exclusion
 *     `20260904030000_achievement_recipients_exclude_test.sql` already applies.
 *
 * `rank` is the role's `priority` for a role and `100000 - sort_order` for a
 * medal, so one sort puts roles first and keeps the catalogue's own order inside
 * the medals.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. `role_update` is left alone. The proposal
 * has it gain two parameters so the administration panel can edit the new
 * columns, and that means dropping a SECURITY DEFINER function the panel calls
 * today — the riskiest edit in the slice, for an editor nobody is waiting for.
 * The seed below sets the four badges; the editor can gain them in their own
 * change, where a mistake costs a form rather than the panel.
 *
 * OWNER. Apply as the owner of `public.roles` (postgres on this deployment).
 *
 * Lock: ALTER TABLE takes ACCESS EXCLUSIVE on `public.roles` for the length of
 * this transaction; `lock_timeout` gives up after five seconds rather than queue
 * behind a long one. The table has 13 rows.
 *
 * Rollback: 20260913140000_profile_badges.rollback.sql.
 */

begin;

set local lock_timeout = '5s';

alter table public.roles
  add column if not exists badge_icon text,
  add column if not exists badge_public boolean not null default false;

alter table public.roles
  drop constraint if exists roles_badge_icon_format_check;
alter table public.roles
  add constraint roles_badge_icon_format_check
  check (badge_icon is null or badge_icon ~ '^[a-zA-Z][a-zA-Z0-9]{0,39}$');

comment on column public.roles.badge_icon is
  'A KubIcon name, shown beside the role where it is public. Grants nothing.';
comment on column public.roles.badge_public is
  'Whether this role is shown to other people. Default false: a role is private until it is deliberately worn.';

-- The four that are worn, and the one that is not. `user` is held by everybody.
update public.roles set badge_icon = 'crown',   badge_public = true  where key = 'owner'      and scope = 'global';
update public.roles set badge_icon = 'admin',   badge_public = true  where key = 'tech_admin' and scope = 'global';
update public.roles set badge_icon = 'shield',  badge_public = true  where key = 'admin'      and scope = 'global';
update public.roles set badge_icon = 'manager', badge_public = true  where key = 'manager'    and scope = 'global';
update public.roles set badge_icon = null,      badge_public = false where key = 'user'       and scope = 'global';

create or replace function public.profile_badges(p_user_ids uuid[])
returns table (
  user_id uuid,
  kind text,
  key text,
  title text,
  detail text,
  icon text,
  colour text,
  rank integer
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $function$
declare
  v_caller uuid := auth.uid();
  v_count integer := coalesce(array_length(p_user_ids, 1), 0);
begin
  if v_caller is null then
    return;
  end if;
  if v_count > 200 then
    raise exception 'too_many_ids' using errcode = '22023';
  end if;
  if v_count = 0 then
    return;
  end if;
  if public.is_banned(v_caller) then
    return;
  end if;

  return query
    select ugr.user_id,
           'global_role'::text as kind,
           r.key,
           r.name as title,
           r.description as detail,
           r.badge_icon as icon,
           r.colour,
           r.priority as rank
      from public.user_global_roles ugr
      join public.roles r on r.id = ugr.role_id
      join public.profiles p on p.id = ugr.user_id
     where ugr.user_id = any (p_user_ids)
       and r.scope = 'global'
       and r.is_active
       and r.badge_public
       and not coalesce(p.is_test_account, false)
    union all
    select ua.user_id,
           'achievement'::text as kind,
           a.key,
           a.title,
           a.description as detail,
           a.icon,
           null::text as colour,
           (100000 - a.sort_order) as rank
      from public.user_achievements ua
      join public.achievements a on a.key = ua.achievement_key
      join public.profiles p on p.id = ua.user_id
     where ua.user_id = any (p_user_ids)
       and a.active
       and not coalesce(p.is_test_account, false);
end;
$function$;

revoke all on function public.profile_badges(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.profile_badges(uuid[]) to authenticated;

comment on function public.profile_badges(uuid[]) is
  'The badges other people may see: public global roles and granted achievements, presentation fields only (D-180).';

do $check$
declare
  v_public integer;
  v_user_public boolean;
  v_rows integer;
  v_subject uuid;
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.roles'::regclass
       and conname = 'roles_badge_icon_format_check'
  ) then
    raise exception 'the badge icon constraint is missing';
  end if;

  select count(*) into v_public
    from public.roles
   where scope = 'global' and badge_public and badge_icon is not null;
  if v_public <> 4 then
    raise exception 'expected four public global roles with an icon, found %', v_public;
  end if;

  select badge_public into v_user_public from public.roles where key = 'user' and scope = 'global';
  if v_user_public is not false then
    raise exception 'the role everybody holds was made public';
  end if;

  if not pg_catalog.has_function_privilege('authenticated', 'public.profile_badges(uuid[])', 'execute') then
    raise exception 'a signed-in account cannot call profile_badges';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.profile_badges(uuid[])', 'execute') then
    raise exception 'profile_badges is callable without signing in';
  end if;

  -- And it answers something, rather than merely existing.
  --
  -- The function is written to answer nothing when there is no caller, which is
  -- exactly the state a migration runs in: `auth.uid()` is null for
  -- `supabase_admin`. The first draft of this check therefore failed on its own
  -- guard and looked like a broken function. So the check borrows a caller --
  -- somebody who really holds a public role -- for the length of one query.
  -- And not a test account: the function excludes those on purpose, so a check
  -- that happened to pick one would fail while the function was right. Of the
  -- three accounts holding `owner` on this deployment, one is a test account,
  -- and the first draft of this check picked it.
  select ugr.user_id into v_subject
    from public.user_global_roles ugr
    join public.roles r on r.id = ugr.role_id
    join public.profiles p on p.id = ugr.user_id
   where r.scope = 'global' and r.is_active and r.badge_public
     and not coalesce(p.is_test_account, false)
   limit 1;
  if v_subject is null then
    raise exception 'nobody on this deployment holds a public global role, so nothing can be proved';
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_subject::text, 'role', 'authenticated')::text,
    true
  );
  select count(*) into v_rows from public.profile_badges(array[v_subject]);
  perform set_config('request.jwt.claims', '', true);

  if v_rows < 1 then
    raise exception 'profile_badges answered nothing for an account that holds a public role';
  end if;
end
$check$;

commit;
