/**
 * `roles.colour` holds a palette key, so the colour an administrator picks can
 * reach a pixel somebody can see (D-214).
 *
 * WRITTEN, NOT APPLIED. Nothing here has been run against production. It needs
 * the owner's decision first, and it needs the client change named at the
 * bottom to land in the same step — applied alone it takes every swatch in the
 * administration panel neutral, because `normalizeRoleColour` in
 * `lib/roleHierarchy.ts` answers null for anything that is not six hex digits.
 *
 * WHAT WAS MEASURED, 2026-09-19, read-only on production.
 *
 * `roles.colour` is written by exactly one thing — `public.role_update`'s
 * `p_colour`, from the free `<input type="color">` in `RolesPermissionsTab` —
 * and read by exactly two: `public.profile_badges`, which hands it to the
 * client, and the panel itself. No view mentions the table. Thirteen rows, ten
 * with a colour:
 *
 *     #F5B50A x3   #f04a92 x3   #4DCD5E x2   #4d8bd0 x2   null x3
 *
 * On the client `projectProfileBadges` carries the value into
 * `ProfileBadge.colour` and **no call site reads it**: `ProfileBadgeChip` takes
 * its tone from `badgeTone(family, key)`, which answers `pink` for `owner` and
 * `tech_admin`, `cyan` for the rest and `muted` for every medal. So the four
 * colours cross the wire and are dropped.
 *
 * THE COLOUR DOES REACH PIXELS — fifteen of them, all inside the administration
 * panel, and the register's «never reaches a pixel» was wrong about that. Read
 * off the running panel at 1440 in both themes: ten 12x12 swatches with a 1px
 * ring in the roles list, and five 6x6 **unringed** dots in the global-role
 * assignment list, where `dot={!swatch}` replaces `KubBadge`'s own tone dot —
 * the one its header calls «load-bearing rather than decorative». Against the
 * composited ground those five measure
 *
 *     dark  rgb(5,11,24):     gold 10.77   blue 5.55
 *     light rgb(233,239,246): gold  1.58   blue 3.06
 *
 * so in the light theme three of the five sit at 1.58:1, under the 3:1 a mark
 * needs and far under it.
 *
 * WHY A KEY AND NOT A HEX, measured rather than argued. A free `#rrggbb` column
 * holds ONE value and this product has TWO themes, so the question «is this
 * colour legible» has no single answer and the column cannot carry both. Three
 * ways out were measured and two fail:
 *
 *   - **Use the hex as it stands.** The four seeded values read 9.94 / 5.12 /
 *     5.27 / 8.82 on the dark surfaces and 1.83 / 3.55 / 3.44 / 2.06 on the
 *     light ones. They are the DARK palette's own tokens, reused in a theme
 *     nobody measured them in.
 *   - **Compose it toward the theme's text colour**, as `chatRoleColourOnChat`
 *     does for the conversation wallpaper. Swept from 100% to 30%: the four
 *     seeded values do not all clear 4.5:1 until **50%** — 55% leaves the gold
 *     at 4.12:1 — by which point half of the administrator's colour is gone
 *     and `#F5B50A` has become the olive `#7e6315`. And it cannot work in
 *     general, because the picker accepts any hex: `#FFFFFF` composed 80%
 *     toward the light theme's text still measures **1.28:1**, and `#000000`
 *     composed 80% toward the dark theme's text measures **1.11:1**.
 *   - **Give the mark a ring** so it keeps an edge whatever it holds.
 *     `--kub-border-color` is `rgba(66,127,194,0.24)` in the light theme, which
 *     composites to about 1.3:1 against that ground — thinner than the fill it
 *     was meant to rescue.
 *
 * So the value has to be a NAME the interface resolves per theme, and that is
 * not a new idea in this product: `chat_roles.colour` has held exactly such a
 * key since `20260918120000_chat_roles_and_member_tags.sql`, bounded by
 * `chat_roles_colour_palette_key`, with eight entries in
 * `lib/chatRolePalette.ts` and a `--kub-role-<key>` token in BOTH theme blocks
 * of `index.css`, each pinned at **4.5:1 as text** on `--kub-surface`,
 * `--kub-surface-2` and `--kub-surface-3` by
 * `tests/unit/chat-role-palette.test.mts`. That palette was chosen on D-214's
 * own evidence. This migration stops the two scopes disagreeing: one palette,
 * one contract, one test.
 *
 * THE MAPPING IS MEASURED, NOT GUESSED. Each seeded hex is matched to the
 * palette entry nearest it in CIELAB (dE*ab, CIE76) against that entry's DARK
 * token, because the hexes are dark-theme values. The nearest is unambiguous in
 * every case — the runner-up is two to five times further away:
 *
 *     #F5B50A -> amber  13.7   (next: orange 40.6)
 *     #4d8bd0 -> blue   13.2   (next: violet 29.8)
 *     #f04a92 -> rose   29.9   (next: violet 53.1)
 *     #4DCD5E -> green   5.5   (next: teal   62.4)
 *
 * `user`, `location_client` and `chat_member` hold null and keep it: null is
 * «the panel picks a neutral», which is still true.
 *
 * OWNER. `public.roles` is owned by `postgres`, but `public.role_update` is
 * owned by **`supabase_admin`** and `postgres` is not a member of that role, so
 * `create or replace function` on it fails as `postgres`. Apply the whole
 * transaction as `supabase_admin`. This is the same trap
 * `20260905140000_bot_avatar_policy_repair.sql` records.
 *
 * LOCK. The constraint swap takes ACCESS EXCLUSIVE on `public.roles` for the
 * length of the transaction; `lock_timeout` gives up after five seconds rather
 * than queueing behind a long one. The table has 13 rows.
 *
 * REHEARSED, 2026-09-19, on a throwaway PostgreSQL 18.4 cluster carrying
 * stand-in `roles`, `role_update`, `profile_badges` and `audit_logs` objects
 * and the thirteen rows' key/scope/colour distribution. Applied verbatim: ten
 * rows moved, the self-check passed, the three nulls stayed null. Afterwards
 * the function refused `#123456` with `colour_must_be_palette_key`, accepted
 * `teal`, accepted the unknown-but-well-shaped `purple` — which is why the
 * client has to render an unknown key plain rather than error — and a direct
 * `update ... set colour = '#ff0000'` was refused by the constraint. The
 * rollback then ran verbatim: nine rows took their hexes back and the one row
 * holding a key the rollback table does not know went null, exactly as its own
 * header says. Two things the rehearsal could NOT cover: the ownership trap
 * (there is no `supabase_admin` on a throwaway cluster) and whether the live
 * `role_update` body is the one reproduced here.
 *
 * Both strings this file compares whole were read off that cluster rather than
 * assumed, and one of them contradicted a confident reading of the
 * documentation: `pg_get_function_identity_arguments` DOES carry the parameter
 * names — `p_role_id uuid, p_name text, ...` — and not only the types. The
 * comment further down that says so is right. `pg_get_constraintdef` renders
 * the palette-key CHECK as the exact text the self-check expects.
 *
 * ROLLBACK: 20260919170000_a_role_colour_a_reader_can_see.rollback.sql. It
 * restores the hexes by the same table, so a role an administrator recoloured
 * between the two runs comes back as the seeded value rather than as what they
 * chose. Read the table first if that matters.
 *
 * THE CLIENT HALF THAT HAS TO LAND WITH THIS, named so it cannot be forgotten:
 *
 *   1. `lib/roleHierarchy.ts` - `roleSwatchColour` must answer
 *      `var(--kub-role-<key>)` for a palette key. Leave the hex branch in
 *      place: it costs nothing and it is what makes this migration reversible
 *      without a second client deploy.
 *   2. `pages/admin/RolesPermissionsTab.tsx` - the free `<input type="color">`
 *      and the `#rrggbb` field become the eight palette swatches. This is the
 *      only piece that MUST change at the same instant: a picker that still
 *      writes a hex meets `roles_colour_palette_key` and the save fails.
 *   3. `components/profile/ProfileBadgeChip.tsx` - a standing whose colour is a
 *      palette key takes that colour on its border and its dot;
 *      `badgeTone` stays as the answer for a standing with no colour and for
 *      every medal.
 *
 * NOT IN SCOPE, deliberately. `profile_badges` is not touched: it already
 * returns `r.colour` and needs to know nothing about what the string means. The
 * `location` and `chat` scope rows are mapped too, because leaving them on
 * hexes would put two shapes in one column for no gain — the chat-scope rows
 * are the three dead ones `20260904060000` retired and they keep their rank.
 */

