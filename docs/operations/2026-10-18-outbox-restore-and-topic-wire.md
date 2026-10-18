# Persistent Outbox Order And Topic Transport

## Current Resume

Owner: Codex; stage: item52 restore FIFO fix and item77 live transport acceptance.
Source baseline: `c92e408075f3dc696363c0e4cfcdda11ecf02992`. Web readable previews
and Android0.1.22/build23 remain accepted; do not repeat their unchanged matrix.
Topic runtime is still OFF. The current live wire probe is accepted, not the
child-override compatibility/provider/OS matrix. Next: complete the narrow
outbox review/release and fresh isolated Topic override acceptance.

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

The review finding is repaired and affected source checks pass. Build and
deployment are pending. Android0.1.23/build24 is prepared; Android23 is immutable
and must not be overwritten. Physical/package/public acceptance remains separate.
