-- Notify the support pool for direct email tickets and later requester
-- replies while a ticket is still unassigned. The first message of a new
-- ticket must not duplicate the ticket_created notification.

begin;

set search_path = public;

create or replace function public._support_email_ticket_after_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  perform public._support_append_event(
    new.id,
    'ticket_created',
    null,
    jsonb_build_object('source', 'email')
  );

  return null;
end
$function$;

revoke all on function public._support_email_ticket_after_insert()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_support_email_ticket_created
  on public.support_tickets;
create trigger trg_support_email_ticket_created
  after insert on public.support_tickets
  for each row
  when (new.source = 'email')
  execute function public._support_email_ticket_after_insert();

create or replace function public._support_notify_after_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_ticket public.support_tickets%rowtype;
  v_recipient record;
begin
  select ticket.*
  into v_ticket
  from public.support_tickets ticket
  where ticket.id = new.ticket_id;

  if not found then
    return null;
  end if;

  if new.event_type in ('ticket_created', 'returned_to_pool') then
    for v_recipient in
      select profile.id
      from public.profiles profile
      left join public.support_operator_preferences preference
        on preference.operator_user_id = profile.id
      where public.has_permission(profile.id, 'support.view')
        and coalesce(preference.notify_new_pool, true)
        and (
          not coalesce(preference.notify_urgent_only, false)
          or v_ticket.urgent
        )
        and profile.id is distinct from new.actor_user_id
    loop
      perform public._support_notify(
        v_recipient.id,
        new.ticket_id,
        new.event_type
      );
    end loop;
  elsif new.event_type = 'requester_message'
        and v_ticket.assigned_operator_id is null
        and exists (
          select 1
          from public.support_ticket_events previous_event
          where previous_event.ticket_id = new.ticket_id
            and previous_event.id <> new.id
            and previous_event.event_type in (
              'requester_message',
              'operator_message'
            )
        ) then
    for v_recipient in
      select profile.id
      from public.profiles profile
      left join public.support_operator_preferences preference
        on preference.operator_user_id = profile.id
      where public.has_permission(profile.id, 'support.view')
        and coalesce(preference.notify_new_pool, true)
        and (
          not coalesce(preference.notify_urgent_only, false)
          or v_ticket.urgent
        )
        and profile.id is distinct from new.actor_user_id
    loop
      perform public._support_notify(
        v_recipient.id,
        new.ticket_id,
        new.event_type
      );
    end loop;
  elsif new.event_type = 'escalated' then
    for v_recipient in
      select profile.id
      from public.profiles profile
      left join public.support_operator_preferences preference
        on preference.operator_user_id = profile.id
      where (
          public.has_permission(profile.id, 'support.escalate')
          or public.has_permission(profile.id, 'support.manage')
        )
        and coalesce(preference.notify_escalations, true)
        and profile.id is distinct from new.actor_user_id
    loop
      perform public._support_notify(
        v_recipient.id,
        new.ticket_id,
        new.event_type
      );
    end loop;
  elsif new.event_type in ('claimed', 'transferred', 'requester_message')
        and v_ticket.assigned_operator_id is not null
        and v_ticket.assigned_operator_id is distinct from new.actor_user_id then
    if new.event_type <> 'requester_message'
       or coalesce((
         select preference.notify_assigned_messages
         from public.support_operator_preferences preference
         where preference.operator_user_id = v_ticket.assigned_operator_id
       ), true) then
      perform public._support_notify(
        v_ticket.assigned_operator_id,
        new.ticket_id,
        new.event_type
      );
    end if;
  elsif new.event_type in ('operator_message', 'resolved', 'closed')
        and v_ticket.requester_user_id is not null
        and v_ticket.requester_user_id is distinct from new.actor_user_id then
    perform public._support_notify(
      v_ticket.requester_user_id,
      new.ticket_id,
      new.event_type
    );
  end if;

  return null;
end
$function$;

revoke all on function public._support_notify_after_event()
  from public, anon, authenticated, service_role;

comment on function public._support_email_ticket_after_insert() is
  'Creates the PII-free ticket_created event for direct inbound email tickets.';

comment on function public._support_notify_after_event() is
  'Fans out PII-free support notifications to the assigned operator or eligible pool.';

commit;
