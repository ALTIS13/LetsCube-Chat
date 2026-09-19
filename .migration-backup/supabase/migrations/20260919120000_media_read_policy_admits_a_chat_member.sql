-- D-208, the step the register does not have, and it comes before its step one.
--
-- NOT APPLIED. Written 2026-09-19 from read-only measurements against
-- production; nothing here has been rehearsed anywhere. It needs a verified
-- schema backup and the owner's approval before it runs.
--
-- ## Why it is needed
--
-- Signing an object requires `select` on `storage.objects`. The `media`
-- bucket's SELECT policy calls `_kub_media_path_allowed`, which admits exactly
-- four things: your own uploads under `{auth.uid()}/`, your own avatar, an
-- administrator reaching another person's avatar, and a chat *administrator*
-- reaching that chat's avatar folder. Nothing else. Measured on production on
-- 2026-09-19, as a real chat member looking at a photograph a different member
-- of the same chat had sent:
--
--     may_select_the_photo             f
--     may_select_its_preview           f
--     uploader_may_select_own_photo    t
--     uploader_may_select_its_preview  f
--
-- and `select count(*) from storage.objects` over those two names, as that
-- member, returned 0 where `postgres` sees 2. The whole `variants/` prefix
-- matches no branch of that function at all — not even for the person who
-- uploaded the original it was made from.
--
-- So what puts other people's photographs on screen today is not the policy. It
-- is the bucket's `public` flag, which is the defect. Until this runs, a client
-- switched to signed URLs would lose every photograph, video, voice message and
-- file anybody else sent, and every generated preview, thumbnail, poster and
-- 720p re-encode including its own.
--
-- ## What it does, and what it deliberately does not
--
-- It adds a *reading* predicate, `_kub_media_read_allowed`, and points only the
-- SELECT policy at it. `_kub_media_path_allowed` keeps INSERT, UPDATE and
-- DELETE and is not touched: who may write to an address and who may read it
-- are different questions, and they have been sharing one answer. Writing stays
-- exactly as narrow as it is today.
--
-- Every branch below is written against the object layout as it actually is,
-- counted on production the same day:
--
--     {owner_uuid}/{file}                                     originals + sidecars
--     avatars/{profile_id}/avatar-{uuid}.{ext}                            21
--     chat-avatars/{chat_id}/avatar-{uuid}.{ext}                           9
--     bot-avatars/{bot_id}/...                                             0
--     variants/messages/{chat_id}/{message_id}/{kind}.{ext}    412, 422/422 rows
--                                                              confirmed seg3 =
--                                                              chat_id and seg4 =
--                                                              message_id
--     variants/profiles/{profile_id}/{kind}.webp                20, 20/20 confirmed
--     variants/chats/{chat_id}/{token}/{kind}.webp               6,  6/6 confirmed
--
-- ## The one judgement call in here
--
-- An avatar — a person's, a chat's, a bot's — and a profile's avatar variants
-- are readable by **any authenticated account**, not only by someone who shares
-- a chat. That is a deliberate widening relative to the other branches and a
-- large narrowing relative to today, where they are readable by the entire
-- internet with no account at all. It is what the product already does: an
-- avatar is drawn in global search, in a member list, beside a forwarded
-- message and in a notification, none of which implies a shared chat. Tying it
-- to membership would blank pictures in all four. If that is judged too wide,
-- the branch to tighten is `avatars/` and `variants/profiles/` — and it should
-- be tightened with a measurement of which surfaces go blank, not by argument.
--
-- Rollback: `20260919120000_media_read_policy_admits_a_chat_member.rollback.sql`.

begin;

