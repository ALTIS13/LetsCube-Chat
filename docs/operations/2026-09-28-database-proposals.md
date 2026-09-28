# Database changes waiting on the owner — 2026-09-28

Everything the tester's reports of 2026-09-27/28 asked for that the client
could do alone is built and deployed. What is left needs the database, and
CLAUDE.md §10 puts a production change behind the owner's word, a verified
backup, a rehearsal, one transaction with a self-check that raises, and a
byte-identical copy in `.migration-backup/`. Nothing below has been applied.
Each entry says what it unblocks, the smallest change that does it, and the
risk that decides whether it is worth it.

Ordered by what it buys for the least risk.

## 1. Hides heard live — a return to a conversation without waiting

**Unblocks:** tracker item 58's last round trip. Coming back to a conversation
now waits for one read (the hidden ids); before 2026-09-28 it waited for two.
The read exists because a message hidden «for me» on another device cannot be
heard: `public.message_hidden_for_users` is not in the `supabase_realtime`
publication (read-only on production, 2026-09-28).

**Change** — one statement:

```sql
begin;
alter publication supabase_realtime add table public.message_hidden_for_users;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'message_hidden_for_users'
  ) then
    raise exception 'message_hidden_for_users is not in supabase_realtime';
  end if;
end $$;
commit;
-- rollback: alter publication supabase_realtime drop table public.message_hidden_for_users;
```

**Risk:** low. The table's SELECT policy is already
`user_id = (select auth.uid())`, and Realtime delivers rows through RLS, so each
client hears only its own hides. REPLICA IDENTITY is default, so a DELETE
(an «unhide») carries the key only, which is all a client needs. The client
change after it: subscribe `user_id=eq.<me>` on the list's socket, keep the
hidden ids current, and draw a held conversation at once.

## 2. A task's start date (item 68)

**Unblocks:** «не хватает возможности выбрать промежуток… есть задачи которые
идут месяц» — a task that runs from a date to a date.

**Change:** `alter table public.tasks add column starts_at timestamptz;` with a
check `starts_at is null or due_at is null or starts_at <= due_at`, and the new
parameter in `task_create_v3` / `task_update_v3` (both `security definer`, so
their bodies are re-issued whole).

**Risk:** low for the column; the two RPC bodies are long and are where a
mistake would be, so the rehearsal replays every existing call shape against a
copy.

## 3. A checklist inside a task (item 62)

**Change:** `public.task_checklist_items (id uuid, task_id uuid references
tasks on delete cascade, text text check (length between 1 and 500), done
boolean default false, position int, created_by uuid, created_at, updated_at)`,
RLS that reuses `_task_visible_to_current_user_v3` for reading and the task's
own edit rule for writing, and the table in the realtime publication.

**Risk:** medium — the RLS has to be exactly the task's, or a checklist leaks a
private task's contents. The rehearsal checks it against every visibility
combination the task function knows.

## 4. Reminders on a task (item 66)

**Change:** `public.task_reminders (id, task_id, remind_at, created_by,
delivered_at)`, the same RLS as item 3, and a delivery path: the worker already
writes notifications, so a minute's poll for `remind_at <= now() and
delivered_at is null` that inserts the notification and stamps the row.

**Risk:** medium — the scheduler is new moving code on the server, and a stuck
poll is a silent failure; it needs its own health line in the worker's status.

## 5. Unread per channel (item 54, the unread half)

**Unblocks:** a channel in a server's list saying how much is unread in it.
Today the read marker is per chat (`chat_members.last_read_at`), so opening one
channel marks every other read.

**Change:** `public.chat_topic_reads (chat_id, topic_id, user_id, last_read_at,
primary key (chat_id, topic_id, user_id))`, `mark_topic_read(chat_id,
topic_id, at)`, and `channel_unread_counts(chat_id)` returning a count per text
channel for the caller, both `security definer` with the membership check.

**Risk:** medium-high. The chat-level marker drives the list's unread count,
push, read receipts and the entry position (CLAUDE.md §11); the per-channel one
must sit beside it without changing any of them. Worth a design pass of its own
before SQL.

## 6. Several people on one task (item 67)

**Change:** `public.task_assignees (task_id, user_id, primary key)` beside
`tasks.assignee_id`, and every function that reads `assignee_id` —
visibility, claim, the list's filters, notifications — taught the set.

**Risk:** high — `assignee_id` is read in more than a dozen functions and
policies. This one is a project, not a migration.

## 7. Smaller, recorded for completeness

- **Badge dates (item 38):** `profile_badges` returns no grant date, so «с
  такого числа» cannot be printed. Add the grant's `created_at` to its result.
- **Kind folders (item 69, decided against for now):** Telegram's are folders
  with chat-type rules; ours would need `folders.include_types text[]`. Only if
  the capsule in «Все» turns out not to be enough.
- **D-103:** «удалить у всех» leaves the content in the row, the media in
  storage and the preview in `notifications`. Clearing them is a data-loss
  decision about other people's messages, and the owner's.
