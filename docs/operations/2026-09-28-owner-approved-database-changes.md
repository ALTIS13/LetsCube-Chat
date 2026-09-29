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

## 4. A badge says since when — tracker item 38

- **Migration** `supabase/migrations/20260928200000_profile_badges_since.sql`
  (`5DBC8C56123E7FF5909D650E52C59626FD7076F8F5E193E6D61A4365A106A7D4`),
  rollback `…_profile_badges_since.rollback.sql`
  (`FAB9E3B1FE258501EC7DD20ACFF82034925A3625519D988E7F86CC53C6B0CE32`); both
  copied byte-identical into `.migration-backup/`.
- **What it does:** `profile_badges` gains one column, `since` — the grant's own
  date, `user_global_roles.assigned_at` for a standing and
  `user_achievements.granted_at` for a medal, both `not null` already. The
  proposal said `created_at`; neither table has one, and these are the columns
  that hold the date. A result's columns cannot change under CREATE OR REPLACE,
  so the function was dropped and created in one transaction, **as
  `supabase_admin`**, its owner, which `postgres` cannot drop. Measured before
  writing it: nothing depends on the function (`pg_depend`) and no other
  function names it. Its comment and its grants are restored as they were —
  EXECUTE for `authenticated` alone, the ACL read back
  `{supabase_admin=X/supabase_admin,authenticated=X/supabase_admin}`. The new
  body differs from production's `prosrc` by exactly the two `since` lines, and
  the rollback's body is production's `prosrc` byte for byte.
- **Self-check:** before the drop, the migration read the function as a signed-in
  reader for every badge holder (up to 200) and kept the answer; after the
  create, it compared every other column with `except all` both ways, required
  `since` on every row, and required the owner, the ACL, `stable`, `security
  definer` and the comment. Any difference raised.
- **Backup:** `/srv/letscube/backups/automated/20260928-230920`, `SHA256SUMS`
  15 of 15, `pg_restore --list` reads 157 table-data entries including
  `user_global_roles`, `user_achievements` and the function itself.
- **Rehearsal** (rolled back) and **post-apply smoke** (rolled back): through
  the `authenticated` role, 39 badges came back, every one dated and none in
  the future, and `anon` was refused `insufficient_privilege`. Production read
  afterwards: the old result type until the apply, the new one after it.
- **Client:** `badgeSinceLine` in `lib/profileBadges.ts` — a standing reads
  «с 10.05.26», a medal, which is an event rather than a state, «получено
  03.09.26»: the short numeric date the tracker records from Discord's card
  («Подписчик с 12.05.26»). The badge card prints it under the badge's own
  sentence, and a badge whose only line is its date is a card too. A database
  older than the column answers without it, which reads as no line. Evidence:
  `profile-badges.test.mts`, `profile-badges.spec` at 1440 and 390, with the
  mutant that drops the date from the card's condition going red.

## 5. A message deleted for everyone keeps nothing — D-103

- **Migration** `supabase/migrations/20260928210000_deleted_message_keeps_nothing.sql`
  (`E1CDE49E3EE4DC9478A445269FF81CCCE5BFD3D2A875DF55842A251CB771A90D`),
  rollback `…_deleted_message_keeps_nothing.rollback.sql`
  (`467FF24A0699FCFF2A5A1E1E216BA223F118C7762A732B8F8CF2878F7B5830B2`); both
  copied byte-identical into `.migration-backup/`, and the rehearsal beside
  them in `.migration-backup/supabase/rehearsal/`.
- **The decision.** The proposal named this the owner's to take, because it
  loses other people's messages and cannot be undone; he approved it with the
  rest. What was measured before writing it, read-only: 297 messages deleted
  for everyone, 295 of them still holding their text and 34 their file;
  151 notifications still carrying a deleted message's words; the `media`
  bucket **public**, so a deleted file stayed downloadable by anyone holding
  its URL; no function and no screen that undoes a deletion.
