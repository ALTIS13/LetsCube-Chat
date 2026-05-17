-- Proposal only. Do not apply automatically.
-- Search v2 filters and in-chat full-history search RPCs for KUB.
--
-- Goals:
-- - Keep search RLS-safe through normal authenticated table access.
-- - Support type/from/in/has/before/after filters for global search.
-- - Support full-history search inside one visible chat, including topic scope.
-- - Avoid raw media URLs in snippets returned to the frontend.

create extension if not exists pg_trgm with schema extensions;

set search_path = public, extensions;

create index if not exists profiles_full_name_trgm_idx
  on public.profiles using gin (lower(coalesce(full_name, '')) gin_trgm_ops);

create index if not exists profiles_username_trgm_idx
  on public.profiles using gin (lower(coalesce(username, '')) gin_trgm_ops);

create index if not exists chats_name_trgm_idx
  on public.chats using gin (lower(coalesce(name, '')) gin_trgm_ops);

create index if not exists messages_content_trgm_idx
  on public.messages using gin (lower(coalesce(content, '')) gin_trgm_ops);

create index if not exists tasks_title_trgm_idx
  on public.tasks using gin (lower(coalesce(title, '')) gin_trgm_ops);

create index if not exists locations_name_trgm_idx
  on public.locations using gin (lower(coalesce(name, '')) gin_trgm_ops);

