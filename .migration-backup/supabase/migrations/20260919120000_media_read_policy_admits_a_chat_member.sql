-- D-208, the step the register does not have, and it comes before its step one.
--
-- Written 2026-09-19 from read-only measurements against production, then
-- reviewed, re-measured and revised the same day before it was rehearsed. The
-- revisions are listed under "What the review changed" below.
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
-- re-counted on production immediately before the apply rather than trusted
-- from the first pass. 778 objects in `media`, up from the 771 the register
-- recorded on 2026-09-15, and three of the shape counts moved:
--
--     {owner_uuid}/{file}                                    306, of which 286
--                                                            name a live or
--                                                            deleted message row
--                                                            and 20 name none
--     avatars/{profile_id}/avatar-{uuid}.{ext}                21, 19 with a uuid
--                                                            second segment
--     chat-avatars/{chat_id}/avatar-{uuid}.{ext}              11, 10 with a uuid
--                                                            second segment
--     bot-avatars/{bot_id}/...                                 0
--     variants/messages/{chat_id}/{message_id}/{kind}.{ext}   412, and 412/412
--                                                            confirmed seg3 is a
--                                                            real chat and seg4 a
--                                                            real message
--     variants/profiles/{profile_id}/{kind}.webp               20, 20/20 confirmed
--     variants/chats/{chat_id}/{token}/{kind}.webp              8,  8/8 confirmed
--
-- Three objects sit one segment short — `avatars/{file}` twice and
-- `chat-avatars/{file}` once, with no id folder at all. They match no branch
-- here and matched none before either, and no `avatar_url` in the product names
-- them: all 17 avatar URLs in use are two-segment, carry a uuid, and their
-- object exists. So they are orphans, and nothing regresses by leaving them
-- unreadable.
--
-- ## The one judgement call in here
--
-- A **person's** avatar, that person's avatar **variants**, and a **bot's**
-- avatar are readable by any authenticated account, not only by someone who
-- shares a chat. A **chat's** avatar and its variants are not: those are tied
-- to membership. An earlier draft of this paragraph said a chat's avatar was in
-- the wide group, which the code has never done and the truth table below
-- refutes; it is corrected here rather than left to be read as intent.
--
-- Who that actually widens it to, measured rather than argued. Through the
-- authenticated route today, exactly **5 of 18** accounts can read a profile
-- avatar that is not their own — the ones holding a critical global role or
-- `users.manage`/`media.moderate`, which is the administrator branch of
-- `_kub_media_path_allowed`. After this it is 18 of 18. Through the route the
-- product really uses, the bucket's `public` flag, it is and remains the entire
-- internet with no account at all, so in effect this narrows rather than widens.
--
-- It is also what the product already does: an avatar is drawn in global
-- search, in a member list, beside a forwarded message and in a notification,
-- none of which implies a shared chat. Tying it to membership would blank
-- pictures in all four.
--
-- Two properties of the branch worth knowing before anybody calls it tight.
-- It admits a **well-formed uuid path whether or not the object exists** — it
-- is a path test, not a lookup — and the pattern is matched case-insensitively
-- (`~*`), as the write predicate's already is. So it also admits every
-- *superseded* avatar a person ever uploaded, not only the one in use. That is
-- acceptable only because the file name carries its own random uuid: the
-- profile id alone does not let anybody derive the address. If the file naming
-- ever becomes predictable, this branch has to be revisited.
--
-- If it is judged too wide, the branches to tighten are `avatars/`,
-- `variants/profiles/` and `bot-avatars/` — and it should be tightened with a
-- measurement of which surfaces go blank, not by argument.
--
-- ## What the review changed, and why
--
-- 1. **A banned account is refused.** `public.messages` and
--    `public.chat_members` each carry a RESTRICTIVE `block banned reads`
--    policy, and this function is SECURITY DEFINER, so it bypasses exactly the
--    rule that says a banned account may not see the conversation whose
--    membership every shared branch below consults. Without the check a banned
--    account would have kept reading every photograph in every chat it had not
--    yet been removed from. The check sits *below* the own-upload branch, so
--    nothing a banned account can read today stops being readable.
--
-- 2. **The sidecar branch no longer matches with LIKE.** `v_stem` comes out of
--    an object name, and 484 of the 778 object names in this bucket contain an
--    underscore, which LIKE reads as a wildcard. `starts_with` has no
--    metacharacters.
--
-- 3. **The predicate is owned by `postgres`, not by `supabase_admin`.** Both
--    work — the body needs only SELECT on two tables and BYPASSRLS, and
--    `postgres` measurably holds all three — but `supabase_admin` is a
--    superuser on this deployment and `postgres` is not. A SECURITY DEFINER
--    function that every authenticated account may execute should run as the
--    smaller role, and `postgres` is what its sibling
--    `_kub_media_path_allowed` already runs as.
--
-- 4. **The self-check proves the write predicate rather than naming it.** It
--    asserted only that a policy called `media authenticated scoped insert`
--    existed; it now asserts that all three write policies still carry
--    `_kub_media_path_allowed`, that the new function is a stable
--    security-definer owned by `postgres`, and that `anon` cannot execute it.
--
-- ## Two things this does not fix, measured and recorded here
--
-- - **The sidecar branch matches nothing on production.** Not one of the 778
--   object names contains `.preview.`; the client writes that address but no
--   object at it has reached this deployment yet. The branch is therefore
--   forward-looking, and the only proof it works is the rehearsal, which
--   inserted such an object inside a transaction it rolled back.
-- - **Ten live messages carry a `media_url` and no `media_path`**, and all ten
--   name an object that exists. This predicate reaches a message's original
--   through `messages.media_path`, so for those ten only the uploader passes.
--   Today the bucket's `public` flag hides that. It means
--   `20260919130000_media_path_backfill_for_legacy_messages.sql` is a
--   **prerequisite for step four**, not the tidy-up the register calls it.
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

  -- A banned account gets nothing beyond its own uploads. Every branch below
  -- asks `chat_members` or `messages`, both of which carry a RESTRICTIVE
  -- `block banned reads` that this SECURITY DEFINER function would otherwise
  -- bypass. Deliberately below the branch above, so that a ban changes nothing
  -- about what a banned account can read today.
  if public.is_banned(v_uid) then
    return false;
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
    -- `starts_with` rather than LIKE: the stem is an object name, and 484 of the
    -- names in this bucket contain an underscore, which LIKE reads as a
    -- wildcard and which would widen this branch across a neighbour's file.
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
          and starts_with(m.media_path, v_stem || '.')
      );
    end if;

    return false;
  end if;

  return false;
end
$function$;

alter function public._kub_media_read_allowed(text) owner to postgres;
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
  v_write_policies integer;
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

  if has_function_privilege('anon', 'public._kub_media_read_allowed(text)', 'execute') then
    raise exception 'anon can execute the read predicate';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = '_kub_media_read_allowed'
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.provolatile = 's'
  ) then
    raise exception 'the read predicate is not a stable security-definer owned by postgres';
  end if;

  -- The write predicate must be exactly as narrow as it was: named, and still
  -- pointing at the function it pointed at. Naming it alone proved nothing.
  select count(*) into v_write_policies
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('media authenticated scoped insert',
                       'media authenticated scoped update',
                       'media authenticated scoped delete')
    and coalesce(qual, '') || coalesce(with_check, '') like '%media_path_allowed%';
  if v_write_policies <> 3 then
    raise exception 'the write policies were disturbed: % of 3 still carry the write predicate', v_write_policies;
  end if;
end
$check$;

commit;