- **What it does:**
  - `private.deleted_message_keeps_nothing`, a BEFORE UPDATE trigger on
    `messages` named `trg_zz_…` so it runs after every other BEFORE trigger,
    clears content, media references, media metadata, a bot's keyboard and
    placeholder, and unpins, for every path that sets `deleted_at`. It makes
    the deletion final: nothing written into a deleted row afterwards stays,
    and `deleted_at` cannot return to null. Because the statement that fires
    it names only `deleted_at`, the column-scoped triggers on content and media
    do not fire: no «edited» stamp, no bot `edited_message`, no variant job.
  - What the row pointed at is queued in `private.message_media_purge` first:
    the file and the preview named after it, in both spellings the media check
    allows, so a preview written after the deletion is still found. Rows kept
    only a public URL are parsed for their path.
  - `public.message_media_purge_claim` / `_finish`, EXECUTE for `service_role`
    only, feed the worker. The claim moves a deleted message's variant rows
    into the queue, and keeps — never hands out — a file some live message
    still shows: its own file, its preview, a preview named after its file, or
    one of its variants. A forward shares its source's file and a reused 720p
    rendition is the source itself, which is why this check exists.
    `mediaPurgeWorker` removes what it is handed through the Storage API,
    once a minute, one request per bucket, and logs counts only. A refusal is
    backed off and given up after eight tries.
  - `private.scrub_deleted_message_notifications`, from an AFTER trigger on
    the transition: unsent pushes are deleted from both outboxes, sent ones keep
    no copy of the words, and the notification's `preview` becomes null with
    `deleted` true. The bell reads «Сообщение удалено».
  - A message under an open report (`new`, `reviewing`) keeps what it said;
    `trg_content_report_closed_finishes_deletion` finishes the deletion when
    the report is `actioned` or `dismissed`.
  - The 297 earlier deletions were cleared through the same trigger by setting
    `deleted_at` to itself, and their notifications scrubbed.
  - `notifications_message_id_idx` finds a message's notifications.
- **Not touched, on purpose:** `forward_origin_name` (a guard keeps it
  permanent, and it is a name the chat already saw) and reactions. A push
  already on a device is out of the server's reach.
- **Backup:** `/srv/letscube/backups/automated/20260928-232837`, `SHA256SUMS`
  15 of 15, `pg_restore --list` 157 table-data entries; because this change
  destroys data, the dump was also read back: `pg_restore --data-only --table
  messages` yields 3,905 rows, the table's count at that moment. The cleared
  words survive there until the 14-day prune.
- **Rehearsal** (rolled back) on production, in a group made for it with two
  real accounts: words, a photo with a preview, the same photo in a second
  message, a message the admin reports, and one the older client deletes by a
  direct UPDATE. Deleted for everyone: the words and the photo gone from their
  rows, three paths queued for the photo, the admin's notification scrubbed
  with no push left waiting; the direct UPDATE cleared the same way; the
  reported message kept its words. The author's attempt to undelete and
  rewrite came back deleted and empty. Dismissing the report finished that
  deletion. As `service_role`, the claim handed out nothing of the shared
  photo and marked its three paths kept; deleting the second message released
  them, and finishing one as done and one with an error left them `done` and
  backed off. `authenticated` was refused the claim. Production read
  afterwards: no queue, no trigger, the same counts.
- **Applied** as `postgres`: `UPDATE 297`, the self-check passed (no deleted
  message outside an open report carries anything; no notification of one
  carries words; triggers enabled; grants as above). Post-apply smoke the same
  as the rehearsal, rolled back, passed. After: 297 deleted, 0 with content,
  0 with media; 132 paths pending for the worker; 151 notifications marked
  deleted.
- **Rollback** removes the mechanism only; what was cleared stays cleared.
- **Worker switch:** `MEDIA_PURGE_WORKER_ENABLED=0` stops it;
  `MEDIA_PURGE_WORKER_TICK_MS` sets its pace (60 s). Its queue:
  `select status, count(*) from private.message_media_purge group by 1;`.

## 6. Hides heard live — tracker item 58

- **Migration** `supabase/migrations/20260928220000_hides_heard_live.sql`
  (`0F8E1EC6626A7029E136BF483466A171827D138B16A29D90D015C8D9851EA5F1`),
  rollback `…_hides_heard_live.rollback.sql`
  (`E5BB43D85F0595A362DB664212328EA08F059D8169C249C2FD6D30798D9252F1`); both
  copied byte-identical into `.migration-backup/`. Applied as `supabase_admin`,
  because the policy is on `realtime.messages`, which `supabase_realtime_admin`
  owns; what `postgres` should own is created under `SET LOCAL ROLE postgres`.
- **Why not the proposal.** Publishing `message_hidden_for_users` would have
  let any signed-in client subscribe to another account's unhides: Realtime
  sends a DELETE to every subscriber whose filter matches without asking RLS
  («Order», above). So each account has a private broadcast topic,
  `hides:<its id>`.
