/**
 * Per-group roles: a named tag that means something inside one group and
 * nowhere else.
 *
 * D-215. A group has exactly three levels of standing and no fourth thing.
 * Measured on production on 2026-09-18: `chat_members.role` is the enum
 * `chat_member_role = owner | admin | member`, NOT NULL, default `member`, with
 * no CHECK constraint because the type is the constraint. That is the whole of
 * what a group can say about a person, and it is the same three words in every
 * group.
 *
 * **What this file is not.** `public.roles` carries three chat-scope rows —
 * `chat_owner`, `chat_admin`, `chat_member` — seeded on 2026-05-14, all three
 * `is_active = false` with zero holders, retired by
 * `20260904060000_roles_retire_dead_tiers_and_club_naming.sql`. Re-activating
 * them would look cheap and would not work: `roles.colour` is one colour shared
 * by every holder of that role, so it cannot express one person's tag in one
 * group. D-168 and the roles-and-badges proposal both say so; the register says
 * it a third time because it is the move everybody reaches for. This migration
 * does not touch those rows, and its self-check asserts it did not.
 *
 * ── The shape, and the five things production said about it ──────────────────
 *
 * 1. **The composite foreign key is the whole mechanism, and the key it needs
 *    already exists.** `chat_members_pkey` is `PRIMARY KEY (chat_id, user_id)`,
 *    backed by a unique index of that name. So
 *
 *        foreign key (chat_id, user_id)
 *          references public.chat_members (chat_id, user_id) on delete cascade
 *
 *    is accepted as written, and leaving a group drops the tags with the
 *    membership. No trigger, no sweeper, no nightly job. `chat_members delete`
 *    already lets a person delete their own row, which is what leaving is, and
 *    a referential action bypasses row security, so the cascade fires for a
 *    member removing themselves exactly as it does for an administrator
 *    removing them.
 *
 * 2. **A second composite key, which the proposal did not have, and without
 *    which a tag from one group renders in another.** The design as written in
 *    `docs/proposals/2026-09-13-roles-and-badges.md` §4.3 gives
 *    `chat_member_roles.role_id` a plain `references chat_roles(id)`. Nothing
 *    then ties the row's `chat_id` to the role's `chat_id`: an administrator of
 *    chat A could insert `(A, person, <a role belonging to chat B>)` and chat
 *    A's member list would draw chat B's name and colour. That is the exact
 *    defect `voice_channels_category_fkey` was built to prevent four days ago,
 *    and the fix is the same one — a unique key on `(chat_id, id)` turning the
 *    rule into a schema fact instead of a hope:
 *
 *        constraint chat_roles_chat_id_id_key unique (chat_id, id)
 *        ...
 *        foreign key (chat_id, role_id)
 *          references public.chat_roles (chat_id, id) on delete cascade
 *
 *    Both columns are NOT NULL, so MATCH SIMPLE has no null row to wave
 *    through. It also makes the private-chat guard below transitive: a tag can
 *    only name a role that exists in its own chat.
 *
 * 3. **Private chats have owners, so "inside a group" is not what the schema
 *    would have enforced.** 27 private chats, 24 of them carrying an `owner`
 *    row — the artefact `20260911120000_private_chat_owner_delete_repair.sql`
 *    describes, where whoever opens a private conversation becomes its owner.
 *    `is_chat_admin` is therefore true for one side of most private chats, and
 *    an ungated `chat_roles` would let that side invent a tag and pin it on the
 *    other person, in a two-person conversation, with no group to appeal to.
 *    The 2026-09-11 repair closed the same class of hole by requiring
 *    `type <> 'private'`; this file requires it too, in
 *    `private.enforce_chat_role_rules`. It is a trigger rather than a policy
 *    predicate on purpose: a new `public.` predicate would be a new callable
 *    RPC on the API surface, and the `private` schema grants USAGE to nobody
 *    but postgres.
 *
 * 4. **The write gate is split, and the split is copied from a rule that is
 *    already in the database.** `enforce_chat_member_update` lets an
 *    administrator flip a member to admin and back, and refuses them the owner
 *    in either direction. Personnel is an administrator's job; the group's
 *    vocabulary is a step above it. So:
 *
 *      - `chat_roles` (inventing, renaming, recolouring, reordering, deleting a
 *        tag) is `is_chat_owner(chat_id)`;
 *      - `chat_member_roles` (handing an existing tag to somebody) is
 *        `is_chat_admin(chat_id)`, which is precisely the power
 *        `chat_members insert` / `chat_members update` already grant them.
 *
 *    This deployment has exactly one non-owner `admin` row across all 13
 *    groups, so owner-only costs one person one power today, and widening it
 *    later is one policy; narrowing it after a group has built a vocabulary is
 *    not. A global moderator holding `chats.moderate` is deliberately not given
 *    either gate — moderating a conversation and rewriting a group's own words
 *    are different powers.
 *
 * 5. **`colour` holds a palette key, not a hex.** D-214 measured the global
 *    catalogue's free hex values against the three surfaces a chip sits on,
 *    with the arithmetic `tests/unit/status-badge-contrast.test.mjs` uses:
 *    owner `#F5B50A` reads 1.83 / 1.63 / 1.50 in the light theme against a 3:1
 *    floor for non-text, and manager `#4DCD5E` reads 2.06 / 1.83 / 1.69. Those
 *    colours were taken from the dark palette. A free `^#[0-9a-fA-F]{6}$`
 *    column here would reproduce that defect once per group, with nobody to
 *    audit it. The constraint therefore bounds the *shape of a key*, the way
 *    `roles_badge_icon_format_check` bounds an icon name it cannot enumerate in
 *    SQL, and the interface owns the palette and its two theme values. An
 *    unrecognised key renders plain — principle 5 of the proposal, and the rule
 *    `canRenderCosmetic` already applies to decorations.
 *
 * ── Conventions this file follows rather than invents ────────────────────────
 *
 * - **Policies.** Six per table, byte-for-byte the set `topics`,
 *   `voice_channels` and `chat_channel_categories` carry: one permissive
 *   `for select to authenticated using (is_chat_member(chat_id))`, one
 *   permissive `for all`, and the four restrictive ban vetoes. Nothing new is
 *   spelled inline; `is_chat_member`, `is_chat_admin`, `is_chat_owner` and
 *   `is_banned` are all `stable security definer set search_path = public`,
 *   owned by postgres, with EXECUTE held by `authenticated`.
 *
 * - **Grants, and the 2026-09-11 revoke.** Read off `pg_default_acl` on
 *   2026-09-18: `postgres`'s default privileges in `public` still hand `anon`
 *   and `authenticated` `arwd` — INSERT, SELECT, UPDATE, DELETE — on every new
 *   table, while TRUNCATE, TRIGGER and REFERENCES were removed from the
 *   defaults by `20260911130000_revoke_unfiltered_table_privileges.sql`. So
 *   `create table` publishes these tables to `anon` on its own and a narrower
 *   grant afterwards adds nothing. They are revoked first, then granted, the
 *   way `20260914140000_channel_categories.sql` does it, and the self-check
 *   asserts both halves: `anon` reaches neither table, and `authenticated`
 *   holds none of the three unfiltered privileges.
 *
 * - **The grant matches the policy.** `voice_channels` is the warning:
 *   "admins manage voice channels" is `for all`, and `authenticated` holds
 *   SELECT, INSERT and DELETE but **not UPDATE**, so renaming or reordering a
 *   voice channel is refused by a privilege check the policy never sees.
 *   Measured 2026-09-18, and worth its own register entry. Both tables here
 *   grant all four and the self-check counts them.
 *
 * - **`priority`, not `position`.** Every per-chat ordered list in this database
 *   uses `position integer not null default 0`, ascending, with no unique
 *   constraint and a tiebreaker in the index. The name here is `priority`
 *   because that is what the design asked for and what `roles.priority` and
 *   `lib/roleHierarchy.ts` mean: a rank read downwards, not a place in a list.
 *   The *mechanics* are the house ones — not unique, reordered by a plain
 *   multi-row UPDATE, ties broken deterministically by the index. Like
 *   `roles.priority`, it decides order and pixels and grants nothing.
 *
 * - **`updated_at` is not trigger-maintained**, because it is not on `topics`,
 *   `voice_channels` or `chat_channel_categories` either. Whoever updates the
 *   row sets it.
 *
 * - **Realtime.** Both tables join the `supabase_realtime` publication, owned
 *   by `postgres`. Without it the member list never updates itself, which is
 *   the defect `20260906130000_publish_permissions_table.sql` records. Note
 *   that `chat_channel_categories` was *not* published on 2026-09-14 and
 *   `topics` and `voice_channels` were — that inconsistency is somebody else's
 *   entry, not this file's business. Both tables have replica identity
 *   `default`, which is their primary key, so UPDATE and DELETE carry a key.
 *
 * - **Permissions on a chat role are not here.** A table nothing evaluates is
 *   what `20260904060000` had to clean up. `chat_role_permissions` and
 *   `has_chat_permission` arrive with the function that reads them.
 *
 * ── Before applying ─────────────────────────────────────────────────────────
 *
 * Take and verify a schema backup first. Then run
 * `20260918120000_chat_roles_and_member_tags.rehearsal.sql`, which measures the
 * refusals as real `authenticated` sessions inside `begin; … rollback;` — a
 * policy measured as its own table's owner is not measured at all — and aborts
 * rather than reporting success if a control case fails.
 *
 * Run as `postgres`. Nothing here touches `voice_channels`, so the
 * `supabase_admin` ownership problem `20260914140000` hit does not arise;
 * the self-check asserts the owner anyway.
 *
 * Rollback: `20260918120000_chat_roles_and_member_tags.rollback.sql`.
 */

