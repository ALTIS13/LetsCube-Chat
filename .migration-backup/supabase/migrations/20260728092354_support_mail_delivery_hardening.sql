-- Harden the disabled support mail bridge before activation:
-- - keep replies to closed/spam tickets from blocking IMAP polling;
-- - reap the final expired delivery lease;
-- - provide bounded server-side ledger retention.

begin;

set search_path = public;

create or replace function public.support_email_ingest_inbound(
  p_message_id_hash text,
  p_sender_hash text,
  p_recipient_hash text,
  p_provider_reference_hash text,
  p_route_token_hash text,
  p_in_reply_to_hash text,
  p_contact_name text,
  p_email_original text,
  p_email_normalized text,
  p_category text,
  p_subject text,
  p_body text,
  p_quarantine_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_existing_ticket boolean := false;
  v_existing_ticket_id uuid;
  v_existing_ticket_status text;
  v_settings public.support_settings%rowtype;
  v_count_15m integer := 0;
  v_count_day integer := 0;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  -- Automated, oversized and otherwise pre-quarantined messages must still be
  -- deduplicated by the core, but must not consume user ticket rate limits.
  if p_quarantine_code is not null then
    return public._support_email_ingest_inbound_core(
      p_message_id_hash,
      p_sender_hash,
      p_recipient_hash,
      p_provider_reference_hash,
      p_route_token_hash,
      p_in_reply_to_hash,
      p_contact_name,
      p_email_original,
      p_email_normalized,
      p_category,
      p_subject,
      p_body,
      p_quarantine_code
    );
  end if;

  if p_route_token_hash is not null then
    select ticket.id, ticket.status
    into v_existing_ticket_id, v_existing_ticket_status
    from public.support_email_routes route
    join public.support_tickets ticket
      on ticket.id = route.ticket_id
    where route.route_token_hash = p_route_token_hash
      and route.enabled
    order by route.created_at desc
    limit 1
    for update of ticket;
  end if;

  if v_existing_ticket_id is null and p_in_reply_to_hash is not null then
    select ticket.id, ticket.status
    into v_existing_ticket_id, v_existing_ticket_status
    from public.support_email_messages email_message
    join public.support_tickets ticket
      on ticket.id = email_message.ticket_id
    where email_message.direction = 'outbound'
      and email_message.message_id_hash = p_in_reply_to_hash
      and email_message.ticket_id is not null
    order by email_message.created_at desc
    limit 1
    for update of ticket;
  end if;

  v_existing_ticket := v_existing_ticket_id is not null;

  -- The core message trigger rejects these states. Persist a terminal ledger
  -- outcome instead of rolling back and retrying the same IMAP item forever.
  if v_existing_ticket_status in ('closed', 'spam') then
    return public._support_email_ingest_inbound_core(
      p_message_id_hash,
      p_sender_hash,
      p_recipient_hash,
      p_provider_reference_hash,
      p_route_token_hash,
      p_in_reply_to_hash,
      p_contact_name,
      p_email_original,
      p_email_normalized,
      p_category,
      p_subject,
      p_body,
      'ticket_not_writable'
    );
  end if;

  if not v_existing_ticket then
    select settings.*
    into v_settings
    from public.support_settings settings
    where settings.id is true
    for update;

    if not found or not v_settings.intake_enabled then
      return public._support_email_ingest_inbound_core(
        p_message_id_hash,
        p_sender_hash,
        p_recipient_hash,
        p_provider_reference_hash,
        p_route_token_hash,
        p_in_reply_to_hash,
        p_contact_name,
        p_email_original,
        p_email_normalized,
        p_category,
        p_subject,
        p_body,
        'intake_closed'
      );
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      hashtextextended('support:email:' || coalesce(p_sender_hash, ''), 0)
    );

    select
      count(*) filter (
        where signal.created_at >= v_now - interval '15 minutes'
      ),
      count(*) filter (
        where signal.created_at >= v_now - interval '1 day'
      )
    into v_count_15m, v_count_day
    from public.support_rate_limit_signals signal
    where signal.scope_kind = 'email'
      and signal.scope_hash = p_sender_hash
      and signal.action = 'ticket_create';

    if v_count_15m >= v_settings.ticket_limit_15m
       or v_count_day >= v_settings.ticket_limit_day then
      return public._support_email_ingest_inbound_core(
        p_message_id_hash,
        p_sender_hash,
        p_recipient_hash,
        p_provider_reference_hash,
        p_route_token_hash,
        p_in_reply_to_hash,
        p_contact_name,
        p_email_original,
        p_email_normalized,
        p_category,
        p_subject,
        p_body,
        'rate_limited'
      );
    end if;
  end if;

  v_result := public._support_email_ingest_inbound_core(
    p_message_id_hash,
    p_sender_hash,
    p_recipient_hash,
    p_provider_reference_hash,
    p_route_token_hash,
    p_in_reply_to_hash,
    p_contact_name,
    p_email_original,
    p_email_normalized,
    p_category,
    p_subject,
    p_body,
    null
  );

  if not v_existing_ticket and v_result->>'status' = 'created' then
    insert into public.support_rate_limit_signals (
      scope_kind,
      scope_hash,
      action,
      ticket_id,
      expires_at,
      created_at
    )
    values (
      'email',
      p_sender_hash,
      'ticket_create',
      (v_result->>'ticket_id')::uuid,
      v_now + interval '90 days',
      v_now
    );
  end if;

  return v_result;