- **What it does:** `private.broadcast_hide`, AFTER INSERT OR DELETE on the
  hides table, sends `{message_id, chat_id, hidden}` to the owner's topic
  through `realtime.send`, which never raises — a broadcast that fails does not
  undo a hide; a hide removed with its message sends nothing. The policy
  «hides: each account hears its own» lets `authenticated` read, and so join,
  only its own topic; there is no INSERT policy, so a client cannot send on it.
  `public.hides_live_ping` sends a ping on the caller's own topic.
- **Measured before writing it:** the database already replicates
  `realtime.messages` to Realtime — `supabase_realtime_messages_publication`
  over the daily partitions and an active `pgoutput` slot — and no broadcast
  had ever been sent (0 rows). `realtime.send` is SECURITY INVOKER, so the two
  functions that call it are SECURITY DEFINER as `postgres`, which may insert.
- **Backup:** `/srv/letscube/backups/automated/20260928-234643`, `SHA256SUMS`
  15 of 15, `pg_restore --list` 158 table-data entries including
  `message_hidden_for_users` and `realtime.messages`.
- **Rehearsal** (rolled back), in a group made for it with two real accounts:
  the member's hide broadcast on `hides:<member>` with the message, the chat
  and `hidden: true`; the ping arrived; Realtime's own join check — the account's
  role and claims with `realtime.topic` set to the topic — let the member read
  its topic and none of the admin's rows; the member's own INSERT on its topic
  refused `42501`; the unhide broadcast `hidden: false`; `anon` refused the ping.
  Production read afterwards: no policy, no trigger, no broadcast row. The
  post-apply smoke passed the same way.
- **Client:** `useChats` joins `hides:<id>` with `private: true` beside the
  account's own membership channel. The channel is trusted only once the ping
  sent after the join has come back through it (`lib/hiddenMessagesLive.ts`), so
  a channel that reports SUBSCRIBED while database broadcasts do not reach it
  never replaces a read. Any gap ends the trust: a status other than
  SUBSCRIBED, a revival or going offline. A heard hide takes the row out of the
  held copy of its chat, whether open or not; a heard unhide makes the chat read
  again. A return to a conversation skips the hidden-ids read only when every
  row it holds, and every row those reply to, was verified by a read begun while
  the channel was live, or arrived live after that. If the channel never becomes
  trusted, the product behaves exactly as before: it reads.
- **Evidence:** `hidden-messages-live.test.mts`; `conversation-return.spec`
  at 1440 and 390. With every hidden-ids read slowed to 1.5 s, the return draws
  in under a second. A hide heard in the open chat removes the line, and one
  heard while the chat was closed does not flash back. Two mutants go red: one
  that never skips (drawn after 1.9 s), and one that leaves the held copy alone.
  The second went green at first, because the open chat's own listener hid
  the line as well; the closed-chat case is what the held copy's removal is
  for, and it is now in the test. The fixture's count answer now honours the
  reader's read mark. Without it, every re-read of the list counted a whole chat
  as unread and a return took a path a real database never sends it down.

## 7. Unread per channel — tracker item 54, the unread half

- **Migration** `supabase/migrations/20260929090000_channel_reads.sql`
  (`10AA5AF2C7E025EDB0FD790ACEBAC082FFAABBE0E6575B9632310B4DB6F83C69`),
  rollback `…_channel_reads.rollback.sql`
  (`B481F739D720E91236AD36F3467354C90B8579A1588A48919E5DCA4D3FB37D1E`); both
  copied byte-identical into `.migration-backup/`.
- **The design pass the proposal asked for.** The chat's own mark,
  `chat_members.last_read_at`, drives the list's count, push, receipts and
  where a chat opens (CLAUDE.md §11), so it is left exactly as it is, and a
  second mark per channel sits beside it. That makes the chat's count and a
  channel's count different questions, as in Discord, where a server shows
  that something is unread and each channel shows its own. The channel key is
  `general` for the general conversation — a topic flagged general, or no
  topic, which is what a group without topics has — and the topic's id
  otherwise, so the general channel needs no `topics` row of its own. Measured:
  32 topics in 8 chats, 7 of them general rows; 38 of 3,905 messages carry a
  topic.
- **What it does:** `public.channel_reads (chat_id, channel, user_id,
  last_read_at)`, read only by its owner, written only by
  `mark_channel_read`: forward only, never past now, only by a member, only for
  a channel the chat has. `channel_unread_counts(chat)` answers the caller's
  count per channel: the general one and every topic not archived. It counts
  messages after the mark that are somebody else's, not deleted, not hidden for
  the caller, not from before they cleared the chat, and not a notice. That is
  the list's own rule, the one the chat-level count query asks. The seed gives
  every group member a mark per channel at their chat mark, or their joining,
  so nothing turned unread on the day: 26 general marks and 47 topic marks. A
  channel made later, or a member who joins later, counts from the later of
  their joining and the channel's making.
