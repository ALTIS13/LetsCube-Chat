# Tester-priority continuation, 2026-10-15

## Current Scope

Owner: coordinator. The owner's direct continuation prioritizes the selected
Nikita-to-owner conversation over the unfinished native-preview diagnostics.
Do not replay those diagnostics, renew old artifact age, or infer native release
acceptance from this web work. The before-state was reverified as `c2e1397e`;
the narrow `dc5a7c70` web rollout was accepted at 11:51 UTC below.

## Read-only Intake

One repeatable-read, read-only query of the previously selected private
conversation returned 19 new rows, no edited rows: 13 text, five images and one
video, from 2026-10-08 16:40 UTC through 2026-10-15 10:41 UTC. The authenticated
selection/membership control passed; neither bound was reached. No new voice
messages were present. Source IDs, timestamps with full precision, message
bodies, URLs and downloaded media remain in ignored private storage only.

The five images and video were downloaded once from the existing exact Storage
origin without credentials, redirects or renewed links. Local Windows OCR ran
on the five images; no originals, recognized text or personal pixels were
printed. Download/OCR success does not establish a defect's meaning. The video
has not been semantically reviewed. No paid rental minutes were used.

A single offline text-summary run completed, but its schema validation failed.
Only six source-fragment-grounded, privacy-filtered draft summaries were retained;
they are not a complete or semantically accepted transcription. Deterministic
concept checks corroborate the categories below, not their causes. Five rejected
drafts and the media remain an explicit intake gap, not silently discarded work.

| Priority | Private source alias | Safe paraphrase / action | Evidence boundary |
| --- | --- | --- | --- |
| P1 | T7, T9; T6 category corroboration | Switching and opening chats reportedly takes too long. Extend item 87 with a concrete warm-reopen request/render measurement. | Client, build, timings and causal mechanism not established. |
| P1 | T4 | Chats reportedly fail to open while a VPN is active. Test request cancellation, timeout and recovery without altering the owner's connectivity. | Do not diagnose a provider, routing or VPN failure from this report. |
| P2 | T10 | Lock-screen notifications reportedly lack message text. Link to D-335's preview and privacy work. | Do not enable dormant rich-preview/native gates or infer permission to reveal content. |
| Context | T8 | Tester suspects missing caching. | Hypothesis only: cached history already exists in `useMessages`. |
| Positive | T3 | Tester reports normal behavior on iPhone in that message. | Not general installed-PWA/device acceptance or closure of older iOS issues. |

Image OCR also detects task/loading vocabulary in two images. It does not prove
that these are task defects, nor which operation is slow. Existing items 84-87
stay open; the older microphone/read-notification reports are not closed by a
separately reproduced race.

## Concrete Source Findings

These findings were reproduced against compiled application code independently
of attribution to the tester's delays:

1. Active-chat Realtime UPDATE captures a whole message array before a hidden-ID
   await, then writes it back over newer inserts, edits or tombstones. Initial
   four RED cases and two ownership controls; latest-array/target admission fix
   passes 26/26, including literal revision and omission controls. Independent
   source review found no P1/P2. The same 26 pass after the warm-read change.
2. A signing response timestamps the URL after the network await, extending its
   apparent validity by the request delay. One expired-response RED with normal
   renewal/account-retirement controls; conservative request-start clock and
   bounded delayed-offer cooldown are implemented.
3. Avatar cache-buster tokens drop timestamp fractions, so two revisions in the
   same second share a URL. Compiled RED and whole-second control;
   UTC-normalized fractions now remain in the revision key.
4. Removing a currently playing voice message from a registered playlist does
   not retire the retained player item. Compiled RED plus leave-chat/explicit-close
   controls. Follow-up must act on an authoritative deletion/access retirement,
   not absence from a partial or paginated playlist.
5. Background history reconciliation repeats a hidden-ID query even when the
   complete fetched/held/reply ID set remains verified by the live channel.
   One behavioral RED/new-ID control; synchronous trusted reuse now passes 28/28,
   including 13 omission variants and lost/rejoining/unhide/new-reply controls.
   Cached rows stay visible during the measured background wait: this is a
   request reduction, not proof of the tester's visible latency cause.

The signing/revision utilities pass 78/78 (23 new checks,55 affected adjacent
contracts). Independent source review found no P1/P2. Actual root kub typecheck
passes. These are separate source runs, not a browser/device or one aggregate
test invocation. No markup, layout, schema, provider policy or dependencies change.

Final warm-read independent review found no P1/P2 and verified that the complete
UPDATE repair was preserved byte-for-byte apart from the separate three-line
hidden-read decision. The main-based release tree passes actual kub typecheck
and production build: `sw.js build d7b01022a21882a7`, `built in 28.03s`.
Known sourcemap, static/dynamic import and bundle-size warnings remain. The
installed application/platform acceptance is not inferred from those checks.

## Synchronization And Cache Direction

Keep one canonical, account/session-owned projection per chat/topic. Apply a
completed asynchronous read to the latest projection, not its pre-await array;
preserve explicit removals and newer revisions. Distinguish message identity
from revision identity, and preserve fractional revision precision.

Warm reopening should reuse verified held history immediately where its
ownership/access evidence is still valid, coalesce duplicate reads and reconcile
in the background. Required hidden-message, membership and clear-history checks
must not be bypassed to improve a timing number. Measure the actual wait before
adding persistence or another cache. Offline content is not proof of current
access. A reconnect gap requires authoritative reconciliation, not blind append
or repeated full-history downloads.

