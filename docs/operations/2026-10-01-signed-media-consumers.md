# D-208 Signed Media Consumer Acceptance

Owner: Codex coordinator, with Hilbert (actual ChatAvatar and history review)
and Goodall (mounted renewal/playback). Baseline: `e92f0e86` on `main`.
This is a shared-web slice, not an Android/Windows release or a private-bucket
activation. Android build/install/publication remains on hold.

## Observed Failures

- A FILE with `media_bucket`/`media_path` but no legacy `media_url` was not drawn
  by the actual MessageBubble. A successfully signed URL did not repair that
  renderer guard.
- Refused FILE signing left an endless spinner. An initial error-label patch
  grew the row by 10.65625px; the final label replaces the second line rather
  than adding a third one.
- WebKit did not return focus to the file button after closing its viewer.
  Its click does not reliably make that button `document.activeElement`, so the
  viewer now receives its explicit opener and restores focus without scrolling.
- Ordinary background history verification invalidated an already-verified
  active conversation when the three-second membership cache aged out. Runtime
  instrumentation proved that MessageList and its FILE viewer unmounted while
  the app shell stayed mounted; there was no close, resize or scroll event.
- A late history response from an old topic could modify the current topic
  before its replacement read began. Account and generation guards alone did
  not cover that interval; the post-await guard now checks the topic too.
- Mounted signed sources did not renew themselves without another render.
  Playback recovery also lost the prior playing state, and the download expiry
  floor unloaded an engaged element during an offline interval.
- Replacing the attachment on the same message could keep the previous audio,
  regular-video or video-circle player mounted while the new object was pending.
  The component had no stable object-identity key at these three call sites.

## Implemented Boundaries

FILE recognizes an object reference without a legacy URL. A final refusal says
`Файл недоступен`, stops the spinner and disables activation without a public
fallback. Signed preview/download keeps the filename and exact synthetic bytes.

A verified active conversation stays mounted while a background read is pending.
Reopening or changing accounts still waits for its privacy boundary. A changed
clear watermark invalidates the view before the next awaited query. Request-local
verification requirements survive the pending interval, so membership/history/
hidden-ID refusal and exceptions still close unverified history.

One store-owned browser clock, with visibility/online/focus/pageshow recovery,
prompts mounted snapshots to read current addresses. It signs only read objects,
uses their own issuance boundaries and stops when the final subscriber leaves.
A keyed cache lookup distinguishes expiry from actual refusal/account clearing.
Buffered engaged playback keeps its old address on same-object renewal/offline;
error recovery takes the fresh address and restores position and playing state.
Audio/video players are keyed by persisted bucket/path, or the original legacy
URL when that pair is absent. Replacing an object resets the old player; renewing
the signed address of the same object does not remount it.

## Evidence And Limits

Final local acceptance; publication receipt follows below:

- Actual ChatAvatar: 16/16 synthetic Chromium cases, 390/1440, both themes;
  signed `src/srcSet`, signed-original fallback and refusal monogram. All 16
  images inspected, zero public-object requests. Two omission controls were RED
  and restored GREEN. This is the actual consumer, not a variant helper alone.
- Mounted renewal: the first 19 browser-backed cases plus focused store tests. Literal
  48/55/60-minute boundaries, delayed/staggered issuance, offline/resume,
  idle/download, playing/paused audio/video, account/refusal revoke and cleanup.
  Thirteen omission controls rejected. A simulated expired Range error is fed
  into a real media element; this is not native cache-eviction proof.
- Actual MessageBubble: another 24 cases cover replacement identity, pending or
  refused replacement, blob/legacy/path/bucket changes and unchanged-object
  renewal/offline playback. Removing the keys fails at all three real call sites;
  seven omission controls reject the broken identity rules. The aggregate mounted
  run passed 43/43. An immediate HTTP-counter assertion at stopped virtual time
  was repaired to wait for the request while preserving the literal 48:00 check.
- Cleanup review added a test of the actual shortened 1234ms store timer after
  delayed issuance. Only the registered store callback is counted, not arbitrary
  React/browser timers. Cleanup/deadline/100-consumer checks passed 3/3; removing
  `clearTimeout` in memory fails, and restoring it passes. Production source did
  not change for this final test-only strengthening.
  The final full run includes all 44 mounted renewal/replacement/cleanup cases.