create or replace function public.global_search_v2(
  p_query text,
  p_filters jsonb default '{}'::jsonb,
  p_limit int default 20
)
returns table (
  result_type text,
  id uuid,
  title text,
  subtitle text,
  snippet text,
  avatar_url text,
  chat_id uuid,
  message_id uuid,
  task_id uuid,
  location_id uuid,
  created_at timestamptz,
  rank real
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_query text := lower(trim(coalesce(p_query, '')));
  v_plain text;
  v_like text;
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_type text := nullif(v_filters->>'type', '');
  v_from text := lower(regexp_replace(trim(coalesce(v_filters->>'from', '')), '^@+', ''));
  v_in text := lower(trim(coalesce(v_filters->>'in', '')));
  v_has text[];
  v_before timestamptz;
  v_after timestamptz;
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  select coalesce(array_agg(has_value.value), '{}'::text[])
  into v_has
  from jsonb_array_elements_text(coalesce(v_filters->'has', '[]'::jsonb)) as has_value(value);

  begin
    if nullif(v_filters->>'before', '') is not null then
      v_before := ((v_filters->>'before')::date + interval '1 day')::timestamptz;
    end if;
    if nullif(v_filters->>'after', '') is not null then
      v_after := (v_filters->>'after')::date::timestamptz;
    end if;
  exception when others then
    v_before := null;
    v_after := null;
  end;

  v_plain := regexp_replace(v_query, '^@+', '');

  if length(v_plain) < (case when v_query like '@%' then 1 else 2 end)
     and coalesce(array_length(v_has, 1), 0) = 0
     and nullif(v_from, '') is null
     and nullif(v_in, '') is null
     and v_before is null
     and v_after is null then
    return;
  end if;

  v_like := '%' || v_plain || '%';

  return query
  select *
  from (
    select
      'user'::text as result_type,
      p.id,
      coalesce(nullif(trim(p.full_name), ''), '@' || p.username, 'Пользователь') as title,
      case
        when p.username is not null then '@' || p.username
        else 'Профиль'
      end as subtitle,
      null::text as snippet,
      p.avatar_url,
      null::uuid as chat_id,
      null::uuid as message_id,
      null::uuid as task_id,
      null::uuid as location_id,
      p.updated_at as created_at,
      greatest(
        similarity(lower(coalesce(p.full_name, '')), v_plain),
        similarity(lower(coalesce(p.username, '')), v_plain),
        case when lower(coalesce(p.username, '')) like v_plain || '%' then 0.95 else 0 end
      )::real as rank
    from public.profiles p
    where
      (v_type is null or v_type in ('all', 'user'))
      and coalesce(array_length(v_has, 1), 0) = 0
      and nullif(v_from, '') is null
      and nullif(v_in, '') is null
      and (v_after is null or p.updated_at >= v_after)
      and (v_before is null or p.updated_at < v_before)
      and (
        lower(coalesce(p.full_name, '')) like v_like
        or lower(coalesce(p.username, '')) like v_like
      )

    union all

    select
      'chat'::text as result_type,
      c.id,
      coalesce(nullif(trim(c.name), ''), 'Личный чат') as title,
      case c.type
        when 'private' then 'Личный чат'
        when 'channel' then 'Канал'
        else 'Чат'
      end as subtitle,
      nullif(trim(c.description), '') as snippet,
      c.avatar_url,
      c.id as chat_id,
      null::uuid as message_id,
      null::uuid as task_id,
      null::uuid as location_id,
      c.updated_at as created_at,
      greatest(
        similarity(lower(coalesce(c.name, '')), v_plain),
        similarity(lower(coalesce(c.description, '')), v_plain)
      )::real as rank
    from public.chats c
    join public.chat_members cm
      on cm.chat_id = c.id
      and cm.user_id = auth.uid()
      and cm.hidden_at is null
    where
      (v_type is null or v_type in ('all', 'chat'))
      and coalesce(array_length(v_has, 1), 0) = 0
      and nullif(v_from, '') is null
      and (v_after is null or c.updated_at >= v_after)
      and (v_before is null or c.updated_at < v_before)
      and (
        lower(coalesce(c.name, '')) like v_like
        or lower(coalesce(c.description, '')) like v_like
      )
      and (
        nullif(v_in, '') is null
        or lower(coalesce(c.name, '')) like '%' || v_in || '%'
        or c.id::text = v_in
      )

    union all

    select
      'message'::text as result_type,
      m.id,
      coalesce(nullif(trim(c.name), ''), 'Сообщение') as title,
      coalesce(sender.full_name, sender.username, 'Участник') as subtitle,
      coalesce(
        nullif(left(regexp_replace(coalesce(m.content, ''), '\s+', ' ', 'g'), 180), ''),
        case
          when m.type = 'image' then 'Фото'
          when m.type = 'video' and coalesce(m.media_metadata->>'kind', '') = 'video_message' then 'Видеосообщение'
          when m.type = 'video' then 'Видео'
          when m.type = 'audio' then 'Голосовое'
          when m.type = 'file' then 'Файл'
          else 'Сообщение'
        end
      ) as snippet,
      sender.avatar_url,
      m.chat_id,
      m.id as message_id,
      null::uuid as task_id,
      null::uuid as location_id,
      m.created_at,
      greatest(
        similarity(lower(coalesce(m.content, '')), v_plain),
        similarity(lower(coalesce(sender.full_name, '')), v_plain),
        similarity(lower(coalesce(sender.username, '')), v_plain)
      )::real as rank
    from public.messages m
    join public.chats c on c.id = m.chat_id
    join public.chat_members cm
      on cm.chat_id = m.chat_id
      and cm.user_id = auth.uid()
      and cm.hidden_at is null
    left join public.profiles sender on sender.id = m.user_id
    left join public.message_hidden_for_users hidden
      on hidden.message_id = m.id
      and hidden.user_id = auth.uid()
    where
      (v_type is null or v_type in ('all', 'message', 'media'))
      and m.deleted_at is null
      and hidden.message_id is null
      and (cm.cleared_at is null or m.created_at > cm.cleared_at)
      and (v_type is distinct from 'media' or m.type in ('image', 'video', 'audio', 'file') or m.media_url is not null)
      and (v_after is null or m.created_at >= v_after)
      and (v_before is null or m.created_at < v_before)
      and (
        nullif(v_from, '') is null
        or lower(coalesce(sender.username, '')) like '%' || v_from || '%'
        or lower(coalesce(sender.full_name, '')) like '%' || v_from || '%'
      )
      and (
        nullif(v_in, '') is null
        or lower(coalesce(c.name, '')) like '%' || v_in || '%'
        or c.id::text = v_in
      )
      and (
        coalesce(array_length(v_has, 1), 0) = 0
        or ('link' = any(v_has) and coalesce(m.content, '') ~* '(https?://|www\.)')
        or ('image' = any(v_has) and (m.type = 'image' or coalesce(m.media_metadata->>'mime_type', '') like 'image/%'))
        or ('video' = any(v_has) and (m.type = 'video' or coalesce(m.media_metadata->>'mime_type', '') like 'video/%'))
        or ('audio' = any(v_has) and (m.type = 'audio' or coalesce(m.media_metadata->>'mime_type', '') like 'audio/%'))
        or ('file' = any(v_has) and m.media_url is not null and m.type not in ('image', 'video', 'audio'))
      )
      and (
        v_plain = ''
        or lower(coalesce(m.content, '')) like v_like
        or lower(coalesce(sender.full_name, '')) like v_like
        or lower(coalesce(sender.username, '')) like v_like
        or (m.type in ('image', 'video', 'audio', 'file') and v_type = 'media')
      )

    union all

    select
      'task'::text as result_type,
      t.id,
      t.title,
      coalesce(l.name, 'Задача') as subtitle,
      nullif(left(regexp_replace(coalesce(t.description, ''), '\s+', ' ', 'g'), 180), '') as snippet,
      null::text as avatar_url,
      t.chat_id,
      null::uuid as message_id,
      t.id as task_id,
      t.location_id,
      t.updated_at as created_at,
      greatest(
        similarity(lower(coalesce(t.title, '')), v_plain),
        similarity(lower(coalesce(t.description, '')), v_plain),
        similarity(lower(coalesce(l.name, '')), v_plain)
      )::real as rank
    from public.tasks t
    left join public.locations l on l.id = t.location_id
    left join public.chats tc on tc.id = t.chat_id
    where
      (v_type is null or v_type in ('all', 'task'))
      and coalesce(array_length(v_has, 1), 0) = 0
      and nullif(v_from, '') is null
      and t.deleted_at is null
      and (v_after is null or t.updated_at >= v_after)
      and (v_before is null or t.updated_at < v_before)
      and (
        lower(coalesce(t.title, '')) like v_like
        or lower(coalesce(t.description, '')) like v_like
        or lower(coalesce(l.name, '')) like v_like
      )
      and (
        nullif(v_in, '') is null
        or lower(coalesce(l.name, '')) like '%' || v_in || '%'
        or lower(coalesce(tc.name, '')) like '%' || v_in || '%'
        or t.location_id::text = v_in
        or t.chat_id::text = v_in
      )

    union all

    select
      'location'::text as result_type,
      l.id,
      l.name,
      coalesce(nullif(trim(l.address), ''), 'Локация') as subtitle,
      nullif(trim(l.description), '') as snippet,
      null::text as avatar_url,
      null::uuid as chat_id,
      null::uuid as message_id,
      null::uuid as task_id,
      l.id as location_id,
      l.updated_at as created_at,
      greatest(
        similarity(lower(coalesce(l.name, '')), v_plain),
        similarity(lower(coalesce(l.address, '')), v_plain),
        similarity(lower(coalesce(l.description, '')), v_plain)
      )::real as rank
    from public.locations l
    where
      (v_type is null or v_type in ('all', 'location'))
      and coalesce(array_length(v_has, 1), 0) = 0
      and nullif(v_from, '') is null
      and l.is_active = true
      and (v_after is null or l.updated_at >= v_after)
      and (v_before is null or l.updated_at < v_before)
      and (
        lower(coalesce(l.name, '')) like v_like
        or lower(coalesce(l.address, '')) like v_like
        or lower(coalesce(l.description, '')) like v_like
      )
      and (
        nullif(v_in, '') is null
        or lower(coalesce(l.name, '')) like '%' || v_in || '%'
        or l.id::text = v_in
      )
  ) results
  where results.rank > 0 or v_plain = '' or coalesce(array_length(v_has, 1), 0) > 0
  order by results.rank desc, results.created_at desc nulls last
  limit v_limit;
end;
$$;

create or replace function public.search_chat_messages(
  p_chat_id uuid,
  p_query text,
  p_filters jsonb default '{}'::jsonb,
  p_limit int default 80,
  p_topic_id uuid default null,
  p_all_topics boolean default false
)
returns table (
  message_id uuid,
  chat_id uuid,
  topic_id uuid,
  sender_name text,
  snippet text,
  message_type text,
  media_url text,
  mime_type text,
  created_at timestamptz,
  rank real
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_query text := lower(trim(coalesce(p_query, '')));
  v_plain text;
  v_like text;
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_from text := lower(regexp_replace(trim(coalesce(v_filters->>'from', '')), '^@+', ''));
  v_has text[];
  v_before timestamptz;
  v_after timestamptz;
  v_limit int := least(greatest(coalesce(p_limit, 80), 1), 120);
begin
  select coalesce(array_agg(has_value.value), '{}'::text[])
  into v_has
  from jsonb_array_elements_text(coalesce(v_filters->'has', '[]'::jsonb)) as has_value(value);

  begin
    if nullif(v_filters->>'before', '') is not null then
      v_before := ((v_filters->>'before')::date + interval '1 day')::timestamptz;
    end if;
    if nullif(v_filters->>'after', '') is not null then
      v_after := (v_filters->>'after')::date::timestamptz;
    end if;
  exception when others then
    v_before := null;
    v_after := null;
  end;

  v_plain := regexp_replace(v_query, '^@+', '');

  if length(v_plain) < (case when v_query like '@%' then 1 else 2 end)
     and coalesce(array_length(v_has, 1), 0) = 0
     and nullif(v_from, '') is null
     and v_before is null
     and v_after is null then
    return;
  end if;

  v_like := '%' || v_plain || '%';

  return query
  select
    m.id as message_id,
    m.chat_id,
    m.topic_id,
    coalesce(sender.full_name, sender.username, 'Участник') as sender_name,
    coalesce(
      nullif(left(regexp_replace(coalesce(m.content, ''), '\s+', ' ', 'g'), 220), ''),
      case
        when m.type = 'image' then 'Фото'
        when m.type = 'video' and coalesce(m.media_metadata->>'kind', '') = 'video_message' then 'Видеосообщение'
        when m.type = 'video' then 'Видео'
        when m.type = 'audio' then 'Голосовое'
        when m.type = 'file' then 'Файл'
        else 'Сообщение'
      end
    ) as snippet,
    m.type::text as message_type,
    m.media_url,
    coalesce(m.media_metadata->>'mime_type', null) as mime_type,
    m.created_at,
    greatest(
      similarity(lower(coalesce(m.content, '')), v_plain),
      similarity(lower(coalesce(sender.full_name, '')), v_plain),
      similarity(lower(coalesce(sender.username, '')), v_plain)
    )::real as rank
  from public.messages m
  join public.chat_members cm
    on cm.chat_id = m.chat_id
    and cm.user_id = auth.uid()
    and cm.hidden_at is null
  left join public.profiles sender on sender.id = m.user_id
  left join public.message_hidden_for_users hidden
    on hidden.message_id = m.id
    and hidden.user_id = auth.uid()
  where
    m.chat_id = p_chat_id
    and m.deleted_at is null
    and hidden.message_id is null
    and (cm.cleared_at is null or m.created_at > cm.cleared_at)
    and (p_all_topics = true or (m.topic_id is not distinct from p_topic_id))
    and (coalesce(v_filters->>'type', '') <> 'media' or m.type in ('image', 'video', 'audio', 'file') or m.media_url is not null)
    and (v_after is null or m.created_at >= v_after)
    and (v_before is null or m.created_at < v_before)
    and (
      nullif(v_from, '') is null
      or lower(coalesce(sender.username, '')) like '%' || v_from || '%'
      or lower(coalesce(sender.full_name, '')) like '%' || v_from || '%'
    )
    and (
      coalesce(array_length(v_has, 1), 0) = 0
      or ('link' = any(v_has) and coalesce(m.content, '') ~* '(https?://|www\.)')
      or ('image' = any(v_has) and (m.type = 'image' or coalesce(m.media_metadata->>'mime_type', '') like 'image/%'))
      or ('video' = any(v_has) and (m.type = 'video' or coalesce(m.media_metadata->>'mime_type', '') like 'video/%'))
      or ('audio' = any(v_has) and (m.type = 'audio' or coalesce(m.media_metadata->>'mime_type', '') like 'audio/%'))
      or ('file' = any(v_has) and m.media_url is not null and m.type not in ('image', 'video', 'audio'))
    )
    and (
      v_plain = ''
      or lower(coalesce(m.content, '')) like v_like
      or lower(coalesce(sender.full_name, '')) like v_like
      or lower(coalesce(sender.username, '')) like v_like
      or (m.type in ('image', 'video', 'audio', 'file') and coalesce(array_length(v_has, 1), 0) > 0)
    )
  order by rank desc, m.created_at desc
  limit v_limit;
end;
$$;

revoke all on function public.global_search_v2(text, jsonb, int) from public;
grant execute on function public.global_search_v2(text, jsonb, int) to authenticated;

revoke all on function public.search_chat_messages(uuid, text, jsonb, int, uuid, boolean) from public;
grant execute on function public.search_chat_messages(uuid, text, jsonb, int, uuid, boolean) to authenticated;
