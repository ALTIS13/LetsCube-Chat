-- =====================================================================
-- KUB media storage path policies
-- =====================================================================
-- Idempotent migration proposal. Apply manually in Supabase SQL Editor.
--
-- Current risk:
--   Bucket `media` is public and currently has broad SELECT/listing plus
--   authenticated upload into any path. Frontend now writes user avatars to
--   avatars/{auth.uid()}/..., chat avatars to chat-avatars/{chat_id}/...,
--   and message/voice files to {auth.uid()}/...
--
-- Goal:
--   Keep public object URL access for rendered media, but remove broad
--   bucket listing and enforce path ownership for uploads/updates/deletes.
-- =====================================================================

-- Keep the bucket public so existing getPublicUrl URLs continue to render.
update storage.buckets
   set public = true
 where id = 'media';

drop policy if exists "Anyone can view media" on storage.objects;
drop policy if exists "Authenticated users can upload media" on storage.objects;
drop policy if exists "media authenticated scoped read" on storage.objects;
drop policy if exists "media authenticated scoped insert" on storage.objects;
drop policy if exists "media authenticated scoped update" on storage.objects;
drop policy if exists "media authenticated scoped delete" on storage.objects;

create or replace function public._kub_media_path_allowed(p_name text)
returns boolean
language plpgsql
security definer
stable
set search_path = public, storage
as $$
declare
  v_parts text[] := storage.foldername(p_name);
  v_first text := v_parts[1];
  v_second text := v_parts[2];
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if auth.uid() is null then
    return false;
  end if;

  -- Message, voice and generic attachments: {auth.uid()}/...
  if v_first = auth.uid()::text then
    return true;
  end if;

  -- Own profile avatar: avatars/{auth.uid()}/...
  if v_first = 'avatars' and v_second = auth.uid()::text then
    return true;
  end if;

  -- Group/channel avatar: chat-avatars/{chat_id}/...
  if v_first = 'chat-avatars'
     and coalesce(v_second, '') ~* v_uuid_re then
    return public.is_chat_admin(v_second::uuid);
  end if;

  return false;
end $$;

revoke all on function public._kub_media_path_allowed(text) from public, anon;
grant execute on function public._kub_media_path_allowed(text) to authenticated;

-- Listing/select is now scoped. Public object URLs still work because the
-- bucket remains public; this policy only prevents broad authenticated list.
create policy "media authenticated scoped read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'media'
    and public._kub_media_path_allowed(name)
  );

create policy "media authenticated scoped insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'media'
    and public._kub_media_path_allowed(name)
  );

create policy "media authenticated scoped update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'media'
    and public._kub_media_path_allowed(name)
  )
  with check (
    bucket_id = 'media'
    and public._kub_media_path_allowed(name)
  );

create policy "media authenticated scoped delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'media'
    and public._kub_media_path_allowed(name)
  );

-- Verify SQL:
--
-- select name, public from storage.buckets where id = 'media';
--
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'storage'
--   and tablename = 'objects'
--   and policyname like 'media authenticated scoped%'
-- order by policyname;
--
-- select public._kub_media_path_allowed('avatars/' || auth.uid()::text || '/avatar-test.png');
--
-- Manual QA:
-- 1. User changes own avatar; avatar renders in sidebar/chat/admin.
-- 2. User cannot upload to avatars/{other_user_id}/...
-- 3. Chat owner/admin changes group avatar.
-- 4. Ordinary chat member cannot upload to chat-avatars/{chat_id}/...
-- 5. Send image/file/voice message; media renders through public URL.
