-- Let a bot's owner give it a picture.
--
-- `bots.avatar_url` has existed since the platform's foundation and nothing has
-- ever written it: `bot_update_profile_internal` takes a name and a description
-- and no avatar, and no route would carry one. So the column has always been
-- null and every bot has shown its monogram.
--
-- Three things were in the way, and all three are here:
--
--   1. The URL check forbade every storage URL outright. That rule is right
--      about signed URLs — they expire and carry a credential — but a *public*
--      object has neither problem, and is exactly what a person's avatar
--      already is. The ban is narrowed to what it was protecting against.
--   2. Nothing let an owner write to a bot's avatar path in the media bucket.
--   3. There was no function to record the result.
--
-- `_kub_media_path_allowed` is deliberately left alone. Storage policies are
-- OR-ed, so the bot prefix is added as its own policy rather than by rewriting
-- a function that decides who may touch every other avatar in the product.
--
-- Additive: one widened check, one new function, four new storage policies,
-- one new management function.

alter table public.bots drop constraint if exists bots_avatar_url_check;
alter table public.bots add constraint bots_avatar_url_check check (
  avatar_url is null
  or (
    pg_catalog.octet_length(avatar_url) <= 2048
    -- A signed URL expires and carries a credential in the query string. It is
    -- never an acceptable avatar, whatever the host.
    and pg_catalog.lower(avatar_url) not like '%/object/sign/%'
    and pg_catalog.lower(avatar_url) not like '%token=%'
    and (
      -- The application's own pages, absolute or relative, never storage.
      (
        (
          (avatar_url like '/%' and avatar_url not like '//%')
          or avatar_url like 'https://app.letscube.ru/%'
          or avatar_url like 'https://api.letscube.ru/%'
        )
        and pg_catalog.lower(avatar_url) not like '%/storage/v1/%'
      )
      -- Or a public, unsigned object in this project's own storage, under the
      -- one prefix that holds bot pictures. Anything else there is somebody
      -- else's file and has no business being a bot's face.
      or avatar_url like 'https://core.letscube.ru/storage/v1/object/public/media/bot-avatars/%'
    )
  )
);

/**
 * Whether the caller may write a bot's avatar file.
 *
 * `bot-avatars/{bot_id}/...`, and only for an owner of that bot. A developer
 * added to a bot is deliberately not enough: the picture is the bot's public
 * identity, not part of running it.
 */
create or replace function public._kub_bot_avatar_path_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'storage'
as $function$
declare
  v_parts text[] := storage.foldername(p_name);
  v_bot text := v_parts[2];
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if auth.uid() is null then
    return false;
  end if;
  if v_parts[1] is distinct from 'bot-avatars' then
    return false;
  end if;
  if coalesce(v_bot, '') !~* v_uuid_re then
    return false;
  end if;
  return exists (
    select 1
    from public.bot_owners owner
    where owner.bot_id = v_bot::uuid
      and owner.user_id = auth.uid()
      and owner.role = 'owner'
  );
end
$function$;

drop policy if exists "media bot avatars owner read" on storage.objects;
create policy "media bot avatars owner read"
  on storage.objects for select
  using (bucket_id = 'media' and public._kub_bot_avatar_path_allowed(name));

drop policy if exists "media bot avatars owner insert" on storage.objects;
create policy "media bot avatars owner insert"
  on storage.objects for insert
  with check (bucket_id = 'media' and public._kub_bot_avatar_path_allowed(name));

drop policy if exists "media bot avatars owner update" on storage.objects;
create policy "media bot avatars owner update"
  on storage.objects for update
  using (bucket_id = 'media' and public._kub_bot_avatar_path_allowed(name))
  with check (bucket_id = 'media' and public._kub_bot_avatar_path_allowed(name));

drop policy if exists "media bot avatars owner delete" on storage.objects;
create policy "media bot avatars owner delete"
  on storage.objects for delete
  using (bucket_id = 'media' and public._kub_bot_avatar_path_allowed(name));

/**
 * Record a bot's picture, or clear it.
 *
 * Called through the management API like every other bot mutation, so it takes
 * the same actor, bot and request arguments. Passing null removes the picture.
 */
create or replace function public.bot_set_avatar_internal(
  p_actor_id uuid,
  p_bot_id uuid,
  p_avatar_url text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_url text := nullif(pg_catalog.btrim(coalesce(p_avatar_url, '')), '');
  v_state text;
begin
  if p_actor_id is null or p_bot_id is null then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.bot_owners owner
    where owner.bot_id = p_bot_id
      and owner.user_id = p_actor_id
      and owner.role = 'owner'
  ) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select bot.state into v_state from public.bots bot where bot.id = p_bot_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_state in ('pending_delete', 'deleted') then
    raise exception 'bot_deleted' using errcode = 'P0001';
  end if;

  -- A picture must be this bot's own file. Without this an owner could point
  -- one of their bots at another bot's avatar, which is a small thing that
  -- would read as impersonation in a chat.
  if v_url is not null
     and v_url not like ('https://core.letscube.ru/storage/v1/object/public/media/bot-avatars/' || p_bot_id::text || '/%') then
    raise exception 'invalid_avatar' using errcode = 'P0001';
  end if;

  update public.bots
  set avatar_url = v_url, updated_at = pg_catalog.now()
  where id = p_bot_id;

  return pg_catalog.jsonb_build_object('ok', true, 'avatar_url', v_url);
end
$function$;

revoke all on function public.bot_set_avatar_internal(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public._kub_bot_avatar_path_allowed(text) from public, anon;
