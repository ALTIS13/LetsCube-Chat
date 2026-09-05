/**
 * Repair for the UUID pattern in `public._kub_media_path_allowed`.
 *
 * The constant reads 8-4-4-12. A UUID is 8-4-4-4-12, so the pattern matches no
 * UUID that has ever existed, and the two branches guarded by it have never
 * been reachable:
 *
 *   avatars/{target_user_id}/...   an administrator replacing someone's picture
 *   chat-avatars/{chat_id}/...     a group or channel picture
 *
 * The other branches compare strings rather than matching, which is why message
 * media and a person's own avatar always worked and this stayed invisible.
 * Measured on production with a real session: `is_chat_admin(chat_id)` returned
 * true, the chat id failed the live four-group pattern and passed the correct
 * five-group one, and the predicate returned false. The only thing standing
 * between an administrator of a chat and their own chat's avatar path was the
 * missing group.
 *
 * This predates the bot-avatar outage repaired in
 * 20260905140000_bot_avatar_policy_repair.sql and is unrelated to it: that one
 * denied every upload with a permission error, this one silently refuses two
 * paths with an RLS violation. Fixing the first is what made the second
 * visible.
 *
 * The body below is the live definition with one character class inserted and
 * nothing else changed. `create or replace` keeps the existing privileges, so
 * the ACL — postgres, service_role and authenticated may execute — is carried
 * across untouched.
 */

create or replace function public._kub_media_path_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'storage'
as $function$
declare
  v_parts text[] := storage.foldername(p_name);
  v_first text := v_parts[1];
  v_second text := v_parts[2];
  v_target public.profiles%rowtype;
  v_actor_critical boolean;
  -- 8-4-4-4-12. The third group of four was missing, so this matched nothing.
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

  -- Admin-managed profile avatar: avatars/{target_user_id}/...
  if v_first = 'avatars'
     and coalesce(v_second, '') ~* v_uuid_re then
    select * into v_target
    from public.profiles
    where id = v_second::uuid;

    if not found then
      return false;
    end if;

    v_actor_critical :=
      public.has_global_role(auth.uid(), 'owner')
      or public.has_global_role(auth.uid(), 'tech_admin')
      or public.has_permission(auth.uid(), 'system.manage');

    return v_actor_critical
      or (
        (public.has_permission(auth.uid(), 'users.manage') or public.has_permission(auth.uid(), 'media.moderate'))
        and v_target.role <> 'admin'::public.app_role
        and not public.has_global_role(v_target.id, 'owner')
        and not public.has_global_role(v_target.id, 'tech_admin')
      );
  end if;

  -- Group/channel avatar: chat-avatars/{chat_id}/...
  if v_first = 'chat-avatars'
     and coalesce(v_second, '') ~* v_uuid_re then
    return public.is_chat_admin(v_second::uuid);
  end if;

  return false;
end
$function$;

-- ── Refuse to succeed unless the pattern actually accepts a UUID ─────────────
-- The defect was a constant that looked right at a glance and matched nothing.
-- A check that a canonical UUID passes the pattern now in the deployed function
-- is the one assertion that could not have been satisfied before.
do $$
declare
  v_pattern text;
  v_sample constant text := gen_random_uuid()::text;
begin
  select substring(pg_get_functiondef(p.oid) from 'v_uuid_re constant text := ''([^'']+)''')
  into v_pattern
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '_kub_media_path_allowed';

  if v_pattern is null then
    raise exception 'repair failed: could not read the pattern back out of the function';
  end if;
  if v_sample !~* v_pattern then
    raise exception 'repair failed: pattern % still rejects a real uuid', v_pattern;
  end if;
  -- And it must still reject something that is not one, or the repair would
  -- have opened the branch to any folder name at all.
  if 'not-a-uuid' ~* v_pattern or repeat('a', 36) ~* v_pattern then
    raise exception 'repair failed: pattern % accepts a non-uuid', v_pattern;
  end if;
end
$$;
