# Persistent Outbox Order And Topic Transport

## Current Resume

Owner: Codex; stage: item52 restore FIFO fix and item77 live transport acceptance.
Source baseline: `c92e408075f3dc696363c0e4cfcdda11ecf02992`; reviewed repair and
Android24 source: `5af58c2b051ed826adf09567c1b94b79bc36b123`. Web readable previews
and Android0.1.22/build23 remain accepted; do not repeat their unchanged matrix.
Topic runtime is still OFF. The current live wire probe is accepted, not the
child-override compatibility/provider/OS matrix. The FIFO repair is released;
next: fresh isolated Topic override acceptance, then the remaining recorded
Nikita/cache/reconnect intake. No cloud device/runtime is currently held.

## Observed Cause

`createOutboxRunner.start()` published its owner before awaiting the persistent
queue. A concurrent `enqueue()` therefore sent a newly composed message while
an older same-chat message was still loading. The per-chat FIFO rule could not
order an entry it had not yet seen. Same-owner repeated initialization also
returned a partial queue rather than waiting for restoration.

The shipped runner is reproduced with real IndexedDB across a document reload
in both Chromium and WebKit: newer -> older. Both desired-order assertions fail
against the shipped source; the explicit shipped-source negative control passes.
This is a confirmed implementation defect, not a claim that it alone explains
Nikita's reported network/VPN latency.

The repair keeps sending/scheduling closed until the current owner's restore
completes, shares the pending initialization and retains epoch fences. A failed
storage restore does not grant permission to overtake unknown older entries;
queued work remains waiting and a later explicit initialization can retry.
No server schema, message ID, persistence format or retry budget is changed.

Independent review reproduced a second P2: a discarded entry could return from
the stale restore snapshot and be sent. Current-restore discard tombstones now
survive that snapshot and a failed restore, with the same account/epoch fences.
An explicit new enqueue retains its current payload. Both Chromium and WebKit
first failed the stale-discard case and then passed after this repair.

## Evidence

- Actual current production SDK2.105.1 + `createNotificationFeedV2` obtained the
  own open marker, admitted one newly produced QA message exactly once and
  reconciled the real read update. No resync; fresh alert-decision HTTP64ms.
- The production wire probe used only owned QA accounts and one synthetic
  message. Both Auth sessions were locally signed out and independently absent
  in the database afterwards. Web=true, Topic=false and RLS remained unchanged.
- Chromium/WebKit use actual IndexedDB, an isolated fictional origin and no
  external requests, screenshots, traces or personal content. The changed
  runner passes both FIFO cases; the shipped-source control still exposes the
  old failure. This is browser/storage proof, not physical-device network proof.
- A separate owned ordinary-HTTP canary uses the current runner against the real
  message endpoint: older restored entry precedes the new send, exactly two
  distinct server rows exist and the acknowledged queue is empty. The QA session
  is retired. Private receipt `outbox-http.json` records only acceptance metadata;
  this does not add a physical-device/FCM claim or repeat the accepted build.
- The adjacent mounted outbox fixture had an obsolete incidental sound import
  boundary. Stubbing its existing sound port restores its intended isolation
  without replacing the runner, store, account lifecycle or send behavior.
- Final affected suite117/117, zero skips/failures, including actual browser5/5,
  restore22/22 with three loaded literal omission mutants, mentions/media resume,
  attachment ordering and Android packaging/signing/verifier contracts. Kub
  typecheck passes. Two stale packaging expectations still named0.1.13/build14;
  they now pin the intended0.1.23/build24 candidate, not a derived self-oracle.

Private metadata-only wire receipt:
`.ops-private/topic-live-20261018/feed-wire.json`. Do not replay spent canaries
or retain/print access tokens. The wire operator is deliberately not an override
or physical notification acceptance oracle.

## Topic Acceptance Still Required