begin;

set local lock_timeout = '5s';

-- A colour the mapping below has no entry for, named before the constraint
-- refuses it.
--
-- Rehearsed on a throwaway PostgreSQL 18.4 cluster carrying this table, this
-- function and these thirteen rows: with a fifth hex present the `update` moves
-- the nine it knows, `add constraint` then fails with «check constraint
-- "roles_colour_palette_key" of relation "roles" is violated by some row», and
-- the whole transaction rolls back leaving the old constraint and every value
-- exactly as they were. That is already safe. What it is not is legible — the
-- message names neither the row nor the value, and the operator is left to find
-- them. This block changes nothing about what happens, only what is said.
--
-- The four are spelled lower case and compared lower case, the same way the
-- `update` matches, because production holds `#F5B50A` and `#4DCD5E` in upper.
do $preflight$
declare
  v_unmapped text;
begin
  select string_agg(format('%s/%s = %s', scope, key, colour), ', ' order by scope, key)
    into v_unmapped
    from public.roles
   where colour is not null
     and lower(colour) not in ('#f5b50a', '#4d8bd0', '#f04a92', '#4dcd5e');
  if v_unmapped is not null then
    raise exception 'a colour with no palette entry: %. Measure it against lib/chatRolePalette.ts in CIELAB the way the four below were measured, add the pair here, and re-read this check; do not guess a near-enough key.', v_unmapped;
  end if;
