-- 20260727_privacy_support_ticketing_foundation.sql
-- Proposal for the LETSCUBE privacy-policy evidence and support ticketing model.
--
-- This file is intentionally not part of the automatically applied migration
-- chain. Review against the live schema and a current backup before applying.
-- It is transactional, does not drop tables, denies anonymous table access to
-- support data, and exposes state changes only through permission-aware RPCs.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $preflight$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.permissions') is null
     or to_regclass('public.roles') is null
     or to_regclass('public.role_permissions') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.profile_contacts') is null
     or to_regclass('public.audit_logs') is null then
    raise exception 'support_foundation_dependencies_missing';
  end if;

  if to_regprocedure('public.has_permission(uuid,text)') is null
     or to_regprocedure('public._notify(uuid,text,jsonb)') is null then
    raise exception 'support_foundation_helpers_missing';
  end if;
end
$preflight$;

create or replace function public._support_generate_public_reference()
returns text
language sql
volatile
set search_path = pg_catalog, extensions
as $function$
  select 'LC-'
    || to_char(clock_timestamp(), 'YYYY')
    || '-'
    || upper(encode(extensions.gen_random_bytes(6), 'hex'))
$function$;

revoke all on function public._support_generate_public_reference()
  from public, anon, authenticated;
grant execute on function public._support_generate_public_reference()
  to service_role;

-- ---------------------------------------------------------------------------
-- 1. Policy evidence and support tables
-- ---------------------------------------------------------------------------

create table if not exists public.privacy_policy_versions (
  version text primary key,
  title text not null,
  effective_on date not null,
  published_at timestamptz not null default now(),
  content_hash text not null,
  is_current boolean not null default false,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint privacy_policy_versions_version_check
    check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:\.[0-9]+)?$'),
  constraint privacy_policy_versions_title_check
    check (length(btrim(title)) between 3 and 200),
  constraint privacy_policy_versions_content_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

create unique index if not exists privacy_policy_versions_current_uidx
  on public.privacy_policy_versions (is_current)
  where is_current is true;

create table if not exists public.support_settings (
  id boolean primary key default true,
  intake_enabled boolean not null default true,
  guest_intake_enabled boolean not null default true,
  closed_message text not null default
    'Приём обращений временно приостановлен. Попробуйте обратиться позднее.',
  ticket_limit_15m integer not null default 3,
  ticket_limit_day integer not null default 10,
  message_limit_5m integer not null default 20,
  message_limit_day integer not null default 200,
  updated_by uuid null references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint support_settings_singleton_check check (id is true),
  constraint support_settings_closed_message_check
    check (length(btrim(closed_message)) between 3 and 500),
  constraint support_settings_ticket_limit_15m_check
    check (ticket_limit_15m between 1 and 50),
  constraint support_settings_ticket_limit_day_check
    check (ticket_limit_day between 1 and 500),
  constraint support_settings_message_limit_5m_check
    check (message_limit_5m between 1 and 200),
  constraint support_settings_message_limit_day_check
    check (message_limit_day between 1 and 5000)
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  public_reference text not null unique default public._support_generate_public_reference(),
  requester_user_id uuid null references public.profiles(id) on delete set null,
  source text not null default 'web_guest',
  status text not null default 'new',
  category text not null,
  subject text not null,
  priority text not null default 'normal',
  assigned_operator_id uuid null references public.profiles(id) on delete set null,
  assigned_at timestamptz null,
  urgent boolean not null default false,
  linked_ticket_id uuid null references public.support_tickets(id) on delete set null,
  resolution_summary text null,
  resolved_at timestamptz null,
  closed_at timestamptz null,
  last_requester_message_at timestamptz null,
  last_operator_message_at timestamptz null,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint support_tickets_source_check
    check (source in ('web_guest', 'authenticated', 'email', 'admin')),
  constraint support_tickets_public_reference_check
    check (public_reference ~ '^LC-[0-9]{4}-[A-F0-9]{12}$'),
  constraint support_tickets_status_check
    check (status in (
      'new',
      'in_progress',
      'waiting_user',
      'waiting_support',
      'escalated',
      'resolved',
      'closed',
      'spam'
    )),
  constraint support_tickets_category_check
    check (category in (
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
    )),
  constraint support_tickets_subject_check
    check (length(btrim(subject)) between 3 and 180),
  constraint support_tickets_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint support_tickets_resolution_summary_check
    check (
      resolution_summary is null
      or length(btrim(resolution_summary)) between 3 and 4000
    ),
  constraint support_tickets_assignment_check
    check (
      (assigned_operator_id is null and assigned_at is null)
      or (assigned_operator_id is not null and assigned_at is not null)
    ),
  constraint support_tickets_resolution_state_check
    check (
      (status not in ('resolved', 'closed'))
      or (resolution_summary is not null and resolved_at is not null)
    ),
  constraint support_tickets_closed_state_check
    check ((status <> 'closed') or closed_at is not null),
  constraint support_tickets_version_check check (version > 0)
);