- **Backup:** `/srv/letscube/backups/automated/20260929-002747`, `SHA256SUMS`
  15 of 15, `pg_restore --list` 158 table-data entries including
  `chat_members`, `topics` and `messages`.
- **Rehearsal** (rolled back), in a server made for it with two real accounts
  who joined an hour before: general 2 and the channel 1. Hiding one message
  took general to 1. Reading general took it to 0, left the channel at 1 and
  left the chat's own mark where it was. A mark sent backwards was refused
  silently. Reading the channel took it to 0. Refused: `invalid_channel`,
  another chat's channel (`channel_not_found`), a chat the member is not in
  (`chat_member_required`). No counts came back for a chat the member is not
  in, and a direct INSERT was refused. The messages were written with a time
  in the past: a signed-in write is stamped with `clock_timestamp()`, which in
  one transaction is later than any mark `now()` can make, so the first try
  failed on the rehearsal's own clock, not on the rule. The post-apply smoke
  passed the same way.
- **Client:** `useChannelUnread` reads the counts when the list is shown and
  keeps them from the conversation's socket, once per message. The list's
  socket and the conversation's both hand a message over, and the first e2e run
  counted one message twice. The channel being read counts nothing. The list
  draws Telegram's topic badge in the chat list's own counter style («3»,
  «99+») and the name in full weight. `lib/channelReadMarks.ts` moves the
  channel's mark as far as the conversation has been shown while the page is
  visible, beside the chat's own mark. A database without the functions leaves
  the list as it was. Evidence: `channel-unread.test.mts`, and
  `channel-previews.spec` at 1440 and 390: three counts drawn, one more heard
  live, opening a channel clears it and sends its mark, and a database without
  the counts draws none.

## 8. Co-executors on a task — tracker item 67

- **Migration** `supabase/migrations/20260929100000_task_coassignees.sql`
  (`724C5CF2FEC0A578F32A49A2786C78115DBA62F628831506D7D0129815005A45`),
  rollback `…_task_coassignees.rollback.sql`
  (`6A47F523AE5B36CE5F125FCED5E403BF19D2E8E09E1DC29A081D233218011B4B`); both
  copied byte-identical into `.migration-backup/`. The six replaced functions
  were generated from production's own text with each patch applied by exact
  match, and read again just before the apply to confirm nothing had moved;
  the rollback restores that text byte for byte.
- **The shape, and why.** The proposal called this a project, because
  `assignee_id` is read by 28 functions and 4 policies (measured). Turning
  the assignee into a set would have changed every one of them, and also
  several things that mean one person: the one a reminder «Исполнителю»
  reaches, the one a pool claim fills, the one a recurrence copies, and the one
  the installed Android bundle reads. So `assignee_id` keeps all of that, and
  `task_coassignees` adds the others. The tester asked for two people doing
  the work, and a co-executor may do what the work needs: see the task, move it
  along its statuses, comment, tick the checklist and set reminders. Like the
  assignee, a co-executor may not confirm or reject the task.
- **What it does:**
  - `_task_coassigned_to_me(task)` is SECURITY DEFINER and answers for the
    caller only. The read policies of `tasks`, `task_events` and
    `task_checklist_items` ask it beside the task's own visibility.
    `task_coassignees`' own policy reads through `tasks`, so the two never
    recurse.
  - Six functions change only in the lines that name the assignee:
    `_task_transition` (every assignee-only step — accept, start, send for
    confirmation, return to work), `task_comment`, `task_confirm` and
    `task_reject` (a co-executor is refused as the assignee is),
    `_task_checklist_assert_can_change` (ticking) and `_task_reminder_may_hold`.
  - `_task_transition` also compared the assignee with `<>`, which let anybody
    through when the task had no assignee. It now uses IS DISTINCT FROM.
  - `task_set_coassignees(task, people)` sets the whole list. Only those who may
    edit the task may call it, on a task assigned to a person and still open.
    It takes at most 10 people, never the assignee (silently dropped), nobody
    banned, and on a location's task only that location's members. Each person
    added is told as an assignee is told (`task_assigned`, `coassignee: true`).
    The change goes into the task's history as an `update` with
    `coassignees: {added, removed}`: the event kinds are a checked list, and
    that list was left alone.
  - A co-executor made the assignee leaves the co-executors.
  - A task confirmed or rejected tells its co-executors as it tells its
    assignee.
