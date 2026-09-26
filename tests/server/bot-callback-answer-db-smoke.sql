\set ON_ERROR_STOP on

begin;

do $smoke$
declare
  v_bot_id uuid;
  v_second_bot_id uuid;
  v_actor uuid;
  v_other uuid;
  v_callback_id uuid := pg_catalog.gen_random_uuid();
  v_source_id bigint;
  v_second_source_id bigint;
  v_view jsonb;
begin
  select bot.id into v_bot_id from public.bots bot where bot.state = 'active' limit 1;
  select bot.id into v_second_bot_id from public.bots bot
    where bot.state = 'active' and bot.id <> v_bot_id limit 1;
  select profile.id into v_actor from public.profiles profile order by profile.id limit 1;
  select profile.id into v_other from public.profiles profile
    where profile.id <> v_actor order by profile.id limit 1;
  if v_bot_id is null or v_actor is null or v_other is null then
    raise exception 'bot_callback_smoke_fixture_unavailable';
  end if;

  if pg_catalog.has_table_privilege('authenticated', 'private.bot_callback_answers', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'private.bot_updates', 'SELECT')
     or not pg_catalog.has_function_privilege(
       'authenticated', 'public.bot_callback_answer_for_actor(uuid)', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon', 'public.bot_callback_answer_for_actor(uuid)', 'EXECUTE'
     ) then
    raise exception 'bot_callback_reader_privileges_invalid';
  end if;

  insert into private.bot_updates(bot_id, update_id, update_type, payload)
  values (
    v_bot_id,
    (select coalesce(pg_catalog.max(queued.update_id), 0) + 1000000
       from private.bot_updates queued where queued.bot_id = v_bot_id),
    'callback_query',
    pg_catalog.jsonb_build_object('callback_query', pg_catalog.jsonb_build_object(
      'id', v_callback_id, 'from', pg_catalog.jsonb_build_object('id', v_actor)
    ))
  ) returning id into v_source_id;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_answer_for_actor(v_callback_id) into v_view;
  if v_view is not null then
    raise exception 'unanswered_callback_visible';
  end if;
  execute 'reset role';

  insert into private.bot_callback_answers(bot_id, callback_query_id, source_update_id, text, show_alert)
  values (v_bot_id, v_callback_id, v_source_id, 'Private answer', true);

  perform pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_answer_for_actor(v_callback_id) into v_view;
  if v_view is not null then
    raise exception 'callback_answer_leaked_to_other_actor';
  end if;
  execute 'reset role';

  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_answer_for_actor(v_callback_id) into v_view;
  if v_view is distinct from pg_catalog.jsonb_build_object('text', 'Private answer', 'show_alert', true) then
    raise exception 'callback_answer_missing_for_actor';
  end if;
  select public.bot_callback_answer_for_actor(pg_catalog.gen_random_uuid()) into v_view;
  if v_view is not null then
    raise exception 'unknown_callback_visible';
  end if;
  execute 'reset role';

  if v_second_bot_id is not null then
    insert into private.bot_updates(bot_id, update_id, update_type, payload)
    values (
      v_second_bot_id,
      (select coalesce(pg_catalog.max(queued.update_id), 0) + 1000000
         from private.bot_updates queued where queued.bot_id = v_second_bot_id),
      'callback_query',
      pg_catalog.jsonb_build_object('callback_query', pg_catalog.jsonb_build_object(
        'id', v_callback_id, 'from', pg_catalog.jsonb_build_object('id', v_other)
      ))
    ) returning id into v_second_source_id;
    insert into private.bot_callback_answers(bot_id, callback_query_id, source_update_id, text, show_alert)
    values (v_second_bot_id, v_callback_id, v_second_source_id, 'Other bot answer', false);

    perform pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
    execute 'set local role authenticated';
    select public.bot_callback_answer_for_actor(v_callback_id) into v_view;
    if v_view is distinct from pg_catalog.jsonb_build_object('text', 'Other bot answer', 'show_alert', false) then
      raise exception 'callback_answer_cross_bot_collision';
    end if;
    execute 'reset role';
  end if;

  delete from private.bot_updates where id = v_source_id;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_answer_for_actor(v_callback_id) into v_view;
  if v_view is not null then
    raise exception 'detached_callback_answer_visible';
  end if;
  execute 'reset role';
end
$smoke$;

select 'bot_callback_answer_db_smoke_ok' as result;

rollback;