- FILE: the final frozen-source matrix passed 69/69 in Chromium desktop/mobile
  and WebKit mobile. Original path/refusal/focus/background failures and four
  omission controls were RED. Five active-history outcomes passed in both themes:
  unchanged, changed clear watermark, membership refusal, hidden-ID refusal and
  history refusal. Twelve final FILE/refusal/viewer images were inspected at
  390/1440 in both themes; refusal keeps the row height unchanged.
- Earlier FILE/history-privacy integration: 101 passed, four explicit skips.
  The late-previous-chat and clear-menu in-flight cases are desktop-only in their
  existing spec; all other selected cases ran across the three projects.
- Account/history focused unit run: 52/52, zero skips, including the new old-topic
  delayed success/refusal test and same-topic positive control.
- Real backend, read-only: member signing/HEAD 200, outsider refusal, short-link
  expiry 400 and renewed HEAD 200; two image variants and two avatar variants
  signed successfully. No personal bytes or screens were captured.
- A separate read-only FILE lookup found zero eligible non-author QA rows.
  Live FILE preview/download remains unaccepted; no production fixture was
  created to manufacture evidence.
- Fresh database read: `storage.buckets` still reports `media.public = true`.
  Signed-only synthetic tests do not make that bucket private, and production's
  existing `signed` canary still permits its compatibility fallback.

Final typecheck passed. Production build emitted `sw.js build e9d125114fb15ae8`
and `built in 18.76s`; its fixture flag was absent. The first full run had 4811
passes and eight skipped opt-in caption paint checks because its visual-server
variable was missing. Those checks then passed in a separate 20/20 run. This
is not reported as a zero-skip full run. The final frozen-source rerun, including
the strengthened test and both visual-server opt-ins, passed **4832/4832** with
zero failures, cancellations or skips. The repaired idle assertion still rejects
both omitted scheduling and a delayed renewal rule in fresh omission runs.
Source commit: `ebb93d6f17180d58790a5203f6aaf78927036ee5`.
No native builds, installs, native release changes, SQL/Edge changes,
cloud-device sessions or production message writes occurred.

## Web Publication, 2026-10-02

The two owned commits were reviewed as their own `origin/main..HEAD` step;
74 alias imports resolved against the commits' own trees. Candidate
`codex/signed-media-consumers-20261002` was pushed before `main`.
Coolify finished `c31ed22ffa787f160d1a39903bd345917ae7f0bb`, with exactly one
healthy replica running that image. The public entry is
`/assets/index-LbL6mooT.js`, SHA256
`7c5c98ab83c9041daf1fc7dfe42891e731db6b8ac743090c07eec06992802770`.
It contains the refusal and retained-signature markers absent from the baseline.
The retained `/assets/index-BCrQq7Yo.js` is byte-identical to its prestate and
still lacks those markers. Public entry and service worker hashes match the
running container's files. This verifies the rollout, not just its webhook.

Deployed read-only QA passed 4/4 without skips: signed chat-list avatar in
Chromium desktop/mobile and WebKit mobile, plus removal of a client-only signed
chat row after switching QA accounts in the same desktop page. Capture, trace,
video and Playwright's failure-context snapshot were off; output directories
contain only `.last-run.json`. These tests do not open a real conversation or
write messages. Contexts were closed; the account-switch test explicitly logs
the first account out. No installed PWA/native-device or long-session result is
claimed. The owned synthetic dev server and both source workers were stopped.

Rollback: revert only source commit `ebb93d6f` on a reviewed candidate, rerun
affected gates and verify the resulting web image/content before completing
the rollback. Do not remove the retained asset volume or change the bucket's
mode; neither database nor backend configuration changed in this slice.

## Remaining Acceptance

Do not close D-208 or flip the bucket on these tests alone. Required next proof:
an eligible real-member FILE and group-avatar consumer; actual deployed
long-session renewal and media seek; compatible installed Android acceptance
after the owner resumes Android;
then the separately controlled private-bucket switch with rollback. Keep
source/synthetic/deployed-browser/physical evidence distinct.
