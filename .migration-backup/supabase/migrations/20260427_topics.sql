-- Forum topics inside group chats.
--
-- A "forum" chat (is_forum = true) is partitioned into named topics; every
-- message belongs to exactly one topic.  Non-forum chats keep working as
-- before — for them topic_id stays NULL.
--
-- The default topic auto-created when forum mode is enabled is marked with
-- is_general = true and cannot be deleted.

create table if not exists public.topics (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats(id) on delete cascade,
  name        text not null,
  emoji       text,
  is_general  boolean not null default false,
  position    integer not null default 0,
  archived    boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_topics_chat on public.topics (chat_id, position);
-- At most one general topic per chat.
create unique index if not exists uniq_topics_general
  on public.topics (chat_id) where is_general;

alter table public.chats
  add column if not exists is_forum boolean not null default false;

alter table public.messages
  add column if not exists topic_id uuid references public.topics(id) on delete cascade;

create index if not exists idx_messages_topic on public.messages (topic_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.topics enable row level security;

-- Anyone in the chat can read its topics.
create policy "members read topics"
  on public.topics for select
  using (
    exists (
      select 1 from public.chat_members m
      where m.chat_id = topics.chat_id and m.user_id = auth.uid()
    )
  );

-- Only owners and admins can create / update / delete topics.
create policy "admins manage topics"
  on public.topics for all
  using (
    exists (
      select 1 from public.chat_members m
      where m.chat_id = topics.chat_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.chat_members m
      where m.chat_id = topics.chat_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- ── Realtime ───────────────────────────────────────────────────────────────
-- Make sure topics are broadcast through the realtime publication so the
-- TopicStrip in the client reflects new/edited topics live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'topics'
  ) then
    execute 'alter publication supabase_realtime add table public.topics';
  end if;
end $$;
