/**
 * The two doors a person needs into a bot, and neither existed.
 *
 * The bot platform was built from the bot's side: a bot can send an inline
 * keyboard, register its commands and be added to a chat, and every one of
 * those paths is `service_role`. Nothing let the **person** act. Measured on
 * production on 2026-09-14:
 *
 *   - `public.bot_update_enqueue_internal(p_bot_id, p_update_type, p_source_id,
 *     p_context)` is the only writer of `private.bot_updates`. Its
 *     `callback_query` branch is complete and already checks that the actor is
 *     a member of the chat, that the bot is in it, and that the message is
 *     inside the bot's history window. But it takes the actor **inside
 *     `p_context`** and trusts its caller for it, which is why it can only be
 *     `service_role`: granting it to `authenticated` would let one member of a
 *     chat press a button in another member's name.
 *   - `public.chat_bot_members` grants `authenticated` **SELECT and nothing
 *     else**, with one SELECT policy. So a bot found in search could not be
 *     opened, because the row that would put the bot in a chat could not be
 *     written by anybody but the service.
 *
 * This adds the two wrappers that close those, and adds nothing else.
 *
 * **Neither takes an actor.** Both read `auth.uid()` and refuse without one.
 * That is the whole reason they exist: a function that accepts the actor as an
 * argument cannot be given to the people it is about.
 *
 * `bot_callback_press` also checks something the internal function does not:
 * that the data belongs to a button that is actually on that message. The
 * internal branch bounds the length and nothing else, so without this a member
 * could send a bot any string it liked. Telegram does not check this either;
 * we can, because the keyboard is on the row.
 *
 * Rollback: `20260914150000_bot_press_and_bot_chat.rollback.sql`.
 */

begin;

set local lock_timeout = '5s';

/**
 * A person presses a button on a bot's message.
 *
 * Returns the callback id, so a client can match the bot's answer to the press
 * once `private.bot_callback_answers` is readable by anyone at all — it is
 * revoked from every role today, including `service_role`, and that is a
 * separate gap this migration deliberately does not touch.
 */
create or replace function public.bot_callback_press(p_message_id uuid, p_data text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_bot_id uuid;
  v_markup jsonb;
  v_callback_id uuid := pg_catalog.gen_random_uuid();
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_message_id is null
     or p_data is null
     or pg_catalog.octet_length(p_data) not between 1 and 128 then
    raise exception 'bot_press_input_invalid' using errcode = '22023';
  end if;

  select message_row.bot_id, message_row.bot_reply_markup
    into v_bot_id, v_markup
    from public.messages message_row
   where message_row.id = p_message_id
     and message_row.bot_id is not null
     and message_row.deleted_at is null;
  if not found then
    raise exception 'bot_press_no_such_message' using errcode = '42501';
  end if;

  -- The button has to be on the message. Without this the length is the only
  -- bound there is, and a member could send the bot any string at all.
  if v_markup is null or not exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_markup->'inline_keyboard') keyboard_row,
           pg_catalog.jsonb_array_elements(keyboard_row) button
     where button->>'callback_data' = p_data
  ) then
    raise exception 'bot_press_no_such_button' using errcode = '42501';
  end if;

  -- Membership, the bot's presence and the history window are all the internal
  -- function's own checks, and it raises 42501 for each. They are not repeated
  -- here: two copies of one rule drift, and the copy that is not the one being
  -- enforced is the one that gets read.
  perform public.bot_update_enqueue_internal(
    v_bot_id,
    'callback_query',
    p_message_id,
    pg_catalog.jsonb_build_object(
      'callback_id', v_callback_id,
      'actor_id', v_actor,
      'data', p_data
    )
  );

  return v_callback_id;
end
$function$;

revoke all on function public.bot_callback_press(uuid, text) from public, anon;
grant execute on function public.bot_callback_press(uuid, text) to authenticated;

/**
 * Open the chat with a bot, making it if it is not there yet.
 *
 * Idempotent: a second call returns the same chat. The chat is `private` and
 * carries the bot's name, because a private chat's title comes from the other
 * human and a bot chat has none — `useChats` fills `other_user` only where
 * there is one.
 */
