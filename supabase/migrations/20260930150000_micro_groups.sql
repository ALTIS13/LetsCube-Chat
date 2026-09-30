/**
 * The micro-group, first phase — tracker item 45 (2026-09-30).
 *
 * WHAT THE OWNER DECIDED. A separate kind of conversation, not a flag on a
 * group: «сервер в дискорде именно что обладает огромным комбайном
 * возможностей». Born by a gesture, not a form: two people are talking in a
 * private chat, one adds somebody, and a small group exists. A crown on its
 * creator is its only hierarchy. Name and picture are all it has to edit: no
 * channels, roles, folders, invite links or categories. And on 2026-09-30:
 * «Микро-группы должны входить в общую систему блока пользователя (проверь
 * реализацию Discord/Telegram)», with every other open question delegated to
 * the references.
 *
 * WHAT THE REFERENCES DO, READ 2026-09-30.
 *
 *   - Blocks. Telegram refuses to add somebody to a group in both directions:
 *     `messages.addChatUser` documents `USER_IS_BLOCKED` and `YOU_BLOCKED_USER`
 *     (core.telegram.org). Discord adds only friends to a group DM, and a block
 *     ends a friendship; inside a group DM with somebody blocked it warns, and
 *     collapses their messages (`GDM_BLOCKED_USER_WARNING`,
 *     `MESSAGE_GROUP_BLOCKED` in its web bundle). Here: nobody is brought in
 *     across a block in either direction, the private chat's other person
 *     included; the warning is the client's.
 *   - Size. Discord's group DM holds 10: `isPartyFull` compares against a limit
 *     that resolves to 10 in the shipped bundle (25 for staff). Adopted.
 *   - Who adds, who removes. Any member of a Discord group DM adds; the owner
 *     removes. Adopted; the owner's delete policy already admits the crown.
 *   - From a DM. Discord makes a new group DM from a DM (`_promoteDMToGroupDM`)
 *     and leaves the DM as it was. Adopted.
 *   - Name. None stored until somebody gives one; drawn from the others' names.
 *     Any member renames, as in Discord. The picture stays the crown's in this
 *     phase: the storage rule for a chat's picture admits its owner and
 *     administrators, and widening it is a separate change.
 *   - Deleting others' messages: the group rule, own messages only — unchanged.
 *
 * THE INTERNAL NAME. `dm_group`, not `group_chat`: tracker item 45 warns that a
 * light `group_chat` beside a heavy `group` differs by a suffix, and a filter
 * that starts with «group» would select both. The interface calls it
 * «групповой чат».
 *
 * NOT IN THIS PHASE. The call — a room for ten, ringing the people added, the
 * two already talking carried over — is the second phase: `voice_private_room`
 * refuses this kind until then, so no call can start in one.
 *
 * Lock: ALTER TABLE on public.chats (49 rows) and policy changes on chats and
 * chat_members take ACCESS EXCLUSIVE briefly; `lock_timeout` gives up after
 * five seconds rather than queue behind a long one.
 *
 * Its picture's small versions: `20260930150100_micro_group_avatar_variants.sql`,
 * separately, because the trigger it changes belongs to `supabase_admin`.
 *
 * Rollback: 20260930150000_micro_groups.rollback.sql — possible while no
 * micro-group exists; after that, the interface stops offering the gesture.
 */
begin;
set local lock_timeout = '5s';

-- ── the kind ─────────────────────────────────────────────────────────────────
alter table public.chats drop constraint chats_type_check;
alter table public.chats add constraint chats_type_check
  check (type = any (array['private'::text, 'group'::text, 'channel'::text, 'dm_group'::text]));

-- Born only through `micro_group_create`: a direct insert would skip the cap,
-- the blocks and the private chat it has to come from.
drop policy if exists "Users create chats with self as creator" on public.chats;
create policy "Users create chats with self as creator"
  on public.chats
  for insert
  to authenticated
  with check ((created_by = auth.uid()) and (type is not null) and (type <> all (array['private'::text, 'dm_group'::text])));

