-- PocketFlow's own schema.
--
-- This is a third-party application's database, not the messenger's. Nothing
-- here references a LETSCUBE table, and nothing here may be joined to one:
-- §21 of the brief exists precisely so that this bot proves an outside
-- developer could write it, and a foreign key into the platform's schema would
-- quietly make that false.
--
-- Every identifier that came from the platform is stored as `text`. They are
-- UUIDs on LETSCUBE and 64-bit integers on Telegram, and §19 asks that ids
-- larger than a signed 32-bit integer be safe — text is the only column type
-- that is correct for both and cannot silently truncate either.
--
-- Applied by `pnpm --filter @workspace/pocketflow run migrate`, which runs the
-- files in this directory in name order inside one transaction each and
-- records them in `pf_migrations`.

create table if not exists pf_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Who we are talking to
-- ---------------------------------------------------------------------------

create table if not exists pf_users (
  user_id text primary key,
  display_name text,
  username text,
  -- An IANA zone. Reminders are useless without one, and guessing is worse
  -- than asking, so this starts as the configured default and is changed by
  -- the person in Настройки.
  time_zone text not null,
  developer_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Idempotent update processing (§19)
-- ---------------------------------------------------------------------------

-- An update that has been handled. The platform may redeliver after a webhook
-- timeout, and a long poll that dies between the fetch and the acknowledgement
-- re-offers the same update_id, so «handle it twice» is the normal case and
-- not an exceptional one.
create table if not exists pf_processed_updates (
  update_id bigint primary key,
  kind text not null,
  processed_at timestamptz not null default now()
);

create index if not exists pf_processed_updates_age_idx
  on pf_processed_updates (processed_at);

-- ---------------------------------------------------------------------------
-- Smart inbox (§3)
-- ---------------------------------------------------------------------------

create table if not exists pf_saved_items (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  chat_id text not null,
  -- text | url | json | photo | document | voice | location
  kind text not null,
  content text not null,
  tags text[] not null default '{}',
  source_message_id text,
  file_id text,
  created_at timestamptz not null default now()
);

create index if not exists pf_saved_items_owner_idx
  on pf_saved_items (owner_id, created_at desc);

-- Search is «find the thing I saved», so a trigram-free prefix/substring match
-- on a lowercased copy is enough and needs no extension. The column is
-- generated so it cannot drift from `content`.
create index if not exists pf_saved_items_search_idx
  on pf_saved_items (owner_id, lower(content) text_pattern_ops);

-- ---------------------------------------------------------------------------
-- Reminders (§4)
-- ---------------------------------------------------------------------------

create table if not exists pf_reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  chat_id text not null,
  body text not null,
  due_at timestamptz not null,
  -- pending | fired | done | cancelled
  state text not null default 'pending',
  snooze_count integer not null default 0,
  -- The message the reminder was fired into, so «Выполнено» can edit it in
  -- place rather than adding another line to the conversation (§2).
  fired_message_id text,
  created_at timestamptz not null default now(),
  fired_at timestamptz,
  completed_at timestamptz,
  -- Claimed by one scheduler tick, so two processes cannot fire the same
  -- reminder twice. Null when nobody holds it.
  claimed_at timestamptz,
  claim_token uuid
);

-- The scheduler's only query: what is due and unclaimed.
create index if not exists pf_reminders_due_idx
  on pf_reminders (due_at)
  where state = 'pending';

create index if not exists pf_reminders_owner_idx
  on pf_reminders (owner_id, due_at);

-- ---------------------------------------------------------------------------
-- Webhook inbox (§5)
-- ---------------------------------------------------------------------------

create table if not exists pf_webhooks (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  chat_id text not null,
  display_name text not null,
  -- Only the hash is kept. The secret is shown once, at creation and at
  -- rotation, and cannot be read back afterwards — which is the only version
  -- of «храним безопасно» that survives a database being read.
  secret_hash text not null,
  enabled boolean not null default true,
  event_count bigint not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists pf_webhooks_owner_idx
  on pf_webhooks (owner_id, created_at desc);

-- Idempotency-Key / event id deduplication for incoming external events.
create table if not exists pf_webhook_events (
  webhook_id uuid not null references pf_webhooks (id) on delete cascade,
  event_key text not null,
  received_at timestamptz not null default now(),
  primary key (webhook_id, event_key)
);

create index if not exists pf_webhook_events_age_idx
  on pf_webhook_events (received_at);

-- ---------------------------------------------------------------------------
-- Watcher (§6)
-- ---------------------------------------------------------------------------

create table if not exists pf_watchers (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  chat_id text not null,
  -- availability | http_status | content_change | feed
  kind text not null,
  url text not null,
  interval_seconds integer not null default 300,
  enabled boolean not null default true,
  -- What the last successful check saw: a status code, and a hash of the body
  -- for content_change. Null until the first check, which is why the first
  -- check never notifies: there is nothing to have changed from.
  last_status integer,
  last_content_hash text,
  last_checked_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  next_check_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claim_token uuid
);

create index if not exists pf_watchers_due_idx
  on pf_watchers (next_check_at)
  where enabled;

create index if not exists pf_watchers_owner_idx
  on pf_watchers (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Multi-step conversation state
-- ---------------------------------------------------------------------------

-- What this chat is in the middle of: «пришлите дату», «введите имя webhook».
-- One row per (chat, user) and it expires, because a flow somebody abandoned
-- must not silently eat their next unrelated message.
create table if not exists pf_pending_prompts (
  chat_id text not null,
  user_id text not null,
  kind text not null,
  context jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Selftest (§15)
-- ---------------------------------------------------------------------------

-- A run is kept so two runs can be compared after a platform change, which is
-- the whole reason the brief asks for it to be stored rather than printed.
create table if not exists pf_selftest_runs (
  id uuid primary key default gen_random_uuid(),
  requested_by text not null,
  chat_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  report jsonb not null default '{}'::jsonb
);

create index if not exists pf_selftest_runs_recent_idx
  on pf_selftest_runs (requested_by, started_at desc);
