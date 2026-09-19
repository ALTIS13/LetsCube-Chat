-- Rollback for `20260919170000_a_role_colour_a_reader_can_see.sql`.
--
-- WRITTEN, NOT RUN. Neither this nor the migration it undoes has been applied.
--
-- Puts `roles.colour` back on `^#[0-9a-fA-F]{6}$` and restores the four seeded
-- hexes by the same table the migration used.
--
-- WHAT THIS CANNOT RESTORE, stated rather than discovered later: it maps a
-- palette KEY back to the hex that key was derived from, so a role somebody
-- recoloured while the palette was live comes back as the seeded value for
-- whichever key it ended on — not as the colour they chose, which never existed
-- as a hex. Read `select key, scope, colour from public.roles order by 1` first
-- if anything was changed after the migration; there is no other record of it
-- except the `role_updated` rows in `public.audit_logs`, whose `diff` carries
-- the `colour` that was sent.
--
-- A key the palette gained after the migration and that is not in the table
-- below becomes NULL, which the constraint accepts and the panel draws as a
-- neutral. That is deliberate: inventing a hex for it would be worse than
-- showing no colour.
--
-- Run it as `supabase_admin`. `public.role_update` is owned by that role and
-- `postgres` is not a member of it, so `create or replace function` fails as
-- `postgres`.
--
-- The client change has to go back with it, or every swatch in the panel goes
-- neutral again for the opposite reason.

begin;

set local lock_timeout = '5s';

alter table public.roles
  drop constraint if exists roles_colour_palette_key;

update public.roles set colour = v.hex
  from (values
    ('amber', '#F5B50A'),
    ('blue',  '#4d8bd0'),
    ('rose',  '#f04a92'),
    ('green', '#4DCD5E')
  ) as v(key, hex)
 where public.roles.colour = v.key;

-- Anything still not a hex is a key the table above does not know. Null rather
-- than a guess.
update public.roles set colour = null
 where colour is not null and colour !~ '^#[0-9a-fA-F]{6}$';

alter table public.roles
  add constraint roles_colour_format_check
  check (colour is null or colour ~ '^#[0-9a-fA-F]{6}$');

comment on column public.roles.colour is
  'Hex #rrggbb for the role''s swatch in the admin panel and its badge on a profile. Constrained by roles_colour_format_check so it can be interpolated into a style attribute safely. Null means the panel picks a neutral.';

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
  if v_role.is_system and p_is_active = false then
    raise exception 'system_role_protected' using errcode = '42501';
  end if;
  if v_role.key in ('owner', 'tech_admin')
     and p_is_active = false
     and public._critical_role_count(v_role.key) <= 1 then
    raise exception 'last_%', v_role.key using errcode = '42501';
  end if;
  if p_colour is not null and p_colour !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'colour_must_be_hex' using errcode = '22023';
  end if;

  update public.roles
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         is_active = coalesce(p_is_active, is_active),
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

do $check$
declare
  v_bad integer;
  v_body text;
begin
  if exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.roles'::regclass and conname = 'roles_colour_palette_key'
  ) then
    raise exception 'the palette-key constraint is still on the table';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.roles'::regclass and conname = 'roles_colour_format_check'
  ) then
    raise exception 'the hex constraint was not restored';
  end if;

  select count(*) into v_bad from public.roles
   where colour is not null and colour !~ '^#[0-9a-fA-F]{6}$';
  if v_bad <> 0 then
    raise exception '% role(s) still carry something that is not a hex', v_bad;
  end if;

  if (select colour from public.roles where key = 'owner' and scope = 'global') is distinct from '#F5B50A' then
    raise exception 'owner did not take its hex back';
  end if;

  select p.prosrc into v_body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'role_update';
  if v_body not like '%colour_must_be_hex%' then
    raise exception 'role_update does not validate a hex again';
  end if;
  if v_body like '%colour_must_be_palette_key%' then
    raise exception 'role_update still validates a palette key';
  end if;
end
$check$;

commit;