create table if not exists public.support_ticket_contacts (
  ticket_id uuid primary key references public.support_tickets(id) on delete cascade,
  contact_name text not null,
  email_original text not null,
  email_normalized text not null,
  phone_original text not null,
  phone_e164 text not null,
  email_hash text not null,
  phone_hash text not null,
  email_verified boolean not null default false,
  phone_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_ticket_contacts_name_check
    check (length(btrim(contact_name)) between 2 and 120),
  constraint support_ticket_contacts_email_check
    check (
      length(email_normalized) between 3 and 320
      and email_normalized = lower(btrim(email_normalized))
      and position('@' in email_normalized) > 1
    ),
  constraint support_ticket_contacts_phone_check
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint support_ticket_contacts_email_hash_check
    check (email_hash ~ '^[a-f0-9]{64}$'),
  constraint support_ticket_contacts_phone_hash_check
    check (phone_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists public.support_guest_sessions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  secret_hash text not null unique,
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoke_reason text null,
  created_at timestamptz not null default now(),
  constraint support_guest_sessions_secret_hash_check
    check (secret_hash ~ '^[a-f0-9]{64}$'),
  constraint support_guest_sessions_expiry_check
    check (
      idle_expires_at > created_at
      and absolute_expires_at > created_at
      and idle_expires_at <= absolute_expires_at
    ),
  constraint support_guest_sessions_revoke_reason_check
    check (
      revoke_reason is null
      or length(btrim(revoke_reason)) between 3 and 300
    )
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_user_id uuid null references public.profiles(id) on delete set null,
  guest_session_id uuid null references public.support_guest_sessions(id) on delete set null,
  author_kind text not null,
  source text not null default 'web',
  body text not null,
  created_at timestamptz not null default now(),
  constraint support_ticket_messages_author_kind_check
    check (author_kind in ('requester', 'operator', 'system', 'email')),
  constraint support_ticket_messages_source_check
    check (source in ('web', 'android', 'windows', 'email', 'system')),
  constraint support_ticket_messages_body_length_check
    check (length(btrim(body)) between 1 and 8000),
  constraint support_ticket_messages_author_check
    check (
      (author_kind = 'operator' and author_user_id is not null)
      or (author_kind = 'requester')
      or (author_kind in ('system', 'email'))
    )
);

create table if not exists public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid null references public.profiles(id) on delete set null,
  visibility text not null default 'operator',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint support_ticket_events_type_check
    check (event_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint support_ticket_events_visibility_check
    check (visibility in ('requester', 'operator')),
  constraint support_ticket_events_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint support_ticket_events_payload_size_check
    check (octet_length(payload::text) <= 16384)
);

create table if not exists public.support_operator_preferences (
  operator_user_id uuid primary key references public.profiles(id) on delete cascade,
  notify_new_pool boolean not null default true,
  notify_urgent_only boolean not null default false,
  notify_assigned_messages boolean not null default true,
  notify_transfers boolean not null default true,
  notify_escalations boolean not null default true,
  email_enabled boolean not null default false,
  push_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.support_rate_limit_signals (
  id uuid primary key default gen_random_uuid(),
  scope_kind text not null,
  scope_hash text not null,
  action text not null,
  ticket_id uuid null references public.support_tickets(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint support_rate_limit_signals_scope_kind_check
    check (scope_kind in ('ip', 'ip_prefix', 'email', 'phone', 'session')),
  constraint support_rate_limit_signals_scope_hash_check
    check (scope_hash ~ '^[a-f0-9]{64}$'),
  constraint support_rate_limit_signals_action_check
    check (action in ('ticket_create', 'message_create', 'recovery_request')),
  constraint support_rate_limit_signals_expiry_check check (expires_at > created_at)
);

create table if not exists public.support_email_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid null references public.support_tickets(id) on delete set null,
  direction text not null,
  message_id_hash text not null,
  sender_hash text null,
  recipient_hash text null,
  delivery_status text not null default 'pending',
  provider_reference_hash text null,
  received_at timestamptz null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint support_email_messages_direction_check
    check (direction in ('inbound', 'outbound')),
  constraint support_email_messages_message_id_hash_check
    check (message_id_hash ~ '^[a-f0-9]{64}$'),
  constraint support_email_messages_sender_hash_check
    check (sender_hash is null or sender_hash ~ '^[a-f0-9]{64}$'),
  constraint support_email_messages_recipient_hash_check
    check (recipient_hash is null or recipient_hash ~ '^[a-f0-9]{64}$'),
  constraint support_email_messages_status_check
    check (delivery_status in ('pending', 'sent', 'received', 'failed', 'quarantined'))
);

create unique index if not exists support_email_messages_message_id_uidx
  on public.support_email_messages (direction, message_id_hash);

create table if not exists public.privacy_acceptances (
  id uuid primary key default gen_random_uuid(),
  policy_version text not null references public.privacy_policy_versions(version),
  user_id uuid null references public.profiles(id) on delete set null,
  ticket_id uuid null references public.support_tickets(id) on delete set null,
  acceptance_context text not null,
  subject_kind text not null,
  subject_reference_hash text null,
  ip_hash text null,
  user_agent_hash text null,
  accepted_at timestamptz not null default now(),
  constraint privacy_acceptances_context_check
    check (acceptance_context in ('registration', 'support', 'settings', 'recovery')),
  constraint privacy_acceptances_subject_kind_check
    check (subject_kind in ('authenticated_user', 'support_guest', 'legal_representative')),
  constraint privacy_acceptances_subject_check
    check (user_id is not null or ticket_id is not null),
  constraint privacy_acceptances_reference_hash_check
    check (
      subject_reference_hash is null
      or subject_reference_hash ~ '^[a-f0-9]{64}$'
    ),
  constraint privacy_acceptances_ip_hash_check
    check (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$'),
  constraint privacy_acceptances_user_agent_hash_check
    check (user_agent_hash is null or user_agent_hash ~ '^[a-f0-9]{64}$')
);

-- ---------------------------------------------------------------------------
-- 2. Operational indexes
-- ---------------------------------------------------------------------------

create index if not exists support_tickets_pool_idx
  on public.support_tickets (urgent desc, priority desc, last_activity_at desc)
  where assigned_operator_id is null
    and status in ('new', 'waiting_support', 'escalated');

create index if not exists support_tickets_assignee_activity_idx
  on public.support_tickets (assigned_operator_id, status, last_activity_at desc)
  where assigned_operator_id is not null;

create index if not exists support_tickets_requester_activity_idx
  on public.support_tickets (requester_user_id, last_activity_at desc)
  where requester_user_id is not null;

create index if not exists support_tickets_status_activity_idx
  on public.support_tickets (status, last_activity_at desc);

create index if not exists support_guest_sessions_ticket_idx
  on public.support_guest_sessions (ticket_id, created_at desc);

create index if not exists support_guest_sessions_expiry_idx
  on public.support_guest_sessions (absolute_expires_at, idle_expires_at)
  where revoked_at is null;

create index if not exists support_ticket_messages_ticket_created_idx
  on public.support_ticket_messages (ticket_id, created_at, id);

create index if not exists support_ticket_events_ticket_created_idx
  on public.support_ticket_events (ticket_id, created_at, id);

create index if not exists support_rate_limit_signals_scope_created_idx
  on public.support_rate_limit_signals (scope_kind, scope_hash, action, created_at desc);

create index if not exists support_rate_limit_signals_expiry_idx
  on public.support_rate_limit_signals (expires_at);

create index if not exists privacy_acceptances_user_created_idx
  on public.privacy_acceptances (user_id, accepted_at desc)
  where user_id is not null;

create index if not exists privacy_acceptances_ticket_created_idx
  on public.privacy_acceptances (ticket_id, accepted_at desc)
  where ticket_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Seed current policy metadata, support settings and permissions
-- ---------------------------------------------------------------------------

insert into public.privacy_policy_versions (
  version,
  title,
  effective_on,
  content_hash,
  is_current
)
values (
  '2026-07-27',
  'Политика конфиденциальности LETSCUBE',
  date '2026-07-27',
  '03fe852fa293995c0fa15dd1691d1d091ede059db4fcb12dcb8613e7229f034c',
  not exists (
    select 1
    from public.privacy_policy_versions
    where is_current is true
      and version <> '2026-07-27'
  )
)
on conflict (version) do update
set title = excluded.title,
    effective_on = excluded.effective_on,
    content_hash = excluded.content_hash;

insert into public.support_settings (id)
values (true)
on conflict (id) do nothing;

insert into public.permissions (key, name, description, category)
values
  ('support.view', 'Просмотр поддержки', 'Просмотр очереди и обращений поддержки.', 'support'),
  ('support.claim', 'Принятие обращений', 'Принятие обращения из общего пула.', 'support'),
  ('support.reply', 'Ответы поддержки', 'Ведение переписки по принятому обращению.', 'support'),
  ('support.transfer', 'Передача обращений', 'Передача коллеге и возврат в общий пул.', 'support'),
  ('support.escalate', 'Эскалация обращений', 'Передача обращения старшему оператору.', 'support'),
  ('support.lookup_customer', 'Поиск клиента', 'Ограниченный и аудируемый поиск клиента.', 'support'),
  ('support.manage', 'Управление поддержкой', 'Управление всеми обращениями и полными контактами.', 'support'),
  ('support.settings', 'Настройки поддержки', 'Управление режимом приёма и лимитами поддержки.', 'support')
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.key in ('owner', 'tech_admin')
  and r.scope = 'global'
  and p.key like 'support.%'
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. RLS and explicit Data API privileges
-- ---------------------------------------------------------------------------

alter table public.privacy_policy_versions enable row level security;
alter table public.privacy_acceptances enable row level security;
alter table public.support_settings enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_contacts enable row level security;
alter table public.support_guest_sessions enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_events enable row level security;
alter table public.support_operator_preferences enable row level security;
alter table public.support_rate_limit_signals enable row level security;
alter table public.support_email_messages enable row level security;

revoke all on table public.privacy_policy_versions from public, anon, authenticated;
revoke all on table public.privacy_acceptances from public, anon, authenticated;
revoke all on table public.support_settings from public, anon, authenticated;
revoke all on table public.support_tickets from public, anon, authenticated;
revoke all on table public.support_ticket_contacts from public, anon, authenticated;
revoke all on table public.support_guest_sessions from public, anon, authenticated;
revoke all on table public.support_ticket_messages from public, anon, authenticated;
revoke all on table public.support_ticket_events from public, anon, authenticated;
revoke all on table public.support_operator_preferences from public, anon, authenticated;
revoke all on table public.support_rate_limit_signals from public, anon, authenticated;
revoke all on table public.support_email_messages from public, anon, authenticated;

grant select on table public.privacy_policy_versions to anon, authenticated;
grant select on table public.privacy_acceptances to authenticated;
grant select on table public.support_settings to authenticated;
grant select on table public.support_tickets to authenticated;
grant select on table public.support_ticket_contacts to authenticated;
grant select on table public.support_ticket_messages to authenticated;
grant select on table public.support_ticket_events to authenticated;
grant select, insert, update on table public.support_operator_preferences to authenticated;

grant all on table
  public.privacy_policy_versions,
  public.privacy_acceptances,
  public.support_settings,
  public.support_tickets,
  public.support_ticket_contacts,
  public.support_guest_sessions,
  public.support_ticket_messages,
  public.support_ticket_events,
  public.support_operator_preferences,
  public.support_rate_limit_signals,
  public.support_email_messages
to service_role;

drop policy if exists "privacy versions public current select"
  on public.privacy_policy_versions;
create policy "privacy versions public current select"
  on public.privacy_policy_versions
  for select
  to anon, authenticated
  using (is_current is true);

drop policy if exists "privacy acceptances owner select"
  on public.privacy_acceptances;
create policy "privacy acceptances owner select"
  on public.privacy_acceptances
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "support settings operator select"
  on public.support_settings;
create policy "support settings operator select"
  on public.support_settings
  for select
  to authenticated
  using (
    public.has_permission((select auth.uid()), 'support.view')
    or public.has_permission((select auth.uid()), 'support.settings')
  );

drop policy if exists "support tickets requester select"
  on public.support_tickets;
create policy "support tickets requester select"
  on public.support_tickets
  for select
  to authenticated
  using (requester_user_id = (select auth.uid()));

drop policy if exists "support tickets operator select"
  on public.support_tickets;
create policy "support tickets operator select"
  on public.support_tickets
  for select
  to authenticated
  using (public.has_permission((select auth.uid()), 'support.view'));

drop policy if exists "support contacts assigned operator select"
  on public.support_ticket_contacts;
create policy "support contacts assigned operator select"
  on public.support_ticket_contacts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.support_tickets ticket
      where ticket.id = support_ticket_contacts.ticket_id
        and (
          ticket.assigned_operator_id = (select auth.uid())
          or public.has_permission((select auth.uid()), 'support.manage')
        )
    )
  );

drop policy if exists "support messages scoped select"
  on public.support_ticket_messages;
create policy "support messages scoped select"
  on public.support_ticket_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.support_tickets ticket
      where ticket.id = support_ticket_messages.ticket_id
        and (
          ticket.requester_user_id = (select auth.uid())
          or public.has_permission((select auth.uid()), 'support.view')
        )
    )
  );

