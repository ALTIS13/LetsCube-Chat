# Database changes approved on 2026-09-28: the rollout record

The owner approved every entry of
[`2026-09-28-database-proposals.md`](2026-09-28-database-proposals.md) on
2026-09-28 («все пункты принимаю»). CLAUDE.md §10 still governs each one: a
fresh verified backup, a rollback-only rehearsal with a smoke that raises, one
apply, a post-apply smoke, and byte-identical copies in
`.migration-backup/supabase/migrations/`. This file records each change as it
lands, in the order they were applied — which is not the proposals' order, for
the reason given under «Order».

## Order

The proposals were ordered by what each buys for the least risk. Two things
moved that. The first entry, hides heard live, was written as «add the table to
`supabase_realtime`», and that is unsafe: Realtime sends a **DELETE to every
subscriber whose filter matches, without asking RLS** —
`realtime.apply_rls` in the running v2.102.3 reads
`if not is_rls_enabled or action = 'DELETE' then visible_role_sub_ids = … || subscription_id`
— so any signed-in client could subscribe to the table and learn, from every
«unhide» (`unhide_message_for_me`) and every cascade, which account had hidden
which message. It is being rebuilt on a private broadcast channel per account
instead, and goes later. The task entries go first because they are what the
testers asked for most.

## 1. A task's period — tracker item 68

- **Migration** `supabase/migrations/20260928170000_task_period.sql`
  (SHA-256 `006A09F5252B8430694A1666E3CE509CFEC0130731E04BD9AEC0042AB6109972`),
  rollback `…_task_period.rollback.sql`
  (`2AF0BD9B4085E8F8163F2407FC07677F5DD09E9CAC019B35E50E7E9285291DC5`); both
  copied byte-identical into `.migration-backup/`.
- **What it does:** `tasks.starts_at timestamptz`, the check
  `tasks_period_order` (start not after the deadline), and `task_create_v4` /
  `task_update_v4`, which call v3 unchanged and add only the start. v3 is
  untouched, so the installed Android bundle keeps working and never sets one.
  `task_update_v4` sets the old start aside before v3 writes the new deadline,
  so a period moved earlier than its own old start is not refused by the check.
  Granted as v3 is: `authenticated` and `service_role`, not `anon`.
- **Backup:** `/srv/letscube/backups/automated/20260928-221436`, `SHA256SUMS`
  verified, `pg_restore --list` reads 155 table-data entries including
  `public.tasks` and `task_update_v3`.
- **Rehearsal:** the migration without its commit, then as a staff account: a
  period created and read back; moved earlier than its old start; cleared; a
  start after the deadline refused as `task_starts_after_due`; v3 creating a
  task with no start — then `ROLLBACK`. Passed.
- **Applied** as `postgres`; the column, the check and both functions read back
  with the grants above; 58 tasks, none with a start.
- **Post-apply smoke:** the same checks in a rolled-back transaction, passed;
  still 58 tasks.
- **Client:** `lib/taskPeriod.ts`, the form's «Начало» beside «Срок», the
  period on the card, the row and the detail, and «Начнётся через …» for a
  period not begun. Evidence: `task-period.test.mts`, `task-period.spec` at
  1440 and 390.

## 2. A checklist inside a task — tracker item 62

- **Migration** `supabase/migrations/20260928180000_task_checklist.sql`
  (SHA-256 `DC0D420133EBF42882728230E00709CDFBC278C4D5478CFD85721BD8A0C8E0DB`),
  rollback `…_task_checklist.rollback.sql`
  (`9E26340DFE18AE58B4E857D3C64248BA369FDA06E9382571999C5FA670B5C199`); both
  copied byte-identical into `.migration-backup/`.
- **What it does:** `public.task_checklist_items` (text 1–500 characters,
  trimmed; `done` consistent with `done_at` and `done_by`; a position), read by
  exactly who reads the task — the policy is `task_events select scoped`'s,
  written out — and written by nobody directly: `task_checklist_add`,
  `…_rename`, `…_set_done` and `…_remove`, each through
  `_task_checklist_assert_can_change`, which asks `task_update_v3`'s rule (the
  creator, staff, or an administrator of the task's location) and lets the
  assignee tick too; nothing changes on a confirmed, cancelled or deleted task.
  At most 100 points. The table is in `supabase_realtime` with REPLICA IDENTITY
  FULL, as `tasks` and `task_events` are. Unlike the hides of entry 1, a DELETE
  here reaching a subscriber RLS was not asked about carries a random item id
  and, under a `task_id` filter, the fact that a task lost a point — the same
  property `tasks` and `task_events` already have, and nothing of the text.
- **Backup:** `/srv/letscube/backups/automated/20260928-222615`, `SHA256SUMS`
  verified, `pg_restore --list` has `public.tasks` and `task_create_v4`.
- **Rehearsal** (rolled back), as a staff account and as an ordinary one the
  task is assigned to: three points added — trimmed, positions 1, 2, 3 — one
  renamed, one removed, an empty one refused as `checklist_text_invalid`; the
  assignee reads them, ticks one (with `done_by`), is refused `forbidden` on
  adding and removing, and unticking clears `done_at` and `done_by`; the task
  cancelled, a tick refused as `task_locked`; a direct INSERT refused
  `insufficient_privilege`. Passed.
- **Applied** as `postgres`; post-apply smoke the same, rolled back, passed;
  no rows, 58 tasks, the table published.
