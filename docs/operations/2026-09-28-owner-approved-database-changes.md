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