begin;

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A group's own vocabulary.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.chat_roles (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  name text not null,
  colour text,
  icon text,
  priority integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_roles_name_length
    check (char_length(btrim(name)) between 1 and 32),
  constraint chat_roles_colour_palette_key
    check (colour is null or colour ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint chat_roles_icon_format
    check (icon is null or icon ~ '^[a-zA-Z][a-zA-Z0-9]{0,39}$'),
  constraint chat_roles_chat_id_id_key unique (chat_id, id)
);

comment on table public.chat_roles is
  'A tag a group defines for itself: a name, a palette key, an icon name and a '
  'rank. Presentation only — it grants nothing. Scoped to one chat by chat_id, '
  'and refused entirely in a private chat.';

comment on column public.chat_roles.colour is
  'A key into the palette the interface defines, never a hex value. D-214 '
  'measured the global catalogue''s free hex colours at 1.50-2.06 against a 3:1 '
  'floor in the light theme, because they were taken from the dark palette; a '
  'free hex column here would repeat that once per group. An unrecognised key '
  'renders plain.';

comment on column public.chat_roles.icon is
  'A KubIcon name. The union cannot be expressed in SQL, so the shape is bounded '
  'the way roles.badge_icon is and an unrecognised name renders plain.';

comment on column public.chat_roles.priority is
  'Order and pixels, and nothing else — the same promise roles.priority makes. '
  'Read downwards, highest first. Not unique: ties are broken by name.';