end
$preflight$;

-- The old constraint next: an `update` to a key would violate it, and a new
-- CHECK is validated against existing rows when it is added, so the data has to
-- move in between.
alter table public.roles
  drop constraint if exists roles_colour_format_check;

update public.roles set colour = v.key
  from (values
    ('#F5B50A', 'amber'),
    ('#4d8bd0', 'blue'),
    ('#f04a92', 'rose'),
    ('#4DCD5E', 'green')
  ) as v(hex, key)
 where lower(public.roles.colour) = lower(v.hex);

alter table public.roles
  add constraint roles_colour_palette_key
  check (colour is null or colour ~ '^[a-z][a-z0-9_]{1,31}$');

comment on column public.roles.colour is
  'A palette key out of lib/chatRolePalette.ts, never a hex: the interface owns the two theme values behind the name. Bounded by roles_colour_palette_key, the same shape chat_roles.colour carries. Null means the panel picks a neutral. A key this build of the client does not know renders plain rather than erroring (D-214).';

-- `role_update` reproduced from the LIVE definition read off production on
-- 2026-09-19, not from the migration that first created it: `20260904100000`
-- changed the `is_active` handling afterwards and the file in this directory
-- does not carry that. The only edit is the colour validation, four lines down
-- from the bottom of the guards.
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
  -- Rejected here as well as by the constraint, so the caller gets a name for
  -- the problem instead of a constraint violation. The shape is the key's, not
  -- a hex's: a colour is chosen from a palette the interface can measure in
  -- both themes, and a free hex cannot be measured in either (D-214).
  if p_colour is not null and p_colour !~ '^[a-z][a-z0-9_]{1,31}$' then
    raise exception 'colour_must_be_palette_key' using errcode = '22023';
  end if;

  update public.roles
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         -- Null means "not mentioned", not "switch on". The guard above is what
         -- keeps a system role from being switched off.
         is_active = coalesce(p_is_active, is_active),
         priority = coalesce(p_priority, priority),
         colour = coalesce(p_colour, colour)
   where id = p_role_id;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (auth.uid(), 'role_updated', 'role', p_role_id,
          jsonb_build_object('name', p_name, 'is_active', p_is_active,
                             'priority', p_priority, 'colour', p_colour));
end $function$;

-- The grants are re-stated rather than assumed: `create or replace` keeps them,
-- and this is here so that a future reader can see what they are supposed to be
-- without going to find the original.
revoke all on function public.role_update(uuid, text, text, boolean, integer, text) from public, anon;
grant execute on function public.role_update(uuid, text, text, boolean, integer, text) to authenticated;

do $check$
declare
  v_coloured integer;
  v_blank integer;
  v_bad integer;
  v_body text;
  v_acl text;
