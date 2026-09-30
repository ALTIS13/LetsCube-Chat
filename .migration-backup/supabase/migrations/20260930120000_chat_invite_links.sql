/**
 * A link into a group — the last half of D-170 (2026-09-30).
 *
 * WHAT EXISTS. `group_invites` is one row per *named* invitee, so a group can
 * only be reached by somebody whose name an inviter can find and spell. There is
 * no link and no join code anywhere in the product. `registration_invites` has
 * a similar shape, but it admits somebody to the product, and must not be
 * confused with this: a link into a group admits people who already have an
 * account.
 *
 * WHAT THE OWNER DECIDED. The proposal
 * (`docs/operations/2026-09-29-chat-invite-link-proposal.md`) put five questions.
 * The owner answered the one about exposure on 2026-09-30: a person holding a
 * link sees «примерно следующее, либо то что +- у Telegram» — the group's name,
 * its picture and how many members it has, and nothing else. He delegated the
 * rest to the references.
 *
 * WHAT TELEGRAM DOES, READ 2026-09-30. Its link editor (Android
 * `LinkEditActivity`) offers a time limit of 1 hour, 1 day, 1 week or none, and
 * a use limit of 1, 10, 100 or none — **both defaulting to none** — plus an
 * optional name for the link. Any link can be revoked. Join requests that an
 * administrator approves one by one are a larger mechanic and are not built.
 *
 * WHAT THIS ADDS.
 *
 *   - `public.chat_invite_links`: one row per link. The token is stored, as
 *     Telegram shows a group's links to whoever may invite: an inviter can copy a
 *     link again later. It is readable only by whoever may invite into that chat
 *     (`chat_invite_allowed`), and it is never written directly.
 *   - `chat_invite_allowed(chat)`: exactly `group_invite_create`'s gate —
 *     `system.manage`; or `chats.invite_any` and membership; or the policy
 *     `members_can_invite` with membership and `chats.invite`; or the chat's own
 *     owner or administrator. A link is an invitation to whoever holds it, so it
 *     is never easier to make than an invitation to one named person.
 *   - `chat_invite_link_create`, `chat_invite_link_revoke`: the only writers.
 *   - `chat_invite_link_preview(token)`: what the holder of a link may see
 *     before joining. For a dead link — unknown, revoked, expired or used up —
 *     it answers with the state alone, so a link that has been withdrawn does
 *     not go on saying which group it led to.
 *   - `chat_invite_link_join(token)`: checks everything in one transaction with
 *     the link's row locked, adds the member, counts the use. Somebody already in
 *     the group is let through without counting a use.
 *
 * WHO CAN NEVER USE ONE. An account the product has banned; anybody once a link
 * is revoked, expired or used up; nobody without an account, because every
 * function refuses an anonymous caller. A person removed from the group may come
 * back through a valid link: there is no per-group ban to stop that, and adding
 * one is a separate decision.
 *
 * WHAT THE GROUP HEARS. The existing «присоединился(ась) к группе» line, which
 * `write_membership_service_message` writes for a join into a group of more than
 * one member. A channel, which that trigger skips, gets the same line from here,
 * as `group_invite_accept` does for it.
 *
 * Lock: new objects only, plus grants. Rollback:
 * 20260930120000_chat_invite_links.rollback.sql.
 */
begin;
set local lock_timeout = '5s';

create table public.chat_invite_links (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  token text not null,
  title text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses integer,
  uses integer not null default 0,
  revoked_at timestamptz,
  constraint chat_invite_links_token_shape check (token ~ '^[A-Za-z0-9_-]{22}$'),
  constraint chat_invite_links_title_valid
    check (title is null or (title = btrim(title) and char_length(title) between 1 and 32)),
  constraint chat_invite_links_max_uses_valid check (max_uses is null or max_uses between 1 and 100000),
  constraint chat_invite_links_uses_valid check (uses >= 0 and (max_uses is null or uses <= max_uses)),
  constraint chat_invite_links_expiry_after_creation check (expires_at is null or expires_at > created_at)
);

create unique index chat_invite_links_token_key on public.chat_invite_links (token);
create index chat_invite_links_chat_idx on public.chat_invite_links (chat_id, created_at desc);

alter table public.chat_invite_links enable row level security;

-- Revoke first: this deployment's default privileges hand `anon` and
-- `authenticated` everything on a new table in `public`.
revoke all on public.chat_invite_links from public, anon, authenticated;
grant select on public.chat_invite_links to authenticated;

/**
 * Whether the signed-in person may invite into this chat: `group_invite_create`'s
 * four branches, read off production on 2026-09-17 and mirrored by the client in
 * `lib/chatInviteAccess.ts`.
 */
