-- 20260508_messages_client_message_id.sql
--
-- Goal:
--   Add an idempotency key for message sends so the frontend can safely retry
--   requests whose network response was lost after the database insert
--   succeeded. This prevents duplicate messages without trusting client clocks.
--
-- Manual apply:
--   Apply this file in Supabase SQL Editor after review. Do not run it through
--   MCP and do not disable RLS.
--
-- Frontend follow-up after apply:
--   1. Generate one crypto.randomUUID() client_message_id per composed send.
--   2. Include client_message_id on text/media/voice/location/forward inserts.
--   3. Do not send created_at from the client; use the returned DB created_at.
--   4. If INSERT returns a unique-violation or the request result is unknown,
--      fetch the existing row by (chat_id, user_id, client_message_id), then
--      replace the pending bubble with that server row.
--   5. Retry a failed/unknown send with the same client_message_id.

begin;

alter table public.messages
  add column if not exists client_message_id uuid,
  add column if not exists client_sent_at timestamptz;

create unique index if not exists messages_client_message_id_unique_idx
  on public.messages (chat_id, user_id, client_message_id)
  where client_message_id is not null;

create index if not exists messages_client_message_lookup_idx
  on public.messages (user_id, client_message_id)
  where client_message_id is not null;

comment on column public.messages.client_message_id is
  'Client-generated idempotency key for one logical send attempt. Retries must reuse the same value.';

comment on column public.messages.client_sent_at is
  'Optional client-side pending timestamp for diagnostics only. Persisted ordering must use messages.created_at.';

commit;

-- Verify SQL after manual apply:
--
-- 1. Columns:
-- select column_name, data_type, udt_name, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'messages'
--   and column_name in ('created_at', 'client_message_id', 'client_sent_at')
-- order by column_name;
--
-- Expected:
--   - created_at remains timestamptz not null default now().
--   - client_message_id exists as uuid nullable.
--   - client_sent_at exists as timestamptz nullable.
--
-- 2. Indexes:
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename = 'messages'
--   and indexname in (
--     'messages_client_message_id_unique_idx',
--     'messages_client_message_lookup_idx'
--   )
-- order by indexname;
--
-- Expected:
--   - unique partial index on (chat_id, user_id, client_message_id)
--     where client_message_id is not null.
--   - lookup partial index on (user_id, client_message_id).
--
-- 3. RLS sanity:
-- select policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'messages'
-- order by policyname;
--
-- Expected:
--   - existing INSERT policy still requires auth.uid() = user_id and chat membership.
--   - existing SELECT policy still restricts rows to chat members.
--
-- Manual QA after frontend alignment:
--   1. Send a text message and confirm the persisted created_at is DB-returned.
--   2. Simulate a lost response, retry with the same client_message_id, and
--      confirm only one row exists.
--   3. Repeat for reply/topic/media/voice/location sends.