The current legacy fence applies account-wide after an applied child override.
New clients use authenticated feed-v2 RPCs/Realtime and fresh effect decisions;
legacy direct table reads are excluded while existing own read RPCs remain
compatible. The old R5 helper binds expired identities/recovery receipts and
cannot simply be pointed at current production.

Use a bounded fresh schema-only PG17/PostgREST/Realtime copy and the existing
actual old/current hook executor. Prove parent-muted child-enabled, inverse,
independent recipient positive, cross-session read/foreign denial, retained
history, terminal suppression and enforcement-preserving rollback/reconnect.
Provider/physical OS acceptance remains separate. Do not enable Topic globally
based on this ordinary-message baseline or the earlier manual-claims probe.

## Release State

Android0.1.23/build24 is Stable, mandatory=false. Real build markers:
`bca1e854882abe98`, Vite23.41s, Gradle16s. Original APK/AAB signer, four Firebase
initialization values, ordinary false QA flags, logging-none and bundled web /
native DEX parity pass. APK7,755,415 bytes, SHA256
`15a2f563b261e50d0ff824855ba2378dfc3059216dc66041ee4c6f194bd56706`.
AAB7,387,175 bytes, SHA256
`11ed53fc3a50c9ffd399f71ab64716e980c4c10b1d623b588dcd9831f8c3fe4c`.

Realme primary23 ->24 is an actual in-place installation; UID, data directory
and first-install time match. No clear/uninstall/PIN entry or other app update.
The actual guest login screen and foreground activity are verified, with no
native fatal in that process. Initial verification refused because the probe
used Android15's `dumpsys window windows`, which omits current-focus metadata,
and omitted a UI label field; calibration against `window displays` and the
existing safe UI reader corrected the probe. The successful recovery inspected
the already-installed24, not a second install or a fictional successful retry.
This is guest upgrade/startup evidence, not a new authenticated FIFO/FCM canary.
The unchanged native delivery/auth acceptance from23 remains explicitly reused.

The existing immutable publisher ran under its catalog CAS/publish lock with
byte-checked previous Stable23 manifest/APK and rollback retained. Separate
HTTPS streaming verifies the entire published APK and manifest bytes/hash.
Android23 was not overwritten. No store/package identity changed.

Shared-web source5af58c2b is deployed; build `6d2e3337463d0e30` has one healthy
image and exact public/container HTML, entry JS and SW hash parity. The public
compiled bundle contains the changed deferred-restore/shared-init/discard
boundary, not only an unrelated inherited notification marker. No production
SQL, API worker or provider configuration changed. Windows uses the updated
remote renderer with its unchanged0.2.14 shell. Native Apple release ownership
is unchanged. Later documentation-only deploys may replace the image/build ID
without changing this product source; retain their separate private receipt.

Private receipts: `.ops-private/topic-live-20261018/`, including `realme24.json`,
`publish24-public.json`, build receipts and `web-fifo-5af58c2b.json`; public web
parity also lives under the preceding web-preview operator directory. Both main
and worktree preserve ignored credentials and original immutable release files.

## Fresh Topic Runtime Preparation

The new ignored `runtime/` directory contains seven inert preparation files.
Coordinator local tests12/12 and syntax pass, including exact-owned cleanup,
lost-ACK reconciliation, schema-only parsing and a killed exact-CID omission.
No runtime was created or SQL applied by this preparation.

Before execution: capture current schema-only bytes and corresponding current
Realtime numeric migration versions, and supply a finite in-network SDK/hook
driver. It must use fresh QA identities and actual producers, ordinary JWTs and
current/old product hooks; no expired R5/330 cohort, giant per-request metadata
guard loop, production rows/mounts/secrets or provider side effects. The prepared
internal network has no exposed host ports, read-only services, random QA-only
secrets, fixed deadlines and exact labelled CID cleanup in `finally`.

The existing executor lacks read actions/observability and latches CLOSED;
extend that test boundary minimally before claiming same-document reconnect or
hook read reconciliation. Do not relabel a remount, manual claims, source tests
or this preparation as completed override/provider/physical acceptance.
