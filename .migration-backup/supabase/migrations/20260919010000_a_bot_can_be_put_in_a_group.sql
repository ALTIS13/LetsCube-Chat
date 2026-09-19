/**
 * A bot can be put in a group, which until now nothing could do.
 *
 * D-235. Reported by the owner: «бота нельзя добавить в групповой чат (его не
 * видно в списке приглашения)». The invite list not showing one is the symptom
 * — `GroupInviteModal` searches `public.profiles` and a bot is not a profile —
 * and the cause is a layer deeper: **`chat_bot_members` has exactly one policy,
 * `SELECT`**, no INSERT policy at all, and no write path anywhere except
 * `open_or_create_bot_chat`, which makes the *private* chat. Production carries
 * one bot membership and it is private.
 *
 * ── Everything else was already built ──────────────────────────────────────
 *
 * This is the pleasant surprise in the entry and it shapes the whole migration.
 * The group model is not missing; it is finished and unreachable:
 *
 * - `chat_bot_members` carries `privacy_mode`, `full_visibility_requested_at`,
 *   `full_visibility_approved_by` and `removed_at`;
 * - `bot_membership_authorize_internal` **already enforces it**: in a group,
 *   `receive_all` requires `privacy_mode = 'full'` *and* an approver, while
 *   `send_message`, `read_file` and `manage` are allowed to any active
 *   membership, and a private chat is exempt;
 * - the CHECK constraint makes `'full'` impossible to write without both the
 *   request and the approval.
 *
 * So what is added here is only the door. Nothing about the privacy model is
 * invented, re-decided, or duplicated.
 *
 * ── Why a bot always joins «restricted», and why that is not a default ─────
 *
 * The register asked for «the privacy mode chosen at the moment of adding
 * rather than defaulted silently». The schema answers it more firmly than an
 * interface could: `chat_bot_members_visibility_approval_check` forbids a
 * `'full'` row that has no approver, so **there is no one-step way to add a bot
 * that reads everything**. A bot enters seeing only what is addressed to it, and
 * raising that is a second, deliberate act.
 *
 * That second act is deliberately **not** in this migration. The two columns are
 * shaped for a two-party flow — somebody asks, an administrator approves — and
 * the asking side lives in the bot management API. Building only the approving
 * half here would be a control with nothing to approve.
 *
 * ── Who may ──────────────────────────────────────────────────────────────────
 *
 * `is_chat_admin(chat_id)`, the same rule that governs every other act of chat
 * administration, and the same one whose absence for the *other* participant of
 * a private chat produced slice A's definer RPC. A group is the only target: a
 * private chat's bot membership is `open_or_create_bot_chat`'s, and a channel
 * has no bot story yet.
 *
 * Any **active** bot may be added by any administrator of the group, which is
 * Telegram's model: a bot is a public thing and its owner does not gate who
 * invites it. `state <> 'active'` — paused, suspended, pending delete — is
 * refused, because `bot_membership_authorize_internal` would refuse every
 * operation anyway and a membership that can do nothing is a row that lies.
 *
 * ── Removal is soft, because the authoriser reads it that way ──────────────
 *
 * `removed_at` rather than a delete: `bot_membership_authorize_internal` joins
 * `where removed_at is null`, so setting it is exactly what «this bot is no
 * longer here» means to every reader that matters. It also keeps `joined_at`,
 * which is the only record that the bot was ever in the room.
 */

begin;

/**
 * The bots an administrator could add to this group.
 *
 * Returns nothing at all — not an error — for somebody who may not add them, so
 * that a listing cannot be used to enumerate bots from a chat you administer
 * nothing in. An empty answer and a refusal look the same from outside, which
 * is the point.
 */
create or replace function public.chat_bots_available(
  p_chat_id uuid,
  p_query text default null
)
returns table (bot_id uuid, username text, display_name text, description text, avatar_url text)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select b.id, b.username, b.display_name, b.description, b.avatar_url
    from public.bots as b
   where auth.uid() is not null
     and b.state = 'active'
     and (select c.type from public.chats as c where c.id = p_chat_id) = 'group'
     and public.is_chat_admin(p_chat_id)
     and not exists (
       select 1 from public.chat_bot_members as m
        where m.chat_id = p_chat_id and m.bot_id = b.id and m.removed_at is null
     )
     and (
       p_query is null
       or btrim(p_query) = ''
       or b.username ilike '%' || btrim(p_query) || '%'
       or b.display_name ilike '%' || btrim(p_query) || '%'
     )
   order by b.display_name
   limit 20;
$$;

