begin;

do $test$
declare
  v_ticket_id uuid;
  v_expected_pool_recipients integer;
  v_ticket_created_events integer;
  v_ticket_created_notifications integer;
  v_requester_notifications integer;
begin
  select count(*)
  into v_expected_pool_recipients
  from public.profiles profile
  left join public.support_operator_preferences preference
    on preference.operator_user_id = profile.id
  where public.has_permission(profile.id, 'support.view')
    and coalesce(preference.notify_new_pool, true)
    and not coalesce(preference.notify_urgent_only, false);

  if v_expected_pool_recipients < 1 then
    raise exception 'support_notification_smoke_requires_operator_fixture';
  end if;

  insert into public.support_tickets (
    requester_user_id,
    source,
    status,
    category,
    subject,
    priority,
    urgent
  )
  values (
    null,
    'email',
    'new',
    'technical',
    'QA support notification fanout',
    'normal',
    false
  )
  returning id into v_ticket_id;

  select count(*)
  into v_ticket_created_events
  from public.support_ticket_events event
  where event.ticket_id = v_ticket_id
    and event.event_type = 'ticket_created';

  if v_ticket_created_events <> 1 then
    raise exception 'email_ticket_created_event_count:%', v_ticket_created_events;
  end if;

  insert into public.support_ticket_messages (
    ticket_id,
    author_user_id,
    guest_session_id,
    author_kind,
    source,
    body
  )
  values (
    v_ticket_id,
    null,
    null,
    'requester',
    'email',
    'Initial QA message'
  );

  select count(*) filter (where notification.kind = 'support_ticket_created'),
         count(*) filter (where notification.kind = 'support_requester_message')
  into v_ticket_created_notifications, v_requester_notifications
  from public.notifications notification
  where notification.payload->>'ticket_id' = v_ticket_id::text;

  if v_ticket_created_notifications <> v_expected_pool_recipients then
    raise exception 'email_ticket_created_notification_count:% expected:%',
      v_ticket_created_notifications,
      v_expected_pool_recipients;
  end if;

  if v_requester_notifications <> 0 then
    raise exception 'initial_email_message_notification_duplicate:%',
      v_requester_notifications;
  end if;

  insert into public.support_ticket_messages (
    ticket_id,
    author_user_id,
    guest_session_id,
    author_kind,
    source,
    body
  )
  values (
    v_ticket_id,
    null,
    null,
    'requester',
    'email',
    'Follow-up QA message'
  );

  select count(*)
  into v_requester_notifications
  from public.notifications notification
  where notification.payload->>'ticket_id' = v_ticket_id::text
    and notification.kind = 'support_requester_message';

  if v_requester_notifications <> v_expected_pool_recipients then
    raise exception 'unassigned_requester_notification_count:% expected:%',
      v_requester_notifications,
      v_expected_pool_recipients;
  end if;
end
$test$;

rollback;