create or replace function public._kub_media_read_allowed(p_name text)
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
  v_third text := v_parts[3];
  v_uid uuid := auth.uid();
  v_suffix text;
  v_stem text;
  -- 8-4-4-4-12. Written out because a migration in this project once shipped
  -- 8-4-4-12 and two branches were unreachable for weeks without anyone
  -- noticing; see `20260905150000_media_path_uuid_pattern_repair.sql`.
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_uid is null then
    return false;
  end if;

  -- Whatever this account uploaded itself. Unchanged from the write predicate.
  if v_first = v_uid::text then
    return true;
  end if;

  -- A profile picture, and the small versions of one. Readable by any account;
  -- see the note in the header for why this branch is not tied to membership.
  if v_first = 'avatars' and coalesce(v_second, '') ~* v_uuid_re then
    return true;
  end if;
  if v_first = 'variants' and v_second = 'profiles' and coalesce(v_third, '') ~* v_uuid_re then
    return true;
  end if;

  -- A bot's picture. Same reasoning: it is drawn wherever the bot is named.
  if v_first = 'bot-avatars' and coalesce(v_second, '') ~* v_uuid_re then
    return true;
  end if;

  -- A group or channel picture, and its small versions: for its members.
  -- Today only a chat *administrator* passes, which would blank the picture for
  -- everybody else the moment the bucket stops being public.
  if v_first = 'chat-avatars' and coalesce(v_second, '') ~* v_uuid_re then
    return exists (
      select 1 from public.chat_members cm
      where cm.chat_id = v_second::uuid and cm.user_id = v_uid
    );
  end if;
  if v_first = 'variants' and v_second = 'chats' and coalesce(v_third, '') ~* v_uuid_re then
    return exists (
      select 1 from public.chat_members cm
      where cm.chat_id = v_third::uuid and cm.user_id = v_uid
    );
  end if;

  -- A message's generated variants. The path carries the chat and the message,
  -- which is exactly the pair the entry pointed at as the reason the current
  -- state is worse than "somebody needs the URL": those two ids are derivable
  -- by any member, so the address is too. Making membership the *condition*
  -- rather than the leak is the whole of the fix.
  if v_first = 'variants' and v_second = 'messages' and coalesce(v_third, '') ~* v_uuid_re then
    return exists (
      select 1
      from public.chat_members cm
      where cm.chat_id = v_third::uuid and cm.user_id = v_uid
    );
  end if;

  -- A message's own upload. The path is `{uploader}/{file}` and carries no
  -- chat, so the message row is what says which conversation it belongs to.
  -- `idx_messages_media_path` covers this lookup exactly.
  if coalesce(v_first, '') ~* v_uuid_re then
    if exists (
      select 1
      from public.messages m
      join public.chat_members cm on cm.chat_id = m.chat_id and cm.user_id = v_uid
      where m.media_bucket = 'media'
        and m.media_path = p_name
        and m.deleted_at is null
    ) then
      return true;
    end if;

    -- The sidecar preview the client uploads beside an original, at the address
    -- a reader derives from the original's own path (`originalPreviewPath`). It
    -- is in no row of its own, so it is admitted through the original it names.
    v_suffix := substring(p_name from '\.preview\.(webp|jpg)$');
    if v_suffix is not null then
      v_stem := left(p_name, length(p_name) - length('.preview.') - length(v_suffix));
      return exists (
        select 1
        from public.messages m
        join public.chat_members cm on cm.chat_id = m.chat_id and cm.user_id = v_uid
        where m.media_bucket = 'media'
          and m.user_id = v_first::uuid
          and m.deleted_at is null
          and m.media_path like v_stem || '.%'
      );
    end if;

    return false;
  end if;

  return false;
end
$function$;

alter function public._kub_media_read_allowed(text) owner to supabase_admin;
revoke all on function public._kub_media_read_allowed(text) from public;
-- The grant the bot-avatar migration forgot, which took every upload in the
-- product down for a day. See `20260905140000_bot_avatar_policy_repair.sql`.
grant execute on function public._kub_media_read_allowed(text) to authenticated;

drop policy if exists "media authenticated scoped read" on storage.objects;
create policy "media authenticated scoped read"
  on storage.objects for select to authenticated
  using (bucket_id = 'media' and public._kub_media_read_allowed(name));

-- A half-applied state raises rather than committing.
do $check$
declare
  v_has_policy boolean;
  v_exec boolean;
begin
  select exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'media authenticated scoped read'
      and qual like '%_kub_media_read_allowed%'
  ) into v_has_policy;
  if not v_has_policy then
    raise exception 'media read policy did not take the new predicate';
  end if;

  select has_function_privilege('authenticated', 'public._kub_media_read_allowed(text)', 'execute')
    into v_exec;
  if not v_exec then
    raise exception 'authenticated cannot execute the read predicate';
  end if;

  -- The write predicate must be exactly as narrow as it was.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'media authenticated scoped insert'
  ) then
    raise exception 'the write policies were disturbed';
  end if;
end
$check$;

commit;
