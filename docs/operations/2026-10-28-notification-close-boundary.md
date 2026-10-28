# Notification Close Boundary, 2026-10-28

Owner: bounded #85 worker. Stage: SOURCE_ONLY_READY from clean `b115e903`;
coordinator owns release. No build, deployment, device, Auth, DB, remote or Git
write was performed. Foreign updater/media work is preserved.

## Review Follow-Up: Task/Invite Regression

The coordinator identified a genuine nonmessage regression in this slice: the
existing caller also cleans read task/invite cards, but the new boundary builder
accepted only messages. Four actual-renderer/helper/worker positive cases first
went RED: **16 tests, 12 PASS / 4 FAIL**, all failures at the literal
`CONFIRMED_NONMESSAGE_CARD_MUST_CLOSE` oracle. These are now GREEN. Additional
REDs caught legacy declarative fallback missing the row ID, an invalid source
subscription supplying identity, and old-worker mutable compatibility.

Source tracing: `_enqueue_push_after_notification_insert` in
`.migration-backup/supabase/migrations/20260926091149_album_push_activate.sql`
adds `notificationId = new.id` to the common Web/native outbox payload. Task and
invite tags identify the subject, not a unique notification row. Both Web
renderers previously discarded this row ID for nonmessages; the Edge renderer's
selector argument already receives it from `row.payload.notificationId`.
Therefore an equally exact browser-only fix could not recover the missing row ID.

The coordinator explicitly authorized these two renderer files. Both now retain
the validated row UUID in an additive `notificationId` field, including
declarative `Notification.data`. The Edge renderer uses the existing checked
selector argument, not an untrusted payload fallback. The browser boundary for
these kinds is `{notificationId, subjectKind: "task" | "invite", subjectId}`.
Both renderer paths, the actual hook call-site, mutable-event handling and OS
declarative fallback have positive controls; new same-tag row IDs survive queued
close commands. Explicit malformed boundaries never fall back to raw metadata.

Mixed-worker compatibility: old workers strictly whitelist declarative data.
Generic task/invite cards carrying the new field therefore use `mutable: false`,
preserving display, exact routing and metadata without invoking that older
decoder. Message-preview mutation/capability and its privacy gates are unchanged.
No API signature, SQL, dispatcher index/runtime or native updater was changed.

### Generation And Reuse

This is source inventory, not a live-catalog claim. `_notify` in
`20260504_notifications.sql` INSERTs a row whose ID defaults to `gen_random_uuid()`;
task state changes and `20260928190000_task_reminders.sql` call that helper.
`20260512_group_invite_reinvite_and_policy.sql` creates a fresh invitation and
notification on reinvite; a pending-invite retry returns its existing result.
Its cancel path and `20260919190000_a_join_is_announced_once.sql` accept path
update invite payload/status on the existing notification, without resetting
`read_at` or changing its row/subject identity. The common push enqueue trigger
is AFTER INSERT (`20260527_push_notifications_foundation.sql`), not UPDATE.
No reviewed task/invite path rearms an old read row as a new unread delivery.
Thus same-row metadata updates retain a valid exact boundary, while a genuinely
new event has a different notification UUID even when its subject tag is reused.
The focused runtime tests exercise both behaviors; no DB was accessed or changed.

## Cause And RED

The [pre-dispatch repair](2026-10-28-priority-intake.md) already protects the wait
for `navigator.serviceWorker.ready`. It cannot revoke a command already posted.
The shipped worker awaited `getNotifications({ tag })`, then unconditionally
closed every result. A newer unread card returned by that pending query was
therefore removed even though only the previous notification had been read.

Initial actual-worker regression: **2 tests, 1 PASS / 1 FAIL**, exit 1. The known
exact-read close passed; the held-query/new-push case failed the literal
`NEW_UNREAD_CARD_MUST_SURVIVE_QUEUED_CLOSE` assertion (`true !== false`). This ran
the complete shipped `sw.js`, not copied close logic. Browser notification ports
are controlled; this is source/VM evidence, not a physical OS-card acceptance.
The initial reproducer used the shipped `KUB_CLOSE_NOTIFICATION` command; the
final test uses the distinct guarded protocol below.

## Repair

- The own confirmed feed row supplies `{notificationId, chatId, messageId}`.
  The builder requires the exact known `user_id`, a confirmed `read_at`, a
  supported kind and canonical lowercase UUIDs. Task/invite use the subject
  boundary described above. Existing mounted user/session/epoch
  and latest-unread predicates still run before and after worker readiness.
