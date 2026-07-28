-- LETSCUBE support mail bridge.
-- Additive production migration for server-side SMTP/IMAP delivery.
-- Raw mailbox credentials and raw RFC headers remain outside Postgres.

begin;

set search_path = public;

-- Direct email tickets do not have to include a phone number. The existing
-- web gateway still validates and supplies the complete phone bundle.
alter table public.support_ticket_contacts
  drop constraint if exists support_ticket_contacts_phone_check;

alter table public.support_ticket_contacts
  alter column phone_original drop not null,
  alter column phone_e164 drop not null,
  alter column phone_hash drop not null;

alter table public.support_ticket_contacts
  drop constraint if exists support_ticket_contacts_phone_bundle_check;
alter table public.support_ticket_contacts
  add constraint support_ticket_contacts_phone_bundle_check
  check (
    (
      phone_original is null
      and phone_e164 is null
      and phone_hash is null
      and phone_verified is false
    )
    or (
      phone_original is not null
      and phone_e164 is not null
      and phone_hash is not null
      and phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
      and phone_hash ~ '^[a-f0-9]{64}$'
    )
  );

-- Extend the existing restricted ledger into a bounded, leased outbound
-- queue. It stores hashes and workflow references only, never message bodies,
-- SMTP credentials or raw provider responses.
alter table public.support_email_messages
  add column if not exists ticket_message_id uuid null
    references public.support_ticket_messages(id) on delete set null,
  add column if not exists in_reply_to_hash text null,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz null,
  add column if not exists last_attempt_at timestamptz null,
  add column if not exists locked_by uuid null,
  add column if not exists locked_until timestamptz null,
  add column if not exists last_error_code text null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.support_email_messages
  drop constraint if exists support_email_messages_status_check;
alter table public.support_email_messages
  add constraint support_email_messages_status_check
  check (
    delivery_status in (
      'pending',
      'processing',
      'retry',
      'sent',
      'received',
      'failed',
      'dead',
      'quarantined'
    )
  );

alter table public.support_email_messages
  drop constraint if exists support_email_messages_in_reply_to_hash_check;
alter table public.support_email_messages
  add constraint support_email_messages_in_reply_to_hash_check
  check (
    in_reply_to_hash is null
    or in_reply_to_hash ~ '^[a-f0-9]{64}$'
  );

alter table public.support_email_messages
  drop constraint if exists support_email_messages_provider_reference_hash_check;
alter table public.support_email_messages
  add constraint support_email_messages_provider_reference_hash_check
  check (
    provider_reference_hash is null
    or provider_reference_hash ~ '^[a-f0-9]{64}$'
  );

alter table public.support_email_messages
  drop constraint if exists support_email_messages_attempt_count_check;
alter table public.support_email_messages
  add constraint support_email_messages_attempt_count_check
  check (attempt_count between 0 and 32);

alter table public.support_email_messages
  drop constraint if exists support_email_messages_lock_check;
alter table public.support_email_messages
  add constraint support_email_messages_lock_check
  check (
    (locked_by is null and locked_until is null)
    or (locked_by is not null and locked_until is not null)
  );

alter table public.support_email_messages
  drop constraint if exists support_email_messages_error_code_check;
alter table public.support_email_messages
  add constraint support_email_messages_error_code_check
  check (
    last_error_code is null
    or last_error_code ~ '^[a-z0-9_]{1,64}$'
  );

create unique index if not exists support_email_messages_outbound_message_uidx
  on public.support_email_messages (ticket_message_id)
  where ticket_message_id is not null;

create index if not exists support_email_messages_queue_idx
  on public.support_email_messages (
    delivery_status,
    next_attempt_at,
    created_at
  )
  where direction = 'outbound'
    and delivery_status in ('pending', 'processing', 'retry');

create index if not exists support_email_messages_reply_lookup_idx
  on public.support_email_messages (message_id_hash, ticket_id)
  where direction = 'outbound';

