-- Purpose:
--   Allow a global admin to manage avatar files for non-admin users without
--   exposing broad Storage writes to every authenticated user.
--
-- Current state:
--   public.profiles UPDATE already allows admin to update profile rows, but
--   public._kub_media_path_allowed only permits avatars/{auth.uid()}/... for
--   profile avatars. Therefore admin UI cannot upload a replacement avatar
--   for another user without a Storage/RLS adjustment.
--
-- Dependencies:
--   public.profiles(id, role)
--   public.is_admin(uuid)
--   storage.foldername(text)
--
-- Apply manually in Supabase SQL Editor. Do not apply automatically from Codex.

begin;

create or replace function public._kub_media_path_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path to public, storage
as $function$
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

  -- Admin-managed profile avatar for non-admin users only:
  -- avatars/{target_user_id}/...
  if v_first = 'avatars'
     and coalesce(v_second, '') ~* v_uuid_re
     and public.is_admin(auth.uid())
     and exists (
       select 1
       from public.profiles p
       where p.id = v_second::uuid
         and p.role <> 'admin'::app_role
     ) then
    return true;
  end if;

  -- Group/channel avatar: chat-avatars/{chat_id}/...
  if v_first = 'chat-avatars'
     and coalesce(v_second, '') ~* v_uuid_re then
    return public.is_chat_admin(v_second::uuid);
  end if;

  return false;
end
$function$;

commit;

-- Verify SQL:
-- 1. Confirm function body contains admin-managed avatar branch:
--    select pg_get_functiondef('public._kub_media_path_allowed(text)'::regprocedure);
--
-- 2. As admin, upload a small test avatar to:
--    avatars/{non_admin_user_id}/admin-avatar-test.webp
--    and update public.profiles.avatar_url for that non-admin user.
--
-- 3. As manager, uploading to avatars/{admin_user_id}/... must fail.
--    As ordinary user, uploading to avatars/{other_user_id}/... must fail.
--
-- Manual QA:
-- - Admin can replace/reset avatar for a non-admin user from Users admin UI
--   after frontend alignment.
-- - Manager does not see admin avatar controls and Storage rejects admin path.
-- - Ordinary users can still upload only their own avatar.
--
-- Rollback / compatibility:
-- - Restore the previous public._kub_media_path_allowed function body from
--   20260505_media_storage_path_policies.sql.