create or replace function public.chat_invite_allowed(p_chat_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_type text;
  v_policy text;
  v_role text;
begin
  if v_me is null then
    return false;
  end if;
  select chat_row.type, coalesce(chat_row.invite_policy, 'owner_admin_only')
    into v_type, v_policy
    from public.chats as chat_row
   where chat_row.id = p_chat_id;
  if v_type is null or v_type not in ('group', 'channel') then
    return false;
  end if;
  if public.has_permission(v_me, 'system.manage') then
    return true;
  end if;
  select member.role::text into v_role
    from public.chat_members as member
   where member.chat_id = p_chat_id and member.user_id = v_me;
  if v_role is null then
    return false;
  end if;
  if public.has_permission(v_me, 'chats.invite_any') then
    return true;
  end if;
  if v_policy = 'members_can_invite' then
    return public.has_permission(v_me, 'chats.invite');
  end if;
  return v_role in ('owner', 'admin');
end
$$;

revoke all on function public.chat_invite_allowed(uuid) from public, anon;
grant execute on function public.chat_invite_allowed(uuid) to authenticated;

create policy "Inviters read their chat's links"
  on public.chat_invite_links
  for select
  to authenticated
  using (public.chat_invite_allowed(chat_id));

create policy "block banned reads (chat_invite_links)"
  on public.chat_invite_links
  as restrictive
  for select
  to authenticated
  using (not public.is_banned((select auth.uid())));

comment on table public.chat_invite_links is
  'A link into a group. Readable by whoever may invite into that chat; written only through chat_invite_link_create and chat_invite_link_revoke.';

create or replace function public.chat_invite_link_create(
  p_chat_id uuid,
  p_expires_in_seconds integer default null,
  p_max_uses integer default null,
  p_title text default null
)
returns public.chat_invite_links
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_type text;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_token text;
  v_row public.chat_invite_links;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_me) then
    raise exception 'banned' using errcode = '42501';
  end if;
  select chat_row.type into v_type from public.chats as chat_row where chat_row.id = p_chat_id;
  if v_type is null then
    raise exception 'chat_not_found' using errcode = 'P0002';
  end if;
  if v_type not in ('group', 'channel') then
    raise exception 'invite_link_not_group_chat' using errcode = '22023';
  end if;
  if not public.chat_invite_allowed(p_chat_id) then
    raise exception 'invite_link_forbidden' using errcode = '42501';
  end if;
  if p_expires_in_seconds is not null and (p_expires_in_seconds < 60 or p_expires_in_seconds > 31536000) then
    raise exception 'invite_link_bad_expiry' using errcode = '22023';
  end if;
  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 100000) then
    raise exception 'invite_link_bad_uses' using errcode = '22023';
  end if;
  if v_title is not null and char_length(v_title) > 32 then
    raise exception 'invite_link_bad_title' using errcode = '22023';
  end if;
  -- A ceiling on live links per chat, so nobody fills the table from a loop.
  if (
    select count(*)
      from public.chat_invite_links as link
     where link.chat_id = p_chat_id
       and link.revoked_at is null
       and (link.expires_at is null or link.expires_at > now())
  ) >= 100 then
    raise exception 'invite_link_too_many' using errcode = '54000';
  end if;

  -- 128 random bits, base64url without padding: 22 characters.
  v_token := translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_');

  insert into public.chat_invite_links (chat_id, token, title, created_by, expires_at, max_uses)
  values (
    p_chat_id,
    v_token,
    v_title,
    v_me,
    case when p_expires_in_seconds is null then null else now() + make_interval(secs => p_expires_in_seconds) end,
    p_max_uses
  )
  returning * into v_row;

  return v_row;
end
$$;

revoke all on function public.chat_invite_link_create(uuid, integer, integer, text) from public, anon;
grant execute on function public.chat_invite_link_create(uuid, integer, integer, text) to authenticated;

/**
 * Withdraw a link at once. Whoever made it may, while they still may invite;
 * so may the chat's owner or an administrator, whoever made it.
 */
