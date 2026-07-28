\set ON_ERROR_STOP on

begin;

do $test$
declare
  v_created jsonb;
  v_closed jsonb;
  v_appended jsonb;
  v_first_limited jsonb;
  v_second_limited jsonb;
  v_closed_ticket_reply jsonb;
  v_ticket_id uuid;
  v_route_hash text := repeat('c', 64);
  v_worker_id uuid := '11111111-1111-4111-8111-111111111111';
begin
  if has_function_privilege(
    'anon',
    'public.support_email_ingest_inbound(text,text,text,text,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'anon_can_execute_support_email_ingest';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.support_email_ingest_inbound(text,text,text,text,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated_can_execute_support_email_ingest';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.support_email_ingest_inbound(text,text,text,text,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'service_role_cannot_execute_support_email_ingest';
  end if;

  if has_function_privilege(
    'service_role',
    'public._support_email_ingest_inbound_core(text,text,text,text,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'service_role_can_execute_private_email_ingest_core';
  end if;

  update public.support_settings
  set intake_enabled = true,
      ticket_limit_15m = 3,
      ticket_limit_day = 10;

  v_created := public.support_email_ingest_inbound(
    repeat('1', 64),
    repeat('a', 64),
    repeat('f', 64),
    null,
    null,
    null,
    'Mail intake QA',
    'qa+mail@example.test',
    'qa+mail@example.test',
    'technical',
    'Direct email intake smoke',
    'Direct inbound body',
    null
  );

  if v_created->>'status' <> 'created' then
    raise exception 'direct_email_not_created: %', v_created;
  end if;

  v_ticket_id := (v_created->>'ticket_id')::uuid;

  if not exists (
    select 1
    from public.support_rate_limit_signals signal
    where signal.ticket_id = v_ticket_id
      and signal.scope_kind = 'email'
      and signal.scope_hash = repeat('a', 64)
      and signal.action = 'ticket_create'
  ) then
    raise exception 'direct_email_rate_signal_missing';
  end if;

  perform public.support_email_route_register(v_ticket_id, v_route_hash);

  update public.support_settings
  set intake_enabled = false;

  v_closed := public.support_email_ingest_inbound(
    repeat('2', 64),
    repeat('b', 64),
    repeat('f', 64),
    null,
    null,
    null,
    'Closed intake QA',
    'closed@example.test',
    'closed@example.test',
    'technical',
    'Closed direct email',
    'This must be quarantined',
    null
  );

  if v_closed->>'status' <> 'quarantined' then
    raise exception 'closed_intake_not_quarantined: %', v_closed;
  end if;

  if not exists (
    select 1
    from public.support_email_messages email_message
    where email_message.direction = 'inbound'
      and email_message.message_id_hash = repeat('2', 64)
      and email_message.delivery_status = 'quarantined'
      and email_message.last_error_code = 'intake_closed'
  ) then
    raise exception 'closed_intake_ledger_reason_missing';
  end if;

  v_appended := public.support_email_ingest_inbound(
    repeat('3', 64),
    repeat('a', 64),
    repeat('f', 64),
    null,
    v_route_hash,
    null,
    'Mail intake QA',
    'qa+mail@example.test',
    'qa+mail@example.test',
    'technical',
    'Reply while intake is closed',
    'Existing ticket reply body',
    null
  );

  if v_appended->>'status' <> 'appended'
     or (v_appended->>'ticket_id')::uuid <> v_ticket_id then
    raise exception 'existing_reply_not_appended: %', v_appended;
  end if;

  update public.support_tickets
  set status = 'spam'
  where id = v_ticket_id;

  v_closed_ticket_reply := public.support_email_ingest_inbound(
    repeat('6', 64),
    repeat('a', 64),
    repeat('f', 64),
    null,
    v_route_hash,
    null,
    'Mail intake QA',
    'qa+mail@example.test',
    'qa+mail@example.test',
    'technical',
    'Reply to closed ticket',
    'This must not block the mailbox',
    null
  );

  if v_closed_ticket_reply->>'status' <> 'quarantined' then
    raise exception 'closed_ticket_reply_not_quarantined: %',
      v_closed_ticket_reply;
  end if;

  if not exists (
    select 1
    from public.support_email_messages email_message
    where email_message.direction = 'inbound'
      and email_message.message_id_hash = repeat('6', 64)
      and email_message.delivery_status = 'quarantined'
      and email_message.last_error_code = 'ticket_not_writable'
  ) then
    raise exception 'closed_ticket_reply_ledger_reason_missing';
  end if;

  update public.support_settings
  set intake_enabled = true,
      ticket_limit_15m = 1,
      ticket_limit_day = 1;

  v_first_limited := public.support_email_ingest_inbound(
    repeat('4', 64),
    repeat('d', 64),
    repeat('f', 64),
    null,
    null,
    null,
    'Rate limit QA',
    'rate@example.test',
    'rate@example.test',
    'technical',
    'First limited direct email',
    'First direct email body',
    null
  );

  if v_first_limited->>'status' <> 'created' then
    raise exception 'first_rate_limited_email_not_created: %', v_first_limited;
  end if;

  v_second_limited := public.support_email_ingest_inbound(
    repeat('5', 64),
    repeat('d', 64),
    repeat('f', 64),
    null,
    null,
    null,
    'Rate limit QA',
    'rate@example.test',
    'rate@example.test',
    'technical',
    'Second limited direct email',
    'Second direct email body',
    null
  );

  if v_second_limited->>'status' <> 'quarantined' then
    raise exception 'second_rate_limited_email_not_quarantined: %',
      v_second_limited;
  end if;

  if not exists (
    select 1
    from public.support_email_messages email_message
    where email_message.direction = 'inbound'
      and email_message.message_id_hash = repeat('5', 64)
      and email_message.delivery_status = 'quarantined'
      and email_message.last_error_code = 'rate_limited'
  ) then
    raise exception 'rate_limit_ledger_reason_missing';
  end if;

  insert into public.support_email_messages (
    direction,
    message_id_hash,
    delivery_status,
    attempt_count,
    locked_by,
    locked_until,
    created_at
  )
  values (
    'outbound',
    repeat('7', 64),
    'processing',
    8,
    v_worker_id,
    clock_timestamp() - interval '1 minute',
    clock_timestamp() - interval '2 minutes'
  );

  perform *
  from public.support_email_claim_outbound(v_worker_id, 1, 300);

  if not exists (
    select 1
    from public.support_email_messages email_message
    where email_message.direction = 'outbound'
      and email_message.message_id_hash = repeat('7', 64)
      and email_message.delivery_status = 'dead'
      and email_message.last_error_code = 'lease_expired'
      and email_message.locked_by is null
      and email_message.locked_until is null
  ) then
    raise exception 'exhausted_delivery_lease_not_reaped';
  end if;

  insert into public.support_email_messages (
    direction,
    message_id_hash,
    delivery_status,
    attempt_count,
    locked_by,
    locked_until
  )
  values (
    'outbound',
    repeat('9', 64),
    'processing',
    1,
    v_worker_id,
    clock_timestamp() + interval '5 minutes'
  );

  if not public.support_email_mark_sent(
    (
      select email_message.id
      from public.support_email_messages email_message
      where email_message.direction = 'outbound'
        and email_message.message_id_hash = repeat('9', 64)
    ),
    v_worker_id,
    repeat('e', 64)
  ) then
    raise exception 'first_delivery_ack_failed';
  end if;

  if not public.support_email_mark_sent(
    (
      select email_message.id
      from public.support_email_messages email_message
      where email_message.direction = 'outbound'
        and email_message.message_id_hash = repeat('9', 64)
    ),
    v_worker_id,
    repeat('e', 64)
  ) then
    raise exception 'idempotent_delivery_ack_failed';
  end if;

  insert into public.support_email_messages (
    direction,
    message_id_hash,
    delivery_status,
    last_error_code,
    created_at
  )
  values (
    'inbound',
    repeat('8', 64),
    'quarantined',
    'retention_smoke',
    clock_timestamp() - interval '31 days'
  );

  perform public.support_email_retention_cleanup(1000);

  if exists (
    select 1
    from public.support_email_messages email_message
    where email_message.direction = 'inbound'
      and email_message.message_id_hash = repeat('8', 64)
  ) then
    raise exception 'expired_mail_ledger_not_deleted';
  end if;
end
$test$;

select 'support_mail_intake_db_smoke_ok' as result;

rollback;