comment on column public.chat_roles.updated_at is
  'Set by whoever updates the row. There is no touch trigger, matching topics, '
  'voice_channels and chat_channel_categories.';

-- One name per group, compared folded and trimmed, so «Модератор» and
-- «  модератор » cannot both exist and mean different things.
create unique index if not exists chat_roles_chat_name_idx
  on public.chat_roles (chat_id, lower(btrim(name)));

-- The ladder read for one chat. Total and stable: name is unique per chat, so
-- (priority desc, name) never leaves two rows tied.
create index if not exists chat_roles_chat_priority_idx
  on public.chat_roles (chat_id, priority desc, name);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Who wears which tag.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.chat_member_roles (
  chat_id uuid not null,
  user_id uuid not null,
  role_id uuid not null,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (chat_id, user_id, role_id),
  constraint chat_member_roles_member_fkey
    foreign key (chat_id, user_id)
    references public.chat_members (chat_id, user_id) on delete cascade,
  constraint chat_member_roles_role_fkey
    foreign key (chat_id, role_id)
    references public.chat_roles (chat_id, id) on delete cascade
);

comment on table public.chat_member_roles is
  'A (chat, person, tag) row. The composite key onto chat_members means leaving '
  'the group drops the tags with the membership, with no trigger and no '
  'sweeper; the composite key onto chat_roles means a tag can never name a role '
  'belonging to a different chat.';