end
$function$;

revoke all on function public.support_email_ingest_inbound(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.support_email_ingest_inbound(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;

create or replace function public.support_email_claim_outbound(
  p_worker_id uuid,
  p_limit integer default 1,
  p_lease_seconds integer default 300
)
returns table (
  outbox_id uuid,
  ticket_id uuid,
  ticket_message_id uuid,
  public_reference text,
  recipient_email text,
  contact_name text,
  subject text,
  body text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_worker_id is null
     or p_limit not between 1 and 10
     or p_lease_seconds not between 60 and 900 then
    raise exception 'invalid_support_email_claim';
  end if;

  -- A process can die after taking its eighth lease. Such a row is no longer
  -- claimable, so expire it explicitly instead of leaving it in processing.
  update public.support_email_messages email_message
  set delivery_status = 'dead',
      next_attempt_at = null,
      locked_by = null,
      locked_until = null,
      last_error_code = 'lease_expired'
  where email_message.direction = 'outbound'
    and email_message.delivery_status = 'processing'
    and email_message.locked_until <= clock_timestamp()
    and email_message.attempt_count >= 8;

  return query
  with candidates as (
    select email_message.id
    from public.support_email_messages email_message
    where email_message.direction = 'outbound'
      and (
        (
          email_message.delivery_status in ('pending', 'retry')
          and coalesce(email_message.next_attempt_at, email_message.created_at)
            <= clock_timestamp()
        )
        or (
          email_message.delivery_status = 'processing'
          and email_message.locked_until < clock_timestamp()
        )
      )
      and email_message.attempt_count < 8
    order by
      coalesce(email_message.next_attempt_at, email_message.created_at),
      email_message.created_at,
      email_message.id
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.support_email_messages email_message
    set delivery_status = 'processing',
        attempt_count = email_message.attempt_count + 1,
        last_attempt_at = clock_timestamp(),
        locked_by = p_worker_id,
        locked_until = clock_timestamp()
          + make_interval(secs => p_lease_seconds),
        last_error_code = null
    from candidates
    where email_message.id = candidates.id
    returning email_message.*
  )
  select
    claimed.id,
    claimed.ticket_id,
    claimed.ticket_message_id,
    ticket.public_reference,
    contact.email_normalized,
    contact.contact_name,
    ticket.subject,
    ticket_message.body,
    claimed.attempt_count
  from claimed
  join public.support_tickets ticket
    on ticket.id = claimed.ticket_id
  join public.support_ticket_contacts contact
    on contact.ticket_id = claimed.ticket_id
  join public.support_ticket_messages ticket_message
    on ticket_message.id = claimed.ticket_message_id
  order by claimed.created_at, claimed.id;
end
$function$;

revoke all on function public.support_email_claim_outbound(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.support_email_claim_outbound(uuid, integer, integer)
  to service_role;

create or replace function public.support_email_retention_cleanup(
  p_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_deleted integer := 0;
  v_signals_deleted integer := 0;
begin
  if p_limit not between 1 and 10000 then
    raise exception 'invalid_support_email_retention_limit';
  end if;

  with candidates as (
    select email_message.id
    from public.support_email_messages email_message
    where (
        email_message.delivery_status in ('quarantined', 'dead')
        and email_message.created_at < clock_timestamp() - interval '30 days'
      )
      or (
        email_message.delivery_status in ('received', 'sent')
        and email_message.created_at < clock_timestamp() - interval '180 days'
      )
    order by email_message.created_at, email_message.id
    limit p_limit
    for update skip locked
  )
  delete from public.support_email_messages email_message
  using candidates
  where email_message.id = candidates.id;

  get diagnostics v_deleted = row_count;

  with expired_signals as (
    select signal.id
    from public.support_rate_limit_signals signal
    where signal.expires_at < clock_timestamp()
    order by signal.expires_at, signal.id
    limit p_limit
    for update skip locked
  )
  delete from public.support_rate_limit_signals signal
  using expired_signals
  where signal.id = expired_signals.id;

  get diagnostics v_signals_deleted = row_count;
  return v_deleted + v_signals_deleted;
end
$function$;

revoke all on function public.support_email_retention_cleanup(integer)
  from public, anon, authenticated;
grant execute on function public.support_email_retention_cleanup(integer)
  to service_role;

comment on function public.support_email_claim_outbound(uuid, integer, integer) is
  'Claims one outbound email per worker cycle and reaps exhausted expired leases.';
comment on function public.support_email_retention_cleanup(integer) is
  'Deletes bounded expired support mail ledger and rate-limit rows; service-role only.';

commit;
