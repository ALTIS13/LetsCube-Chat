# Notification ownership and activation, 2026-10-05

Owner: shared web/backend/Windows/Android coordinator. Parent: item76/D-335.
Baseline web: `1f864a39`; candidate branch: `codex/bot-inline-media-20261002`.
These are adjacent activation/history repairs, not a claim that native previews
or the tester's unspecified missing-alert report are fixed.

## Measured cause

`usePush.ts` called the real `safeOpenChat` without an action-generation guard,
then scheduled a150ms message jump without checking account or current view.
Two card clicks could finish access reads out of order. A completed click could
still emit its jump after logout, return to the same account, manual navigation
or a newer notification target. Existing chat access checks remain authoritative;
this defect is ownership of their asynchronous result, not an RLS bypass.

Actual-source unit cases initially reproduced7 failures out of11, with4 positive
controls. A separate manual-selection-during-access case also failed before its
guard. One initial canonical-route expectation was corrected from a query URL
to the existing `/chat/<chat>/m/<message>` contract before counting those results.

Windows added two measured failures: a delayed bridge read/window restore could
reverse emitted click order, and retiring the hook/account discarded ownership
without removing its successful native cards. The original hook failed7 of8
controlled ownership cases; a hook-local queue failed two real React remount
cases. The actual adapter failed8 of12 ordering/disposal controls. Synthetic
bridge ACK/history is evidence for JS ordering, not Windows OS receipt behavior.

Coordinator follow-up reproduced two additional failures when React batches
logout/return into the same user-id snapshot. A separate accountEpoch selector
now triggers retirement; the immediate delivery/read-removal boundaries compare
the captured epoch before React commits. The pre-commit control models an advanced
authority snapshot, not a measured OS event.

Independent review refused two P2s before deployment: concurrent destructive
`take()` reads could discard the latest native slot, and unmount during async
registration lost the eventual disposer (the latter also existed on baseline).
The first test fixture let the event read consume the slot too early; after
controlling both read completions it reproduced the actual missing restore.
Native reads now serialize and retain a consumed non-null route until the latest
queued read, which may be empty. Registration returns a disposer without waiting
for startup I/O; the hook refuses cancelled callbacks and disposes late arrivals.
Default single-slot and ordinary cold-start controls plus compiled omissions
cover the repair. No native IPC contract changed.

The next review found the same destructive-read race across two registrations:
a retired in-flight reader could consume the successor's target. It reproduced
RED on the real adapter, then passed with a module-level read chain, retained
route and registration owner. A compiled omission is refused. One newly typed
expected URL omitted a UUID segment; it was corrected to the established literal
before accepting GREEN (the earlier missing-restore RED remains valid).

The real access helper also treated SQLSTATE42501 (explicit permission refusal)
as transient. A cached-chat test reproduced selection/route/jump instead of an
unavailable alert. That code now refuses access; ordinary network errors still
permit an already-visible cached chat, never an unknown chat.

## Activation repair / verification

- Capture the existing store's `accountEpoch` and recipient, plus the latest
  accepted target revision. Pass the guard through `safeOpenChat`.
- While access/hydration waits, chat/topic transitions (including a manual round
  trip) or a changed address cancel the older action. Transient watchers are
  released on completion, replacement and rejection.
- After access succeeds, only the still-owned selected chat may navigate.
  The delayed jump additionally requires the same canonical path/query/hash.
- Keep the150ms entry handshake, base path/hash, denied-access handling and
  authenticated cold-start queue. No new production helper or dependency.
- Windows stamps ownership at the emitted event, before route reads and window
  restoration; only the latest live action may navigate. Disposed listeners and
  a failed restore cannot reopen an old target. Cold pending routes still work.
- Windows sends/removals share a queue per native identity across React remounts.
  Successful ACKs retain owner/row identity until a confirmed removal. Retirement
  cleans late old-owner sends without deleting the replacement owner's card;
  failed removals retain identifiers for a later transition/retry. Read and
  five-card retention cleanup use the same queue. Legacy iconless retry remains.
-97 focused actual-source cases pass, including30 compiled mutations refused
  by independent literal oracles: activation30, access14, Windows ordering24
  and actual React/adapter ownership29. The real access/hydration code runs
  against a fictional network boundary, not a no-op replacement.
