-- Proposal only. Do not apply automatically.
-- Global search RPC for KUB messenger.
--
-- Goals:
-- - Search users by full_name and username/@username.
-- - Search only RLS-visible chats, messages, tasks and locations.
-- - Avoid privileged backend keys in the frontend.
-- - Keep commands local to the frontend command palette.

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

create or replace function public.global_search(
  p_query text,
  p_limit int default 20,
  p_types text[] default null
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
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  v_plain := regexp_replace(v_query, '^@+', '');

  if length(v_plain) < (case when v_query like '@%' then 1 else 2 end) then
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
      (p_types is null or 'user' = any(p_types))
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
      (p_types is null or 'chat' = any(p_types))
      and (
        lower(coalesce(c.name, '')) like v_like
        or lower(coalesce(c.description, '')) like v_like
      )

    union all

    select
      'message'::text as result_type,
      m.id,
      coalesce(nullif(trim(c.name), ''), 'Сообщение') as title,
      coalesce(sender.full_name, sender.username, 'Участник') as subtitle,
      left(regexp_replace(coalesce(m.content, ''), '\s+', ' ', 'g'), 180) as snippet,
      sender.avatar_url,
      m.chat_id,
      m.id as message_id,
      null::uuid as task_id,
      null::uuid as location_id,
      m.created_at,
      similarity(lower(coalesce(m.content, '')), v_plain)::real as rank
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
      (p_types is null or 'message' = any(p_types))
      and m.deleted_at is null
      and hidden.message_id is null
      and (cm.cleared_at is null or m.created_at > cm.cleared_at)
      and lower(coalesce(m.content, '')) like v_like

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
        similarity(lower(coalesce(t.description, '')), v_plain)
      )::real as rank
    from public.tasks t
    left join public.locations l on l.id = t.location_id
    where
      (p_types is null or 'task' = any(p_types))
      and t.deleted_at is null
      and (
        lower(coalesce(t.title, '')) like v_like
        or lower(coalesce(t.description, '')) like v_like
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
      (p_types is null or 'location' = any(p_types))
      and l.is_active = true
      and (
        lower(coalesce(l.name, '')) like v_like
        or lower(coalesce(l.address, '')) like v_like
        or lower(coalesce(l.description, '')) like v_like
      )
  ) results
  where results.rank > 0
  order by results.rank desc, results.created_at desc nulls last
  limit v_limit;
end;
$$;

revoke all on function public.global_search(text, int, text[]) from public;
grant execute on function public.global_search(text, int, text[]) to authenticated;