drop policy if exists "support events scoped select"
  on public.support_ticket_events;
create policy "support events scoped select"
  on public.support_ticket_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.support_tickets ticket
      where ticket.id = support_ticket_events.ticket_id
        and (
          (
            ticket.requester_user_id = (select auth.uid())
            and support_ticket_events.visibility = 'requester'
          )
          or public.has_permission((select auth.uid()), 'support.view')
        )
    )
  );

drop policy if exists "support preferences owner select"
  on public.support_operator_preferences;
create policy "support preferences owner select"
  on public.support_operator_preferences
  for select
  to authenticated
  using (
    operator_user_id = (select auth.uid())
    and public.has_permission((select auth.uid()), 'support.view')
  );

drop policy if exists "support preferences owner insert"
  on public.support_operator_preferences;
create policy "support preferences owner insert"
  on public.support_operator_preferences
  for insert
  to authenticated
  with check (
    operator_user_id = (select auth.uid())
    and public.has_permission((select auth.uid()), 'support.view')
  );

drop policy if exists "support preferences owner update"
  on public.support_operator_preferences;
create policy "support preferences owner update"
  on public.support_operator_preferences
  for update
  to authenticated
  using (
    operator_user_id = (select auth.uid())
    and public.has_permission((select auth.uid()), 'support.view')
  )
  with check (
    operator_user_id = (select auth.uid())
    and public.has_permission((select auth.uid()), 'support.view')
  );

revoke insert, update, delete on table public.support_ticket_events from authenticated;

-- ---------------------------------------------------------------------------
-- 5. Internal helpers and audit-safe triggers
-- ---------------------------------------------------------------------------

create or replace function public._support_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$function$;

drop trigger if exists trg_support_settings_touch_updated_at
  on public.support_settings;
create trigger trg_support_settings_touch_updated_at
  before update on public.support_settings
  for each row execute function public._support_touch_updated_at();

drop trigger if exists trg_support_tickets_touch_updated_at
  on public.support_tickets;
create trigger trg_support_tickets_touch_updated_at
  before update on public.support_tickets
  for each row execute function public._support_touch_updated_at();

drop trigger if exists trg_support_contacts_touch_updated_at
  on public.support_ticket_contacts;
create trigger trg_support_contacts_touch_updated_at
  before update on public.support_ticket_contacts
  for each row execute function public._support_touch_updated_at();

drop trigger if exists trg_support_preferences_touch_updated_at
  on public.support_operator_preferences;
create trigger trg_support_preferences_touch_updated_at
  before update on public.support_operator_preferences
  for each row execute function public._support_touch_updated_at();

revoke all on function public._support_touch_updated_at()
  from public, anon, authenticated;