create or replace function public.chat_invite_link_revoke(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_chat uuid;
  v_creator uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select link.chat_id, link.created_by into v_chat, v_creator
    from public.chat_invite_links as link
   where link.id = p_link_id
     for update;
  if v_chat is null then
    raise exception 'invite_link_not_found' using errcode = 'P0002';
  end if;
  if not (
    public.chat_invite_allowed(v_chat)
    and (v_creator = v_me or public.is_chat_admin(v_chat) or public.has_permission(v_me, 'system.manage'))
  ) then
    raise exception 'invite_link_forbidden' using errcode = '42501';
  end if;
  update public.chat_invite_links
     set revoked_at = coalesce(revoked_at, now())
   where id = p_link_id;
end
$$;

revoke all on function public.chat_invite_link_revoke(uuid) from public, anon;
grant execute on function public.chat_invite_link_revoke(uuid) to authenticated;

/**
 * What a person holding a link sees before joining: the group's name, picture
 * and member count — the owner's answer, ± Telegram. A dead link answers with its
 * state and nothing about the group.
 */
create or replace function public.chat_invite_link_preview(p_token text)
returns table (
  state text,
  chat_id uuid,
  name text,
  avatar_url text,
  member_count integer
)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_link public.chat_invite_links;
  v_chat public.chats;
  v_count integer;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return query select 'invalid'::text, null::uuid, null::text, null::text, null::integer;
    return;
  end if;
  select * into v_link from public.chat_invite_links as link where link.token = p_token;
  if v_link.id is null then
    return query select 'invalid'::text, null::uuid, null::text, null::text, null::integer;
    return;
  end if;
  select * into v_chat from public.chats as chat_row where chat_row.id = v_link.chat_id;
  if v_chat.id is null or v_chat.type not in ('group', 'channel') then
    return query select 'invalid'::text, null::uuid, null::text, null::text, null::integer;
    return;
  end if;

  select count(*)::integer into v_count from public.chat_members as member where member.chat_id = v_chat.id;

  -- Somebody already inside may see it whatever the link's state: they see the
  -- group anyway, and the link then only needs to take them there.
  if exists (select 1 from public.chat_members as member where member.chat_id = v_chat.id and member.user_id = v_me) then
    return query select 'member'::text, v_chat.id, v_chat.name, v_chat.avatar_url, v_count;
    return;
  end if;
  if public.is_banned(v_me) then
    return query select 'unavailable'::text, null::uuid, null::text, null::text, null::integer;
    return;
  end if;
  if v_link.revoked_at is not null then
    return query select 'revoked'::text, null::uuid, null::text, null::text, null::integer;
    return;
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::text, null::text, null::integer;
    return;
  end if;
  if v_link.max_uses is not null and v_link.uses >= v_link.max_uses then
    return query select 'used_up'::text, null::uuid, null::text, null::text, null::integer;
    return;
  end if;
  return query select 'ok'::text, v_chat.id, v_chat.name, v_chat.avatar_url, v_count;
end
$$;

revoke all on function public.chat_invite_link_preview(text) from public, anon;
grant execute on function public.chat_invite_link_preview(text) to authenticated;

/** Join through a link, and count the use. Everything is decided under the link's lock. */
create or replace function public.chat_invite_link_join(p_token text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_link public.chat_invite_links;
  v_type text;
  v_now timestamptz := now();
  v_joined boolean;
  v_members bigint;
  v_display_name text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_me) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'invite_link_invalid' using errcode = 'P0002';
  end if;
  select * into v_link from public.chat_invite_links as link where link.token = p_token for update;
  if v_link.id is null then
    raise exception 'invite_link_invalid' using errcode = 'P0002';
  end if;
  select chat_row.type into v_type from public.chats as chat_row where chat_row.id = v_link.chat_id;
  if v_type is null or v_type not in ('group', 'channel') then
    raise exception 'invite_link_invalid' using errcode = 'P0002';
  end if;

  -- Already inside: taken there, and no use is counted.
  if exists (select 1 from public.chat_members as member where member.chat_id = v_link.chat_id and member.user_id = v_me) then
    return v_link.chat_id;
  end if;
  if v_link.revoked_at is not null then
    raise exception 'invite_link_revoked' using errcode = 'P0001';
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= v_now then
    raise exception 'invite_link_expired' using errcode = 'P0001';
  end if;
  if v_link.max_uses is not null and v_link.uses >= v_link.max_uses then
    raise exception 'invite_link_used_up' using errcode = 'P0001';
  end if;

  insert into public.chat_members (chat_id, user_id, role, joined_at, last_read_at, last_delivered_at)
  values (v_link.chat_id, v_me, 'member'::public.chat_member_role, v_now, v_now, v_now)
  on conflict (chat_id, user_id) do nothing
  returning true into v_joined;

  if coalesce(v_joined, false) then
    update public.chat_invite_links set uses = uses + 1 where id = v_link.id;

    -- The membership trigger announces a join into a group of more than one
    -- member; a channel, and a group whose only member is the one who just
    -- joined, get the line here, as `group_invite_accept` gives it to them.
    select count(*) into v_members from public.chat_members as member where member.chat_id = v_link.chat_id;
    if not (v_type = 'group' and v_members > 1) then
      select coalesce(nullif(btrim(profile.full_name), ''), nullif(profile.username, ''), 'Пользователь')
        into v_display_name
        from public.profiles as profile
       where profile.id = v_me;
      insert into public.messages (chat_id, user_id, type, content)
      values (v_link.chat_id, null, 'system', coalesce(v_display_name, 'Пользователь') || ' присоединился к группе');
    end if;
  end if;

  return v_link.chat_id;
end
$$;

revoke all on function public.chat_invite_link_join(text) from public, anon;
grant execute on function public.chat_invite_link_join(text) to authenticated;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.chat_invite_links'::regclass)
    or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'chat_invite_links') <> 2
    or pg_catalog.has_table_privilege('anon', 'public.chat_invite_links', 'SELECT')
    or not pg_catalog.has_table_privilege('authenticated', 'public.chat_invite_links', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.chat_invite_links', 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', 'public.chat_invite_links', 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.chat_invite_links', 'DELETE')
    or pg_catalog.has_function_privilege('anon', 'public.chat_invite_link_join(text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', 'public.chat_invite_link_preview(text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', 'public.chat_invite_link_create(uuid, integer, integer, text)', 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', 'public.chat_invite_link_join(text)', 'EXECUTE')
  then
    raise exception 'chat_invite_links_rls_or_grants_invalid';
  end if;
end;
$$;

commit;
