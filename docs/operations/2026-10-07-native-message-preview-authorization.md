# Native message preview authorization - 2026-10-07

Owner: coordinator, `codex/bot-inline-media-20261002`, source base `d5edbe83`.
Tracker item76 / D-335. This is a source-only proposal, not an installed RPC,
preview setting or a repaired system card. Existing native v1 stays generic.

## Observed boundary

Three bounded read-only production catalog transactions completed with exit0 and
empty stderr, against the selected `supabase-db` container and PostgreSQL17.6.
Database/version/relation positive controls matched. No account/message/token
rows, private configuration or media were queried or captured.

Current `user_push_devices` already has `session_id`; table grants exclude anon
and authenticated. Its RLS is enabled. `auth.sessions` has `id`, `user_id`,
`created_at` and `not_after`. Current notification preferences have push/category
booleans, but no explicit preview consent. Own-notification RLS and the existing
message-visibility function do not themselves authorize OS display. Voice binding
and service-role outbox delivery recheck are not message-preview credentials.

The current `_notification_push_allowed` definition checks source visibility,
source/chat matching, DND, push/category preferences, self-sender suppression,
chat push choice and temporary mute. It is STABLE/SECURITY DEFINER. The new RPC
calls this trusted boundary with current source IDs, not cached sender/mention
flags, title/body or a native outbox payload.

## Source contract

[Unversioned SQL proposal](../../supabase/migration-proposals/native_message_preview.sql)
introduces three functions and one table with owner RLS: a session-aware identity
helper, device capability, account-owned consent and recipient preview RPC. It does not alter source,
enqueue, worker, device registration, provider or voice contracts.

- `notification_preview_preferences.preview_level`: `none` by default, or explicit
  `sender` / `message`. Missing choice denies a projection. Four owner RLS policies
  also require a live normal-user session; a revoked/expired JWT cannot change
  consent. No admin, anon or service-role table grant is introduced.
- `native_message_preview_recipient()`: verified-API JWT `sub`, `session_id`,
  normal authenticated role, explicit non-anonymous claim and bounded valid
  `exp`, matched against current session owner/creation/`not_after`. This helper
  does not validate signatures: that remains PostgREST's required responsibility.
- `native_message_preview_capability(deviceUUID)`: current live recipient/session
  plus exact enabled, unrevoked Android FCM device. Returns exactly one five-key
  row: `preview_v=1`, recipient/session/device IDs and current account-wide level,
  defaulting to `none`. This is server availability/consent, not authority to draw
  private text, a voice capability or an installed native implementation.
- `native_message_notification_preview(deviceUUID,notificationUUID)`: no supplied
  recipient, session, endpoint, display text, media URL or service credential.
  Derives the account; requires the exact enabled/unrevoked Android FCM device
  bound to that session and the exact own unread message notification. Other
  platforms/providers are deliberately refused until separately negotiated.
- Notification source message/chat must match. Ordinary native delivery must
  match notification/device/recipient. Album delivery instead requires the exact
  member notification/message, group recipient/chat/current sender kind+ID and
  unsuppressed device-only album receipt. Common authorization/visibility/policy
  checks stay outside the OR; a web receipt or another group's/device's receipt
  cannot grant a projection. Notifications before the current session
  or in the future are refused. The existing visibility function rechecks current
  membership/join/clear/hidden/topic/block/ban/deletion rules; current push policy
  must allow delivery. No old notification/outbox text is projected.
- `sender` exposes only current author label plus generic new-message body;
  `message` adds current text or a generic photo/video/voice/file label. No media,
  avatar URL, caption/object metadata or cached group name is returned. Empty or
  absent sender source refuses the projection. Names/text are whitespace-normalized
  and capped at96/240 PostgreSQL characters, respectively.
- A single row has distinct `preview_v=1`, exact recipient/session/device/
  notification/chat/message identities, level, author/title/body and a15-second
  expiry from the authorization statement. Refusal returns zero rows.
  This is not `native_chat_v1` or a voice protocol receipt.

RPC/helper are STABLE/SECURITY DEFINER, postgres-owned, with pinned `pg_catalog`
search path and authenticated-only execution. The transaction's raising catalog
self-check rejects weakened mode/search path/RLS or extra grants; failures do not
commit partial objects. Rollback is in the header, with new consumers disabled
first. Removing the new consent table resets its choices to fail-closed defaults.

## Verification