-- The primary key's leading (chat_id, user_id) already answers "every tag of
-- every member of this chat" in one index scan, which is the member-list query.
-- This one answers the other direction — every holder of one role — and is the
-- index the role_id cascade needs when a tag is deleted.
create index if not exists chat_member_roles_chat_role_idx
  on public.chat_member_roles (chat_id, role_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Grants. Revoked before anything is granted: this deployment's default
--    privileges hand anon and authenticated arwd on every new table in public
--    (pg_default_acl, read 2026-09-18), so create table has already published
--    both tables to anon and a narrower grant afterwards would add nothing.
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.chat_roles from anon, authenticated;
revoke all on public.chat_member_roles from anon, authenticated;

grant select, insert, update, delete on public.chat_roles to authenticated;
grant select, insert, update, delete on public.chat_member_roles to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Row level security. Six policies per table, the set topics,
--    voice_channels and chat_channel_categories already carry, expressed in
--    the predicates that already exist.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.chat_roles enable row level security;
alter table public.chat_member_roles enable row level security;

drop policy if exists "members read chat roles" on public.chat_roles;
create policy "members read chat roles"
  on public.chat_roles for select to authenticated
  using (public.is_chat_member(chat_id));

drop policy if exists "owners manage chat roles" on public.chat_roles;
create policy "owners manage chat roles"
  on public.chat_roles for all to authenticated
  using (public.is_chat_owner(chat_id))
  with check (public.is_chat_owner(chat_id));

drop policy if exists "block banned reads" on public.chat_roles;
create policy "block banned reads"
  on public.chat_roles as restrictive for select to authenticated
  using (not public.is_banned(auth.uid()));

drop policy if exists "block banned writes (insert)" on public.chat_roles;
create policy "block banned writes (insert)"
  on public.chat_roles as restrictive for insert to authenticated
  with check (not public.is_banned(auth.uid()));

drop policy if exists "block banned writes (update)" on public.chat_roles;
create policy "block banned writes (update)"
  on public.chat_roles as restrictive for update to authenticated
  using (not public.is_banned(auth.uid()))
  with check (not public.is_banned(auth.uid()));

drop policy if exists "block banned writes (delete)" on public.chat_roles;
create policy "block banned writes (delete)"
  on public.chat_roles as restrictive for delete to authenticated
  using (not public.is_banned(auth.uid()));

drop policy if exists "members read chat member roles" on public.chat_member_roles;
create policy "members read chat member roles"
  on public.chat_member_roles for select to authenticated
  using (public.is_chat_member(chat_id));

drop policy if exists "admins assign chat member roles" on public.chat_member_roles;
create policy "admins assign chat member roles"
  on public.chat_member_roles for all to authenticated
  using (public.is_chat_admin(chat_id))
  with check (public.is_chat_admin(chat_id));

drop policy if exists "block banned reads" on public.chat_member_roles;
create policy "block banned reads"
  on public.chat_member_roles as restrictive for select to authenticated
  using (not public.is_banned(auth.uid()));

drop policy if exists "block banned writes (insert)" on public.chat_member_roles;
create policy "block banned writes (insert)"
  on public.chat_member_roles as restrictive for insert to authenticated
  with check (not public.is_banned(auth.uid()));

drop policy if exists "block banned writes (update)" on public.chat_member_roles;
create policy "block banned writes (update)"
  on public.chat_member_roles as restrictive for update to authenticated
  using (not public.is_banned(auth.uid()))
  with check (not public.is_banned(auth.uid()));

drop policy if exists "block banned writes (delete)" on public.chat_member_roles;
create policy "block banned writes (delete)"
  on public.chat_member_roles as restrictive for delete to authenticated
  using (not public.is_banned(auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The three rules a constraint cannot express, in the schema that grants
--    USAGE to nobody but postgres. All three follow
--    private.enforce_reaction_limit: security definer, empty search_path, fully
--    qualified names, and a machine-named exception rather than a truncation.
--
--    **The two bounds are AFTER triggers, and that is not cosmetic.** A BEFORE
--    ROW trigger's query cannot see the rows inserted earlier by its own
--    command — they carry the running command's id, so a snapshot taken inside
--    the trigger excludes them. A count checked in a BEFORE trigger therefore
--    reads 1 twenty-six times for a single twenty-six row INSERT and lets all
--    of them in, and PostgREST will happily send an array. An AFTER ROW trigger
--    fires once the command has finished and the command counter has moved, so
--    it sees the real total. `private.enforce_reaction_limit` has the BEFORE
--    shape and, as far as this file can tell, the same hole; it is not this
--    migration's to fix, but it is not a precedent to copy either.
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * A role belongs to a group, and stays in it.
 *
 * The private-chat refusal is the point. `is_chat_admin` and `is_chat_owner`
 * are both true for whoever opened a private chat — 24 of this deployment's 27
 * private chats carry such an owner row, the artefact
 * 20260911120000_private_chat_owner_delete_repair.sql describes — so without
 * this, one side of a two-person conversation could invent a tag for the other.
 */
create or replace function private.enforce_chat_role_scope()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_type text;
begin
  if tg_op = 'UPDATE' and new.chat_id is distinct from old.chat_id then
    raise exception 'chat_role_chat_immutable' using errcode = '42501';
  end if;

  select chat_row.type into v_type
    from public.chats as chat_row
   where chat_row.id = new.chat_id;

  if v_type is null then
    raise exception 'chat_role_chat_missing' using errcode = 'P0001';
  end if;

  if v_type = 'private' then
    raise exception 'chat_role_private_chat' using errcode = '42501';
  end if;

  return new;
end
$function$;

/**
 * At most twenty-five roles in one group — what a rail of tags stays readable
 * at, and what the member-list join stays cheap at.
 *
 * The advisory lock is the one `enforce_chat_member_delete` takes around the
 * last-owner count, and for the same reason: two transactions each adding the
 * twenty-sixth role cannot see each other's uncommitted row, so without it both
 * would count twenty-five and both would be let through.
 */
create or replace function private.enforce_chat_role_limit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('chat_roles:' || new.chat_id::text));

  select pg_catalog.count(*)::integer
    into v_count
    from public.chat_roles as role_row
   where role_row.chat_id = new.chat_id;

  if v_count > 25 then
    raise exception 'chat_roles_limit' using errcode = 'P0001';
  end if;

  return null;
end
$function$;

/**
 * At most five tags on one person in one group — what the strip can draw.
 *
 * There is no private-chat clause here and none is needed: the composite key
 * onto chat_roles (chat_id, id) means a row can only name a role that exists
 * in its own chat, and the scope trigger refuses to let one exist in a private
 * chat at all.
 */
create or replace function private.enforce_chat_member_role_limit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('chat_member_roles:' || new.chat_id::text || ':' || new.user_id::text));

  select pg_catalog.count(*)::integer
    into v_count
    from public.chat_member_roles as tag_row
   where tag_row.chat_id = new.chat_id
     and tag_row.user_id = new.user_id;

  if v_count > 5 then
    raise exception 'chat_member_roles_limit' using errcode = 'P0001';
  end if;

  return null;
end
$function$;

drop trigger if exists trg_enforce_chat_role_scope on public.chat_roles;
create trigger trg_enforce_chat_role_scope
  before insert or update on public.chat_roles
  for each row execute function private.enforce_chat_role_scope();

drop trigger if exists trg_enforce_chat_role_limit on public.chat_roles;
create trigger trg_enforce_chat_role_limit
  after insert on public.chat_roles
  for each row execute function private.enforce_chat_role_limit();

drop trigger if exists trg_enforce_chat_member_role_limit on public.chat_member_roles;
create trigger trg_enforce_chat_member_role_limit
  after insert on public.chat_member_roles
  for each row execute function private.enforce_chat_member_role_limit();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Realtime, or the member list never updates itself.
-- ─────────────────────────────────────────────────────────────────────────────

do $publish$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_roles'
  ) then
    alter publication supabase_realtime add table public.chat_roles;
    raise notice 'published public.chat_roles';
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_member_roles'
  ) then
    alter publication supabase_realtime add table public.chat_member_roles;
    raise notice 'published public.chat_member_roles';
  end if;
