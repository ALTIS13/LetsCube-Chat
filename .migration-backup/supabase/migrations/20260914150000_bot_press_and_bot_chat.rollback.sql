/**
 * Rollback for 20260914150000_bot_press_and_bot_chat.sql.
 *
 * It takes away the only two doors a person has into a bot: pressing a button
 * on a bot's message, and opening a chat with one. The chats and the presses
 * already made are untouched — these are functions, not data — but every
 * inline keyboard in the product goes back to being a question nobody can
 * answer. Worth knowing before running this rather than after.
 */

begin;

set local lock_timeout = '5s';

drop function if exists public.bot_callback_press(uuid, text);
drop function if exists public.open_or_create_bot_chat(uuid);

do $check$
begin
  if pg_catalog.to_regproc('public.bot_callback_press') is not null
     or pg_catalog.to_regproc('public.open_or_create_bot_chat') is not null then
    raise exception 'a wrapper survived its own rollback';
  end if;
end
$check$;

commit;
