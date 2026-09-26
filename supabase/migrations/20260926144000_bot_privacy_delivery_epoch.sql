-- A privacy change starts a new delivery epoch. Pending messages from the
-- previous epoch must not survive in polling or webhook queues.
begin;
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.md5(pg_catalog.pg_get_functiondef('public.chat_bot_set_privacy(uuid,uuid,boolean)'::regprocedure))
       <> '2249b5a7dc0ae51fe92984656aa7c090'
     or pg_catalog.md5(pg_catalog.pg_get_functiondef('public.bot_updates_poll_internal(uuid,bigint,integer,text[],uuid)'::regprocedure))
       <> '25fbd266c1ca0c5beb7a8aef58e6517b'
     or pg_catalog.md5(pg_catalog.pg_get_functiondef('public.bot_delivery_prepare_internal(bigint,uuid,bigint)'::regprocedure))
       <> 'e8d173c2007295d8fa3e0e3d3744520d' then
    raise exception 'bot_privacy_delivery_prestate_drift';
  end if;
  if pg_catalog.to_regprocedure('private.bot_update_still_visible(uuid,text,jsonb)') is not null
     or pg_catalog.to_regprocedure('private.guard_bot_message_created_at()') is not null
     or pg_catalog.to_regprocedure('private.lock_bot_message_epoch()') is not null then
    raise exception 'bot_privacy_delivery_already_present';
  end if;
end;
$$;

create function private.bot_update_still_visible(
  p_bot_id uuid,
  p_update_type text,
  p_payload jsonb
) returns boolean
language plpgsql stable security definer
set search_path to ''
as $$
declare
  v_message_id text;
  v_chat_id text;
begin
  if p_bot_id is null or p_update_type is null or p_payload is null then
    return false;
  end if;
  if p_update_type not in ('message', 'edited_message') then
    return true;
  end if;
  v_message_id := p_payload #>> '{message,id}';
  v_chat_id := p_payload #>> '{message,chat_id}';
  if v_message_id is null
     or v_message_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_chat_id is null
     or v_chat_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or not exists (
       select 1 from public.messages message_row
       where message_row.id = v_message_id::uuid
         and message_row.chat_id = v_chat_id::uuid
     ) then
    return false;
  end if;
  return private.bot_can_receive_message(p_bot_id, v_message_id::uuid);
end;
$$;
revoke all on function private.bot_update_still_visible(uuid,text,jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.chat_bot_set_privacy(
  p_chat_id uuid,
  p_bot_id uuid,
  p_full boolean
) returns boolean
language plpgsql security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := auth.uid();
  v_member public.chat_bot_members%rowtype;
  v_mode text;
  v_boundary timestamptz;
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_chat_id is null or p_bot_id is null or p_full is null then
    raise exception 'invalid_bot_privacy_input' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.chats c
    where c.id = p_chat_id and c.type = 'group'
  ) then
    raise exception 'not_a_group' using errcode = '22023';
  end if;
  if not public.is_chat_admin(p_chat_id) then
    raise exception 'not_an_admin' using errcode = '42501';
  end if;

  perform 1 from public.bots bot
  where bot.id = p_bot_id and bot.state = 'active'
  for no key update;
  if not found then
    raise exception 'bot_membership_not_found' using errcode = 'P0002';
  end if;

  select member_row.* into v_member
  from public.chat_bot_members member_row
  join public.bots bot on bot.id = member_row.bot_id
  where member_row.chat_id = p_chat_id
    and member_row.bot_id = p_bot_id
    and member_row.removed_at is null
    and bot.state = 'active'
  for update of member_row;
  if not found then
    raise exception 'bot_membership_not_found' using errcode = 'P0002';
  end if;

  v_mode := case when p_full then 'full' else 'restricted' end;
  if v_member.privacy_mode = v_mode then
    return true;
  end if;

  v_boundary := pg_catalog.clock_timestamp();
  update public.chat_bot_members member_row
  set privacy_mode = v_mode,
      joined_at = v_boundary,
      updated_at = v_boundary
  where member_row.chat_id = p_chat_id
    and member_row.bot_id = p_bot_id
    and member_row.removed_at is null;

  delete from private.bot_delivery_attempts attempt
  using private.bot_updates queued
  where attempt.bot_id = p_bot_id
    and queued.bot_id = p_bot_id
    and attempt.update_id = queued.update_id
    and queued.acknowledged_at is null
    and queued.update_type in ('message', 'edited_message')
    and queued.payload #>> '{message,chat_id}' = p_chat_id::text;

  delete from private.bot_updates queued
  where queued.bot_id = p_bot_id
    and queued.acknowledged_at is null
    and queued.update_type in ('message', 'edited_message')
    and queued.payload #>> '{message,chat_id}' = p_chat_id::text;

  insert into private.bot_audit_events(bot_id, action, metadata)
  values (p_bot_id, 'bot_privacy_changed', pg_catalog.jsonb_build_object(
    'actor_id', v_actor,
    'chat_id', p_chat_id,
    'from', v_member.privacy_mode,
    'to', v_mode
  ));
  return true;
end;
$$;

do $$
declare
  v_body text;
  v_old text := E'    where bot.id = p_bot_id and bot.state = ''active''\n  ) then';
  v_new text := E'    where bot.id = p_bot_id and bot.state = ''active''\n    for share\n  ) then';