end
$publish$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. The self-check. Raises rather than committing a half-applied state.
-- ─────────────────────────────────────────────────────────────────────────────

do $check$
declare
  v_table    text;
  v_count    integer;
  v_owner    text;
  v_def      text;
  v_privilege text;
begin
  foreach v_table in array array['chat_roles', 'chat_member_roles']
  loop
    if pg_catalog.to_regclass('public.' || v_table) is null then
      raise exception 'public.% was not created', v_table;
    end if;

    select pg_catalog.pg_get_userbyid(relowner) into v_owner
      from pg_catalog.pg_class where oid = ('public.' || v_table)::regclass;
    if v_owner <> 'postgres' then
      raise exception 'public.% is owned by % rather than postgres', v_table, v_owner;
    end if;

    if not exists (
      select 1 from pg_catalog.pg_class
       where oid = ('public.' || v_table)::regclass and relrowsecurity
    ) then
      raise exception 'row level security is not on for public.%', v_table;
    end if;

    -- anon must not reach either table, despite the default privileges.
    foreach v_privilege in array array['select', 'insert', 'update', 'delete']
    loop
      if has_table_privilege('anon', 'public.' || v_table, v_privilege) then
        raise exception 'anon can still % public.%', v_privilege, v_table;
      end if;
      if not has_table_privilege('authenticated', 'public.' || v_table, v_privilege) then
        raise exception 'authenticated cannot % public.%, so a policy promises what a grant refuses',
          v_privilege, v_table;
      end if;
    end loop;

    -- And must not have picked up the three privileges RLS never filters.
    foreach v_privilege in array array['truncate', 'trigger', 'references']
    loop
      if has_table_privilege('authenticated', 'public.' || v_table, v_privilege)
         or has_table_privilege('anon', 'public.' || v_table, v_privilege) then
        raise exception 'public.% re-granted % to a public role', v_table, v_privilege;
      end if;
    end loop;

    select pg_catalog.count(*)::integer into v_count
      from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = v_table and permissive = 'RESTRICTIVE';
    if v_count <> 4 then
      raise exception 'public.% has % restrictive guards rather than four', v_table, v_count;
    end if;

    select pg_catalog.count(*)::integer into v_count
      from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = v_table and permissive = 'PERMISSIVE';
    if v_count <> 2 then
      raise exception 'public.% has % permissive policies rather than two', v_table, v_count;
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      raise exception 'public.% is not published to supabase_realtime, so the member list will not update itself',
        v_table;
    end if;
  end loop;

  -- The composite key onto the membership: the whole reason there is no sweeper.
  select pg_catalog.pg_get_constraintdef(oid) into v_def
    from pg_catalog.pg_constraint where conname = 'chat_member_roles_member_fkey';
  if v_def is null then
    raise exception 'the composite foreign key onto chat_members is missing';
  end if;
  if v_def not like '%(chat_id, user_id)%'
     or v_def not like '%REFERENCES chat_members(chat_id, user_id)%'
     or v_def not like '%ON DELETE CASCADE%' then
    raise exception 'the membership foreign key is not what it has to be: %', v_def;
  end if;

  -- The composite key onto the role: the reason a tag cannot cross groups.
  select pg_catalog.pg_get_constraintdef(oid) into v_def
    from pg_catalog.pg_constraint where conname = 'chat_member_roles_role_fkey';
  if v_def is null then
    raise exception 'the composite foreign key onto chat_roles is missing';
  end if;
  if v_def not like '%(chat_id, role_id)%'
     or v_def not like '%REFERENCES chat_roles(chat_id, id)%'
     or v_def not like '%ON DELETE CASCADE%' then
    raise exception 'a tag could name a role from another chat: %', v_def;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.chat_roles'::regclass
       and conname = 'chat_roles_chat_id_id_key' and contype = 'u'
  ) then
    raise exception 'chat_roles has no unique (chat_id, id), so the scoped foreign key cannot hold';
  end if;

  -- The policies must be the existing predicates, not a second hierarchy.
  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'chat_roles'
       and policyname = 'owners manage chat roles'
       and qual like '%is_chat_owner(chat_id)%' and with_check like '%is_chat_owner(chat_id)%'
  ) then
    raise exception 'chat_roles is not gated on is_chat_owner';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'chat_member_roles'
       and policyname = 'admins assign chat member roles'
       and qual like '%is_chat_admin(chat_id)%' and with_check like '%is_chat_admin(chat_id)%'
  ) then
    raise exception 'chat_member_roles is not gated on is_chat_admin';
  end if;
  foreach v_table in array array['chat_roles', 'chat_member_roles']
  loop
    if not exists (
      select 1 from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = v_table
         and cmd = 'SELECT' and permissive = 'PERMISSIVE'
         and qual like '%is_chat_member(chat_id)%'
    ) then
      raise exception 'public.% is not readable by is_chat_member', v_table;
    end if;
  end loop;

  -- The three rules a constraint cannot express.
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.chat_roles'::regclass
       and tgname = 'trg_enforce_chat_role_scope' and not tgisinternal
  ) then
    raise exception 'nothing refuses a chat role in a private chat';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.chat_roles'::regclass
       and tgname = 'trg_enforce_chat_role_limit' and not tgisinternal
  ) then
    raise exception 'nothing bounds the number of roles in one group';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.chat_member_roles'::regclass
       and tgname = 'trg_enforce_chat_member_role_limit' and not tgisinternal
  ) then
    raise exception 'nothing bounds the number of tags on one person';
  end if;

  -- And both bounds must be AFTER triggers, or a single multi-row insert walks
  -- straight past them: bit 2 of tgtype is BEFORE.
  if exists (
    select 1 from pg_catalog.pg_trigger
     where tgname in ('trg_enforce_chat_role_limit', 'trg_enforce_chat_member_role_limit')
       and not tgisinternal
       and (tgtype & 2) <> 0
  ) then
    raise exception 'a count bound is a BEFORE trigger, and cannot see its own statement''s rows';
  end if;

  -- The name constraint has to refuse blank, not merely bound the length.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.chat_roles'::regclass
       and conname = 'chat_roles_name_length'
       and pg_catalog.pg_get_constraintdef(oid) like '%btrim%'
  ) then
    raise exception 'a blank chat role name is not refused';
  end if;

  -- The colour column must not have become a free hex behind our back.
  select pg_catalog.pg_get_constraintdef(oid) into v_def
    from pg_catalog.pg_constraint
   where conrelid = 'public.chat_roles'::regclass and conname = 'chat_roles_colour_palette_key';
  if v_def is null or v_def like '%#%' then
    raise exception 'chat_roles.colour is not a palette key: %', coalesce(v_def, '<missing>');
  end if;

  -- And the three dead chat-scope rows in public.roles are exactly as they were.
  select pg_catalog.count(*)::integer into v_count
    from public.roles where scope = 'chat';
  if v_count <> 3 then
    raise exception 'the chat-scope roles catalogue changed: % rows rather than three', v_count;
  end if;
  if exists (select 1 from public.roles where scope = 'chat' and (is_active or badge_public)) then
    raise exception 'a dead chat-scope role was revived, which is the one thing this migration must not do';
  end if;
  if exists (
    select 1 from public.user_global_roles assignment
      join public.roles role_row on role_row.id = assignment.role_id
     where role_row.scope = 'chat'
  ) then
    raise exception 'a chat-scope role gained a holder';
  end if;

  raise notice 'a group can name its own standings; leaving the group takes the tags with it';
