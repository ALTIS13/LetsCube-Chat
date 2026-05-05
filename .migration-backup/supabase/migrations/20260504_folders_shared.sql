-- Personal & Shared Folders (Part 6)
--
-- Extends `folders` with a `scope` (personal | shared | system) and an
-- explicit `created_by`, then rewrites folder + folder_chats RLS so that
-- shared folders are visible to every user who is a member of at least
-- one chat that the folder contains, while personal folders stay
-- strictly owner-only.
--
-- This migration is idempotent: it can be re-applied without errors.
-- Depends on the SECURITY DEFINER helpers from
-- `20260504_roles_admin.sql` (`is_manager_or_admin`, `is_banned`).

-- ── 1. scope enum + columns ───────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'folder_scope') then
    create type public.folder_scope as enum ('personal', 'shared', 'system');
  end if;
end $$;

alter table public.folders
  add column if not exists scope public.folder_scope not null default 'personal';

-- `created_by` mirrors `user_id` for legacy rows and is the canonical
-- "who owns this folder" reference going forward.  We keep `user_id`
-- around so existing code paths and the banned-user veto policy keep
-- working; new code writes both columns and policies use whichever is
-- non-null via coalesce().
alter table public.folders
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

update public.folders
   set created_by = user_id
 where created_by is null;

create index if not exists idx_folders_scope on public.folders(scope);
create index if not exists idx_folders_created_by on public.folders(created_by);

-- ── 2. shared-visibility helper ──────────────────────────────────────────
-- SECURITY DEFINER so the SELECT policy on `folders` doesn't recurse
-- through `folder_chats` policies (which themselves reference `folders`).
--
-- Hardening: the function intentionally has NO user-id argument.  An
-- earlier draft accepted a caller-supplied `uid`, which would have let
-- any authenticated user probe arbitrary chat memberships ("is user X
-- in chat Y?") simply by passing another UUID.  Pinning to auth.uid()
-- closes that hole; access is also revoked from `anon` so unauth
-- requests can't enumerate either.
create or replace function public.can_see_shared_folder(fid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.folder_chats fc
      join public.chat_members cm on cm.chat_id = fc.chat_id
     where fc.folder_id = fid
       and cm.user_id = auth.uid()
  )
$$;

-- Drop the previous (insecure) signature if a stale copy exists from an
-- earlier run of this migration.
drop function if exists public.can_see_shared_folder(uuid, uuid);

revoke all on function public.can_see_shared_folder(uuid) from public, anon;
grant execute on function public.can_see_shared_folder(uuid) to authenticated;

-- ── 3. drop legacy folder policies, install scope-aware ones ──────────────
drop policy if exists "Users manage own folders" on public.folders;
drop policy if exists "folders select scope-aware" on public.folders;
drop policy if exists "folders insert scope-aware" on public.folders;
drop policy if exists "folders update scope-aware" on public.folders;
drop policy if exists "folders delete scope-aware" on public.folders;

-- SELECT
--   personal → owner only (staff explicitly has NO read access to other
--              users' personal folders — privacy)
--   shared   → managers/admins + the creator + anyone who is a member of
--              at least one chat the folder contains
--   system   → everyone (reserved for future "official" folders)
create policy "folders select scope-aware"
  on public.folders for select
  using (
    (scope = 'personal' and user_id = auth.uid())
    or (
      scope = 'shared' and (
        public.is_manager_or_admin(auth.uid())
        or coalesce(created_by, user_id) = auth.uid()
        or public.can_see_shared_folder(id)
      )
    )
    or scope = 'system'
  );

-- INSERT — the actor must own the row, and only managers/admins may
-- create non-personal folders.
create policy "folders insert scope-aware"
  on public.folders for insert
  with check (
    user_id = auth.uid()
    and coalesce(created_by, user_id) = auth.uid()
    and (
      scope = 'personal'
      or public.is_manager_or_admin(auth.uid())
    )
  );

-- UPDATE / DELETE share the same matrix:
--   personal → owner only
--   shared   → managers/admins or the original creator
--   system   → admins only
create policy "folders update scope-aware"
  on public.folders for update
  using (
    (scope = 'personal' and user_id = auth.uid())
    or (
      scope = 'shared' and (
        public.is_manager_or_admin(auth.uid())
        or coalesce(created_by, user_id) = auth.uid()
      )
    )
    or (scope = 'system' and public.is_admin(auth.uid()))
  )
  with check (
    (scope = 'personal' and user_id = auth.uid())
    or (
      scope = 'shared' and (
        public.is_manager_or_admin(auth.uid())
        or coalesce(created_by, user_id) = auth.uid()
      )
    )
    or (scope = 'system' and public.is_admin(auth.uid()))
  );

create policy "folders delete scope-aware"
  on public.folders for delete
  using (
    (scope = 'personal' and user_id = auth.uid())
    or (
      scope = 'shared' and (
        public.is_manager_or_admin(auth.uid())
        or coalesce(created_by, user_id) = auth.uid()
      )
    )
    or (scope = 'system' and public.is_admin(auth.uid()))
  );

-- ── 4. folder_chats — visibility derived from parent folder ──────────────
drop policy if exists "Users manage own folder_chats" on public.folder_chats;
drop policy if exists "folder_chats select scope-aware" on public.folder_chats;
drop policy if exists "folder_chats insert scope-aware" on public.folder_chats;
drop policy if exists "folder_chats delete scope-aware" on public.folder_chats;

create policy "folder_chats select scope-aware"
  on public.folder_chats for select
  using (
    exists (
      select 1 from public.folders f
       where f.id = folder_chats.folder_id
         and (
           (f.scope = 'personal' and f.user_id = auth.uid())
           or (
             f.scope = 'shared' and (
               public.is_manager_or_admin(auth.uid())
               or coalesce(f.created_by, f.user_id) = auth.uid()
               or public.can_see_shared_folder(f.id)
             )
           )
           or f.scope = 'system'
         )
    )
  );

create policy "folder_chats insert scope-aware"
  on public.folder_chats for insert
  with check (
    exists (
      select 1 from public.folders f
       where f.id = folder_chats.folder_id
         and (
           (f.scope = 'personal' and f.user_id = auth.uid())
           or (
             f.scope = 'shared' and (
               public.is_manager_or_admin(auth.uid())
               or coalesce(f.created_by, f.user_id) = auth.uid()
             )
           )
           or (f.scope = 'system' and public.is_admin(auth.uid()))
         )
    )
  );

create policy "folder_chats delete scope-aware"
  on public.folder_chats for delete
  using (
    exists (
      select 1 from public.folders f
       where f.id = folder_chats.folder_id
         and (
           (f.scope = 'personal' and f.user_id = auth.uid())
           or (
             f.scope = 'shared' and (
               public.is_manager_or_admin(auth.uid())
               or coalesce(f.created_by, f.user_id) = auth.uid()
             )
           )
           or (f.scope = 'system' and public.is_admin(auth.uid()))
         )
    )
  );

-- Banned-user vetos for folders / folder_chats are already installed by
-- 20260504_roles_admin.sql (it iterates over a list that includes both
-- tables) so no extra restrictive policy is required here.

-- ── 5. realtime publication (no-op if already added) ─────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'folders'
  ) then
    execute 'alter publication supabase_realtime add table public.folders';
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'folder_chats'
  ) then
    execute 'alter publication supabase_realtime add table public.folder_chats';
  end if;
  -- chat_members membership changes also affect which shared folders a
  -- user can see; the React app subscribes to it for realtime refresh.
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'chat_members'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_members';
  end if;
end $$;
