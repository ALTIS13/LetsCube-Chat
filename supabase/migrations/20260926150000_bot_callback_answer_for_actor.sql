-- Return a bot's private callback answer only to the account that pressed it.
-- The source update is the authority; a detached answer is intentionally hidden.
-- Rollback: .migration-backup/supabase/migrations/20260926150000_bot_callback_answer_for_actor.rollback.sql
begin;

set local lock_timeout = '5s';

create index if not exists bot_callback_answers_callback_id_idx
  on private.bot_callback_answers(callback_query_id, bot_id);

create or replace function public.bot_callback_answer_for_actor(p_callback_query_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_answer jsonb;
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_callback_query_id is null then
    raise exception 'bot_callback_input_invalid' using errcode = '22023';
  end if;

  select pg_catalog.jsonb_build_object(
    'text', answer.text,
    'show_alert', answer.show_alert
  )
  into v_answer
  from private.bot_callback_answers answer
  join private.bot_updates queued
    on queued.id = answer.source_update_id
   and queued.bot_id = answer.bot_id
   and queued.update_type = 'callback_query'
  where answer.callback_query_id = p_callback_query_id
    and queued.payload#>>'{callback_query,id}' = p_callback_query_id::text
    and queued.payload#>>'{callback_query,from,id}' = v_actor::text
    and answer.answered_at >= pg_catalog.now() - interval '10 minutes'
    and queued.created_at >= pg_catalog.now() - interval '10 minutes'
  limit 1;

  return v_answer;
end
$function$;

revoke all on function public.bot_callback_answer_for_actor(uuid)
  from public, anon, service_role;
grant execute on function public.bot_callback_answer_for_actor(uuid)
  to authenticated;

do $check$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid = 'public.bot_callback_answer_for_actor(uuid)'::regprocedure
      and procedure_row.prosecdef
      and 'search_path=""' = any(procedure_row.proconfig)
  ) or not pg_catalog.has_function_privilege(
    'authenticated', 'public.bot_callback_answer_for_actor(uuid)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon', 'public.bot_callback_answer_for_actor(uuid)', 'EXECUTE'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'private.bot_callback_answers', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'private.bot_updates', 'SELECT'
  ) then
    raise exception 'bot_callback_answer_reader_privileges_invalid';
  end if;
end
$check$;

notify pgrst, 'reload schema';

commit;
