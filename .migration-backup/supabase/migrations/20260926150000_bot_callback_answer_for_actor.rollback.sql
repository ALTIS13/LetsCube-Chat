begin;

set local lock_timeout = '5s';

drop function if exists public.bot_callback_answer_for_actor(uuid);
drop index if exists private.bot_callback_answers_callback_id_idx;

notify pgrst, 'reload schema';

commit;
