-- KUB: secure chat media access proposal
-- Date: 2026-05-06
--
-- Purpose:
--   Move NEW message attachments to a private Storage bucket whose object
--   paths include chat_id, and add message columns needed for signed URL reads.
--
-- Important:
--   This migration is a proposal. Apply manually in Supabase SQL Editor only
--   after reviewing compatibility/backfill notes. It does not migrate legacy
--   public media_url files.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  false,
  104857600,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'audio/webm',
    'audio/ogg',
    'audio/mpeg',
    'application/pdf'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.messages
  add column if not exists media_bucket text,
  add column if not exists media_path text;

create index if not exists idx_messages_media_path
  on public.messages (media_bucket, media_path)
  where media_path is not null;

create or replace function public._kub_chat_media_chat_id(p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_first text := (storage.foldername(p_name))[1];
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if coalesce(v_first, '') !~* v_uuid_re then
    return null;
  end if;
  return v_first::uuid;
end;
$$;

create or replace function public._kub_can_access_chat_media_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.chat_members cm
      where cm.chat_id = public._kub_chat_media_chat_id(p_name)
        and cm.user_id = auth.uid()
    )
    and not public.is_banned(auth.uid());
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'chat media members can read'
  ) then
    create policy "chat media members can read"
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'chat-media'
        and public._kub_can_access_chat_media_path(name)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'chat media members can upload'
  ) then
    create policy "chat media members can upload"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'chat-media'
        and public._kub_can_access_chat_media_path(name)
      );
  end if;
end $$;

grant execute on function public._kub_chat_media_chat_id(text) to authenticated;
grant execute on function public._kub_can_access_chat_media_path(text) to authenticated;

commit;

-- Verify SQL:
-- select id, public, file_size_limit, allowed_mime_types
-- from storage.buckets
-- where id in ('media', 'chat-media');
--
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'storage'
--   and tablename = 'objects'
--   and policyname like 'chat media%';
--
-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'messages'
--   and column_name in ('media_bucket', 'media_path');
--
-- Manual QA:
-- 1. Upload new media to chat-media/{chat_id}/... as a chat member.
-- 2. Create a signed URL as another member of the same chat.
-- 3. Verify a non-member cannot read or sign the object.
-- 4. Verify avatars in the existing public media bucket still render.
--
-- Rollback/compatibility notes:
-- - This migration does not delete old public media URLs.
-- - To pause rollout, keep frontend writing legacy media_url and ignore
--   media_bucket/media_path.
-- - Full rollback can drop chat-media policies and nullable columns only after
--   confirming no new media depends on them.
