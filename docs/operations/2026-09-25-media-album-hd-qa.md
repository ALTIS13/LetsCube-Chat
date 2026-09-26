# Media albums and photo resolution, 2026-09-25

Owner: shared web/Windows/Android stream. Stage: web deployed. The iPhone PWA
viewport fix belongs to the separate iOS/MacOS task.

## Changed

- A single selection of 2-10 photos/videos carries a stable album ID, index and
  count in each visual message's existing `media_metadata`. No database schema or
  storage policy changed. Individual message IDs, replies, reactions, read
  states and retry paths remain addressable.
- The attachment sheet still allows at most 10 files per send. The send helper
  defensively partitions longer queues into groups of 10, and a document or an
  existing failed-album retry separates fresh visual runs without discarding
  their grouping. This does not raise the sheet's user-visible limit.
- Selected gallery items can be moved earlier or later before sending. Number
  badges and the transmitted album order update together; the gallery's source
  order is unchanged.
- Adjacent visible items from the same sender, chat and album render as one
  responsive mosaic. A deleted, failed, hidden or missing item cannot pull in
  unrelated messages. An out-of-order retry returns to its pick position.
- A new device starts photo sends in HD. A stored SD preference is retained;
  blocked/unreadable preference storage falls back to SD. HD re-encodes the photo;
  sending the untouched original remains a separate explicit action. Video
  resolution settings are unchanged.
- Shared-media and link lists now fail closed if the per-user hidden-message
  lookup fails, and expose a retry without advancing pagination.
- Failed album previews fall back to the original only when its known size is
  small enough for inline loading. Large originals remain tap-to-open; in
  signed-only mode the fallback uses the signed original, never a public URL.
  The mosaic has a group label for assistive technology.

## Evidence

- Focused unit tests: 30 passed for album grouping/metadata, send quality and
  compression boundaries.
- Chromium desktop 1440, Chromium mobile 390 and WebKit mobile 390 fixture
  matrix: 116 passed, 6 signed-only scenarios skipped on the ordinary fixture
  server, and one WebKit reload fixture failed because its service worker
  bypassed mocked routes. After blocking the service worker for that mocked
  suite, all 16 WebKit attach-sheet cases passed. The 6 signed-only scenarios
  passed separately with signed media mode enabled.
- Whole-workspace typecheck and build passed after supplying `PORT` and
  `BASE_PATH`, which the unrelated mockup-sandbox build configuration requires.
  Initial build without them stopped there; it did not report a messenger error.
- Synthetic screenshots inspected for mobile/desktop dark/light mosaics. These
  fixtures do not establish physical-device or authenticated production behavior.
- Commit `d86eea8f187fd0cc5cd679199bce2e2b072a125b` was pushed to
  `main`. The live web container's image tag matched that SHA; public HTML and
  its entry JS both returned HTTP 200, and the served JS contained the album
  and HD interface markers. This proves the web rollout, not native acceptance.
- Commit `73f8f3a4` for mixed-queue album sends was pushed and its web image
  tag observed in production. A preview-failure regression was first observed
  failing, then passed on desktop Chromium, mobile Chromium and mobile WebKit.
  Signed-only fallback and existing signed-only album checks passed on desktop
  Chromium and mobile WebKit. Client typecheck and production build passed.
- 2026-09-26: selection-order unit tests passed (18/18). The full attachment
  sheet matrix passed (68/68) on desktop Chromium 1440, mobile Chromium 360/390
  and mobile WebKit 390. Its new test checks both numbered tiles and the bytes
  uploaded in album order. Dark/light desktop/mobile fixture screenshots were
  inspected. Workspace typecheck and client production build passed. This is
  fixture/browser evidence, not native or production acceptance.

## Remaining

- Inserts remain individual. Album-level external push aggregation and atomic
  group insertion need separate backend work. The pre-send mosaic preview was
  subsequently shipped; see the current checkpoint in `docs/HANDOVER.md`.
- Android 0.1.11/build 12 embeds an older web bundle. This web deploy does not
  update the installed APK; the next signed cut needs separate owner instruction,
  real Android gallery/album QA and artifact verification.
- Private media cache/download policy and authenticated physical save/open tests
  remain open. The built web index chunk is still about 3.3 MB before gzip, so
  startup/load profiling and code splitting are still worthwhile.
- The two iPhone screenshots were handed to the separate iOS/MacOS task: bottom
  composer clipping/black gap without a keyboard, and status bar overlap plus
  clipped composer with the keyboard. Its source fix is separate; physical iPhone
  acceptance is not established here.
