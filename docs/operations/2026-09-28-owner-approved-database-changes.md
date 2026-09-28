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