-- The worker derives an opaque plus-address token with a server-only HMAC
-- secret. Postgres stores only the token hash used for inbound routing.
create table if not exists public.support_email_routes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  route_token_hash text not null unique,
  enabled boolean not null default true,
  last_used_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_email_routes_token_hash_check
    check (route_token_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists support_email_routes_ticket_idx
  on public.support_email_routes (ticket_id, enabled, created_at desc);

alter table public.support_email_routes enable row level security;

revoke all on table public.support_email_routes
  from public, anon, authenticated;
grant select, insert, update, delete on table public.support_email_routes
  to service_role;

grant select, insert, update, delete on table public.support_email_messages
  to service_role;

drop trigger if exists trg_support_email_messages_touch_updated_at
  on public.support_email_messages;
create trigger trg_support_email_messages_touch_updated_at
  before update on public.support_email_messages
  for each row execute function public._support_touch_updated_at();

drop trigger if exists trg_support_email_routes_touch_updated_at
  on public.support_email_routes;
create trigger trg_support_email_routes_touch_updated_at
  before update on public.support_email_routes
  for each row execute function public._support_touch_updated_at();

-- Restore the operator reply RPC that the frontend already invokes. Direct
-- table inserts remain unavailable to authenticated clients.
create or replace function public.support_operator_message_create(
  p_ticket_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid;
  v_ticket public.support_tickets%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_message_id uuid;
begin
  v_actor := public._support_require_permission('support.reply');

  if p_ticket_id is null or length(v_body) not between 1 and 8000 then
    raise exception 'invalid_support_message';
  end if;

  select ticket.*
  into v_ticket
  from public.support_tickets ticket
  where ticket.id = p_ticket_id
  for update;

  if not found then
    raise exception 'support_ticket_not_found';
  end if;

  if not public._support_actor_controls_ticket(v_ticket, v_actor) then
    raise exception 'support_ticket_reply_denied' using errcode = '42501';
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
    p_ticket_id,
    v_actor,
    null,
    'operator',
    'web',
    v_body
  )
  returning id into v_message_id;

  return v_message_id;
end
$function$;

revoke all on function public.support_operator_message_create(uuid, text)
  from public, anon, authenticated;
grant execute on function public.support_operator_message_create(uuid, text)
  to authenticated;

-- Every operator message owns at most one outbound ledger row. The worker
-- joins the restricted contact/message records only while it holds a lease.
create or replace function public._support_email_enqueue_after_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_outbox_id uuid := gen_random_uuid();
  v_rfc_message_id text;
begin
  if new.author_kind <> 'operator' then
    return null;
  end if;

  if not exists (
    select 1
    from public.support_ticket_contacts contact
    where contact.ticket_id = new.ticket_id
      and contact.email_normalized is not null
  ) then
    return null;
  end if;

  v_rfc_message_id :=
    '<support-'
    || replace(v_outbox_id::text, '-', '')
    || '@app.letscube.ru>';

  insert into public.support_email_messages (
    id,
    ticket_id,
    ticket_message_id,
    direction,
    message_id_hash,
    recipient_hash,
    delivery_status,
    next_attempt_at
  )
  select
    v_outbox_id,
    new.ticket_id,
    new.id,
    'outbound',
    encode(extensions.digest(v_rfc_message_id, 'sha256'), 'hex'),
    contact.email_hash,
    'pending',
    clock_timestamp()
  from public.support_ticket_contacts contact
  where contact.ticket_id = new.ticket_id
  on conflict (ticket_message_id)
    where ticket_message_id is not null
    do nothing;

  return null;
end
$function$;

revoke all on function public._support_email_enqueue_after_message()
  from public, anon, authenticated;

drop trigger if exists trg_support_email_enqueue_after_message
  on public.support_ticket_messages;
create trigger trg_support_email_enqueue_after_message
  after insert on public.support_ticket_messages
  for each row execute function public._support_email_enqueue_after_message();

create or replace function public.support_email_route_register(
  p_ticket_id uuid,
  p_route_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_route_id uuid;
begin
  if p_ticket_id is null
     or coalesce(p_route_token_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_support_email_route';
  end if;

  if not exists (
    select 1
    from public.support_tickets ticket
    where ticket.id = p_ticket_id
  ) then
    raise exception 'support_ticket_not_found';
  end if;

  insert into public.support_email_routes (
    ticket_id,
    route_token_hash,
    enabled
  )
  values (
    p_ticket_id,
    p_route_token_hash,
    true
  )
  on conflict (route_token_hash) do update
  set enabled = true,
      updated_at = clock_timestamp()
  where support_email_routes.ticket_id = excluded.ticket_id
  returning id into v_route_id;

  if v_route_id is null then
    raise exception 'support_email_route_conflict';
  end if;

  return v_route_id;
end
$function$;

revoke all on function public.support_email_route_register(uuid, text)
  from public, anon, authenticated;
grant execute on function public.support_email_route_register(uuid, text)
  to service_role;

-- Inbound ingestion is one transaction: ledger dedupe, route resolution,
-- sender verification and ticket/message mutation succeed or fail together.
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
  v_ledger_id uuid;
  v_ticket_id uuid;
  v_message_id uuid;
  v_contact_name text := btrim(coalesce(p_contact_name, ''));
  v_email_original text := btrim(coalesce(p_email_original, ''));
  v_email_normalized text := lower(btrim(coalesce(p_email_normalized, '')));
  v_category text := lower(btrim(coalesce(p_category, 'other')));
  v_subject text := btrim(coalesce(p_subject, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_quarantine_code text := lower(btrim(coalesce(p_quarantine_code, '')));
  v_sender_matches boolean := false;
begin
  if coalesce(p_message_id_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_sender_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_recipient_hash, '') !~ '^[a-f0-9]{64}$'
     or (
       p_provider_reference_hash is not null
       and p_provider_reference_hash !~ '^[a-f0-9]{64}$'
     )
     or (
       p_route_token_hash is not null
       and p_route_token_hash !~ '^[a-f0-9]{64}$'
     )
     or (
       p_in_reply_to_hash is not null
       and p_in_reply_to_hash !~ '^[a-f0-9]{64}$'
     ) then
    raise exception 'invalid_support_email_hash';
  end if;

  if v_quarantine_code <> ''
     and v_quarantine_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'invalid_support_email_quarantine_code';
  end if;

  insert into public.support_email_messages (
    direction,
    message_id_hash,
    sender_hash,
    recipient_hash,
    provider_reference_hash,
    in_reply_to_hash,
    delivery_status
  )
  values (
    'inbound',
    p_message_id_hash,
    p_sender_hash,
    p_recipient_hash,
    p_provider_reference_hash,
    p_in_reply_to_hash,
    'processing'
  )
  on conflict (direction, message_id_hash) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if v_quarantine_code <> '' then
    update public.support_email_messages
    set delivery_status = 'quarantined',
        last_error_code = v_quarantine_code,
        received_at = clock_timestamp()
    where id = v_ledger_id;

    return jsonb_build_object('status', 'quarantined');
  end if;

  if p_route_token_hash is not null then
    select route.ticket_id
    into v_ticket_id
    from public.support_email_routes route
    where route.route_token_hash = p_route_token_hash
      and route.enabled
    order by route.created_at desc
    limit 1;

    if v_ticket_id is not null then
      update public.support_email_routes
      set last_used_at = clock_timestamp()
      where route_token_hash = p_route_token_hash;
    end if;
  end if;

  if v_ticket_id is null and p_in_reply_to_hash is not null then
    select email_message.ticket_id
    into v_ticket_id
    from public.support_email_messages email_message
    where email_message.direction = 'outbound'
      and email_message.message_id_hash = p_in_reply_to_hash
      and email_message.ticket_id is not null
    order by email_message.created_at desc
    limit 1;
  end if;

  if v_ticket_id is not null then
    select contact.email_hash = p_sender_hash
    into v_sender_matches
    from public.support_ticket_contacts contact
    where contact.ticket_id = v_ticket_id;

    if not coalesce(v_sender_matches, false) then
      update public.support_email_messages
      set ticket_id = v_ticket_id,
          delivery_status = 'quarantined',
          last_error_code = 'sender_mismatch',
          received_at = clock_timestamp()
      where id = v_ledger_id;

      return jsonb_build_object('status', 'quarantined');
    end if;

    if length(v_body) not between 1 and 8000 then
      update public.support_email_messages
      set ticket_id = v_ticket_id,
          delivery_status = 'quarantined',
          last_error_code = 'invalid_body',
          received_at = clock_timestamp()
      where id = v_ledger_id;

      return jsonb_build_object('status', 'quarantined');
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
      v_body
    )
    returning id into v_message_id;

    update public.support_email_messages
    set ticket_id = v_ticket_id,
        ticket_message_id = v_message_id,
        delivery_status = 'received',
        received_at = clock_timestamp(),
        last_error_code = null
    where id = v_ledger_id;

    return jsonb_build_object(
      'status', 'appended',
      'ticket_id', v_ticket_id,
      'message_id', v_message_id
    );
  end if;

  if length(v_contact_name) not between 2 and 120
     or length(v_email_original) not between 3 and 320
     or length(v_email_normalized) not between 3 and 320
     or position('@' in v_email_normalized) <= 1
     or v_category not in (
       'account',
       'access',
       'technical',
       'messages',
       'media',
       'tasks',
       'messaging',
       'club',
       'privacy',
       'abuse',
       'other'
     )
     or length(v_subject) not between 3 and 180
     or length(v_body) not between 1 and 8000 then
    update public.support_email_messages
    set delivery_status = 'quarantined',
        last_error_code = 'invalid_direct_email',
        received_at = clock_timestamp()
    where id = v_ledger_id;

    return jsonb_build_object('status', 'quarantined');
  end if;

  insert into public.support_tickets (
    requester_user_id,
    source,
    status,
    category,
    subject,
    priority,
    urgent,
    last_activity_at
  )
  values (
    null,
    'email',
    'new',
    v_category,
    v_subject,
    'normal',
    false,
    clock_timestamp()
  )
  returning id into v_ticket_id;

  insert into public.support_ticket_contacts (
    ticket_id,
    contact_name,
    email_original,
    email_normalized,
    phone_original,
    phone_e164,
    email_hash,
    phone_hash,
    email_verified,
    phone_verified
  )
  values (
    v_ticket_id,
    v_contact_name,
    v_email_original,
    v_email_normalized,
    null,
    null,
    p_sender_hash,
    null,
    false,
    false
  );

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
    v_body
  )
  returning id into v_message_id;

  update public.support_email_messages
  set ticket_id = v_ticket_id,
      ticket_message_id = v_message_id,
      delivery_status = 'received',
      received_at = clock_timestamp(),
      last_error_code = null
  where id = v_ledger_id;

  return jsonb_build_object(
    'status', 'created',
    'ticket_id', v_ticket_id,
    'message_id', v_message_id
  );
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
  p_limit integer default 10,
  p_lease_seconds integer default 120
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
     or p_limit not between 1 and 50
     or p_lease_seconds not between 30 and 900 then
    raise exception 'invalid_support_email_claim';
  end if;

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

  return found;
end
$function$;

revoke all on function public.support_email_mark_sent(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.support_email_mark_sent(uuid, uuid, text)
  to service_role;

create or replace function public.support_email_mark_retry(
  p_outbox_id uuid,
  p_worker_id uuid,
  p_error_code text,
  p_retryable boolean,
  p_retry_after_seconds integer default 300
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text;
begin
  if p_outbox_id is null
     or p_worker_id is null
     or coalesce(p_error_code, '') !~ '^[a-z0-9_]{1,64}$'
     or p_retry_after_seconds not between 30 and 86400 then
    raise exception 'invalid_support_email_retry';
  end if;

  update public.support_email_messages
  set delivery_status = case
        when coalesce(p_retryable, false) and attempt_count < 8
          then 'retry'
        else 'dead'
      end,
      next_attempt_at = case
        when coalesce(p_retryable, false) and attempt_count < 8
          then clock_timestamp() + make_interval(secs => p_retry_after_seconds)
        else null
      end,
      locked_by = null,
      locked_until = null,
      last_error_code = p_error_code
  where id = p_outbox_id
    and direction = 'outbound'
    and delivery_status = 'processing'
    and locked_by = p_worker_id
  returning delivery_status into v_status;

  return v_status;
end
$function$;

revoke all on function public.support_email_mark_retry(
  uuid,
  uuid,
  text,
  boolean,
  integer
) from public, anon, authenticated;
grant execute on function public.support_email_mark_retry(
  uuid,
  uuid,
  text,
  boolean,
  integer
) to service_role;

comment on table public.support_email_routes is
  'Server-only hashes for opaque support reply aliases; raw tokens remain in the mail worker.';
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
  'Atomically deduplicates and ingests one sanitized inbound support email; service-role only.';
comment on function public.support_email_claim_outbound(uuid, integer, integer) is
  'Claims bounded outbound support mail rows with SKIP LOCKED leases; service-role only.';

commit;
