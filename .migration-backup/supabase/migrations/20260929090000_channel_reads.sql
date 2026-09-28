-- Tracker item 54, the unread half: each channel of a server says how much in
-- it is unread, as each topic of a Telegram forum does. The testers, 2026-09-28:
-- «ты не видишь вот этих каналов… тебе надо будет протыкивать каждый канал
-- вручную». Approved by the owner on 2026-09-28 with the rest of
-- docs/operations/2026-09-28-database-proposals.md (entry 5).
--
-- The chat's own read mark (`chat_members.last_read_at`) is untouched: it still
-- drives the list's unread count, push, receipts and where a chat opens
-- (CLAUDE.md §11). Beside it, `channel_reads` keeps one mark per channel per
-- member. A channel is `general` for the chat's general conversation — topic
-- null, or a topic flagged general — and a topic's id otherwise.
--
-- * `mark_channel_read` moves the caller's mark forward only, never past now,
--   and only in a chat they are a member of and a channel that chat has.
-- * `channel_unread_counts` answers, for the caller, how many messages in each
--   of a chat's channels — the general one and every topic not archived — came
--   after their mark: somebody else's, not deleted, not hidden for them, not
--   from before they cleared the chat, not a notice.
-- * Every member of a group is given a mark per channel at their chat mark now,
--   or their joining if they have never read it, so nothing turns unread on
--   the day. A channel made later, or a member who joins later, counts from
--   the later of their joining and the channel's making.
--
-- Rollback: 20260929090000_channel_reads.rollback.sql.
begin;

create table public.channel_reads (
  chat_id uuid not null references public.chats(id) on delete cascade,
  channel text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null,
  primary key (chat_id, channel, user_id),
  constraint channel_reads_channel_valid
    check (channel = 'general' or channel ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);

create index channel_reads_user_idx on public.channel_reads (user_id);

alter table public.channel_reads enable row level security;

create policy "channel_reads select own" on public.channel_reads
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.channel_reads from public, anon, authenticated;
grant select on public.channel_reads to authenticated;

insert into public.channel_reads (chat_id, channel, user_id, last_read_at)
select member.chat_id, channel.key, member.user_id, coalesce(member.last_read_at, member.joined_at)
  from public.chat_members as member
  join public.chats as chat on chat.id = member.chat_id and chat.type = 'group'
  cross join lateral (
    select 'general'::text as key
    union all
    select topic.id::text
      from public.topics as topic
     where topic.chat_id = member.chat_id
       and not topic.is_general
  ) as channel
on conflict do nothing;

create function public.mark_channel_read(p_chat_id uuid, p_channel text, p_read_through timestamptz)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_through timestamptz := least(coalesce(p_read_through, pg_catalog.now()), pg_catalog.now());
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_channel is null
     or not (p_channel = 'general' or p_channel ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'invalid_channel' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.chat_members as member
     where member.chat_id = p_chat_id and member.user_id = v_uid
  ) then
    raise exception 'chat_member_required' using errcode = '42501';
  end if;
  if p_channel <> 'general' and not exists (
    select 1 from public.topics as topic
     where topic.id = p_channel::uuid and topic.chat_id = p_chat_id
  ) then
    raise exception 'channel_not_found' using errcode = 'P0002';
  end if;
  insert into public.channel_reads (chat_id, channel, user_id, last_read_at)
  values (p_chat_id, p_channel, v_uid, v_through)
  on conflict (chat_id, channel, user_id) do update
    set last_read_at = excluded.last_read_at
    where public.channel_reads.last_read_at < excluded.last_read_at;
end $$;

create function public.channel_unread_counts(p_chat_id uuid)
returns table (channel text, unread integer)
language sql
stable
security definer
set search_path to ''
as $$
  with me as (
    select member.user_id, member.joined_at, member.cleared_at
      from public.chat_members as member
     where member.chat_id = p_chat_id
       and member.user_id = auth.uid()
  ),
  channels as (
    select 'general'::text as key, null::uuid as topic_id, null::timestamptz as made_at
    union all
    select topic.id::text, topic.id, topic.created_at
      from public.topics as topic
     where topic.chat_id = p_chat_id
       and not topic.is_general
       and not topic.archived
  ),
  marks as (
    select channels.key,
           channels.topic_id,
           me.user_id,
           me.cleared_at,
           coalesce(
             reads.last_read_at,
             greatest(me.joined_at, coalesce(channels.made_at, me.joined_at))
           ) as read_at
      from channels
      cross join me
      left join public.channel_reads as reads
        on reads.chat_id = p_chat_id and reads.channel = channels.key and reads.user_id = me.user_id
  )
  select marks.key,
         (
           select pg_catalog.count(*)::integer
             from public.messages as message
            where message.chat_id = p_chat_id
              and message.deleted_at is null
              and coalesce(message.type, 'text') <> 'system'
              and (message.user_id <> marks.user_id or message.bot_id is not null)
              and message.created_at > marks.read_at
              and (marks.cleared_at is null or message.created_at > marks.cleared_at)
              and (
                (marks.topic_id is null and (
                  message.topic_id is null
                  or exists (select 1 from public.topics as general where general.id = message.topic_id and general.is_general)
                ))
                or message.topic_id = marks.topic_id
              )
              and not exists (
                select 1 from public.message_hidden_for_users as hidden
                 where hidden.message_id = message.id and hidden.user_id = marks.user_id
              )
         )
    from marks;
$$;

revoke all on function public.mark_channel_read(uuid, text, timestamptz) from public, anon;
revoke all on function public.channel_unread_counts(uuid) from public, anon;
grant execute on function public.mark_channel_read(uuid, text, timestamptz) to authenticated, service_role;
grant execute on function public.channel_unread_counts(uuid) to authenticated, service_role;

do $$
declare
  v_members integer;
  v_seeded integer;
begin
  select count(*) into v_members
    from public.chat_members as member
    join public.chats as chat on chat.id = member.chat_id and chat.type = 'group';
  select count(*) into v_seeded from public.channel_reads where channel = 'general';
  if v_seeded <> v_members then
    raise exception 'channel_reads: % general marks for % group members', v_seeded, v_members;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.channel_reads'::regclass)
     or pg_catalog.has_table_privilege('authenticated', 'public.channel_reads', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.channel_reads', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.channel_reads', 'SELECT')
     or pg_catalog.has_function_privilege('anon', 'public.channel_unread_counts(uuid)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', 'public.mark_channel_read(uuid, text, timestamptz)', 'EXECUTE')
  then
    raise exception 'channel_reads_incomplete';
  end if;
end;
$$;

commit;