[Actual SQL fixture tests](../../tests/server/native-message-preview-db.test.mjs)
run the proposal in the existing PGlite runtime with fictional rows/claims.
The visibility function and album association DDL are loaded from their actual
tracked migrations. Push-policy
and ban fixtures are explicitly controlled dependency boundaries, not proof of
the complete live DND/preferences implementation or signature verification.

Feature-absence RED queried the catalog and found the distinct RPC missing;
it was not a syntax/import/setup error or a claimed shipped privacy defect.
An intermediate `auth.uid()`-only consent policy was separately reproduced RED:
revoked-session JWT still read its preference. Replacing it with live-session
authorization made that regression GREEN.

Independent review found a P2 album gap: successful album enqueue intentionally
has no ordinary Android outbox. The positive album-only case reproduced RED
(no projection). The separate owned album association made it GREEN. A fresh
catalog transaction confirms all12 used album columns plus native notification ID.

Full111/111 passed after the album repair; final changed-case refresh45/45 adds
bot-album positive coverage and two self-check variants without replaying unrelated
checks. Accepted evidence includes:

- 30 ordinary and36 album authority/visibility refusal subcases with positive
  controls before/after, plus malformed/expired/anonymous/foreign JWT cases;
- explicit/default consent, fresh message/author edits, sender-only redaction,
  media URL suppression, exact identities and literal96/240/15-second bounds;
- actual authenticated role/table RLS, rejected foreign insert/owner replacement,
  unknown choice, revoked/expired-session read/write/insert/delete restrictions;
- 29 compiled behavioral mutants rejected by assertion failures, not setup errors;
- 7 weakened mode/search-path/RLS/ACL variants rejected by the raising self-check, followed
  by rollback proof that no new RPC/table survived;
- actual read-only transaction lookup and execution of the documented rollback,
  retaining existing notification/outbox/device/session fixture rows.

Final independent source review accepts the SQL/tests with no open P1/P2;
the album P2 is closed after RED/GREEN and current-source inspection. The reviewer
did not repeat accepted tests or claim native, live JWT or recovery acceptance.
No unchanged web/native/PG17 recovery suites were replayed. There is no web or
native runtime import, so no application rebuild or visual claim is required.

**Capability continuation:** absence case was RED against the preceding proposal;
the added function and its exact-device/current-session/default-none controls are
GREEN. Full current SQL fixture135/135 passes. Eight added compiled authority/
default mutants and one added raising ACL self-check mutant are refused; the
documented rollback removes the capability too. This refresh covers the changed
proposal and its adjacent authorization rules, not unrelated product suites.
Independent review of the added capability is recorded with the client preparation
in [the continuation](2026-10-07-notification-preferences-capability.md); this
section does not relabel the previous review as acceptance of new code.

## Remaining acceptance

1. Reviewed live before-state and recovery/backup acceptance under `CLAUDE.md`
   section10, then full-schema PG17/real PostgREST JWT and rollback rehearsal.
   This PGlite fixture is not a full restore or D-342 acceptance. The proposal is
   not in `supabase/migrations` and must not be installed directly by a rollout.
2. Native capability negotiation and server-side device binding, plus user-facing
   preview choice. The current producer remains redacted. No future app version
   number alone enables private display; do not enrich existing v1 envelopes.
3. Bounded native lookup with an independently managed credential lifecycle.
   Before display, compare current account/session/epoch/consent and exact card/
   message, reject expiry and newer replacements, retire work/cards on logout.
   One SQL snapshot/15-second response is not protection against changes after
   it returns; cached responses never become persistent display authorization.
4. Identified installed-client/system-card acceptance on Realme or a targeted
   rental: fictional text/media/multiple-message, route/read cleanup, account
   switch/revoke/read during held lookup, offline and OS lock-screen privacy.
   WNS killed-process and hard-document reload remain separate gates.

No production SQL, HTTP recipient lookup, provider send, personal screen/media
capture, APK sync/assemble/sign/install/publication, device rental, package/store
identity or network/JDK/PATH change. D-335 remains OPEN. Runtime changes are not
claimed from a source proposal or branch publication.

Publication is candidate-only. Review `origin/main..HEAD` separately and finish
the existing clean-tree/own-commit JS syntax/alias guard before pushing; that guard
does not validate SQL or native behavior. Exact branch readback must match the
reviewed commit. Do not trigger a docs/proposal-only production rebuild.