begin
  if exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.roles'::regclass and conname = 'roles_colour_format_check'
  ) then
    raise exception 'the hex constraint is still on the table';
  end if;

  -- Compared whole, not with LIKE. In LIKE an `_` is a single-character
  -- wildcard and `[` is an ordinary character, so a pattern spelled
  -- '%[a-z][a-z0-9_]{1,31}%' would also match a predicate that is not this
  -- one. The expected text is `chat_roles_colour_palette_key`'s own, read off
  -- production, so the two scopes are pinned to the same shape by construction.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.roles'::regclass
       and conname = 'roles_colour_palette_key'
       and pg_get_constraintdef(oid) =
           'CHECK (((colour IS NULL) OR (colour ~ ''^[a-z][a-z0-9_]{1,31}$''::text)))'
  ) then
    raise exception 'the palette-key constraint is missing or is not the shape chat_roles carries: %',
      coalesce((select pg_get_constraintdef(oid) from pg_catalog.pg_constraint
                 where conrelid = 'public.roles'::regclass and conname = 'roles_colour_palette_key'),
               '<absent>');
  end if;

  -- Nothing lost and nothing invented: ten rows carried a colour before this
  -- ran and three did not, and a mapping that dropped one would otherwise be
  -- invisible.
  select count(*) filter (where colour is not null),
         count(*) filter (where colour is null)
    into v_coloured, v_blank
    from public.roles;
  if v_coloured <> 10 or v_blank <> 3 then
    raise exception 'expected 10 coloured and 3 blank roles, found % and %', v_coloured, v_blank;
  end if;

  select count(*) into v_bad from public.roles
   where colour is not null and colour !~ '^[a-z][a-z0-9_]{1,31}$';
  if v_bad <> 0 then
    raise exception '% role(s) still carry something that is not a palette key', v_bad;
  end if;

  -- The four mappings by name, because a count cannot tell «all four moved»
  -- from «one moved four times».
  if (select colour from public.roles where key = 'owner' and scope = 'global') is distinct from 'amber' then
    raise exception 'owner did not take amber';
  end if;
  if (select colour from public.roles where key = 'tech_admin' and scope = 'global') is distinct from 'blue' then
    raise exception 'tech_admin did not take blue';
  end if;
  if (select colour from public.roles where key = 'admin' and scope = 'global') is distinct from 'rose' then
    raise exception 'admin did not take rose';
  end if;
  if (select colour from public.roles where key = 'manager' and scope = 'global') is distinct from 'green' then
    raise exception 'manager did not take green';
  end if;
  if (select colour from public.roles where key = 'user' and scope = 'global') is not null then
    raise exception 'the role everybody holds was given a colour';
  end if;

  -- The function still refuses what it refused and now refuses a hex. Read off
  -- the body rather than by calling it: calling it needs `roles.manage` and a
  -- session, and this check runs as whoever is applying the migration.
  -- The signature is named as well as the name. `20260904080000` had to drop a
  -- four-argument overload before adding these two parameters, precisely
  -- because two overloads make a four-argument call ambiguous; a second one
  -- reappearing would make this `select into` raise «more than one row»,
  -- which is a worse message than the truth.
  --
  -- The identity string carries the parameter NAMES, not only the types —
  -- read off production rather than assumed, because the first draft of this
  -- check spelled 'uuid, text, text, boolean, integer, text' and would have
  -- raised on a migration that had worked perfectly. Pinning the names is
  -- worth having anyway: PostgREST calls this by parameter name, so a rename
  -- breaks every caller while the types still match.
  select p.prosrc into v_body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'role_update'
     and pg_get_function_identity_arguments(p.oid) =
         'p_role_id uuid, p_name text, p_description text, p_is_active boolean, p_priority integer, p_colour text';
  -- `strpos`, not LIKE, for the same reason as the constraint above: every one
  -- of these needles carries an underscore, and LIKE would read each of them as
  -- «any character».
  if v_body is null then
    raise exception 'role_update is gone, or no longer has the six-argument signature';
  end if;
  if strpos(v_body, 'colour_must_be_hex') > 0 then
    raise exception 'role_update still validates a hex';
  end if;
  if strpos(v_body, 'colour_must_be_palette_key') = 0 then
    raise exception 'role_update does not validate a palette key';
  end if;
  if strpos(v_body, '_require_permission(''roles.manage'')') = 0 then
    raise exception 'role_update lost its permission gate';
  end if;
  if strpos(v_body, '_critical_role_count') = 0 then
    raise exception 'role_update lost its last-owner guard';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'role_update' and p.prosecdef
  ) then
    raise exception 'role_update is no longer security definer';
  end if;

  -- A null `proacl` means «default privileges», which for a function is EXECUTE
  -- to PUBLIC: the opposite of what the revoke above exists for. It has to
  -- raise rather than fall through a comparison against null, which is neither
  -- true nor false and would let this check pass in silence.
  select array_to_string(p.proacl, ',') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'role_update'
     and pg_get_function_identity_arguments(p.oid) =
         'p_role_id uuid, p_name text, p_description text, p_is_active boolean, p_priority integer, p_colour text';
  if v_acl is null then
    raise exception 'role_update carries no explicit grants, so PUBLIC can execute it';
  end if;
  if v_acl not like '%authenticated=X%' then
    raise exception 'authenticated cannot execute role_update any more: %', v_acl;
  end if;
  if v_acl like '%anon=X%' then
    raise exception 'anon can execute role_update: %', v_acl;
  end if;

  -- `profile_badges` is the read path and must be exactly as it was.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'profile_badges'
       and p.prosrc like '%r.colour%'
  ) then
    raise exception 'profile_badges no longer returns the role colour';
  end if;
end
$check$;

commit;