begin
  v_body := pg_catalog.pg_get_functiondef('public.bot_updates_poll_internal(uuid,bigint,integer,text[],uuid)'::regprocedure);
  if pg_catalog.strpos(v_body, v_old) = 0 then
    raise exception 'bot_poll_epoch_lock_anchor_missing';
  end if;
  v_body := pg_catalog.replace(v_body, v_old, v_new);
  v_old := E'    and queued.expires_at > pg_catalog.now()\n  order by queued.update_id';
  v_new := E'    and queued.expires_at > pg_catalog.now()\n    and private.bot_update_still_visible(p_bot_id, queued.update_type, queued.payload)\n  order by queued.update_id';
  if pg_catalog.strpos(v_body, v_old) = 0 then
    raise exception 'bot_poll_delivery_guard_anchor_missing';
  end if;
  execute pg_catalog.replace(v_body, v_old, v_new);
end;
$$;

do $$
declare
  v_body text;
  v_old text;
  v_new text;
begin
  v_body := pg_catalog.pg_get_functiondef('public.bot_delivery_prepare_internal(bigint,uuid,bigint)'::regprocedure);
  v_old := E'  v_payload jsonb;\nbegin';
  v_new := E'  v_payload jsonb;\n  v_update_type text;\nbegin';
  if pg_catalog.strpos(v_body, v_old) = 0 then
    raise exception 'bot_webhook_delivery_guard_declaration_missing';
  end if;
  v_body := pg_catalog.replace(v_body, v_old, v_new);
  v_old := 'select queued.payload into v_payload';
  v_new := 'select queued.payload, queued.update_type into v_payload, v_update_type';
  if pg_catalog.strpos(v_body, v_old) = 0 then
    raise exception 'bot_webhook_delivery_guard_select_missing';
  end if;
  v_body := pg_catalog.replace(v_body, v_old, v_new);
  v_old := E'  update private.bot_delivery_attempts attempt\n  set status = ''dispatching'',';
  v_new := E'  if not private.bot_update_still_visible(v_attempt.bot_id, v_update_type, v_payload) then\n    update private.bot_delivery_attempts attempt\n    set status = ''dead_letter'',\n        claim_token = null,\n        claimed_at = null,\n        webhook_epoch = null,\n        error_code = ''privacy_revoked'',\n        completed_at = pg_catalog.clock_timestamp(),\n        updated_at = pg_catalog.clock_timestamp()\n    where attempt.id = v_attempt.id;\n    update private.bot_updates queued\n    set acknowledged_at = coalesce(queued.acknowledged_at, pg_catalog.clock_timestamp())\n    where queued.bot_id = v_attempt.bot_id\n      and queued.update_id = v_attempt.update_id;\n    return null;\n  end if;\n\n  update private.bot_delivery_attempts attempt\n  set status = ''dispatching'',';
  if pg_catalog.strpos(v_body, v_old) = 0 then
    raise exception 'bot_webhook_delivery_guard_dispatch_missing';
  end if;
  execute pg_catalog.replace(v_body, v_old, v_new);
end;
$$;

-- Human clients may not move an old message into a later bot visibility epoch.
create function private.guard_bot_message_created_at()
returns trigger language plpgsql security definer
set search_path to ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Keep trusted historical imports, but stamp default-time writes after
    -- waiting for the membership lock, including bot gateway writes.
    if auth.uid() is not null
       or new.created_at is not distinct from pg_catalog.transaction_timestamp() then
      new.created_at := pg_catalog.clock_timestamp();
    end if;
  elsif auth.uid() is not null then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_bot_message_created_at()
  from public, anon, authenticated, service_role;
create function private.lock_bot_message_epoch()
returns trigger language plpgsql security definer
set search_path to ''
as $$
begin
  perform 1 from public.chat_bot_members member_row
  where member_row.chat_id = new.chat_id and member_row.removed_at is null
  order by member_row.bot_id
  for share of member_row;
  return new;
end;
$$;
revoke all on function private.lock_bot_message_epoch()
  from public, anon, authenticated, service_role;
create trigger trg_a_lock_bot_message_epoch
  before insert on public.messages
  for each row execute function private.lock_bot_message_epoch();
create trigger trg_guard_bot_message_created_at
  before insert or update of created_at on public.messages
  for each row execute function private.guard_bot_message_created_at();

do $$
begin
  if not pg_catalog.has_function_privilege('authenticated', 'public.chat_bot_set_privacy(uuid,uuid,boolean)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.chat_bot_set_privacy(uuid,uuid,boolean)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'private.bot_update_still_visible(uuid,text,jsonb)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'private.bot_update_still_visible(uuid,text,jsonb)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'private.lock_bot_message_epoch()', 'EXECUTE')
     or pg_catalog.has_table_privilege('authenticated', 'private.bot_updates', 'SELECT')
     or not exists (
       select 1 from pg_catalog.pg_trigger
       where tgname = 'trg_guard_bot_message_created_at'
         and tgrelid = 'public.messages'::regclass and not tgisinternal and tgenabled = 'O'
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger
       where tgname = 'trg_a_lock_bot_message_epoch'
         and tgrelid = 'public.messages'::regclass and not tgisinternal and tgenabled = 'O'
     ) then
    raise exception 'bot_privacy_delivery_poststate_invalid';
  end if;
end;
$$;
commit;