- The helper snapshots that boundary before awaiting readiness and posts only
  `KUB_CLOSE_NOTIFICATION_IF_MATCH`, `v: 1`, the exact canonical subject/chat tag and
  `expected`. No body, sender, credentials or display-policy data crosses here.
- Push publication retains the exact notification selector's row ID alongside
  chat/message IDs in `Notification.data.closeBoundary`, including generic cards.
  That row ID identifies the recipient-owned notification; it is not a preview
  grant. Existing content lookup, final durable privacy check and generic fallback
  are unchanged. Unvalidated selectors never produce a boundary.
- The consumer requires a same-origin top-level window, exact packet shape and
  UUID/tag agreement. After the asynchronous query it compares every card's
  exact tag and all boundary fields immediately before `close()`. A replacement cannot
  match the old read boundary. Query failure performs no fallback clear.
- A distinct message type matters: an old worker would ignore new fields on its
  old tag-only command. New packets are inert in that old command gate; the new
  worker ignores legacy tag-only commands. This is not legacy masking.

There is deliberately no blanket close for unknown/legacy identities or
nonmessage cards lacking this boundary. Such cards remain until their normal
click/replacement/removal, rather than guessing ownership. Already executing old
worker code cannot be retroactively revoked by this source patch; actual worker
activation/release is a separate coordinator gate. Native Android exact-pair and
Windows cleanup protocols, read RPCs, feed authority and badge behavior are not
changed. This does not close the entire unidentified tester #85 complaint.

## Focused Evidence

New worker suite: **24/24 PASS**, including five actually loaded worker mutants
(notification ID, message ID, protocol version, omitted producer boundary and
37-byte UUID admission), two actual renderer row-ID omission mutants and one
mutable-compatibility mutant. Byte cases cover exact 36-byte UUIDs, short/long IDs,
Unicode and whitespace without trimming/truncation. Negative controls cover
unknown owner/source, malformed packets/cards, tag mismatch, legacy commands,
privacy-generic presentation, query failure and snapshot mutation during ready.
The prior eight pre-dispatch cases/mutations remain active, plus two actual-effect
task/invite positives. Synthetic IDs, packet bytes and the real builder dependency
were adapted. The existing
ownership fixture imports the actual builder rather than fabricating it.

Final changed-scope command (no broader audit):

```powershell
$env:KUB_QA_ALLOW_MUTATIONS = '0'
node --test tests/unit/browser-notification-worker-close.test.mjs tests/unit/browser-notification-close-race.test.mjs tests/unit/notification-read-sync.test.mjs tests/unit/notification-read-ownership.test.mjs tests/unit/notification-read-realtime.test.mjs tests/unit/notification-read-update-marker.test.mjs tests/unit/web-message-preview-worker.test.mjs tests/unit/legacy-web-preview-payload.test.mjs tests/unit/browser-notification-presentation.test.mjs tests/unit/pwa-notification-click.test.mjs tests/unit/web-push-delivery.test.mjs tests/unit/web-push-delivery-recheck.test.mjs
pnpm.cmd --filter @workspace/kub run typecheck
pnpm.cmd exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck supabase/functions/send-push-notifications/webpush.ts artifacts/api-server/src/workers/pushDispatcherConfig.ts
node --check artifacts/kub/public/sw.js
git diff --check
```

Final combined result: **222/222 PASS**, zero skipped/cancelled; both typechecks and
syntax/diff checks pass. Existing Node module-type/`stripTypeScriptTypes` warnings
are not test failures. No physical/browser-OS or production acceptance is claimed.
Integration requires the producer renderer rollout as well as page/worker bytes;
a web-only rollout cannot recover an ID already omitted from an old push.

## Changed Paths

- [Worker](../../artifacts/kub/public/sw.js)
- [Close helper/protocol](../../artifacts/kub/src/lib/browserNotificationPresentation.ts)
- [Own-feed call-site](../../artifacts/kub/src/hooks/useNotifications.ts)
- [Legacy renderer](../../artifacts/api-server/src/workers/pushDispatcherConfig.ts)
- [Edge renderer](../../supabase/functions/send-push-notifications/webpush.ts)
- [New worker regression](../../tests/unit/browser-notification-worker-close.test.mjs)
- [Pre-dispatch regression](../../tests/unit/browser-notification-close-race.test.mjs)
- [Ownership fixture dependency](../../tests/unit/notification-read-ownership.test.mjs)
- [Privacy worker mutation anchor only](../../tests/unit/web-message-preview-worker.test.mjs)
- This report.
