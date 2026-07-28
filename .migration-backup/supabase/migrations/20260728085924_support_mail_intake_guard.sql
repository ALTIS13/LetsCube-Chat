-- Enforce the existing global support intake switch and persistent ticket
-- limits for direct email without blocking replies to existing tickets.

begin;

set search_path = public;

do $block$
begin
  if to_regprocedure(
    'public._support_email_ingest_inbound_core(text,text,text,text,text,text,text,text,text,text,text,text,text)'
  ) is null then
    alter function public.support_email_ingest_inbound(
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
    ) rename to _support_email_ingest_inbound_core;
  end if;
end
$block$;

revoke all on function public._support_email_ingest_inbound_core(
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
) from public, anon, authenticated, service_role;

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
    select exists (
      select 1
      from public.support_email_routes route
      where route.route_token_hash = p_route_token_hash
        and route.enabled
    )
    into v_existing_ticket;
  end if;

  if not v_existing_ticket and p_in_reply_to_hash is not null then
    select exists (
      select 1
      from public.support_email_messages email_message
      where email_message.direction = 'outbound'
        and email_message.message_id_hash = p_in_reply_to_hash
        and email_message.ticket_id is not null
    )
    into v_existing_ticket;
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

    -- Serialize direct-email ticket creation per sender HMAC so concurrent
    -- mailbox polls cannot race the persistent counters.
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

comment on function public.support_email_ingest_inbound(
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
) is
  'Server-only email ingestion with reply routing, direct-intake closure and persistent sender limits.';

commit;
