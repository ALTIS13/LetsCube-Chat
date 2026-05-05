-- ============================================================
-- NeoGram Database Schema
-- Run this in Supabase SQL Editor
-- ============================================================

create extension if not exists "uuid-ossp";

-- ─── PROFILES ───────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  username    text unique,
  full_name   text,
  avatar_url  text,
  bio         text,
  phone       text,
  online_at   timestamptz default now(),
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by everyone"
  on public.profiles for select using (true);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── CHATS ──────────────────────────────────────────────────
create table if not exists public.chats (
  id          uuid default uuid_generate_v4() primary key,
  type        text check (type in ('private','group','channel')) not null,
  name        text,
  description text,
  avatar_url  text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null
);

alter table public.chats enable row level security;

-- NOTE: policy referencing chat_members added AFTER that table is created below

create policy "Authenticated users can create chats"
  on public.chats for insert with check (auth.uid() is not null);

-- ─── CHAT MEMBERS ───────────────────────────────────────────
create table if not exists public.chat_members (
  chat_id      uuid references public.chats(id) on delete cascade,
  user_id      uuid references public.profiles(id) on delete cascade,
  role         text check (role in ('owner','admin','member')) default 'member',
  joined_at    timestamptz default now() not null,
  last_read_at timestamptz,
  primary key (chat_id, user_id)
);

alter table public.chat_members enable row level security;

create policy "Members can view chat_members"
  on public.chat_members for select using (
    user_id = auth.uid() or
    exists (
      select 1 from public.chat_members cm
      where cm.chat_id = chat_members.chat_id and cm.user_id = auth.uid()
    )
  );

create policy "Users can join chats"
  on public.chat_members for insert with check (auth.uid() is not null);

create policy "Users can update own membership"
  on public.chat_members for update using (user_id = auth.uid());

-- Now safe to add chats select policy (chat_members exists)
create policy "Chat members can view chats"
  on public.chats for select using (
    exists (
      select 1 from public.chat_members
      where chat_id = chats.id and user_id = auth.uid()
    )
  );

-- ─── MESSAGES ───────────────────────────────────────────────
create table if not exists public.messages (
  id                  uuid default uuid_generate_v4() primary key,
  chat_id             uuid references public.chats(id) on delete cascade not null,
  user_id             uuid references public.profiles(id) on delete set null,
  content             text,
  type                text check (type in ('text','image','video','audio','file','sticker','system')) default 'text',
  media_url           text,
  reply_to_id         uuid references public.messages(id) on delete set null,
  forwarded_from_id   uuid references public.messages(id) on delete set null,
  edited_at           timestamptz,
  deleted_at          timestamptz,
  pinned              boolean default false,
  created_at          timestamptz default now() not null
);

alter table public.messages enable row level security;

create policy "Chat members can view messages"
  on public.messages for select using (
    exists (
      select 1 from public.chat_members
      where chat_id = messages.chat_id and user_id = auth.uid()
    )
  );

create policy "Chat members can send messages"
  on public.messages for insert with check (
    auth.uid() = user_id and
    exists (
      select 1 from public.chat_members
      where chat_id = messages.chat_id and user_id = auth.uid()
    )
  );

create policy "Users can edit own messages"
  on public.messages for update using (user_id = auth.uid());

-- ─── REACTIONS ──────────────────────────────────────────────
create table if not exists public.reactions (
  id          uuid default uuid_generate_v4() primary key,
  message_id  uuid references public.messages(id) on delete cascade not null,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  emoji       text not null,
  created_at  timestamptz default now() not null,
  unique(message_id, user_id, emoji)
);

alter table public.reactions enable row level security;

create policy "Anyone in chat can view reactions"
  on public.reactions for select using (true);

create policy "Users can add reactions"
  on public.reactions for insert with check (auth.uid() = user_id);

create policy "Users can remove own reactions"
  on public.reactions for delete using (auth.uid() = user_id);

-- ─── FOLDERS ────────────────────────────────────────────────
create table if not exists public.folders (
  id         uuid default uuid_generate_v4() primary key,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  name       text not null,
  emoji      text,
  position   int default 0,
  created_at timestamptz default now() not null
);

alter table public.folders enable row level security;

create policy "Users can manage own folders"
  on public.folders for all using (auth.uid() = user_id);

create table if not exists public.folder_chats (
  folder_id uuid references public.folders(id) on delete cascade,
  chat_id   uuid references public.chats(id) on delete cascade,
  primary key (folder_id, chat_id)
);

alter table public.folder_chats enable row level security;

create policy "Users can manage own folder_chats"
  on public.folder_chats for all using (
    exists (
      select 1 from public.folders
      where id = folder_chats.folder_id and user_id = auth.uid()
    )
  );

-- ─── REALTIME ───────────────────────────────────────────────
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.reactions;
alter publication supabase_realtime add table public.profiles;

-- ─── INDEXES ────────────────────────────────────────────────
create index if not exists messages_chat_id_idx on public.messages(chat_id, created_at desc);
create index if not exists messages_user_id_idx on public.messages(user_id);
create index if not exists chat_members_user_id_idx on public.chat_members(user_id);
create index if not exists reactions_message_id_idx on public.reactions(message_id);