create or replace function public.open_or_create_bot_chat(p_bot_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_bot public.bots%rowtype;
  v_chat_id uuid;
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if public.is_banned(v_actor) then
    raise exception 'banned' using errcode = '42501';
  end if;

  select * into v_bot from public.bots where id = p_bot_id and state = 'active';
  if not found then
    raise exception 'bot_not_available' using errcode = '42501';
  end if;

  -- An existing chat with this bot that this person is in, and no other human.
  select member_row.chat_id into v_chat_id
    from public.chat_bot_members member_row
    join public.chats chat_row on chat_row.id = member_row.chat_id
    join public.chat_members mine
      on mine.chat_id = member_row.chat_id and mine.user_id = v_actor
   where member_row.bot_id = p_bot_id
     and member_row.removed_at is null
     and chat_row.type = 'private'
     and (select pg_catalog.count(*) from public.chat_members other
           where other.chat_id = member_row.chat_id) = 1
   limit 1;
  if v_chat_id is not null then
    -- Hidden earlier is not gone: opening it again is what the person asked
    -- for, so the chat comes back rather than a second one being made.
    update public.chat_members
       set hidden_at = null
     where chat_id = v_chat_id and user_id = v_actor and hidden_at is not null;
    return v_chat_id;
  end if;

  insert into public.chats (type, name, created_by)
    values ('private', v_bot.display_name, v_actor)
    returning id into v_chat_id;

  -- `trg_add_chat_creator_as_owner` has already written this row, which is why
  -- it is an upsert rather than an insert. The same collision failed the
  -- blocks-and-reports rehearsal on 2026-09-14.
  insert into public.chat_members (chat_id, user_id, role)
    values (v_chat_id, v_actor, 'owner')
    on conflict (chat_id, user_id) do nothing;

  insert into public.chat_bot_members (chat_id, bot_id)
    values (v_chat_id, p_bot_id);

  return v_chat_id;
end
$function$;

revoke all on function public.open_or_create_bot_chat(uuid) from public, anon;
grant execute on function public.open_or_create_bot_chat(uuid) to authenticated;

do $check$
declare
  v_row record;
begin
  for v_row in
    select p.proname, p.prosecdef, p.proconfig,
           pg_catalog.has_function_privilege('authenticated', p.oid, 'execute') as auth_may,
           pg_catalog.has_function_privilege('anon', p.oid, 'execute') as anon_may
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('bot_callback_press', 'open_or_create_bot_chat')
  loop
    if not v_row.prosecdef then
      raise exception '% is not security definer', v_row.proname;
    end if;
    -- `proconfig` stores it as `search_path=""`, quotes and all — an equality
    -- against `search_path=` refuses a function that is pinned correctly, which
    -- is how the first apply of this file failed and rolled itself back.
    if v_row.proconfig is null
       or not exists (
         select 1 from pg_catalog.unnest(v_row.proconfig) setting
          where setting like 'search_path=%'
            and pg_catalog.btrim(pg_catalog.split_part(setting, '=', 2), '"') = ''
       ) then
      raise exception '% does not pin an empty search_path: %', v_row.proname, v_row.proconfig;
    end if;
    if not v_row.auth_may then
      raise exception 'authenticated cannot execute %', v_row.proname;
    end if;
    if v_row.anon_may then
      raise exception 'anon can execute %', v_row.proname;
    end if;
  end loop;

  -- Neither may take an actor: that is the reason they exist rather than a
  -- grant on the internal function.
  if exists (
    select 1 from pg_catalog.pg_proc p
     where p.proname in ('bot_callback_press', 'open_or_create_bot_chat')
       and pg_catalog.pg_get_function_identity_arguments(p.oid) ilike '%actor%'
  ) then
    raise exception 'a wrapper takes an actor as an argument, which is the hole it was written to close';
  end if;

  -- And the internal enqueuer stays where it was.
  if pg_catalog.has_function_privilege('authenticated', 'public.bot_update_enqueue_internal(uuid, text, uuid, jsonb)', 'execute') then
    raise exception 'bot_update_enqueue_internal was opened to authenticated';
  end if;

  raise notice 'a person can press a bot button and open a bot chat, and neither door takes an actor';
end
$check$;

commit;
