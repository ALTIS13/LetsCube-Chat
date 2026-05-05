-- =====================================================================
-- KUB folders policy cleanup
-- =====================================================================
-- Idempotent migration proposal. Apply manually in Supabase SQL Editor.
--
-- Current state from MCP:
--   Scope-aware folders/folder_chats policies are installed, but older
--   *_own permissive policies still exist. They duplicate checks and are
--   reported by Supabase Performance Advisor as multiple permissive policies.
--
-- Goal:
--   Keep the scope-aware shared-folder model as the single source of truth.
--   Do not disable RLS.
-- =====================================================================

drop policy if exists "folders_select_own" on public.folders;
drop policy if exists "folders_insert_own" on public.folders;
drop policy if exists "folders_update_own" on public.folders;
drop policy if exists "folders_delete_own" on public.folders;

drop policy if exists "folder_chats_select_own" on public.folder_chats;
drop policy if exists "folder_chats_insert_own" on public.folder_chats;
drop policy if exists "folder_chats_delete_own" on public.folder_chats;

-- Keep the expected policies present if this cleanup is applied on a DB
-- where only the old policy names existed.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'folders'
      and policyname = 'folders select scope-aware'
  ) then
    raise exception 'Missing folders select scope-aware policy. Apply 20260504_folders_shared.sql first.';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'folder_chats'
      and policyname = 'folder_chats select scope-aware'
  ) then
    raise exception 'Missing folder_chats select scope-aware policy. Apply 20260504_folders_shared.sql first.';
  end if;
end $$;

-- Verify SQL:
--
-- select tablename, policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('folders', 'folder_chats')
-- order by tablename, policyname;
--
-- Manual QA:
-- 1. Personal folder is visible only to owner.
-- 2. Shared folder is visible to members of at least one chat inside it.
-- 3. Creator/staff can edit shared folder; unrelated ordinary user cannot.
-- 4. Add/remove chat from folder does not fail or uncheck unexpectedly.