comment on function public.chat_bots_available(uuid, text) is
  'Active bots an administrator of this group could add. Empty for anybody who may not.';

/**
 * Put a bot in a group.
 *
 * Idempotent in the way that matters: adding a bot that is already there is not
 * an error and changes nothing, while adding one that was removed puts it back
 * — the same row, with a fresh `joined_at` and its privacy mode reset to
 * `restricted`. A bot that was once trusted with everything and then removed
 * does not come back trusted.
 */
create or replace function public.chat_bot_add(p_chat_id uuid, p_bot_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_type text;
  v_state text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select c.type into v_type from public.chats as c where c.id = p_chat_id;
  if v_type is null then
    raise exception 'no_such_chat' using errcode = 'P0002';
  end if;
  if v_type <> 'group' then
    raise exception 'not_a_group' using errcode = '22023';
  end if;
  if not public.is_chat_admin(p_chat_id) then
    raise exception 'not_an_admin' using errcode = '42501';
  end if;

  select b.state into v_state from public.bots as b where b.id = p_bot_id;
  if v_state is null then
    raise exception 'no_such_bot' using errcode = 'P0002';
  end if;
  if v_state <> 'active' then
    -- `bot_membership_authorize_internal` would refuse every operation for a
    -- bot in any other state, so the row would be one that lies.
    raise exception 'bot_not_active' using errcode = '22023';
  end if;

  insert into public.chat_bot_members (chat_id, bot_id, privacy_mode, joined_at)
  values (p_chat_id, p_bot_id, 'restricted', pg_catalog.now())
  on conflict (chat_id, bot_id) do update
     set removed_at = null,
         joined_at = case
           when public.chat_bot_members.removed_at is null
           then public.chat_bot_members.joined_at
           else excluded.joined_at
         end,
         privacy_mode = case
           when public.chat_bot_members.removed_at is null
           then public.chat_bot_members.privacy_mode
           else 'restricted'
         end,
         full_visibility_requested_at = case
           when public.chat_bot_members.removed_at is null
           then public.chat_bot_members.full_visibility_requested_at
           else null
         end,
         full_visibility_approved_by = case
           when public.chat_bot_members.removed_at is null
           then public.chat_bot_members.full_visibility_approved_by
           else null
         end,
         updated_at = pg_catalog.now();

  return true;
end;
$$;

comment on function public.chat_bot_add(uuid, uuid) is
  'Add an active bot to a group as an administrator. Restricted visibility; re-adding a removed bot resets it.';

/**
 * Take a bot out of a group.
 *
 * Soft, because `bot_membership_authorize_internal` joins
 * `where removed_at is null` — so this is exactly what «no longer here» means
 * to the reader that decides what the bot may do. Removing one that is already
 * out is not an error.
 */
create or replace function public.chat_bot_remove(p_chat_id uuid, p_bot_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_chat_admin(p_chat_id) then
    raise exception 'not_an_admin' using errcode = '42501';
  end if;

  update public.chat_bot_members
     set removed_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where chat_id = p_chat_id
     and bot_id = p_bot_id
     and removed_at is null;

  return true;
end;
$$;

comment on function public.chat_bot_remove(uuid, uuid) is
  'Remove a bot from a group as an administrator. Soft, because that is what the authoriser reads.';

revoke all on function public.chat_bots_available(uuid, text) from public;
revoke all on function public.chat_bot_add(uuid, uuid) from public;
revoke all on function public.chat_bot_remove(uuid, uuid) from public;

grant execute on function public.chat_bots_available(uuid, text) to authenticated;
grant execute on function public.chat_bot_add(uuid, uuid) to authenticated;
grant execute on function public.chat_bot_remove(uuid, uuid) to authenticated;

do $$
begin
  -- The door is open and the wall is still a wall: no INSERT policy was added
  -- to the table, so these functions remain the only way in.
  if exists (
    select 1 from pg_policy where polrelid = 'public.chat_bot_members'::regclass and polcmd = 'a'
  ) then
    raise exception 'an INSERT policy appeared on chat_bot_members';
  end if;
  if exists (
    select 1 from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'chat_bot_members'
       and grantee in ('authenticated', 'anon') and privilege_type <> 'SELECT'
  ) then
    raise exception 'a client gained a direct write on chat_bot_members';
  end if;

  -- And the privacy model is untouched: `full` still needs an approver.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.chat_bot_members'::regclass
       and conname = 'chat_bot_members_visibility_approval_check'
  ) then
    raise exception 'the visibility approval constraint is gone';
  end if;
end;
$$;

commit;