-- A micro-group's people arrive only through its functions, which hold the cap
-- and the blocks. Its owner is a chat admin to `is_chat_admin`, so without this
-- the permissive insert policy would let the owner add anybody directly.
drop policy if exists "micro-group members only through its functions" on public.chat_members;
create policy "micro-group members only through its functions"
  on public.chat_members
  as restrictive
  for insert
  to authenticated
  with check ((select chat_row.type from public.chats as chat_row where chat_row.id = chat_id) is distinct from 'dm_group');

-- The crown is the only hierarchy: no administrators in a micro-group.
drop policy if exists "micro-group has no administrators" on public.chat_members;
create policy "micro-group has no administrators"
  on public.chat_members
  as restrictive
  for update
  to authenticated
  using (true)
  with check (
    role <> 'admin'::public.chat_member_role
    or (select chat_row.type from public.chats as chat_row where chat_row.id = chat_id) is distinct from 'dm_group'
  );

-- ── blocks, in both directions ──────────────────────────────────────────────
/**
 * Whether either of two people has blocked the other.
 *
 * Telegram refuses to add somebody to a group in both directions —
 * `messages.addChatUser` documents `USER_IS_BLOCKED` («You were blocked by this
 * user») and `YOU_BLOCKED_USER` — and Discord adds only friends, which a block
 * ends. Internal: a block is never readable by the person blocked.
 */
create or replace function public.users_blocked_either(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.user_blocks as block
     where (block.blocker_id = p_a and block.blocked_id = p_b)
        or (block.blocker_id = p_b and block.blocked_id = p_a)
  )
$$;
revoke all on function public.users_blocked_either(uuid, uuid) from public, anon, authenticated;

/**
 * A micro-group's name when it has none, as one reader sees it: the first names
 * of the others in the order they joined, three at most, «и ещё N» after that.
 * Discord draws a group DM's default name from its members the same way.
 */
create or replace function public.micro_group_drawn_name(p_chat_id uuid, p_viewer uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  with others as (
    select coalesce(
             nullif(split_part(btrim(coalesce(profile.full_name, '')), ' ', 1), ''),
             nullif('@' || profile.username, '@'),
             'Участник'
           ) as first_name,
           row_number() over (order by member.joined_at, member.user_id) as position,
           count(*) over () as total
      from public.chat_members as member
      join public.profiles as profile on profile.id = member.user_id
     where member.chat_id = p_chat_id
       and member.user_id is distinct from p_viewer
  )
  select coalesce(
    (select string_agg(first_name, ', ' order by position) from others where position <= 3)
      || case when (select max(total) from others) > 3
              then ' и ещё ' || ((select max(total) from others) - 3)::text
              else '' end,
    'Групповой чат'
  )
$$;
revoke all on function public.micro_group_drawn_name(uuid, uuid) from public, anon, authenticated;

-- ── born from a private chat ─────────────────────────────────────────────────
/**
 * The gesture: two people are talking in a private chat, one of them adds
 * somebody, and a micro-group exists with the three of them. The private chat
 * stays as it was — Discord's client makes a new group DM from a DM rather than
 * widening the DM (`_promoteDMToGroupDM`, read 2026-09-30).
 *
 * Ten people at most, Discord's group DM cap (its default recipient limit
 * resolves to 10 in the shipped bundle). Nobody may be brought in across a
 * block in either direction, the private chat's other person included.
 */
create or replace function public.micro_group_create(p_private_chat_id uuid, p_user_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_type text;
  v_partner uuid;
  v_added uuid[];
  v_person uuid;
  v_chat uuid;
  v_now timestamptz := now();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_me) then
    raise exception 'banned' using errcode = '42501';
  end if;
  select chat_row.type into v_type from public.chats as chat_row where chat_row.id = p_private_chat_id;
  if v_type is null or v_type <> 'private' then
    raise exception 'micro_group_not_private' using errcode = '22023';
  end if;
  if not exists (select 1 from public.chat_members as member where member.chat_id = p_private_chat_id and member.user_id = v_me) then
    raise exception 'micro_group_not_member' using errcode = '42501';
  end if;
  select member.user_id into v_partner
    from public.chat_members as member
   where member.chat_id = p_private_chat_id and member.user_id <> v_me
   limit 1;
  if v_partner is null then
    raise exception 'micro_group_needs_partner' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct person), '{}') into v_added
    from unnest(coalesce(p_user_ids, '{}')) as person
   where person is not null and person <> v_me and person <> v_partner;
  if cardinality(v_added) = 0 then
    raise exception 'micro_group_nobody_added' using errcode = '22023';
  end if;
  if 2 + cardinality(v_added) > 10 then
    raise exception 'micro_group_full' using errcode = '54000';
  end if;

  foreach v_person in array array_prepend(v_partner, v_added) loop
    if exists (select 1 from public.user_blocks as block where block.blocker_id = v_me and block.blocked_id = v_person) then
      raise exception 'micro_group_blocked_by_you' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles as profile where profile.id = v_person)
       or public.is_banned(v_person)
       or public.users_blocked_either(v_me, v_person) then
      -- No reason given: «you were blocked» is not the blocked person's to learn.
      raise exception 'micro_group_unavailable' using errcode = '42501';
    end if;
  end loop;

  insert into public.chats (type, name, created_by) values ('dm_group', null, v_me) returning id into v_chat;
  -- `add_chat_creator_as_owner` has made the creator its owner: the crown.
  insert into public.chat_members (chat_id, user_id, role, joined_at, last_read_at, last_delivered_at)
  select v_chat, person, 'member'::public.chat_member_role, v_now, v_now, v_now
    from unnest(array_prepend(v_partner, v_added)) as person
  on conflict (chat_id, user_id) do nothing;

  return v_chat;