-46 adjacent cases pass for existing adapter/browser presentation, read sync,
  FCM/WNS account-redaction and native read cleanup. The existing module warning is
  informational; no package metadata change was made just to silence it.
-12 actual service-worker-message-handler browser cases pass: Chromium1440/390
  and WebKit390. They cover an exact-message target, reverse completion of two
  cards, the real store's logout/same-account epoch transition and manual chat
  round trip. Held-response cases await actual request completion before their
  postcondition, rather than assuming a route fulfill ended the client request.
  Each uses a
  fictional localhost backend, aborts external hosts, enforces
  `KUB_QA_ALLOW_MUTATIONS=0` and has screenshots/traces/video disabled.
  All12 report0 page errors. After the epoch delta only the three affected
  logout/return cases are repeated, all passing; the other nine inputs are
  unchanged. This is browser routing, not a real system-card tap.

The module ledger does not survive a hard WebView/document reload and has no
persisted/native owner CAS. Refused native removal can leave a card until retry.
These are explicit remaining boundaries, not claims of completed WNS/native QA.
No visible styling changed, so the accepted both-theme layout evidence was not
repeated for an unrelated visual audit. Initial typecheck/build completed;
the final cross-registration delta passes refreshed typecheck0 and production
build `sw.js build1df98f4cb632f812`, `built in11.85s`. Independent final review
has no open P1/P2; its scoped remount test and six additional controlled probes
pass. Existing sourcemap, dynamic-import and large-chunk warnings are
not hidden by metadata churn. Accepted unchanged cases are reused, not rerun.

## Native preview boundary

MobileNext's local inventory and an explicit read-only ADB package query identify
the available Realme RMX3830, Android15, LETSCUBE0.1.11/build12, with
`POST_NOTIFICATIONS` granted. No conversations, screen, notification contents,
tokens or personal accounts were read. No APK installed, signed or published;
A063 was not used. Inventory proves a connection and package metadata, not FCM
delivery, channel/lock-screen settings or a physical card acceptance.

Current FCM and WNS source intentionally sends generic native text. Android's
data-only presenter draws that text; the Windows live-app adapter can already
draw authenticated in-app sender/context, which is a different delivery path.
The native receiver has no independent preview setting or authenticated
message-projection fetch. Existing voice receipt binding is not a message
preview permission and must not silently become one.

The next native stage must establish a separate recipient/session-bound display
contract: generic wake signal and safe fallback, authorized projection obtained
only by the currently authenticated recipient, fresh access/unread/block/mute/
DND checks, preview opt-in and OS privacy. After a fetch, recheck the native
binding before updating a card; invalidation/logout must retire owned cards.
Do not transmit old-account personal preview text merely because enqueue or
provider acceptance passed. Preserve exact message routing, chat-scoped cleanup
and older-client fallback. Legacy and killed-process acceptance are separate.

[Firebase's Android receive contract](https://firebase.google.com/docs/cloud-messaging/android/receive-messages)
distinguishes data delivery from automatic background notification display and
recommends a lifecycle-managed worker for longer processing. Accordingly, do
not perform an unbounded network/image fetch in `onMessageReceived` or assume
that a browser handler is a killed-process native implementation.

## Release gate

No SQL, Edge, worker, Gateway or native package change. Reuse the verified
`automated/20261005-035146` backup's15 checksum/readable-archive evidence: its
manifest timestamp is unchanged, age42533seconds at the preflight. Live PG17.6
identity was read-only; rollback image is the healthy exact `1f864a39` web image,
with61.99GB build headroom. Final source review/typecheck/build and the committed
own-tree import guard must finish before any main push. Then require one exact
healthy runtime, calibrated old/new activation markers, retained old entry and
a fresh anonymous mounted/login check. The initial public marker accidentally
matched the unrelated direct-navigation branch; restricting it to the actual
timer callback calibrated all three baseline guards absent. No marker was
weakened to fabricate acceptance.

Source review/build gates are accepted; release outcome is still pending
in this record. No production SQL or package identity change is required.
D-335 remains open for account-authenticated native context and real-device
preview/delivery/lock-screen acceptance; do not repeat accepted contact/sound
or unrelated PG17/full-suite/device checks.
