-- Proposal only. Apply manually after review.
-- Adds per-user persistent ordering for pinned chats. Saved chat remains a
-- frontend special case and must continue to sort above pinned chats.

begin;

alter table public.chat_members
  add column if not exists pinned_order integer;

create index if not exists chat_members_user_pinned_order_idx
  on public.chat_members (user_id, pinned_order, pinned_at desc)
  where pinned = true;

with ranked as (
  select
    user_id,
    chat_id,
    row_number() over (
      partition by user_id
      order by pinned_at desc nulls last, chat_id
    )::integer as next_order
  from public.chat_members
  where pinned = true
    and pinned_order is null
)
update public.chat_members cm
set pinned_order = ranked.next_order
from ranked
where cm.user_id = ranked.user_id
  and cm.chat_id = ranked.chat_id
  and cm.pinned_order is null;

create or replace function public.set_pinned_chat_order(p_chat_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_requested_count integer;
  v_available_count integer;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if public.is_banned(v_uid) then
    raise exception 'Недостаточно прав';
  end if;

  if coalesce(array_length(p_chat_ids, 1), 0) = 0 then
    return;
  end if;

  if exists (
    select 1
    from unnest(p_chat_ids) as requested(chat_id)
    group by requested.chat_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate chat ids';
  end if;

  select count(*)
  into v_requested_count
  from unnest(p_chat_ids) as requested(chat_id);

  select count(*)
  into v_available_count
  from public.chat_members cm
  join unnest(p_chat_ids) as requested(chat_id)
    on requested.chat_id = cm.chat_id
  where cm.user_id = v_uid
    and cm.pinned = true;

  if v_requested_count <> v_available_count then
    raise exception 'Pinned chat is not available';
  end if;

  with ordered as (
    select chat_id, ordinality::integer as pinned_order
    from unnest(p_chat_ids) with ordinality as requested(chat_id, ordinality)
  )
  update public.chat_members cm
  set pinned_order = ordered.pinned_order
  from ordered
  where cm.user_id = v_uid
    and cm.chat_id = ordered.chat_id
    and cm.pinned = true;
end;
$$;

create or replace function public.pin_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.is_banned(auth.uid()) then
    raise exception 'Недостаточно прав';
  end if;

  update public.chat_members
  set pinned = true,
      pinned_at = now(),
      pinned_order = coalesce(
        pinned_order,
        (
          select coalesce(min(cm.pinned_order), 1) - 1
          from public.chat_members cm
          where cm.user_id = auth.uid()
            and cm.pinned = true
            and cm.pinned_order is not null
        )
      )
  where chat_id = p_chat_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Chat is not available';
  end if;
end;
$$;

create or replace function public.unpin_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.chat_members
  set pinned = false,
      pinned_at = null,
      pinned_order = null
  where chat_id = p_chat_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Chat is not available';
  end if;
end;
$$;

comment on column public.chat_members.pinned_order is
  'Per-user order for pinned chats. Lower values render higher. NULL falls back to pinned_at sorting.';

comment on function public.set_pinned_chat_order(uuid[]) is
  'Reorders current user pinned chats according to p_chat_ids. Does not change other users.';

revoke all on function public.set_pinned_chat_order(uuid[]) from public, anon;
grant execute on function public.set_pinned_chat_order(uuid[]) to authenticated;

revoke all on function public.pin_chat(uuid) from public, anon;
grant execute on function public.pin_chat(uuid) to authenticated;

revoke all on function public.unpin_chat(uuid) from public, anon;
grant execute on function public.unpin_chat(uuid) to authenticated;

commit;

-- Verify after manual apply:
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'chat_members'
--   and column_name = 'pinned_order';
--
-- select proname, pg_get_function_arguments(oid)
-- from pg_proc
-- where oid in ('public.set_pinned_chat_order(uuid[])'::regprocedure,
--               'public.pin_chat(uuid)'::regprocedure,
--               'public.unpin_chat(uuid)'::regprocedure);
--
-- select has_function_privilege('authenticated', 'public.set_pinned_chat_order(uuid[])', 'execute') as authenticated_can_execute,
--        has_function_privilege('anon', 'public.set_pinned_chat_order(uuid[])', 'execute') as anon_can_execute;
