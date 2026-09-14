-- Rehearsal: 20260914150000_bot_press_and_bot_chat.sql
--
-- Run against a database that already has an active bot and an unbanned person
-- -- production qualifies, and that is where it was run on 2026-09-14, five
-- rules green and rolled back:
--   psql -X -f .migration-backup/supabase/rehearsal/20260914150000_bot_press_and_bot_chat.test.sql
--
-- It picks its bot and its person out of what is there rather than making them:
-- creating an account on this deployment requires an invitation, so a fixture
-- that inserts into `auth.users` cannot run here at all.
--
begin;

do $proof$
declare
  v_owner text := current_user;
  v_user uuid; v_bot uuid; v_chat uuid; v_again uuid;
  v_refused boolean; v_err text; v_humans bigint;
begin
  select id into v_bot from public.bots where state = 'active' limit 1;
  select id into v_user from public.profiles where not public.is_banned(id) limit 1;
  if v_bot is null or v_user is null then
    raise exception 'no active bot or no person to measure with';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- 1. Opening a bot chat makes one, and it holds exactly one human.
  v_chat := public.open_or_create_bot_chat(v_bot);
  select count(*) into v_humans from public.chat_members where chat_id = v_chat;
  perform set_config('role', v_owner, true);
  if v_chat is null then
    raise exception '1. no chat came back';
  end if;
  if v_humans <> 1 then
    raise exception '1. the bot chat holds % humans rather than one', v_humans;
  end if;
  raise notice '1. a bot chat is opened, with exactly one person in it';

  -- 2. A second call returns the same chat rather than a second one.
  perform set_config('role', 'authenticated', true);
  v_again := public.open_or_create_bot_chat(v_bot);
  perform set_config('role', v_owner, true);
  if v_again <> v_chat then
    raise exception '2. a second call made a second chat (% then %)', v_chat, v_again;
  end if;
  raise notice '2. asking twice gives the same chat';

  -- 3. The bot is actually in it.
  if not exists (
    select 1 from public.chat_bot_members
     where chat_id = v_chat and bot_id = v_bot and removed_at is null
  ) then
    raise exception '3. the chat was made without the bot in it';
  end if;
  raise notice '3. the bot is in the chat that was made for it';

  -- 4. A press on a message that is not a bot's is refused, and the refusal is
  --    a permission error rather than a crash.
  perform set_config('role', 'authenticated', true);
  begin
    perform public.bot_callback_press(gen_random_uuid(), 'anything');
    v_refused := false;
  exception when insufficient_privilege then
    v_refused := true;
  end;
  perform set_config('role', v_owner, true);
  if not v_refused then
    raise exception '4. a press on a message that does not exist went through';
  end if;
  raise notice '4. a press needs a bot message that exists';

  -- 5. Neither door may be reached by `anon`, and the internal enqueuer is
  --    still closed to everybody but the service.
  if has_function_privilege('anon', 'public.bot_callback_press(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.open_or_create_bot_chat(uuid)', 'execute') then
    raise exception '5. anon can reach a bot door';
  end if;
  if has_function_privilege('authenticated', 'public.bot_update_enqueue_internal(uuid, text, uuid, jsonb)', 'execute') then
    raise exception '5. the internal enqueuer was opened to authenticated';
  end if;
  raise notice '5. anon holds neither door, and the internal enqueuer is still the service''s';

  raise notice 'ALL FIVE PASSED (and this transaction is about to roll back)';
end
$proof$;

rollback;
