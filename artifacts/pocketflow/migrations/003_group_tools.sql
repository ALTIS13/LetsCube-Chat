-- Polls and checklists, which this platform has no API for.
--
-- Gap G-3: there is no `sendPoll` and no `poll` / `poll_answer` update, and
-- there is no checklist either. The brief anticipates exactly this and says to
-- fall back to a message plus inline buttons (§10), so a poll here is an
-- ordinary message whose text is regenerated and edited in place as people
-- vote — which is what a poll looks like on every platform anyway, minus the
-- server doing the counting.
--
-- One table for both, because a checklist is a poll whose options are things to
-- do and whose votes are «done». Keeping them apart would duplicate the whole
-- vote path to gain one boolean.

create table if not exists pf_polls (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  chat_id text not null,
  -- The message the poll lives in, so a vote can edit it rather than send
  -- another one. Null only between creating the row and sending the message.
  message_id text,
  -- poll | task
  kind text not null,
  question text not null,
  -- The options, in order, as an array of strings.
  options jsonb not null,
  -- A poll lets one person pick one option; a checklist does not.
  multiple boolean not null default false,
  closed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists pf_polls_chat_idx on pf_polls (chat_id, created_at desc);

create table if not exists pf_poll_votes (
  poll_id uuid not null references pf_polls (id) on delete cascade,
  option_index integer not null,
  user_id text not null,
  -- Kept so a checklist can say who ticked an item, which is the whole point
  -- of a shared one. A poll never shows it.
  display_name text,
  voted_at timestamptz not null default now(),
  primary key (poll_id, option_index, user_id)
);

create index if not exists pf_poll_votes_poll_idx on pf_poll_votes (poll_id);