- **Client:** `lib/taskChecklist.ts`, `pages/tasks/TaskChecklist.tsx` under
  the description in the task's detail — add, tick (drawn before its answer,
  taken back on a refusal), rename by pressing the text, remove — and «1/2» on
  the card; the detail and the list hear the table live. Evidence:
  `task-checklist.test.mts`, `task-checklist.spec` at 1440 and 390 (a mutant
  without the assignee's tick turns the assignee's check red).

## 3. Reminders on a task — tracker item 66

- **Migration** `supabase/migrations/20260928190000_task_reminders.sql`,
  rollback `…_task_reminders.rollback.sql`
  (`D01DD4A2BF6FB20407310D2A6B5A8E97A760937B040F920B25579E6CE89746C0`); both
  copied into `.migration-backup/`. The migration ran as
  `DF9711C9E386E2475ADF1E73EEB62FBE25A3785EE815291E37EA845DBDF5FB7B`; after the
  apply, one sentence of its header comment was removed — it named Bitrix24 as
  the tracker these testers come from, which nobody established — so both
  copies now read
  `DDE68D454984A1BB248024D3521306C2C4A5664F0C131038D6F2D96FDACAD85F`. Every
  statement is the one that ran; that was checked line by line against the
  rehearsal's text with comment lines set aside.
- **What it does:** `public.task_reminders` — a moment, an optional note of up
  to 200 characters, and a recipient: `author` («Мне») or `assignee`
  («Исполнителю»), which is whoever holds the task when the reminder fires, so
  a reassigned task's reminders follow the work. `task_reminder_add` asks
  `_task_reminder_may_hold`: the creator, the assignee, staff, or an
  administrator of the task's location; nothing is set on a confirmed,
  cancelled or deleted task, in the past, or more than two years out, and each
  author holds at most 20 waiting ones per task. `task_reminder_remove` is the
  author's alone, and to anyone else the reminder does not exist.
  `task_reminders_deliver_due` runs every minute as the pg_cron job
  `letscube-task-reminders`, owned by `postgres` as the other `letscube-` jobs
  are: it writes a `task_reminder` notification through `_notify`, so the push
  trigger, the push preferences (`task_push_enabled`) and the notification
  centre take it as they take every task notification, and stamps the row
  `sent` in the same transaction. A reminder on a task closed or deleted
  meanwhile, or whose recipient may no longer hold it, is marked `skipped`; one
  whose notification cannot be written is marked `failed`, so one bad row
  cannot hold the rest back minute after minute. `_notification_push_payload`
  gained one branch: a reminder's push reads «Напоминание» / ««Задача» —
  заметка» and opens `/tasks?task=<id>`. The migration compared the function's
  output for eleven existing kinds before and after, and raised if any
  differed; its restored text in the rollback is byte-identical to production's
  `prosrc` before the change.
- **Two departures from the proposal**, both deliberate. The proposal gave a
  reminder the checklist's reading rule, every reader of the task; it is read
  instead by its author, and by the assignee when addressed to them, because a
  reminder is a personal nudge and its note is not task content. The proposal
  put the delivery in the worker; it is a pg_cron job in the database instead,
  because the notification and the stamp are then one transaction, no service
  credential is added anywhere, and the database already runs its minute jobs
  this way. The table is **not** in `supabase_realtime`: the detail re-reads it
  after the reader's own change, and a DELETE event, which Realtime sends
  without asking RLS (see «Order»), would have told other subscribers that a
  reminder existed.
- **Health.** The proposal asked for a line in the worker's status; the job's
  own record is that line:
  `select status, return_message, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'letscube-task-reminders') order by start_time desc limit 5;`
  and a stuck delivery shows as
  `select count(*) from public.task_reminders where status = 'pending' and remind_at < now() - interval '5 minutes';`
  which must be 0. The first run, 2026-09-28 19:52:00Z, `succeeded`, 10 ms.
- **Backup:** `/srv/letscube/backups/automated/20260928-225040`, `SHA256SUMS`
  15 of 15, `pg_restore --list` reads 156 table-data entries including
  `public.tasks`, `public.task_checklist_items`, `public.notifications` and
  `_notification_push_payload`.
- **Rehearsal** (rolled back), as a staff account and as an ordinary one the
  task is assigned to: a reminder for the assignee with a trimmed note and one
  for the author with a blank note stored as none; refusals
  `reminder_in_past`, `reminder_too_far`, `reminder_recipient_invalid`,
  `reminder_note_invalid`, `reminder_no_assignee`; the assignee reads only the
  one addressed to them, is refused `reminder_not_found` removing it, sets their
  own, and is refused `forbidden` on a task they do not hold; the author does
  not read the assignee's own; a direct INSERT refused `insufficient_privilege`.
  The job, run as pg_cron runs it, sent exactly two — the assignee's
  notification carrying the note, the task and its title; the author's own
  reaching them; both stamped with who got them — and a second run sent
  nothing. The task cancelled: a new reminder refused `task_locked`, and the
  assignee's own on it `skipped` with no notification. Production was read
  afterwards: no table, no job, the push function unchanged, no rehearsal task.
- **Applied** as `postgres`; post-apply smoke the same, rolled back, passed;
  the table empty, 58 tasks, no `task_reminder` notification, the job active.
- **Client:** `lib/taskReminders.ts`, `pages/tasks/TaskReminders.tsx` under
  the checklist in the task's detail — the list soonest first with the
  delivered after it, «Напомнить» with a moment (tomorrow at 09:00 to start
  from), «Исполнителю — имя» or «Мне» when the task is somebody else's, and a
  note — and the bell's «Напоминание» that opens the task. Evidence:
  `task-reminders.test.mts`, `task-reminders.spec` at 1440 and 390, each of
  three mutants (the bell's case, the author-only removal, the assignee as the
  first suggestion) turning its own check red.
