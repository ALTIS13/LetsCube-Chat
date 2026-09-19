-- What a button refers to.
--
-- This table exists because of a real limit rather than a preference. When
-- somebody presses «Сохранить», the callback update carries the id of the
-- **bot's own message** — the one the buttons are on — and nothing about the
-- message the person originally sent. There is no `getMessage` in the Bot API,
-- so the original text cannot be read back at press time.
--
-- The alternative would be to carry the content in `callback_data`, which is
-- capped at 128 bytes and, more importantly, arrives from a client: §19 of the
-- brief says callback data is never proof of anything. So the content is
-- stashed here when the offer is made, the button carries only this row's id,
-- and the handler re-reads it scoped to the presser.
--
-- Rows expire. An offer nobody acted on is not worth keeping, and a table that
-- grows with every message anybody ever sends the bot is a slow outage.

create table if not exists pf_inbox_candidates (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  chat_id text not null,
  source_message_id text not null,
  kind text not null,
  content text not null,
  file_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists pf_inbox_candidates_expiry_idx
  on pf_inbox_candidates (expires_at);

create index if not exists pf_inbox_candidates_owner_idx
  on pf_inbox_candidates (owner_id, created_at desc);
