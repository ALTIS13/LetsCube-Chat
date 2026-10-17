# Web Message Preview Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or
> superpowers:executing-plans. Continue the accepted topic-alert release; do not
> restart completed stages or deploy a partial preview implementation.

**Goal:** Let the installed iPhone PWA show sender/message text under an explicit
preview choice, in the same release the owner will test with Nikita.

**Architecture:** Keep declarative Web Push generic. A service worker can obtain
bounded content through a revocable, hash-only server grant tied to the current
account, live session, exact subscription descriptor and installation consent.
Recheck both server policy and durable worker context before the first display.
No client refresh token, native-device impersonation or service_role is involved.

**Tech Stack:** Existing Supabase/Postgres/RLS, Web Push, service worker,
IndexedDB, React settings and the repository's existing test tooling.

**Source scope:** [Audit](../../operations/2026-10-17-iphone-message-preview-audit.md).
The DB implementer records exact RPC/DTO contracts in
`docs/superpowers/specs/2026-10-17-web-message-preview.md` before consumers bind.
This plan does not assume those contracts already exist.

## Constraints

- Ship together with the accepted topic-notification changes, not as a later
  iOS backlog promise. Existing Android22/native protocols remain unchanged.
- Explicit browser consent is separate from an earlier Android choice. Preserve
  account none/sender/message and current read/access/topic restrictions.
- Grant lifetime is bounded to at most30 days and the live session's expiry.
  Renewal requires foreground authenticated authority; background expiry is
  generic, never an unbounded credential or silent renewal.
- None/logout/same-UID reauthentication/subscription replacement retire local
  admission before awaiting remote work. Stale ACKs cannot restore it.
- Generic declarative fallback remains safe if WebKit bypasses the worker.
  Offline, timeout, malformed result or evicted storage stays generic; no late
  generic-to-rich update or retry after an unknown publication result.
- No production personal captures, message bodies, grant secrets or tokens in
  logs/tests/reports. Use fictional owned canaries only. Rent iPhone only for
  a prepared finite check, then release it immediately.

## Tasks

### 1. Revocable Server Contract

Owner: Kuhn. New proposal/rollback, contract spec and
`tests/server/web-message-preview-db.test.mjs`.

- [x] Establish RED for missing own-session/subscription/grant content authority.
- [x] Implement hash-only grants and narrow authenticated enroll/revoke plus
  bounded selector lookup. Bind actual subscription descriptors, revocation
  revision, expiry and current user choice. Payload text is never authority.
- [x] Prove own positive, foreign tuple, expired/revoked, none, read/deleted/
  hidden, membership/topic denial, selector tampering and album member cases.
  Preserve native RPCs, RLS and existing dispatcher rechecks.
- [x] Test literal omissions; review SQL signatures/owners/search paths/grants.
- [x] Actual isolated PG17 DDL-only rollback rehearsal, unchanged catalog/epoch.
- [ ] Actual content/HTTP and production backup/transaction/rollback proof.
  DDL rehearsal and source tests do not substitute for these checks.

### 2. Worker And Browser Lifecycle

Task1 published the stable RPC/DTO contract. Hume owns browser client/hook/UI/
lifecycle; Leib owns worker/helper and actual-handler tests after the current
topic lease repair. They agree the durable context/retirement protocol before
consumer code. New
`artifacts/kub/src/lib/platform/webMessagePreviews.ts`,
`artifacts/kub/src/hooks/useWebMessagePreview.ts`, bounded changes to existing
SettingsScreen/usePush/browserPushSubscription/PwaRuntime/useUser and
`artifacts/kub/public/sw.js`. Do not rewrite the generic owner framework.

- [x] Pin real worker-handler RED before adding lookup and durable context.
- [x] Add explicit none/sender/message choice, current-installation admission,
  foreground renewal and retirement using existing accountEpoch/session identity.
- [x] Lookup before the first showNotification, then reread durable context;
  honor original grouping, route/tag/renotify and one publication attempt.
- [x] Test held logout/None/account replacement/same-UID session change, stale
  ACK, worker restart, IDB failure/eviction, timeout and malformed responses.
  Omission tests assert literal security outcomes, not their own constants.

### 3. Selector Transport And Common Release

Coordinator owns the narrow Edge/webpush integration and final assembly.

- [x] Add single/album selectors without content in the declarative fallback;
  retain current claim/descriptor/policy checks and old-worker compatibility.
- [x] Cover the opt-in API legacy dispatcher too: its former raw row.payload
  serialization now uses the selector/generic display contract. Keep
  opt-in/default deployment ownership unchanged; no privacy or legacy bypass.
- [x] Verify changed server/worker/client boundaries and exact1440/390 pixels
  in both themes for the new setting, on strictly fictional data.
- [ ] Finish the existing topic fullstack gate. Assemble compatible migrations,
  Edge, worker/client and rollback; never publish only the control or resolver.
- [ ] Verify backup/restore, one raising transaction, byte-identical migration
  mirror, runtime image/content parity and anonymous smoke before canaries.
- [ ] On a rented installed Home Screen iPhone, test real fictional background
  text push, sender/none, restart, exact-message tap and queued logout refusal.
  Record iOS preview-setting limits; release the device immediately afterwards.
  Source/WebKit fixtures alone do not establish physical delivery acceptance.

## Current Checkpoint

Coordinator: topic Task6 remains the common release gate; no production preview
change. DB50, browser30, worker25, adjacent ownership64 and legacy53 source
checks pass; actual PG17 DDL-only rollback also passes. Exact settings pixels
at1440/390 in both themes and the final source review are accepted. The review's
SQL Unicode/codepoint mismatch is fixed with a real SQL-to-worker RED/GREEN
case, retaining the literal96/240 limits. Canonical typecheck/build pass
(SW d14bd7d50ba1fb9a,17.31s). Fullstack, real iPhone and common release checks
remain open; no runtime/device/release acceptance is inferred.