end
$check$;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback, verbatim, kept here as well as in the .rollback.sql file so a
-- reader of this file can see what undoing it costs. Every tag and every role
-- a group has defined is discarded; nothing else is touched, because nothing
-- else was changed.
--
-- begin;
--
-- set local lock_timeout = '5s';
--
-- do $unpublish$
-- begin
--   if exists (
--     select 1 from pg_publication_tables
--      where pubname = 'supabase_realtime' and schemaname = 'public'
--        and tablename = 'chat_member_roles'
--   ) then
--     alter publication supabase_realtime drop table public.chat_member_roles;
--   end if;
--   if exists (
--     select 1 from pg_publication_tables
--      where pubname = 'supabase_realtime' and schemaname = 'public'
--        and tablename = 'chat_roles'
--   ) then
--     alter publication supabase_realtime drop table public.chat_roles;
--   end if;
-- end
-- $unpublish$;
--
-- drop trigger if exists trg_enforce_chat_member_role_limit on public.chat_member_roles;
-- drop trigger if exists trg_enforce_chat_role_limit on public.chat_roles;
-- drop trigger if exists trg_enforce_chat_role_scope on public.chat_roles;
-- drop function if exists private.enforce_chat_member_role_limit();
-- drop function if exists private.enforce_chat_role_limit();
-- drop function if exists private.enforce_chat_role_scope();
--
-- drop table if exists public.chat_member_roles;
-- drop table if exists public.chat_roles;
--
-- do $check$
-- begin
--   if pg_catalog.to_regclass('public.chat_member_roles') is not null
--      or pg_catalog.to_regclass('public.chat_roles') is not null then
--     raise exception 'a table survived its own rollback';
--   end if;
--   if exists (
--     select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'private'
--        and p.proname in ('enforce_chat_role_scope', 'enforce_chat_role_limit',
--                          'enforce_chat_member_role_limit')
--   ) then
--     raise exception 'a trigger function survived its own rollback';
--   end if;
--   if (select pg_catalog.count(*) from public.roles where scope = 'chat') <> 3 then
--     raise exception 'the rollback disturbed the chat-scope roles catalogue';
--   end if;
-- end
-- $check$;
--
-- commit;