create or replace function public._support_require_permission(p_permission_key text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.has_permission(v_actor, p_permission_key) then
    raise exception 'support_permission_denied' using errcode = '42501';
  end if;

  return v_actor;
end
$function$;

revoke all on function public._support_require_permission(text)
  from public, anon, authenticated;

create or replace function public._support_append_event(
  p_ticket_id uuid,
  p_event_type text,
  p_actor_user_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event_id uuid;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_visibility text;
begin
  if p_ticket_id is null
     or p_event_type !~ '^[a-z][a-z0-9_]{1,63}$'
     or jsonb_typeof(v_payload) <> 'object'
     or octet_length(v_payload::text) > 16384 then
    raise exception 'invalid_support_event';
  end if;

  v_visibility := case
    when p_event_type in (
      'ticket_created',
      'waiting_user',
      'waiting_support',
      'resolved',
      'closed',
      'reopened',
      'reopened_as_new'
    ) then 'requester'
    else 'operator'
  end;

  insert into public.support_ticket_events (
    ticket_id,
    event_type,
    actor_user_id,
    visibility,
    payload
  )
  values (
    p_ticket_id,
    p_event_type,
    p_actor_user_id,
    v_visibility,
    v_payload
  )
  returning id into v_event_id;

  return v_event_id;
end
$function$;

revoke all on function public._support_append_event(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public._support_append_event(uuid, text, uuid, jsonb)
  to service_role;

create or replace function public._support_actor_controls_ticket(
  p_ticket public.support_tickets,
  p_actor uuid
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $function$
  select p_actor is not null
    and (
      p_ticket.assigned_operator_id = p_actor
      or public.has_permission(p_actor, 'support.manage')
    )
$function$;

revoke all on function public._support_actor_controls_ticket(
  public.support_tickets,
  uuid
) from public, anon, authenticated;

-- Messages can only be inserted by trusted server code in this proposal. The
-- trigger links every message to immutable workflow history and updates the
-- queue state without exposing message text through notifications.
create or replace function public._support_message_before_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text;
begin
  select ticket.status
  into v_status
  from public.support_tickets ticket
  where ticket.id = new.ticket_id
  for update;

  if not found then
    raise exception 'support_ticket_not_found';
  end if;

  if v_status in ('closed', 'spam') then
    raise exception 'support_ticket_not_writable';
  end if;

  return new;
end
$function$;

create or replace function public._support_message_after_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event_type text;
begin
  if new.author_kind = 'requester' then
    v_event_type := 'requester_message';
    update public.support_tickets
    set status = case
          when assigned_operator_id is null then 'new'
          else 'waiting_support'
        end,
        last_requester_message_at = new.created_at,
        last_activity_at = new.created_at,
        version = version + 1
    where id = new.ticket_id;
  elsif new.author_kind = 'operator' then
    v_event_type := 'operator_message';
    update public.support_tickets
    set status = 'waiting_user',
        last_operator_message_at = new.created_at,
        last_activity_at = new.created_at,
        version = version + 1
    where id = new.ticket_id;
  else
    v_event_type := 'system_message';
    update public.support_tickets
    set last_activity_at = new.created_at,
        version = version + 1
    where id = new.ticket_id;
  end if;

  perform public._support_append_event(
    new.ticket_id,
    v_event_type,
    new.author_user_id,
    jsonb_build_object('message_id', new.id, 'source', new.source)
  );

  return null;
end
$function$;

drop trigger if exists trg_support_message_before_insert
  on public.support_ticket_messages;
create trigger trg_support_message_before_insert
  before insert on public.support_ticket_messages
  for each row execute function public._support_message_before_insert();

drop trigger if exists trg_support_message_after_insert
  on public.support_ticket_messages;
create trigger trg_support_message_after_insert
  after insert on public.support_ticket_messages
  for each row execute function public._support_message_after_insert();

revoke all on function public._support_message_before_insert()
  from public, anon, authenticated;
revoke all on function public._support_message_after_insert()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Trusted guest-gateway RPCs
-- ---------------------------------------------------------------------------

create or replace function public._support_guest_ticket_projection(p_ticket_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public
as $function$
  select jsonb_build_object(
    'id', ticket.id,
    'publicReference', ticket.public_reference,
    'category', ticket.category,
    'subject', ticket.subject,
    'status', ticket.status,
    'createdAt', ticket.created_at,
    'updatedAt', ticket.updated_at,
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', message.id,
          'authorType', message.author_kind,
          'body', message.body,
          'createdAt', message.created_at
        )
        order by message.created_at, message.id
      )
      from (
        select
          source_message.id,
          source_message.author_kind,
          source_message.body,
          source_message.created_at
        from public.support_ticket_messages source_message
        where source_message.ticket_id = ticket.id
        order by source_message.created_at desc, source_message.id desc
        limit 200
      ) message
    ), '[]'::jsonb)
  )
  from public.support_tickets ticket
  where ticket.id = p_ticket_id
$function$;

revoke all on function public._support_guest_ticket_projection(uuid)
  from public, anon, authenticated;
grant execute on function public._support_guest_ticket_projection(uuid)
  to service_role;

create or replace function public._support_guest_session_touch(
  p_ticket_id uuid,
  p_secret_hash text
)
returns public.support_guest_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_session public.support_guest_sessions%rowtype;
begin
  if p_ticket_id is null
     or coalesce(p_secret_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'support_guest_session_invalid' using errcode = '28000';
  end if;

  select session.*
  into v_session
  from public.support_guest_sessions session
  where session.ticket_id = p_ticket_id
    and session.secret_hash = p_secret_hash
    and session.revoked_at is null
  for update;

  if not found
     or v_session.idle_expires_at <= v_now
     or v_session.absolute_expires_at <= v_now then
    raise exception 'support_guest_session_expired' using errcode = '28000';
  end if;

  update public.support_guest_sessions session
  set last_seen_at = clock_timestamp(),
      idle_expires_at = least(
        v_session.absolute_expires_at,
        clock_timestamp() + interval '30 days'
      )
  where session.id = v_session.id
  returning session.* into v_session;

  return v_session;
end
$function$;

revoke all on function public._support_guest_session_touch(uuid, text)
  from public, anon, authenticated;
grant execute on function public._support_guest_session_touch(uuid, text)
  to service_role;

create or replace function public.support_guest_ticket_create(
  p_contact_name text,
  p_email_original text,
  p_email_normalized text,
  p_phone_original text,
  p_phone_e164 text,
  p_email_hash text,
  p_phone_hash text,
  p_category text,
  p_subject text,
  p_message text,
  p_secret_hash text,
  p_idle_expires_at timestamptz,
  p_absolute_expires_at timestamptz,
  p_policy_version text,
  p_subject_reference_hash text,
  p_ip_hash text,
  p_ip_prefix_hash text,
  p_user_agent_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_settings public.support_settings%rowtype;
  v_ticket_id uuid;
  v_message_id uuid;
  v_session public.support_guest_sessions%rowtype;
  v_short_count bigint;
  v_day_count bigint;
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_contact_name text := btrim(coalesce(p_contact_name, ''));
  v_email_original text := btrim(coalesce(p_email_original, ''));
  v_email_normalized text := lower(btrim(coalesce(p_email_normalized, '')));
  v_phone_original text := btrim(coalesce(p_phone_original, ''));
  v_phone_e164 text := btrim(coalesce(p_phone_e164, ''));
  v_subject text := btrim(coalesce(p_subject, ''));
  v_message text := btrim(coalesce(p_message, ''));
begin
  if length(v_contact_name) not between 2 and 120
     or length(v_email_original) not between 3 and 320
     or length(v_email_normalized) not between 3 and 320
     or position('@' in v_email_normalized) <= 1
     or length(v_phone_original) not between 8 and 40
     or v_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
     or length(v_subject) not between 3 and 180
     or length(v_message) not between 1 and 8000
     or v_category not in (
       'account',
       'access',
       'technical',
       'messages',
       'media',
       'tasks',
       'privacy',
       'other',
       'abuse',
       'messaging',
       'club'
     ) then
    raise exception 'support_guest_request_invalid';
  end if;

  if coalesce(p_email_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_phone_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_secret_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_subject_reference_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_ip_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_ip_prefix_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_user_agent_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'support_guest_digest_invalid';
  end if;

  if p_idle_expires_at <= v_now
     or p_absolute_expires_at <= p_idle_expires_at
     or p_idle_expires_at > v_now + interval '31 days'
     or p_absolute_expires_at > v_now + interval '91 days' then
    raise exception 'support_guest_expiry_invalid';
  end if;

  if not exists (
    select 1
    from public.privacy_policy_versions policy
    where policy.version = p_policy_version
      and policy.published_at <= v_now
      and policy.effective_on <= v_now::date
  ) then
    raise exception 'support_privacy_policy_invalid';
  end if;

  select settings.*
  into v_settings
  from public.support_settings settings
  where settings.id is true
  for share;

  if not found
     or not v_settings.intake_enabled
     or not v_settings.guest_intake_enabled then
    raise exception 'support_intake_closed';
  end if;

  -- Fixed lock order prevents races without globally serializing unrelated
  -- support requests.
  perform pg_advisory_xact_lock(
    hashtextextended('support:ip:' || p_ip_hash, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('support:ip_prefix:' || p_ip_prefix_hash, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('support:email:' || p_email_hash, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('support:phone:' || p_phone_hash, 0)
  );

  select greatest(
    (
      select count(*)
      from public.support_rate_limit_signals signal
      where signal.scope_kind = 'ip'
        and signal.scope_hash = p_ip_hash
        and signal.action = 'ticket_create'
        and signal.created_at >= v_now - interval '15 minutes'
    ),
    (
      select count(*)
      from public.support_rate_limit_signals signal
      where signal.scope_kind = 'ip_prefix'
        and signal.scope_hash = p_ip_prefix_hash
        and signal.action = 'ticket_create'
        and signal.created_at >= v_now - interval '15 minutes'
    ),
    (
      select count(*)
      from public.support_rate_limit_signals signal
      where signal.scope_kind = 'email'
        and signal.scope_hash = p_email_hash
        and signal.action = 'ticket_create'
        and signal.created_at >= v_now - interval '15 minutes'
    ),
    (
      select count(*)
      from public.support_rate_limit_signals signal
      where signal.scope_kind = 'phone'
        and signal.scope_hash = p_phone_hash
        and signal.action = 'ticket_create'
        and signal.created_at >= v_now - interval '15 minutes'
    )
  )
  into v_short_count;

  select greatest(
    (
      select count(*)
      from public.support_rate_limit_signals signal
      where signal.scope_kind = 'ip'
        and signal.scope_hash = p_ip_hash
        and signal.action = 'ticket_create'
        and signal.created_at >= v_now - interval '1 day'
    ),
    (
      select count(*)
      from public.support_rate_limit_signals signal
      where signal.scope_kind = 'ip_prefix'
        and signal.scope_hash = p_ip_prefix_hash
        and signal.action = 'ticket_create'
        and signal.created_at >= v_now - interval '1 day'
    ),
    (
      select count(*)
      from public.support_rate_limit_signals signal
      where signal.scope_kind = 'email'
        and signal.scope_hash = p_email_hash
        and signal.action = 'ticket_create'
        and signal.created_at >= v_now - interval '1 day'
    ),
    (
      select count(*)
      from public.support_rate_limit_signals signal
      where signal.scope_kind = 'phone'
        and signal.scope_hash = p_phone_hash
        and signal.action = 'ticket_create'
        and signal.created_at >= v_now - interval '1 day'
    )
  )
  into v_day_count;

  if v_short_count >= v_settings.ticket_limit_15m
     or v_day_count >= v_settings.ticket_limit_day then
    raise exception 'support_rate_limited' using errcode = 'P0001';
  end if;

  insert into public.support_tickets (
    requester_user_id,
    source,
    status,
    category,
    subject,
    priority,
    last_activity_at
  )
  values (
    null,
    'web_guest',
    'new',
    v_category,
    v_subject,
    'normal',
    v_now
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
    phone_hash
  )
  values (
    v_ticket_id,
    v_contact_name,
    v_email_original,
    v_email_normalized,
    v_phone_original,
    v_phone_e164,
    p_email_hash,
    p_phone_hash
  );

  insert into public.support_guest_sessions (
    ticket_id,
    secret_hash,
    idle_expires_at,
    absolute_expires_at,
    last_seen_at
  )
  values (
    v_ticket_id,
    p_secret_hash,
    p_idle_expires_at,
    p_absolute_expires_at,
    v_now
  )
  returning * into v_session;

  insert into public.privacy_acceptances (
    policy_version,
    ticket_id,
    acceptance_context,
    subject_kind,
    subject_reference_hash,
    ip_hash,
    user_agent_hash,
    accepted_at
  )
  values (
    p_policy_version,
    v_ticket_id,
    'support',
    'support_guest',
    p_subject_reference_hash,
    p_ip_hash,
    p_user_agent_hash,
    v_now
  );

  insert into public.support_rate_limit_signals (
    scope_kind,
    scope_hash,
    action,
    ticket_id,
    expires_at,
    created_at
  )
  values
    ('ip', p_ip_hash, 'ticket_create', v_ticket_id, v_now + interval '90 days', v_now),
    (
      'ip_prefix',
      p_ip_prefix_hash,
      'ticket_create',
      v_ticket_id,
      v_now + interval '90 days',
      v_now
    ),
    ('email', p_email_hash, 'ticket_create', v_ticket_id, v_now + interval '90 days', v_now),
    ('phone', p_phone_hash, 'ticket_create', v_ticket_id, v_now + interval '90 days', v_now);

  perform public._support_append_event(
    v_ticket_id,
    'ticket_created',
    null,
    jsonb_build_object('source', 'web_guest')
  );

  insert into public.support_ticket_messages (
    ticket_id,
    guest_session_id,
    author_kind,
    source,
    body
  )
  values (
    v_ticket_id,
    v_session.id,
    'requester',
    'web',
    v_message
  )
  returning id into v_message_id;

  return jsonb_build_object(
    'ticket', public._support_guest_ticket_projection(v_ticket_id),
    'session', jsonb_build_object(
      'ticketId', v_ticket_id,
      'idleExpiresAt', v_session.idle_expires_at,
      'absoluteExpiresAt', v_session.absolute_expires_at,
      'updatedAt', v_session.last_seen_at
    )
  );
end
$function$;

create or replace function public.support_guest_ticket_get(
  p_ticket_id uuid,
  p_secret_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_session public.support_guest_sessions%rowtype;
  v_ticket jsonb;
begin
  v_session := public._support_guest_session_touch(p_ticket_id, p_secret_hash);
  v_ticket := public._support_guest_ticket_projection(p_ticket_id);

  if v_ticket is null then
    raise exception 'support_ticket_not_found';
  end if;

  return v_ticket;
end
$function$;

create or replace function public.support_guest_message_create(
  p_ticket_id uuid,
  p_secret_hash text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_session public.support_guest_sessions%rowtype;
  v_settings public.support_settings%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_short_count bigint;
  v_day_count bigint;
begin
  if length(v_body) not between 1 and 8000 then
    raise exception 'support_message_invalid';
  end if;

  v_session := public._support_guest_session_touch(p_ticket_id, p_secret_hash);

  perform pg_advisory_xact_lock(
    hashtextextended('support:session:' || p_secret_hash, 0)
  );

  select settings.*
  into v_settings
  from public.support_settings settings
  where settings.id is true;

  if not found or not v_settings.intake_enabled then
    raise exception 'support_intake_closed';
  end if;

  select count(*)
  into v_short_count
  from public.support_rate_limit_signals signal
  where signal.scope_kind = 'session'
    and signal.scope_hash = p_secret_hash
    and signal.action = 'message_create'
    and signal.created_at >= v_now - interval '5 minutes';

  select count(*)
  into v_day_count
  from public.support_rate_limit_signals signal
  where signal.scope_kind = 'session'
    and signal.scope_hash = p_secret_hash
    and signal.action = 'message_create'
    and signal.created_at >= v_now - interval '1 day';

  if v_short_count >= v_settings.message_limit_5m
     or v_day_count >= v_settings.message_limit_day then
    raise exception 'support_message_rate_limited' using errcode = 'P0001';
  end if;

  insert into public.support_ticket_messages (
    ticket_id,
    guest_session_id,
    author_kind,
    source,
    body
  )
  values (
    p_ticket_id,
    v_session.id,
    'requester',
    'web',
    v_body
  );

  insert into public.support_rate_limit_signals (
    scope_kind,
    scope_hash,
    action,
    ticket_id,
    expires_at,
    created_at
  )
  values (
    'session',
    p_secret_hash,
    'message_create',
    p_ticket_id,
    v_now + interval '90 days',
    v_now
  );

  return public._support_guest_ticket_projection(p_ticket_id);
end
$function$;

create or replace function public.support_guest_session_revoke(
  p_ticket_id uuid,
  p_secret_hash text,
  p_reason text default 'guest_forget'
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_revoked boolean := false;
begin
  if p_ticket_id is null
     or coalesce(p_secret_hash, '') !~ '^[a-f0-9]{64}$'
     or length(v_reason) not between 3 and 300 then
    raise exception 'support_guest_session_invalid';
  end if;

  update public.support_guest_sessions session
  set revoked_at = coalesce(session.revoked_at, clock_timestamp()),
      revoke_reason = coalesce(session.revoke_reason, v_reason)
  where session.ticket_id = p_ticket_id
    and session.secret_hash = p_secret_hash
    and session.revoked_at is null;

  v_revoked := found;
  return v_revoked;
end
$function$;

revoke all on function public.support_guest_ticket_create(
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
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
revoke all on function public.support_guest_ticket_get(uuid, text)
  from public, anon, authenticated;
revoke all on function public.support_guest_message_create(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.support_guest_session_revoke(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.support_guest_ticket_create(
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
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text
) to service_role;
grant execute on function public.support_guest_ticket_get(uuid, text)
  to service_role;
grant execute on function public.support_guest_message_create(uuid, text, text)
  to service_role;
grant execute on function public.support_guest_session_revoke(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Atomic operator and requester RPCs
-- ---------------------------------------------------------------------------

create or replace function public.support_ticket_claim(p_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid;
  v_ticket_id uuid;
begin
  v_actor := public._support_require_permission('support.claim');

  select ticket.id
  into v_ticket_id
  from public.support_tickets ticket
  where ticket.id = p_ticket_id
    and ticket.assigned_operator_id is null
    and ticket.status in ('new', 'waiting_support', 'escalated')
  for update skip locked;

  if v_ticket_id is null then
    raise exception 'support_ticket_already_claimed_or_unavailable'
      using errcode = 'P0001';
  end if;

  update public.support_tickets
  set assigned_operator_id = v_actor,
      assigned_at = clock_timestamp(),
      status = 'in_progress',
      last_activity_at = clock_timestamp(),
      version = version + 1
  where id = v_ticket_id;

  perform public._support_append_event(
    v_ticket_id,
    'claimed',
    v_actor,
    jsonb_build_object('assigned_operator_id', v_actor)
  );

  return v_ticket_id;
end
$function$;

create or replace function public.support_ticket_transfer(
  p_ticket_id uuid,
  p_operator_id uuid,
  p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid;
  v_ticket public.support_tickets%rowtype;
  v_comment text := btrim(coalesce(p_comment, ''));
begin
  v_actor := public._support_require_permission('support.transfer');

  if p_operator_id is null
     or p_operator_id = v_actor
     or length(v_comment) not between 3 and 1000 then
    raise exception 'invalid_support_transfer';
  end if;

  if not public.has_permission(p_operator_id, 'support.view')
     or not public.has_permission(p_operator_id, 'support.reply') then
    raise exception 'support_target_operator_unavailable';
  end if;

  select ticket.*
  into v_ticket
  from public.support_tickets ticket
  where ticket.id = p_ticket_id
  for update;

  if not found then
    raise exception 'support_ticket_not_found';
  end if;
  if v_ticket.status in ('closed', 'spam')
     or not public._support_actor_controls_ticket(v_ticket, v_actor) then
    raise exception 'support_ticket_transition_denied' using errcode = '42501';
  end if;

  update public.support_tickets
  set assigned_operator_id = p_operator_id,
      assigned_at = clock_timestamp(),
      status = 'in_progress',
      last_activity_at = clock_timestamp(),
      version = version + 1
  where id = p_ticket_id;

  perform public._support_append_event(
    p_ticket_id,
    'transferred',
    v_actor,
    jsonb_build_object(
      'from_operator_id', v_ticket.assigned_operator_id,
      'to_operator_id', p_operator_id,
      'comment', v_comment
    )
  );

  return p_ticket_id;
end
$function$;

create or replace function public.support_ticket_return_to_pool(
  p_ticket_id uuid,
  p_reason text,
  p_urgent boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid;
  v_ticket public.support_tickets%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  v_actor := public._support_require_permission('support.transfer');

  if length(v_reason) not between 3 and 1000 then
    raise exception 'invalid_support_pool_reason';
  end if;

  select ticket.*
  into v_ticket
  from public.support_tickets ticket
  where ticket.id = p_ticket_id
  for update;

  if not found then
    raise exception 'support_ticket_not_found';
  end if;
  if v_ticket.status in ('closed', 'spam')
     or not public._support_actor_controls_ticket(v_ticket, v_actor) then
    raise exception 'support_ticket_transition_denied' using errcode = '42501';
  end if;

  update public.support_tickets
  set assigned_operator_id = null,
      assigned_at = null,
      status = 'new',
      urgent = coalesce(p_urgent, false),
      priority = case when coalesce(p_urgent, false) then 'urgent' else priority end,
      last_activity_at = clock_timestamp(),
      version = version + 1
  where id = p_ticket_id;

  perform public._support_append_event(
    p_ticket_id,
    'returned_to_pool',
    v_actor,
    jsonb_build_object(
      'previous_operator_id', v_ticket.assigned_operator_id,
      'reason', v_reason,
      'urgent', coalesce(p_urgent, false)
    )
  );

  return p_ticket_id;
end
$function$;

create or replace function public.support_ticket_escalate(
  p_ticket_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid;
  v_ticket public.support_tickets%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  v_actor := public._support_require_permission('support.escalate');

  if length(v_reason) not between 3 and 1000 then
    raise exception 'invalid_support_escalation_reason';
  end if;

  select ticket.*
  into v_ticket
  from public.support_tickets ticket
  where ticket.id = p_ticket_id
  for update;

  if not found then
    raise exception 'support_ticket_not_found';
  end if;
  if v_ticket.status in ('closed', 'spam')
     or not public._support_actor_controls_ticket(v_ticket, v_actor) then
    raise exception 'support_ticket_transition_denied' using errcode = '42501';
  end if;

  update public.support_tickets
  set status = 'escalated',
      urgent = true,
      priority = 'urgent',
      last_activity_at = clock_timestamp(),
      version = version + 1
  where id = p_ticket_id;

  perform public._support_append_event(
    p_ticket_id,
    'escalated',
    v_actor,
    jsonb_build_object('reason', v_reason)
  );

  return p_ticket_id;
end
$function$;

create or replace function public.support_ticket_mark_waiting(
  p_ticket_id uuid,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid;
  v_ticket public.support_tickets%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
begin
  v_actor := public._support_require_permission('support.reply');

  if v_status not in ('waiting_user', 'waiting_support') then
    raise exception 'invalid_support_waiting_status';
  end if;

  select ticket.*
  into v_ticket
  from public.support_tickets ticket
  where ticket.id = p_ticket_id
  for update;

  if not found then
    raise exception 'support_ticket_not_found';
  end if;
  if v_ticket.status in ('closed', 'spam')
     or not public._support_actor_controls_ticket(v_ticket, v_actor) then
    raise exception 'support_ticket_transition_denied' using errcode = '42501';
  end if;

  update public.support_tickets
  set status = v_status,
      last_activity_at = clock_timestamp(),
      version = version + 1
  where id = p_ticket_id;

  perform public._support_append_event(
    p_ticket_id,
    v_status,
    v_actor,
    '{}'::jsonb
  );

  return p_ticket_id;
end
$function$;

create or replace function public.support_ticket_resolve(
  p_ticket_id uuid,
  p_summary text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid;
  v_ticket public.support_tickets%rowtype;
  v_summary text := btrim(coalesce(p_summary, ''));
begin
  v_actor := public._support_require_permission('support.reply');

  if length(v_summary) not between 3 and 4000 then
    raise exception 'invalid_support_resolution_summary';
  end if;

  select ticket.*
  into v_ticket
  from public.support_tickets ticket
  where ticket.id = p_ticket_id
  for update;

  if not found then
    raise exception 'support_ticket_not_found';
  end if;
  if v_ticket.status in ('closed', 'spam')
     or not public._support_actor_controls_ticket(v_ticket, v_actor) then
    raise exception 'support_ticket_transition_denied' using errcode = '42501';
  end if;

  update public.support_tickets
  set status = 'resolved',
      resolution_summary = v_summary,
      resolved_at = clock_timestamp(),
      closed_at = null,
      last_activity_at = clock_timestamp(),
      version = version + 1
  where id = p_ticket_id;

  perform public._support_append_event(
    p_ticket_id,
    'resolved',
    v_actor,
    jsonb_build_object('summary', v_summary)
  );

  return p_ticket_id;
end
$function$;

create or replace function public.support_ticket_close(
  p_ticket_id uuid,
  p_summary text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid;
  v_ticket public.support_tickets%rowtype;
  v_summary text := btrim(coalesce(p_summary, ''));
begin
  v_actor := public._support_require_permission('support.reply');

  if length(v_summary) not between 3 and 4000 then
    raise exception 'invalid_support_close_summary';
  end if;

  select ticket.*
  into v_ticket
  from public.support_tickets ticket
  where ticket.id = p_ticket_id
  for update;

  if not found then
    raise exception 'support_ticket_not_found';
  end if;
  if v_ticket.status = 'spam'
     or not public._support_actor_controls_ticket(v_ticket, v_actor) then
    raise exception 'support_ticket_transition_denied' using errcode = '42501';
  end if;

  update public.support_tickets
  set status = 'closed',
      resolution_summary = v_summary,
      resolved_at = coalesce(resolved_at, clock_timestamp()),
      closed_at = clock_timestamp(),
      last_activity_at = clock_timestamp(),
      version = version + 1
  where id = p_ticket_id;

  perform public._support_append_event(
    p_ticket_id,
    'closed',
    v_actor,
    jsonb_build_object('summary', v_summary)
  );

  return p_ticket_id;
end
$function$;

create or replace function public.support_ticket_reopen(p_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid := auth.uid();
  v_ticket public.support_tickets%rowtype;
  v_new_ticket_id uuid;
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select ticket.*
  into v_ticket
  from public.support_tickets ticket
  where ticket.id = p_ticket_id
  for update;

  if not found then
    raise exception 'support_ticket_not_found';
  end if;

  if v_ticket.requester_user_id is distinct from v_actor
     and not public.has_permission(v_actor, 'support.manage') then
    raise exception 'support_ticket_transition_denied' using errcode = '42501';
  end if;

  if v_ticket.status = 'resolved'
     and v_ticket.resolved_at >= clock_timestamp() - interval '7 days' then
    update public.support_tickets
    set status = case
          when assigned_operator_id is null then 'new'
          else 'waiting_support'
        end,
        resolution_summary = null,
        resolved_at = null,
        closed_at = null,
        last_activity_at = clock_timestamp(),
        version = version + 1
    where id = p_ticket_id;

    perform public._support_append_event(
      p_ticket_id,
      'reopened',
      v_actor,
      '{}'::jsonb
    );
    return p_ticket_id;
  end if;

  if v_ticket.status <> 'closed' then
    raise exception 'support_ticket_reopen_window_expired';
  end if;

  insert into public.support_tickets (
    requester_user_id,
    source,
    status,
    category,
    subject,
    priority,
    urgent,
    linked_ticket_id,
    last_activity_at
  )
  values (
    v_ticket.requester_user_id,
    case when v_ticket.requester_user_id = v_actor then 'authenticated' else 'admin' end,
    'new',
    v_ticket.category,
    v_ticket.subject,
    v_ticket.priority,
    v_ticket.urgent,
    v_ticket.id,
    clock_timestamp()
  )
  returning id into v_new_ticket_id;

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
  select
    v_new_ticket_id,
    contact_name,
    email_original,
    email_normalized,
    phone_original,
    phone_e164,
    email_hash,
    phone_hash,
    email_verified,
    phone_verified
  from public.support_ticket_contacts
  where ticket_id = v_ticket.id;

  perform public._support_append_event(
    v_ticket.id,
    'reopened_as_new',
    v_actor,
    jsonb_build_object('new_ticket_id', v_new_ticket_id)
  );
  perform public._support_append_event(
    v_new_ticket_id,
    'ticket_created',
    v_actor,
    jsonb_build_object('linked_ticket_id', v_ticket.id)
  );

  return v_new_ticket_id;
end
$function$;

create or replace function public._support_mask_email(p_email text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $function$
  select case
    when position('@' in p_email) <= 1 then '***'
    else left(p_email, 1)
      || '***@'
      || split_part(p_email, '@', 2)
  end
$function$;

create or replace function public._support_mask_phone(p_phone text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $function$
  select case
    when length(p_phone) < 5 then '***'
    else left(p_phone, 2)
      || repeat('*', greatest(length(p_phone) - 6, 3))
      || right(p_phone, 4)
  end
$function$;

revoke all on function public._support_mask_email(text)
  from public, anon, authenticated;
revoke all on function public._support_mask_phone(text)
  from public, anon, authenticated;

create or replace function public.support_ticket_lookup_customer(
  p_ticket_id uuid,
  p_query text
)
returns table (
  user_id uuid,
  full_name text,
  username text,
  avatar_url text,
  email_masked text,
  phone_masked text,
  match_basis text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_actor uuid;
  v_query text := btrim(coalesce(p_query, ''));
  v_query_lower text;
  v_query_phone text;
  v_count integer := 0;
begin
  v_actor := public._support_require_permission('support.lookup_customer');

  if p_ticket_id is null or length(v_query) not between 3 and 320 then
    raise exception 'invalid_support_customer_lookup';
  end if;

  if not exists (
    select 1
    from public.support_tickets ticket
    where ticket.id = p_ticket_id
  ) then
    raise exception 'support_ticket_not_found';
  end if;

  v_query_lower := lower(v_query);
  v_query_phone := regexp_replace(v_query, '[^0-9+]', '', 'g');

  return query
  select
    profile.id,
    profile.full_name,
    profile.username,
    profile.avatar_url,
    public._support_mask_email(coalesce(account.email, '')),
    public._support_mask_phone(coalesce(contact.phone, '')),
    case
      when lower(coalesce(account.email, '')) = v_query_lower then 'email'
      when regexp_replace(coalesce(contact.phone, ''), '[^0-9+]', '', 'g') = v_query_phone
        and length(v_query_phone) >= 8 then 'phone'
      when lower(coalesce(profile.username, '')) = trim(leading '@' from v_query_lower)
        then 'username'
      else 'profile'
    end
  from public.profiles profile
  left join auth.users account on account.id = profile.id
  left join public.profile_contacts contact on contact.user_id = profile.id
  where lower(coalesce(account.email, '')) = v_query_lower
     or (
       length(v_query_phone) >= 8
       and regexp_replace(coalesce(contact.phone, ''), '[^0-9+]', '', 'g') = v_query_phone
     )
     or lower(coalesce(profile.username, '')) = trim(leading '@' from v_query_lower)
     or position(v_query_lower in lower(coalesce(profile.full_name, ''))) > 0
  order by
    case
      when lower(coalesce(account.email, '')) = v_query_lower then 0
      when lower(coalesce(profile.username, '')) = trim(leading '@' from v_query_lower) then 1
      else 2
    end,
    profile.created_at
  limit 20;

  get diagnostics v_count = row_count;

  perform public._support_append_event(
    p_ticket_id,
    'customer_lookup',
    v_actor,
    jsonb_build_object(
      'query_hash',
      encode(extensions.digest(v_query_lower, 'sha256'), 'hex'),
      'candidate_count',
      v_count
    )
  );
end
$function$;

create or replace function public.support_settings_update(
  p_intake_enabled boolean,
  p_guest_intake_enabled boolean,
  p_closed_message text,
  p_ticket_limit_15m integer,
  p_ticket_limit_day integer
)
returns public.support_settings
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid;
  v_result public.support_settings%rowtype;
  v_closed_message text := btrim(coalesce(p_closed_message, ''));
begin
  v_actor := public._support_require_permission('support.settings');

  if length(v_closed_message) not between 3 and 500
     or p_ticket_limit_15m not between 1 and 50
     or p_ticket_limit_day not between 1 and 500
     or p_ticket_limit_day < p_ticket_limit_15m then
    raise exception 'invalid_support_settings';
  end if;

  insert into public.support_settings (
    id,
    intake_enabled,
    guest_intake_enabled,
    closed_message,
    ticket_limit_15m,
    ticket_limit_day,
    updated_by,
    updated_at
  )
  values (
    true,
    coalesce(p_intake_enabled, false),
    coalesce(p_guest_intake_enabled, false),
    v_closed_message,
    p_ticket_limit_15m,
    p_ticket_limit_day,
    v_actor,
    clock_timestamp()
  )
  on conflict (id) do update
  set intake_enabled = excluded.intake_enabled,
      guest_intake_enabled = excluded.guest_intake_enabled,
      closed_message = excluded.closed_message,
      ticket_limit_15m = excluded.ticket_limit_15m,
      ticket_limit_day = excluded.ticket_limit_day,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  returning * into v_result;

  perform public._audit(
    'support_settings_updated',
    'support_settings',
    null,
    jsonb_build_object(
      'intake_enabled', v_result.intake_enabled,
      'guest_intake_enabled', v_result.guest_intake_enabled,
      'ticket_limit_15m', v_result.ticket_limit_15m,
      'ticket_limit_day', v_result.ticket_limit_day
    )
  );

  return v_result;
end
$function$;

-- Read-only retention candidate discovery. Deletion/anonymization remains a
-- separate, reviewed server job so this proposal cannot destroy live records.
create or replace function public.support_retention_candidates(
  p_as_of timestamptz default clock_timestamp()
)
returns table (
  entity_kind text,
  entity_id uuid,
  eligible_at timestamptz,
  retention_reason text
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $function$
  select
    'ticket',
    ticket.id,
    ticket.closed_at + interval '3 years',
    'closed_ticket'
  from public.support_tickets ticket
  where ticket.status = 'closed'
    and ticket.closed_at is not null
    and ticket.closed_at + interval '3 years' <= p_as_of

  union all

  select
    'ticket',
    ticket.id,
    ticket.created_at + interval '90 days',
    'spam_ticket'
  from public.support_tickets ticket
  where ticket.status = 'spam'
    and ticket.created_at + interval '90 days' <= p_as_of

  union all

  select
    'guest_session',
    session.id,
    session.absolute_expires_at,
    'expired_guest_session'
  from public.support_guest_sessions session
  where session.absolute_expires_at <= p_as_of
     or session.idle_expires_at <= p_as_of
     or session.revoked_at is not null

  union all

  select
    'rate_limit_signal',
    signal.id,
    signal.created_at + interval '90 days',
    'expired_rate_limit_signal'
  from public.support_rate_limit_signals signal
  where signal.created_at + interval '90 days' <= p_as_of
$function$;

revoke all on function public.support_retention_candidates(timestamptz)
  from public, anon, authenticated;
grant execute on function public.support_retention_candidates(timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. PII-free in-app notification fan-out
-- ---------------------------------------------------------------------------

create or replace function public._support_notify(
  p_user_id uuid,
  p_ticket_id uuid,
  p_support_event text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_user_id is null or p_ticket_id is null then
    return;
  end if;

  perform public._notify(
    p_user_id,
    'support_' || p_support_event,
    jsonb_build_object(
      'ticket_id', p_ticket_id,
      'route', '/admin/support?ticket=' || p_ticket_id::text,
      'support_event', p_support_event
    )
  );
end
$$;

revoke all on function public._support_notify(uuid, uuid, text)
  from public, anon, authenticated;

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

drop trigger if exists trg_support_ticket_notifications
  on public.support_ticket_events;
create trigger trg_support_ticket_notifications
  after insert on public.support_ticket_events
  for each row execute function public._support_notify_after_event();

revoke all on function public._support_notify_after_event()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. RPC execution boundaries
-- ---------------------------------------------------------------------------

revoke all on function public.support_ticket_claim(uuid)
  from public, anon, authenticated;
revoke all on function public.support_ticket_transfer(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.support_ticket_return_to_pool(uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.support_ticket_escalate(uuid, text)
  from public, anon, authenticated;
revoke all on function public.support_ticket_mark_waiting(uuid, text)
  from public, anon, authenticated;
revoke all on function public.support_ticket_resolve(uuid, text)
  from public, anon, authenticated;
revoke all on function public.support_ticket_close(uuid, text)
  from public, anon, authenticated;
revoke all on function public.support_ticket_reopen(uuid)
  from public, anon, authenticated;
revoke all on function public.support_ticket_lookup_customer(uuid, text)
  from public, anon, authenticated;
revoke all on function public.support_settings_update(
  boolean,
  boolean,
  text,
  integer,
  integer
) from public, anon, authenticated;

grant execute on function public.support_ticket_claim(uuid)
  to authenticated;
grant execute on function public.support_ticket_transfer(uuid, uuid, text)
  to authenticated;
grant execute on function public.support_ticket_return_to_pool(uuid, text, boolean)
  to authenticated;
grant execute on function public.support_ticket_escalate(uuid, text)
  to authenticated;
grant execute on function public.support_ticket_mark_waiting(uuid, text)
  to authenticated;
grant execute on function public.support_ticket_resolve(uuid, text)
  to authenticated;
grant execute on function public.support_ticket_close(uuid, text)
  to authenticated;
grant execute on function public.support_ticket_reopen(uuid)
  to authenticated;
grant execute on function public.support_ticket_lookup_customer(uuid, text)
  to authenticated;
grant execute on function public.support_settings_update(
  boolean,
  boolean,
  text,
  integer,
  integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Realtime publication (idempotent and limited to non-secret tables)
-- ---------------------------------------------------------------------------

do $realtime_tickets$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_tickets'
  ) then
    alter publication supabase_realtime add table public.support_tickets;
  end if;
end
$realtime_tickets$;

do $realtime_messages$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_ticket_messages'
  ) then
    alter publication supabase_realtime add table public.support_ticket_messages;
  end if;
end
$realtime_messages$;

do $realtime_events$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_ticket_events'
  ) then
    alter publication supabase_realtime add table public.support_ticket_events;
  end if;
end
$realtime_events$;

commit;