- **Backup:** `/srv/letscube/backups/automated/20260929-005958`, `SHA256SUMS`
  15 of 15, `pg_restore --list` 159 table-data entries including `tasks`,
  `task_events`, `task_checklist_items` and `channel_reads`.
- **Rehearsal** (rolled back), as a staff account and an ordinary one:
  - The member could not see the admin's private task and was refused
    `forbidden` setting co-executors.
  - The admin added the member, naming themselves too; the name was dropped,
    leaving exactly the member. Refused: eleven people (`too_many_coassignees`)
    and an account that does not exist (`coassignee_unavailable`). The change
    was in the history.
  - As co-executor, the member saw the task, its history, checklist and list;
    was told; accepted, started, commented, ticked a point, set a reminder and
    sent the task for confirmation; and was refused a direct INSERT.
  - The admin, made co-executor of the member's task, was refused confirming
    it. Taken off the list, the admin confirmed it, and co-executors could not
    be added to the confirmed task (`task_locked`).
  - Made the assignee, the member left the co-executors.
  - Production read afterwards: no table, `_task_transition` unchanged, no
    rehearsal task. The post-apply smoke passed the same way; after it there
    were 0 co-executors and 58 tasks.
- **Client:** `lib/taskCoassignees.ts`; «Соисполнители» in the task form
  (`TaskCoassigneesField`, found as the assignee is found), sent after the task
  is saved and only when the list changed. The task's detail lists them under
  «Исполнитель». A co-executor gets the assignee's buttons, ticking and
  reminders. The card shows «+N». «Мои», «Новые», «В работе» and the «Я»
  filter count a co-executed task as the reader's own; the page reads every
  task its reader may see, which now includes these through the policy.
  Evidence: `task-coassignees.test.mts` and `task-coassignees.spec` at 1440 and
  390. The spec covers a co-executor taking the task on, the author adding one
  in the form (saved after the task), and «Мои» holding the task with «+1».

## 9. The pg_cron run history is kept for a week

- **Migration** `supabase/migrations/20260929110000_cron_history_cleanup.sql`
  (`6F51235028E5BD29133EE70B8A81BDE6DBCFB273507EE54F98FEEA2D6EE88058`),
  rollback `…_cron_history_cleanup.rollback.sql`
  (`43DC2B1DE6ACB8CA4B72B268A8FD0AE6669BA8E29D50281207B6B91DA00DF8CB`); both
  copied byte-identical into `.migration-backup/`. Found while adding the
  reminder job (§3) and approved by the owner on 2026-09-29 («подтверждаю»).
- **Measured first:** `cron.job_run_details` held 220,822 rows (210 MB), the
  oldest from 2026-06-18, 176,566 of them from `kub-send-push-notifications`,
  which runs every ten seconds. Nothing ever deleted a row. `postgres` holds
  DELETE on the table, which `supabase_admin` owns.
- **What it does:** `letscube-cron-history-cleanup`, hourly at :17, as
  `postgres`, deletes at most 50,000 rows that ended more than seven days ago.
  That window is longer than any health query here reads. The 158,267 rows
  already past the week go in bounded steps over the first hours; after that a
  run deletes a few hundred. The file keeps its size, and autovacuum lets later
  rows reuse the space. VACUUM FULL would shrink it, but it needs an exclusive
  lock that every job start would wait on, and 55 GB are free.
- **Backup:** `/srv/letscube/backups/automated/20260929-125950`, `SHA256SUMS`
  15 of 15, `pg_restore --list` 160 table-data entries including `cron.job` and
  `cron.job_run_details`.
- **Rehearsal** (rolled back): the job's own command, run once as `postgres`,
  deleted exactly 50,000 rows past the week and none of the 62,559 from the
  last week. Production read afterwards: no job, the rows intact.
- **Applied** as `postgres`: job 12, active, `17 * * * *`.
- **First run**, read back at 11:06 UTC: run 221003 at 10:17:00 UTC,
  `succeeded`, `DELETE 50000`, one second long. The history then held 171,380
  rows, 108,418 of them past the week, and its oldest run was from 2026-07-18
  instead of 2026-06-18 — the bounded step doing exactly what it was rehearsed
  to do, with three more runs to go before it settles into a few hundred an hour.