Use immutable object references/revision keys for cache identity and SHA-256 for
artifact integrity or an actual changed upload, not rehashing all media whenever
a chat opens. Never share account-scoped cache admission across users. Keep
signed URLs disposable credentials with conservative validity, not object IDs.

Protocol reference checked 2026-10-15: Telegram documents ordered update state,
duplicate/gap handling and difference recovery in
[Working with Updates](https://core.telegram.org/api/updates). This supports the
ordering/reconciliation direction; it is not evidence of Telegram's native UI
timings or a claim that LETSCUBE implements Telegram's protocol.

## Next Acceptance

Review the narrow source repairs, run their literal regression/omission controls
and affected adjacent contracts, typecheck and build the main-based release
tree. Promote only owned changes, preserving the sidebar/search dirty files and
private Android version overlay. Before pushing, inspect the complete outgoing
range and its own-tree aliases. Verify the running image, old/new content markers,
public/container JS and SW parity, previous rollback entry/image and anonymous
non-mutating smoke. Native bundled clients require their own later rebuild and
acceptance; shared source alone does not update an installed APK.

## Actual Web Rollout

Narrow main commit `dc5a7c70610f4b8c8348c1cdf25f962093560ba0` contains only
three product files, three new regression files and two documentation files.
The complete outgoing range was inspected separately; all29 `@/` imports in
its own source tree resolve. Reviewed product/test bytes match the feature tree.
Independent review accepted both hook deltas and the media utilities. No dormant
native-preview source, schema, package identity or unowned search work shipped.

Before-state actual readback11:37:58UTC: healthy container `b557a2c7e939`,
`c2e1397e`, old/new UPDATE consumer1/0. After-state actual readback11:51:15UTC:
healthy container `360d020b6414`, exact target image tag `dc5a7c70`, image ID
`sha256:8907f34fcee9b379e7c787e5da021adc5227688ed5a2bc62745eadd2991efb9b`.
The compiled UPDATE consumer is old0/new1, calibrated against both actual
retained old production JS and the actual main build before publication.

Public `/assets/index-DtMGWmfG.js` SHA256
`07df13e37033135c63ac01045c246e6a94b89370e5a3696e22eb919ee413c66f` and
`/sw.js` SHA256
`d97f52ab5afe92857fcf68da2eb8e0dfe2ee9f7cc14e8e71330d84c302688a1b`
match container bytes. Previous image and `/assets/index-CX3KnNFa.js` remain
available and byte-identical for rollback. Coolify completion alone was not the
acceptance criterion. Local/public build hashes differ with public configuration;
the exact image and structural consumer plus public/container parity establish
the delivered source boundary.

Fresh anonymous Chromium home-to-login smoke11:51:34UTC loads the new entry:
zero page errors, zero mutation attempts, no personal session, captures or login
submission. No DB write, real-user send, physical latency, installed PWA, Windows
runtime or new Android artifact acceptance is claimed. The existing private
Android version overlay remains unchanged; an installed APK needs a separate
current-source candidate and affected QA before publication.

## Next Network Finding, Not Included In This Release

The VPN/opening report prompted a bounded read-only transport audit, not a VPN
configuration change. `createDeadlineFetch` already supplies whole-request
deadlines before headers. However, it calls `settle()` when the Response arrives,
before the SDK consumes its finite JSON/text body. This removes the deadline,
network-cut registration and forwarded caller-abort listener too early.

One actual0.29s offline invocation compiles the unmodified wrapper and request
rules, uses native Response/ReadableStream/AbortController and controlled transport/
clock boundaries. Five complete/pre-header/caller/native-abort controls pass;
three separately created body readers remain pending after their deadline,
network-change cut or caller cancellation. Every stalled stream is explicitly
errored/settled during cleanup. An exit0 audit means these observations were
calibrated, NOT that the product is fixed. No HTTP or accepted-suite rerun.

D-362/item101 is the next P1 source slice. Inspect real SDK parsing and limit the
repair to finite read completion with the original clock and current owner.
Preserve Response/stream metadata, EOF/error/cancel cleanup, Auth retry/session
behavior, non-idempotent write safety and long Storage transfers. No speculative
Response proxy, blanket buffering, arbitrary size cap or network alteration was
implemented. The live `dc5a7c70` release remains the four accepted repairs above;
this finding is not an established cause of Nikita's particular VPN symptom.

## Later Intake And Current-Client Boundary

The already acquired video received one local six-frame extraction/OCR pass:
12.616667 seconds, 720x1568, six completed OCR calls, no known static error-label
match. One separate offline medium/int8/VAD pass on its audio produced zero
speech segments. This does not establish what the video demonstrates or close
its semantics. No raw pixels/text/audio were printed, uploaded or downloaded again.
Image semantic drafts still fail schema/coverage admission and remain unaccepted.

One immutable main-source 390/dark unread-opening case now passes, separately from
the earlier warm4/recovery1. It confirms that the unread wait intentionally
preserves the first-unread anchor; removing the spinner blindly would violate
the chat-entry contract. Current Android 0.1.20/build21 is artifact-verified only,
not installed/published. Device/VPN timing and full media semantics remain open.
[Actual results, artifact and limits](2026-10-15-current-client-android.md).
