-- Folders are per-user.  Each user manages only their own rows.
-- folder_chats is the junction table — RLS gates by walking through
-- folders to check ownership.

alter table public.folders enable row level security;

create policy "Users manage own folders"
  on public.folders for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.folder_chats enable row level security;

create policy "Users manage own folder_chats"
  on public.folder_chats for all
  using (
    exists (
      select 1 from public.folders f
      where f.id = folder_chats.folder_id and f.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.folders f
      where f.id = folder_chats.folder_id and f.user_id = auth.uid()
    )
  );

-- Realtime publication so folders / membership changes propagate live
-- (e.g. when a user creates a folder on another device).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'folders'
  ) then
    execute 'alter publication supabase_realtime add table public.folders';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'folder_chats'
  ) then
    execute 'alter publication supabase_realtime add table public.folder_chats';
  end if;
end $$;
