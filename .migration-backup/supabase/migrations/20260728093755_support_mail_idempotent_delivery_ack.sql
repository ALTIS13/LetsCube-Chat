-- Make SMTP acceptance acknowledgement idempotent. If the original RPC
-- committed but its response was lost, the worker can retry the acknowledgement
-- without returning the row to the delivery queue.

begin;

set search_path = public;

create or replace function public.support_email_mark_sent(
  p_outbox_id uuid,
  p_worker_id uuid,
  p_provider_reference_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_outbox_id is null
     or p_worker_id is null
     or (
       p_provider_reference_hash is not null
       and p_provider_reference_hash !~ '^[a-f0-9]{64}$'
     ) then
    raise exception 'invalid_support_email_delivery';
  end if;

  update public.support_email_messages
  set delivery_status = 'sent',
      provider_reference_hash = p_provider_reference_hash,
      sent_at = clock_timestamp(),
      next_attempt_at = null,
      locked_by = null,
      locked_until = null,
      last_error_code = null
  where id = p_outbox_id
    and direction = 'outbound'
    and delivery_status = 'processing'
    and locked_by = p_worker_id;

  if found then
    return true;
  end if;

  return exists (
    select 1
    from public.support_email_messages email_message
    where email_message.id = p_outbox_id
      and email_message.direction = 'outbound'
      and email_message.delivery_status = 'sent'
      and email_message.provider_reference_hash
        is not distinct from p_provider_reference_hash
  );
end
$function$;

revoke all on function public.support_email_mark_sent(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.support_email_mark_sent(uuid, uuid, text)
  to service_role;

comment on function public.support_email_mark_sent(uuid, uuid, text) is
  'Idempotently acknowledges one SMTP-accepted support email; service-role only.';

commit;
