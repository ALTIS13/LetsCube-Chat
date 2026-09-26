# Album-level external push: rollout plan, 2026-09-26

Owner: shared backend (Codex). Stage: additive schema applied with runtime
disabled; Edge deployment and activation remain. The separate iOS/MacOS task
owns iPhone PWA behavior.

## Current checkpoint

- Fresh full backup: `/srv/letscube/backups/automated/20260926-122324`,
  verified by SHA-256 catalog and `pg_restore -l` before applying SQL.
- Both migrations passed a live-schema transaction rehearsal ending in
  `ROLLBACK`. The trigger and album objects were unchanged after rehearsal.
- `20260926085544_album_push_outbox.sql` was applied once. Live checks show
  `enabled=false`, `legacy_wns_enabled=false`, zero album groups/outbox rows,
  RLS on all five new tables, service-role-only claim RPC and unchanged trigger.
- Focused database tests: 14/14. Web/FCM/voice regression tests: 56/56.
  No external provider or physical-device delivery is claimed yet.

## Current state

- A 2-10 item visual album is sent as individual `messages` rows with the same
  client-supplied `album_id`, per-part index and count in `media_metadata`.
  Every recipient gets an independent in-app `notifications` row and exact
  `message_id` route. Preserve those read and navigation semantics.
- The live `_enqueue_push_after_notification_insert()` trigger creates Web
  and Android FCM outbox rows per eligible notification and target. Its native
  branch currently selects Android FCM only. The older source WNS migration
  also selected Windows devices, so activation detects and preserves that
  prior contract instead of silently turning it on or off.
- Web `push_outbox_claim()` coalesces pending rows by subscription and chat tag;
  the native claim does not. Neither gives a guaranteed album-level delivery.
  Both delivery rechecks inspect one notification. The Edge dispatcher uses
  the payload returned at claim time, so changing a representative later in
  SQL alone would not update the sent payload.

## Proposed implementation

1. Keep existing `notifications` and ordinary outboxes unchanged. Validate the
   original message tuple server-side: image/video, album ID, unique index,
   count 2-10, chat and actual sender. Invalid tuples use the legacy path.
   The grouping key must include recipient, chat, actual sender and album ID;
   album ID alone is client-controlled and not globally unique.
2. Add an isolated album outbox with one row per grouping key and target Web
   subscription or native device. Enforce exactly one target, bounded unique
   member indices/notification IDs, a partial unique key per target, RLS, no
   client grants, a due index, and a persistent sent marker for late parts.
3. Add service-role-only claim/recheck/ack RPCs. Claim due rows under
   `FOR UPDATE SKIP LOCKED`. Recheck under the row lock must choose a currently
   unread, visible member, verify the current subscription/device owner and
   state, mute and Web foreground state, then return a fresh neutral payload
   with that member's exact route. Acknowledge only the matching claim token.
   Unknown statuses fail closed. Provider acceptance followed by lost ack can
   still duplicate a push; do not claim external exactly-once delivery.
4. Start with a five-second quiet window after the last observed part, capped
   at 30 seconds from the first, then measure. A missing part must not block a
   push forever. Parts arriving after an acknowledged push keep their in-app
   notifications but do not create another external push for that album.
5. Group Web and Android FCM targets first. Where WNS was already active before
   activation, retain its legacy per-part delivery for both ordinary messages
   and album parts. The live Android-only server stays Android-only. Album-level
   WNS grouping remains a separate release, not an implicit side effect here.

## Activation and rollback gates

- First apply an additive migration with a verified fresh backup, transaction
  rehearsal, self-checks, privileges/RLS inspection and byte-identical
  migration backup. Deploy Edge support against the empty queue while the old
  trigger still produces ordinary outbox rows.
- Switch only new albums in one short transaction with `lock_timeout` and an
  insert barrier. A grouping key with any pre-activation part stays entirely
  on the legacy path. Do not backfill or double-enqueue. Confirm the opt-in
  legacy API worker cannot drain the same queue.
- Rollback stops *new* album enqueue first while the new Edge version drains
  existing rows. Removing the Edge dispatcher before the queue drains means
  explicitly quarantining unsent album rows and accepting lost external push;
  the in-app rows remain. Do not drop RPCs/tables while a caller remains.
  Never roll back to a native payload with sender or message text without
  separately closing the account-rebinding privacy risk.

## Required proof

- Full-schema Postgres tests: parallel upsert/claim, partial unique indexes,
  two and ten parts, missing/late part, retry, partial/full read, mute,
  foreground, endpoint rebind, lease loss, provider failure and cutover.
- PostgREST RPC/grant contract and mock Web Push/FCM dispatch: one logical
  delivery per eligible target, neutral OS content, exact tap route. Test both
  Android-only and historical WNS trigger variants; WNS must retain legacy
  delivery until its own album grouping is implemented and accepted.
- After deployment, verify module hashes, live schema/function definitions,
  one healthy Edge runtime, cron outcome and a bounded authenticated test.
  Browser fixtures or source checks do not prove physical-device delivery.