end
$$;
revoke all on function public.micro_group_create(uuid, uuid[]) from public, anon;
grant execute on function public.micro_group_create(uuid, uuid[]) to authenticated;

/**
 * Anybody in a micro-group may add people, as anybody in a Discord group DM
 * may; only the crown removes. The same cap and the same blocks, between the
 * one who adds and the one added.
 */
create or replace function public.micro_group_add(p_chat_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_type text;
  v_added uuid[];
  v_person uuid;
  v_count integer;
  v_now timestamptz := now();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_me) then
    raise exception 'banned' using errcode = '42501';
  end if;
  -- The row lock serialises two people adding at once, so the cap holds.
  select chat_row.type into v_type from public.chats as chat_row where chat_row.id = p_chat_id for update;
  if v_type is null or v_type <> 'dm_group' then
    raise exception 'micro_group_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.chat_members as member where member.chat_id = p_chat_id and member.user_id = v_me) then
    raise exception 'micro_group_not_member' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct person), '{}') into v_added
    from unnest(coalesce(p_user_ids, '{}')) as person
   where person is not null
     and not exists (select 1 from public.chat_members as member where member.chat_id = p_chat_id and member.user_id = person);
  if cardinality(v_added) = 0 then
    return 0;
  end if;
  select count(*)::integer into v_count from public.chat_members as member where member.chat_id = p_chat_id;
  if v_count + cardinality(v_added) > 10 then
    raise exception 'micro_group_full' using errcode = '54000';
  end if;

  foreach v_person in array v_added loop
    if exists (select 1 from public.user_blocks as block where block.blocker_id = v_me and block.blocked_id = v_person) then
      raise exception 'micro_group_blocked_by_you' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles as profile where profile.id = v_person)
       or public.is_banned(v_person)
       or public.users_blocked_either(v_me, v_person) then
      raise exception 'micro_group_unavailable' using errcode = '42501';
    end if;
  end loop;

  insert into public.chat_members (chat_id, user_id, role, joined_at, last_read_at, last_delivered_at)
  select p_chat_id, person, 'member'::public.chat_member_role, v_now, v_now, v_now
    from unnest(v_added) as person
  on conflict (chat_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.micro_group_add(uuid, uuid[]) from public, anon;
grant execute on function public.micro_group_add(uuid, uuid[]) to authenticated;

/**
 * Any member names it, as in a Discord group DM; an empty name gives the drawn
 * one back. The picture stays the crown's in this first phase: the storage rule
 * for a chat's picture admits its owner and administrators.
 */
create or replace function public.micro_group_rename(p_chat_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_type text;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_me) then
    raise exception 'banned' using errcode = '42501';
  end if;
  select chat_row.type into v_type from public.chats as chat_row where chat_row.id = p_chat_id;
  if v_type is null or v_type <> 'dm_group' then
    raise exception 'micro_group_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.chat_members as member where member.chat_id = p_chat_id and member.user_id = v_me) then
    raise exception 'micro_group_not_member' using errcode = '42501';
  end if;
  if v_name is not null and char_length(v_name) > 64 then
    raise exception 'micro_group_bad_name' using errcode = '22023';
  end if;
  update public.chats set name = v_name, updated_at = now() where id = p_chat_id;
end
$$;
revoke all on function public.micro_group_rename(uuid, text) from public, anon;
grant execute on function public.micro_group_rename(uuid, text) to authenticated;

/**
 * Leaving. When the crown leaves, it passes to whoever has been there longest,
 * as a Discord group DM passes its ownership on; when the last person leaves,
 * the group goes with them.
 */
create or replace function public.micro_group_leave(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_type text;
  v_role text;
  v_heir uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select chat_row.type into v_type from public.chats as chat_row where chat_row.id = p_chat_id for update;
  if v_type is null or v_type <> 'dm_group' then
    raise exception 'micro_group_not_found' using errcode = 'P0002';
  end if;
  select member.role::text into v_role from public.chat_members as member where member.chat_id = p_chat_id and member.user_id = v_me;
  if v_role is null then
    raise exception 'micro_group_not_member' using errcode = '42501';
  end if;

  select member.user_id into v_heir
    from public.chat_members as member
   where member.chat_id = p_chat_id and member.user_id <> v_me
   order by member.joined_at, member.user_id
   limit 1;

  if v_heir is null then
    delete from public.chats where id = p_chat_id;
    return;
  end if;
  if v_role = 'owner' then
    update public.chat_members set role = 'owner'::public.chat_member_role
     where chat_id = p_chat_id and user_id = v_heir;
  end if;
  delete from public.chat_members where chat_id = p_chat_id and user_id = v_me;
end
$$;
revoke all on function public.micro_group_leave(uuid) from public, anon;
grant execute on function public.micro_group_leave(uuid) to authenticated;

-- ── existing functions, changed only where the new kind needs it ──────────

CREATE OR REPLACE FUNCTION private.enforce_chat_role_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type text;
begin
  if tg_op = 'UPDATE' and new.chat_id is distinct from old.chat_id then
    raise exception 'chat_role_chat_immutable' using errcode = '42501';
  end if;

  select chat_row.type into v_type
    from public.chats as chat_row
   where chat_row.id = new.chat_id;

  if v_type is null then
    raise exception 'chat_role_chat_missing' using errcode = 'P0001';
  end if;

  if v_type = 'private' then
    raise exception 'chat_role_private_chat' using errcode = '42501';
  end if;

  -- A micro-group's only hierarchy is its crown (2026-09-30).
  if v_type = 'dm_group' then
    raise exception 'chat_role_micro_group' using errcode = '42501';
  end if;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.write_membership_service_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_chat_id    uuid;
  v_subject    uuid;
  v_actor      uuid := auth.uid();
  v_chat_type  text;
  v_members    bigint;
  v_subject_nm text;
  v_actor_nm   text;
  v_line       text;
begin
  if tg_op = 'DELETE' then
    v_chat_id := old.chat_id;
    v_subject := old.user_id;
  else
    v_chat_id := new.chat_id;
    v_subject := new.user_id;
  end if;

  -- `is distinct from` rather than `<>`: a cascading chat delete leaves no row
  -- here, v_chat_type is null, and `null <> 'group'` is null — which would fall
  -- through and try to write a message into a chat that no longer exists.
  select chat_row.type into v_chat_type
    from public.chats chat_row where chat_row.id = v_chat_id;
  -- A micro-group hears its joins and departures as a group does (2026-09-30).
  if v_chat_type is distinct from 'group' and v_chat_type is distinct from 'dm_group' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    -- The creator's own row, written by `trg_add_chat_creator_as_owner` while
    -- the group is being made. That is a group appearing, not a person joining.
    select pg_catalog.count(*) into v_members
      from public.chat_members member_row where member_row.chat_id = v_chat_id;
    if v_members <= 1 then
      return null;
    end if;
  end if;

  v_subject_nm := public.chat_member_service_name(v_subject);
  if v_actor is not null and v_actor is distinct from v_subject then
    v_actor_nm := public.chat_member_service_name(v_actor);
  end if;

  -- Russian needs the accusative for a direct object — «добавил Ольгу», not
  -- «добавил Ольга Крылова» — and there is no declension to be had in SQL. So
  -- where a name would be an object it is introduced by a colon instead, which
  -- licenses the nominative and stays grammatical for every name. Where the
  -- person is the subject the plain form already works.
  if tg_op = 'INSERT' then
    if v_actor_nm is null then
      v_line := v_subject_nm || ' присоединился(ась) к группе';
    else
      v_line := v_actor_nm || ' добавил(а) в группу: ' || v_subject_nm;
    end if;
  else
    if v_actor_nm is not null then
      v_line := v_actor_nm || ' исключил(а) из группы: ' || v_subject_nm;
    elsif v_actor is not null then
      v_line := v_subject_nm || ' вышел(а) из группы';
    else
      -- Nobody to name. Saying «вышел» here would be a guess about somebody
      -- who may well have been removed by the service.
      v_line := v_subject_nm || ' больше не в группе';
    end if;
  end if;

  insert into public.messages (chat_id, type, content)
    values (v_chat_id, 'system', v_line);

  return null;
end
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_message_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sender_kind text;
  v_sender_name text;
  v_sender_avatar_url text;
  v_chat_name text;
  v_chat_type text;
  v_chat_named boolean;
  v_preview text;
  v_message_type text := coalesce(new.type, 'text');
begin
  if v_message_type = 'system'
     or (new.user_id is null and new.bot_id is null) then
    return null;
  end if;

  if new.bot_id is not null then
    v_sender_kind := 'bot';
    select
      coalesce(
        nullif(pg_catalog.btrim(b.display_name), ''),
        nullif('@' || b.username, '@'),
        'Бот'
      ),
      b.avatar_url
    into v_sender_name, v_sender_avatar_url
    from public.bots b where b.id = new.bot_id;
  else
    v_sender_kind := 'user';
    select
      coalesce(
        nullif(pg_catalog.btrim(p.full_name), ''),
        nullif('@' || p.username, '@'),
        'Участник'
      ),
      p.avatar_url
    into v_sender_name, v_sender_avatar_url
    from public.profiles p where p.id = new.user_id;
  end if;

  v_sender_avatar_url := public._sanitize_notification_avatar_url(v_sender_avatar_url);

  select
    coalesce(nullif(pg_catalog.btrim(chat.name), ''), v_sender_name, 'Чат'),
    coalesce(nullif(chat.type, ''), 'private'),
    nullif(pg_catalog.btrim(chat.name), '') is not null
  into v_chat_name, v_chat_type, v_chat_named
  from public.chats chat
  where chat.id = new.chat_id;

  v_preview := case
    when v_message_type = 'text' then nullif(
      pg_catalog.left(
        pg_catalog.regexp_replace(coalesce(new.content, ''), '\s+', ' ', 'g'),
        160
      ),
      ''
    )
    when v_message_type = 'image' then 'Фото'
    when v_message_type = 'video'
         and coalesce(new.media_metadata->>'kind', '') = 'video_message'
      then 'Видеосообщение'
    when v_message_type = 'video' then 'Видео'
    when v_message_type = 'audio' then 'Голосовое'
    when v_message_type = 'file' then 'Файл'
    when v_message_type = 'location' then 'Местоположение'
    else 'Сообщение'
  end;
  v_preview := coalesce(v_preview, 'Сообщение');

  -- In-app notifications remain the source of truth.
  -- Push mutes and notification preferences remain enforced by public._notification_push_allowed.
  -- The existing outbox trigger alone projects an OS/browser delivery.
  insert into public.notifications(user_id, kind, payload)
  select
    member_row.user_id,
    'message',
    pg_catalog.jsonb_build_object(
      'chat_id', new.chat_id,
      'message_id', new.id,
      'sender_kind', v_sender_kind,
      'sender_id', new.user_id,
      'bot_id', new.bot_id,
      'sender_name', coalesce(v_sender_name, 'Участник'),
      'sender_avatar_url', v_sender_avatar_url,
      -- A micro-group with no name is called what its reader sees it called:
      -- the others' first names, which differ from one reader to the next.
      'chat_name', case
        when v_chat_type = 'dm_group' and not coalesce(v_chat_named, false)
          then public.micro_group_drawn_name(new.chat_id, member_row.user_id)
        else coalesce(v_chat_name, 'Чат')
      end,
      'chat_type', coalesce(v_chat_type, 'private'),
      'preview', v_preview,
      'message_type', v_message_type,
      'route', '/?chat=' || new.chat_id::text || '&message=' || new.id::text,
      'group_tag', 'message:chat:' || new.chat_id::text
    )
  from public.chat_members member_row
  where member_row.chat_id = new.chat_id
    and (new.user_id is null or member_row.user_id <> new.user_id)
    and member_row.hidden_at is null
    and (member_row.cleared_at is null or new.created_at > member_row.cleared_at)
    and not exists (
      select 1
      from public.message_hidden_for_users hidden
      where hidden.message_id = new.id
        and hidden.user_id = member_row.user_id
    )
  on conflict do nothing;
  return null;
end
$function$;

do $$
begin
  if pg_catalog.pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.chats'::regclass and conname = 'chats_type_check')) not like '%dm_group%'
    or (select with_check from pg_policies where schemaname = 'public' and tablename = 'chats' and policyname = 'Users create chats with self as creator') not like '%dm_group%'
    or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_members' and policyname = 'micro-group members only through its functions' and permissive = 'RESTRICTIVE')
    or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_members' and policyname = 'micro-group has no administrators' and permissive = 'RESTRICTIVE')
    or pg_catalog.has_function_privilege('authenticated', 'public.users_blocked_either(uuid, uuid)', 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', 'public.micro_group_drawn_name(uuid, uuid)', 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', 'public.micro_group_create(uuid, uuid[])', 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', 'public.micro_group_create(uuid, uuid[])', 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', 'public.micro_group_add(uuid, uuid[])', 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', 'public.micro_group_rename(uuid, text)', 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', 'public.micro_group_leave(uuid)', 'EXECUTE')
    or pg_catalog.pg_get_functiondef('private.enforce_chat_role_scope()'::regprocedure) not like '%chat_role_micro_group%'
    or pg_catalog.pg_get_functiondef('public.write_membership_service_message()'::regprocedure) not like '%dm_group%'
    or pg_catalog.pg_get_functiondef('public.enqueue_message_notifications()'::regprocedure) not like '%micro_group_drawn_name%'
  then
    raise exception 'micro_groups_migration_incomplete';
  end if;
end;
$$;

commit;
