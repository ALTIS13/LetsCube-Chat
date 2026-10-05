# Native notification display boundary, 2026-10-05

Owner: shared web/backend/Windows/Android coordinator. Parent: item76/D-335.
Source baseline: `7e88bf4f`; previous deployed web remains `a96a4d55`.
This is a source candidate, not an installed Android or richer-preview release.

## Cause and bounded repair

The current native v1 payload is deliberately generic at the FCM producer, but
the Android `ChatPushNotificationContract` still accepted arbitrary provider
title/body as display text. It also dropped an otherwise valid exact-message
target when those optional display strings were absent, blank or sensitive.
The worker's redaction already protects current production envelopes; this is
the missing client-side boundary, not evidence of a current personal-data leak.

The v1 parser now derives its own `LETSCUBE` / generic new-message display.
Provider text is ignored rather than treated as an authenticated projection.
Valid UUID/type/version/chat-tag/group-tag checks and the exact-message route
remain authoritative. Unknown versions remain reserved and refused. Future
recipient-authenticated previews must have a separate protocol, not enrich v1.

The actual JS `registerNativePushNavigationListeners` had a second gap: its
disposer waited for both SDK registrations, and a rejected second registration
left the first successful listener alive. Disposal also left captured callbacks
active while bridge removal was pending/refused, and repeated disposal repeated
native removal calls. Six calibrated lifecycle cases failed on baseline, with
four positive controls. The initial harness was corrected to supply the browser's
`URLSearchParams` and the actual reserved voice keys before counting those cases.

The registration now returns disposal immediately. Each arriving handle is either
owned or retired; partial registration failure retires successful siblings.
Retired callbacks cannot route, including while native removal is pending or
refused. Cleanup is idempotent; synchronous/asynchronous bridge removal failures
are contained. Active exact-message clicks and voice-reserved routing stay intact.
This does not persist card ownership or claim to repair provider delivery.

## Current verification

- Real compiled JS adapter:16/16, including four compiled omissions rejected by
  literal route/removal/registration-count oracles. Deferred SDK registration,
  partial rejection, callback retirement, late handles, idempotence and sync/
  async removal failure are covered against a fictional native bridge.
- Actual compiled Java parser: baseline13 cases gives9 PASS /4 RED; corrected
  parser22/22 includes13 behavioral groups and nine compiled mutation refusals.
  Provider title/body restoration, version/type/tag/group/UUID guard omissions
  and restored display-required rejection all fail independent literal oracles,
  not compilation/setup failures. Synthetic private fields never become Event
  display context. This does not remove the existing raw tap-intent extras.
-32 affected-boundary adjacent cases pass: native registration, auth lifecycle,
  real wrappers, navigation queue and chat-scoped read reconciliation.
- Kub typecheck exit0. Local fixture-config production bundle exit0:
  `sw.js build1ac27f72c2b42cb8`, `built in15.03s`. This is not the public build.
- Existing Android Studio JBR invoked by absolute path, without changing Java,
  JDK/JRE, global PATH or JAVA_HOME: actual `:app:testDebugUnitTest`, restricted
  to `ChatPushNotificationContractTest`, exit0 / `BUILD SUCCESSFUL in25s`.
  Actual app Java compiled; JUnit XML reports4 tests,0 failures/errors/skips.
- Existing Vite sourcemap/mixed-import/chunk warnings and Gradle flatDir/
  deprecation warnings remain; no metadata churn to conceal them.

Independent JS lifecycle review accepts the patch without open P1/P2. Its three
additional in-memory controls pass under strict unhandled-rejection handling:
synchronous second-registration refusal, rejected late-handle removal and thrown
late-handle removal. Independent native diff review also accepts the four scoped
files without open P1/P2: strict route guards, generic display and literal
compiled-mutation oracles are retained. Neither review repeats accepted suites.
None of this proves OS display, FCM receipt, lock-screen privacy or installed
APK behavior.

## Authenticated preview contract: source audit

The source audit finds an existing account-owned `notifications` read with a
restrictive message-source visibility policy, plus the authenticated
`message_notification_visible(message_id)` boolean RPC. Its recipient is
`auth.uid()`, not a supplied account id. This establishes a possible read
boundary, not permission to project personal content into an OS card.

Missing as one native display authorization: fresh unread/source/access checks,
message receipt/device/session binding, live session validation, mute/category/
DND eligibility and explicit preview consent. The current voice receipt is
separate authority and must not become a message-preview credential. Native
delivery recheck is a service-role-only outbox mutation, not a recipient lookup;
do not expand its grants or ship a trusted credential to a client.

This audit is source-only. Current live ACL/RLS was not re-read, no authenticated
production lookup was made, and no payload/message/provider operation was sent.

## Next acceptance sequence

1. Establish a separate recipient-authenticated, read-only projection contract.
   Require the live own notification and source, current device/session,
   notification eligibility and preview consent. Cached notification payload
   text is not a fresh source projection. Refuse anonymous, expired/revoked,
   foreign-account, read/deleted/hidden/blocked/inaccessible or muted cases.
2. Wire a capability-negotiated native recipient context and a lifecycle-managed
   bounded worker. A wake signal never contains personal text, bearer credentials,
   media URLs or an endpoint chosen by the provider. Generic fallback stays
   available when lookup or authority is unavailable. Do not reinterpret v1 or
   infer capabilities just from an unverified future version number.
3. Revalidate owner/session/epoch, preview choice and exact current card/message
   identity before publication. Late lookup must not overwrite a newer card or
   resurrect an old owner's content. Invalidation/logout retires owned cards and
   pending work. Preserve exact message activation and chat-scoped read cleanup.
4. Accept on identified installed clients: fictional text/media fallback labels,
   multiple messages, account replacement, mute/DND, foreground/background,
   locked/unlocked privacy, read/revoke during a held lookup and offline fallback.
   WNS killed-process receipt, native credential lifecycle and hard-document
   reload persistence remain separate from live web/Windows JS behavior.

[Firebase's Android receive contract](https://firebase.google.com/docs/cloud-messaging/android/receive-messages)
distinguishes data processing from automatic background notification display and
requires valid process-lifecycle handling for longer work. A web handler is not
a killed-process implementation. [Android notification privacy](https://developer.android.com/develop/ui/views/notifications#lockscreenNotification)
is a separate OS boundary; application preview consent must not override it.

## Publication boundary

No SQL, Edge/worker, provider payload, native identity, consent setting or privacy
policy changed. No APK assemble, cap sync, release signing, installation or native
publication. No production/screens/media capture or device rental; A063 was not
used. The next package cut and actual card acceptance are not covered by these
source checks. Do not spend rental minutes inspecting an unchanged installed
APK to claim this candidate works. Preserve current generic FCM/WNS fallback.

Reviewed source and resume records belong to `codex/bot-inline-media-20261002`.
Publication uses a clean-tree/own-commit-tree JS alias/syntax guard, followed by
exact candidate remote-ref readback; that guard is not Java/native acceptance.
Do not rebuild production web merely to carry Android-only preparation or docs.
D-335 stays open; the two adjacent source repairs do not complete useful previews.
