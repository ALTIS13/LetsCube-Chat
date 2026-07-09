-- Proposal only. Do not apply automatically.
--
-- Replaces the sidebar's per-chat last-message/unread fan-out with one
-- authenticated, RLS-aware batch call. The frontend keeps the legacy query
-- path until this proposal is applied manually.

begin;

create index if not exists messages_chat_active_created_idx
  on public.messages (chat_id, created_at desc, id desc)
  where deleted_at is null;

create or replace function public.chat_list_summaries(
  p_chat_ids uuid[] default null
)
returns table (
  chat_id uuid,
  last_message jsonb,
  unread_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with my_memberships as (
    select
      membership.chat_id,
      membership.joined_at,
      membership.last_read_at,
      membership.cleared_at
    from public.chat_members as membership
    where membership.user_id = (select auth.uid())
      and (
        p_chat_ids is null
        or membership.chat_id = any(p_chat_ids)
      )
  )
  select
    membership.chat_id,
    to_jsonb(latest_message) as last_message,
    coalesce(unread.unread_count, 0)::bigint as unread_count
  from my_memberships as membership
  left join lateral (
    select
      message.*,
      to_jsonb(sender) as sender
    from public.messages as message
    left join public.profiles as sender
      on sender.id = message.user_id
    where message.chat_id = membership.chat_id
      and message.deleted_at is null
      and (
        membership.cleared_at is null
        or message.created_at > membership.cleared_at
      )
      and not exists (
        select 1
        from public.message_hidden_for_users as hidden
        where hidden.message_id = message.id
          and hidden.user_id = (select auth.uid())
      )
    order by message.created_at desc, message.id desc
    limit 1
  ) as latest_message on true
  left join lateral (
    select count(*)::bigint as unread_count
    from public.messages as message
    where message.chat_id = membership.chat_id
      and message.deleted_at is null
      and message.user_id <> (select auth.uid())
      and message.created_at > greatest(
        membership.joined_at,
        coalesce(membership.last_read_at, membership.joined_at),
        coalesce(membership.cleared_at, membership.joined_at)
      )
  ) as unread on true;
$function$;

revoke all on function public.chat_list_summaries(uuid[]) from public;
revoke all on function public.chat_list_summaries(uuid[]) from anon;
grant execute on function public.chat_list_summaries(uuid[]) to authenticated;

comment on function public.chat_list_summaries(uuid[]) is
  'Returns last visible message and unread count for the calling user chats in one RLS-aware batch.';

commit;

-- Manual verification after apply:
--
-- select p.prosecdef, p.provolatile, p.proconfig
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'chat_list_summaries';
--
-- select has_function_privilege('anon', 'public.chat_list_summaries(uuid[])', 'execute') as anon_execute,
--        has_function_privilege('authenticated', 'public.chat_list_summaries(uuid[])', 'execute') as authenticated_execute;
--
-- Authenticated QA:
-- select * from public.chat_list_summaries(null);
-- Confirm that only caller memberships are returned, hidden messages are not
-- used as previews, and unread counts match the existing sidebar values.
