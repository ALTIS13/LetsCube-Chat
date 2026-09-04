-- Give roles a rank and a colour, so the panel can show a hierarchy instead of
-- an alphabetical list.
--
-- Asked for by the owner on 2026-09-04: roles should sort by importance, "от
-- основателя который может трогать кого и что угодно, до обычных
-- пользователей", and carry configurable colours — the shape a Discord user
-- expects. `roles` had neither column, so the panel could only sort by key,
-- which puts `admin` above `owner` and tells the reader nothing.
--
-- `priority`: higher is more important. Deliberately NOT unique — two roles
-- sharing a rank is meaningful here. `owner` and `tech_admin` both sit at 100
-- because their parity is a decision (see `20260904070000`), and showing them
-- side by side at the same rank is the honest way to draw it.
--
-- The scale leaves gaps so a role can be inserted between two others without
-- renumbering the table.
--
--   100  owner, tech_admin      full access, by design equal
--    80  admin                  legacy bridge
--    60  manager                operational
--    10  user                   everyone
--
-- Location and chat scopes are ranked within themselves; they are separate
-- ladders and are never compared against the global one.
--
-- IMPORTANT: priority is presentation, not authority. Nothing in
-- `has_permission` or `has_location_permission` reads it, and this migration
-- does not change either. A role does not become more powerful by being moved
-- up the list — that is exactly the confusion a visible hierarchy can create,
-- so the column comment says so and a test asserts the functions ignore it.
--
-- `colour`: a hex string the panel renders as the role's swatch and badge
-- tint. Seeded from the existing brand tokens rather than invented, so the
-- admin panel keeps looking like the product. Constrained to `#rrggbb` so a
-- stray value cannot become an injection vector in a style attribute.
--
-- Additive: two nullable-then-defaulted columns, one check constraint, one
-- index, and seed values. No permission, assignment or policy is touched.

alter table public.roles
  add column if not exists priority integer not null default 0,
  add column if not exists colour text;

alter table public.roles
  drop constraint if exists roles_colour_format_check;

alter table public.roles
  add constraint roles_colour_format_check
  check (colour is null or colour ~ '^#[0-9a-fA-F]{6}$');

comment on column public.roles.priority is
  'Display rank only: higher sorts first within a scope. Ties are allowed and meaningful — owner and tech_admin share 100 because their equality is deliberate. NOTHING about access reads this column; has_permission and has_location_permission ignore it entirely, and moving a role up this list does not grant it anything.';

comment on column public.roles.colour is
  'Hex #rrggbb for the role''s swatch in the admin panel and its badge on a profile. Constrained by roles_colour_format_check so it can be interpolated into a style attribute safely. Null means the panel picks a neutral.';

-- Sorting the picker is the whole point, and it always sorts within a scope.
create index if not exists roles_scope_priority_idx
  on public.roles (scope, priority desc, name);

update public.roles set priority = v.priority, colour = v.colour
from (values
  -- global: the ladder the owner described
  ('owner',            100, '#F5B50A'),  -- kub-warn, the founder tier
  ('tech_admin',       100, '#4d8bd0'),  -- kub-cyan, equal rank on purpose
  ('admin',             80, '#f04a92'),  -- kub-pink
  ('manager',           60, '#4DCD5E'),  -- kub-online
  ('user',              10, null),       -- neutral: it is everybody
  -- location: its own ladder, never compared with the global one
  ('location_owner',    50, '#F5B50A'),
  ('location_admin',    40, '#f04a92'),
  ('location_manager',  30, '#4DCD5E'),
  ('location_staff',    20, '#4d8bd0'),
  ('location_client',   10, null),
  -- chat: inactive since 20260904060000, ranked so the list stays readable
  ('chat_owner',        50, '#F5B50A'),
  ('chat_admin',        40, '#f04a92'),
  ('chat_member',       10, null)
) as v(key, priority, colour)
where public.roles.key = v.key;

-- A role added later must not silently land at the bottom next to `user`.
-- 0 is below every seeded rank, which is the safe default for something
-- nobody has ranked yet, and the panel shows unranked roles last.

-- Let an administrator actually set them.
--
-- `roles` is closed to direct UPDATE by policy ("roles update blocked"), so
-- every write goes through this `security definer` RPC. It gains two optional
-- parameters; the existing four-argument call sites keep working unchanged,
-- and a null means "leave as is" rather than "clear", because the panel saves
-- the name and description from a form that does not carry the colour.
--
-- The permission check, the system-role protection and the last-owner guard are
-- carried over verbatim. Priority and colour are cosmetic, but they are written
-- through the same gate as everything else rather than through a looser one.

-- The old signature must go first. Adding parameters with defaults creates an
-- OVERLOAD rather than replacing the function, and a four-argument call — which
-- is what every current call site makes — would then match both and fail as
-- ambiguous. Dropping by exact signature leaves nothing else behind.
drop function if exists public.role_update(uuid, text, text, boolean);

create or replace function public.role_update(
  p_role_id uuid,
  p_name text,
  p_description text default null::text,
  p_is_active boolean default true,
  p_priority integer default null::integer,
  p_colour text default null::text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.roles%rowtype;
begin
  perform public._require_permission('roles.manage');
  select * into v_role from public.roles where id = p_role_id for update;
  if not found then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  if v_role.is_system and coalesce(p_is_active, true) = false then
    raise exception 'system_role_protected' using errcode = '42501';
  end if;
  if v_role.key in ('owner', 'tech_admin')
     and coalesce(p_is_active, true) = false
     and public._critical_role_count(v_role.key) <= 1 then
    raise exception 'last_%', v_role.key using errcode = '42501';
  end if;
  -- Rejected here as well as by the constraint, so the caller gets a name for
  -- the problem instead of a constraint violation.
  if p_colour is not null and p_colour !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'colour_must_be_hex' using errcode = '22023';
  end if;

  update public.roles
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         is_active = case when is_system then true else coalesce(p_is_active, true) end,
         priority = coalesce(p_priority, priority),
         colour = coalesce(p_colour, colour)
   where id = p_role_id;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (auth.uid(), 'role_updated', 'role', p_role_id,
          jsonb_build_object('name', p_name, 'is_active', p_is_active,
                             'priority', p_priority, 'colour', p_colour));
end $function$;

revoke all on function public.role_update(uuid, text, text, boolean, integer, text) from public, anon;
grant execute on function public.role_update(uuid, text, text, boolean, integer, text) to authenticated;
