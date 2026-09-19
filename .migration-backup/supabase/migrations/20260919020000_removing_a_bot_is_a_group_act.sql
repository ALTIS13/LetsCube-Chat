/**
 * Removing a bot is something you do in a group, and only there.
 *
 * `20260919010000_a_bot_can_be_put_in_a_group.sql` gave `chat_bot_add` a
 * `type <> 'group'` refusal and gave `chat_bot_remove` none. Raised by the agent
 * building the interface, who noticed the asymmetry and — correctly — wrote no
 * migration for it.
 *
 * ── What the asymmetry allows ──────────────────────────────────────────────
 *
 * `open_or_create_bot_chat` makes the person who opens a private bot chat its
 * **owner**, so `is_chat_admin` is true there. Nothing in the interface offers
 * it, but the function is granted to `authenticated` and can be called
 * directly, and then:
 *
 * 1. the membership is soft-removed, so `bot_membership_authorize_internal`
 *    stops allowing the bot anything and the conversation goes quiet;
 * 2. `useBotChat` finds no bot for that chat;
 * 3. the next `open_or_create_bot_chat` does not find the removed membership
 *    and **creates a second private chat with the same bot**.
 *
 * Not destructive — no message is lost and nothing is exposed — but it leaves a
 * person with two identical conversations and one of them permanently mute,
 * with nothing in the interface able to explain or undo it. It is the same
 * shape as D-206: an ordinary rule («an admin manages the members») meeting a
 * chat type where «admin» means something else, because whoever opened the chat
 * holds it.
 *
 * ── The fix, and what it deliberately does not do ──────────────────────────
 *
 * The group check that `chat_bot_add` already has, and nothing more. In
 * particular it does **not** try to repair the private-chat ownership itself:
 * that is `open_or_create_bot_chat`'s and D-206's territory, it affects more
 * than bots, and a migration about a removal button is not where that gets
 * decided.
 *
 * Nor does it clean up any duplicate chat that may already exist. None does —
 * checked below and the count is zero — and deleting a person's conversations
 * would need its own mandate.
 */

begin;

create or replace function public.chat_bot_remove(p_chat_id uuid, p_bot_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_type text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- The same refusal `chat_bot_add` gives, and for a sharper reason: in a
  -- private bot chat `is_chat_admin` is true for whoever opened it, so without
  -- this line the check below is no check at all. See this file's header for
  -- what that allowed.
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
  'Remove a bot from a group as an administrator. Soft, because that is what the authoriser reads. A private bot chat is refused: its opener is its owner.';

do $$
declare
  v_dupes integer;
  v_orphans integer;
begin
  -- The state the gap could have produced, counted rather than assumed.
  select count(*) into v_dupes from (
    select m.bot_id, c.created_by
      from public.chat_bot_members as m
      join public.chats as c on c.id = m.chat_id
     where c.type = 'private'
     group by m.bot_id, c.created_by
    having count(*) > 1
  ) as t;
  if v_dupes > 0 then
    raise warning 'there are % bot/opener pairs with more than one private chat', v_dupes;
  end if;

  select count(*) into v_orphans
    from public.chat_bot_members as m
    join public.chats as c on c.id = m.chat_id
   where c.type = 'private' and m.removed_at is not null;
  if v_orphans > 0 then
    raise warning 'there are % soft-removed memberships in private chats', v_orphans;
  end if;

  if (select pg_get_functiondef(p.oid)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'chat_bot_remove') not like '%not_a_group%' then
    raise exception 'the removal still accepts a chat that is not a group';
  end if;
end;
$$;

commit;
