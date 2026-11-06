# Task3: Mixed Album Viewer

## Resume

- Owner: Codex, Task3 of the 12-stream production completion plan.
- Stage: viewer, path-only poster admission and both metadata ownership
  boundaries verified locally; no release or device action.
- Source: exact `main` baseline `2e1c3afc8a260c73690890144a976de472fbdb03`
  in detached `.worktrees/task3-album-2e1c3afc`, with the retained viewer fix,
  the admission patch, the caller fence and local browser fixtures. The
  scoped baseline paths were unchanged when main advanced.
- Blockers: isolated signed-device fixture and authorized device window.
  Next: hand the locally verified patch to the coordinator for integration;
  run the device matrix only in isolated QA.

## Baseline And Change

The existing [album fixture](../../tests/e2e/media-album-display.spec.ts)
already covers tile identity/order, photo preview fallback, and direct opening
of a video tile. Its video response is deliberately 404, so that test does not
prove stepping across a decoded video. The mosaic uses album pick order;
the [conversation viewer](../../artifacts/kub/src/lib/conversationMedia.ts)
uses the loaded chat's chronological media order, including beyond an album.
The unread boundary can split a mosaic by design. Neither contract changed.

Reuse [album and photo-quality QA](2026-09-25-media-album-hd-qa.md),
[send/retry consumer evidence](2026-11-05-media-send-consumer.md) and
[released AAC compatibility](2026-11-05-video-pcm-fallback.md). New photo
send defaults to HD, stored SD is retained, and explicit original is separate.
The video quality ladder starts at 720p when offered, otherwise source.
The baseline preview/known-small inline policy and accepted single-photo
cold/save workflow were not replayed.

On Chromium mobile 390, a trusted touch swipe crossed photo -> video
(`2 из 3`). Repeating it on the video image above the native controls delivered
`pointerdown:VIDEO, pointercancel:VIDEO`; the viewer never received the
`pointerup` needed for the next step. The baseline video stage allowed browser
horizontal panning, unlike the photo stage. In
[MediaViewer.tsx](../../artifacts/kub/src/components/chat/MediaViewer.tsx),
only the stage for a video with a sequence now reserves horizontal gestures
using `touch-pan-y`. Photo zoom, standalone video, playback defaults, and
the shared step/order logic are unchanged.

## Fixture Evidence

[Mounted integration spec](../../tests/e2e/task3-mixed-album-viewer.spec.ts):
existing chat fixture, three fictional signed-only tiles, real synthetic AVC
MP4 recorded by Chromium, and controlled preview/variant routes. The fixture
advertises large originals; it does not measure multi-megabyte transfer.

- Chromium 1440 and 390, Windows Playwright WebKit 390: one three-tile group,
  two photo previews and the video poster, no inline video, no original byte
  request before open, no public-object request, no message insertion.
  Position traverses `1 из 3` -> `2 из 3` -> `3 из 3` -> `2 из 3`.
- Chromium confirms AVC video dimensions and no autoplay; mobile uses CDP touch
  on the real photo stage and then on the real video. Desktop and WebKit use
  the visible navigation buttons. WebKit mounts paused controls and requests
  the signed bytes; decoding was not established for the synthetic clip.
- Inspected Chromium mosaic and viewer screenshots at 1440 and 390 in dark and
  light themes (fictional data only). Client typecheck and scoped diff check pass.
- Mutation `KUB_TASK3_MUTATE_SWIPE=1` on Chromium mobile 390 replaces only
  `touch-pan-y` with `touch-auto` in the Vite response, checks that response
  reached the browser, and fails on the same `pointercancel` / `2 из 3` as the
  pristine source. No source file is changed by the mutation run.

Run the spec with `KUB_QA_ALLOW_MUTATIONS=0`, `KUB_BASE_URL` pointing to a
loopback Vite fixture server as in [CLAUDE.md](../../CLAUDE.md#5-validation-commands-for-the-current-task)
and `VITE_MEDIA_SIGNED_URLS=signed-only` on the server. Use
`pnpm.cmd exec playwright test tests/e2e/task3-mixed-album-viewer.spec.ts`
with `chromium-desktop-1440`, `chromium-mobile-390`, or `webkit-mobile-390`.
Only opt in to captures on this fictional fixture (`KUB_TASK3_CAPTURE=1`;
`KUB_TASK3_LIGHT=1` selects light). The spec blocks service workers and keeps
automatic screenshots, traces, and video off.

## Path-Only Poster Admission

Baseline `KUB_TASK3_PATH_ONLY_VIDEO=1`: three tiles, no video poster and
zero `media_variants` GETs. The shared
[variant admission filter](../../artifacts/kub/src/lib/messageVariantRefresh.ts)
required `Boolean(message.media_url)` for both query IDs and expected kinds.
It now also accepts the canonical `messageMediaObjectRef` when there is no
legacy URL. That pure helper trims the bucket and path, removes leading path
slashes and rejects an empty bucket or path without inventing a bucket.
This is a presence check on the message's existing object reference, not an
authorization check. Legacy URL admission and deleted, temporary, nonvisual
row exclusion are unchanged. No URL construction, signing, Storage policy,
RLS, worker, caller, or viewer code changed in the admission patch itself.

- [Focused polling tests](../../tests/unit/message-variant-poll.test.mts):
  pristine RED returned no IDs for normalized path-only media; GREEN includes
  the deduplicated query IDs and literal poster/720p and image kinds. Missing
  and empty refs, deleted rows, temporary IDs and files stay excluded.
  A process-local mutation replacing the helper with raw bucket/path
  truthiness admits the blank bucket and slash-only path; the test fails.
- The existing mounted mixed-album spec is GREEN with
  `KUB_TASK3_PATH_ONLY_VIDEO=1`: Chromium 1440/390 and Windows WebKit 390
  (3/3). Actual mocked variant GET and signed poster bytes, no public or eager
  original byte GET, and the retained viewer navigation pass. Chromium's
  1440/390 light run also passed (2/2); inspected the rendered path-only
  poster in both themes. WebKit video decode remains unproven.
- `node --test` for `message-variant-poll`, `media-object-ref`,
  `media-url-mode`, `signed-media-url-store`, and
  `mounted-signed-media-renewal` passed 98/98. Includes pre-reset signer
  response rejection, account switch, and no public fallback on refusal.
  Client typecheck passed. No live or device case ran.

### Retired Owner Boundary

A held `media_variants` GET is not the same as a held signer response.
The local probe `tests/e2e/task3-retired-variant-owner.probe.spec.ts` in the
detached QA tree switches chats, advances the mocked signing generation,
then releases the old GET. A fresh poster-sign POST still reaches the
fixture (which returns 403): RED for both legacy and path-only rows, and RED
with the old gate restored in the browser response. The old video is no
longer mounted, and the probe issued no successful signature. This proves a
stale request, not disclosure or live authorization behavior. The existing
signer generation guard protects already started signing, not this new
demand from stale metadata.

In the authorized caller follow-up,
[useMediaVariants.ts](../../artifacts/kub/src/hooks/useMediaVariants.ts)
now captures the requested batch and signing generation. After the GET and
before storing or projecting its rows, it requires a live subscribed entry,
the same batch, and the same generation. Projection is the point that can
enqueue a new signature. The existing `finally` still drains the request and
schedules a queued batch; the focus retry, URL modes and signing/RLS contracts
are unchanged.

- [Mounted owner regression](../../tests/unit/mounted-message-variant-owner.test.mts)
  compiles the real hook, React, Supabase client and signer with esbuild and
  executes them in Chromium against intercepted fixture endpoints. Three
  cases: retired different chat (legacy URL), replaced same-chat batch, and
  signing generation advanced with the same chat and message ID. The old GET
  returns HTTP 200 and its old row, finishes, and reaches the hook's
  `finally`. Before the fence each case requested the old poster; after it,
  only the current poster is signed and projected. The latter two cases
  exercise the coalesced reload and the existing focus retry respectively.
- Each in-memory mutation (`KUB_TASK3_VARIANT_OWNER_MUTANT=entry`, `batch`,
  or `generation`) returned the old-signing RED in its matching case. Without
  mutants, the owner, variant poll, signed URL store, and URL mode tests
  passed 42/42. The existing path-only mixed-album integration also passed
  3/3 on Chromium 1440/390 and Windows WebKit 390 with the fence present.
  Client typecheck passed. This verifies the held-GET boundary, not live
  authorization, installed shells, or a release.

### Settled Rows And Renewal

Review found a second path in the same cache. A signing reset advances the
generation and emits synchronously; the renewal subscriber used to reproject
the last successful GET and ask for its old path under the new generation.
Changing IDs likewise left the old batch available to reproject until the
replacement GET answered. This was independent of the post-await check.

The entry now owns a signing generation. Rotation clears the accepted rows,
published URLs and polling settlement before any reprojection; a still
mounted entry requests fresh metadata through the existing scheduler. On
batch changes, the cache keeps only the intersection, without reprojecting
during the change. The hook also selects current IDs during render, before
its effect updates the cache. An overlapping visible ID keeps its existing
URL and remains eligible for ordinary renewal in the same generation.

- The compiled Chromium regression first settles and signs the original
  metadata, then holds the fresh GET. Before the fix, rotation requested
  the old path again; a changed batch renewed the removed path and still
  projected its URL. After the fix, rotation publishes an empty map and
  makes zero old sign requests, even when the same message ID remains
  mounted. The batch keeps and renews the overlapping URL while the removed
  ID is absent even from intermediate renders. Fresh metadata subsequently
  signs and projects; a later 48-minute renewal replaces its URL without
  a metadata GET.
- Four in-memory mutations independently reintroduced old generation
  signing, removed-row signing, and non-neutral output for rotation or batch
  changes. The focused and related suites passed 44/44; path-only mixed-album
  integration passed 3/3 on Chromium 1440/390 and Windows WebKit 390.
  The prior held-GET controls, client typecheck and scoped diff checks pass.
  No signer, URL mode, authority, RLS or Storage policy changed.

## Remaining No-Production QA

Use a private disposable QA backend with two owned accounts and real private
Storage signing, one chat, and synthetic files: a JPEG original over 1 MiB,
an AVC MP4 with AAC-LC mono 48 kHz and a nonzero audio offset, and a second
small JPEG. Supply exact input hashes and expected rendition dimensions.
Gate startup on the exact app commit/bundle and isolated backend; do not use
production configuration, a personal account, or an install over release.

| Target | Missing proof |
| --- | --- |
| Signed Android Capacitor QA build on Realme | Select/edit in the installed WebView; refuse one upload once in QA, retry, and verify pick order/identity, one caption and exact uploaded rendition. Receive as the other account; verify poster-only before open, photo -> video -> photo touch, play/seek without stepping, and reopen/hash the file from the actual Android export destination. |
| iPhone Home Screen PWA, separately | With the same controlled media, prove the codec/editor decision on that engine, both tracks after trim when supported, paused open and touch/seek behavior, photo share and video download through the actual OS destination. Record unsupported behavior explicitly; Windows WebKit and Android are not Apple evidence. |

Track only fixture IDs, result counts, formats/dimensions and hashes. Compare
saved bytes to the uploaded rendition, not the input if it was re-encoded.
Remove only the owned QA records/files/sessions, and do not repeat the already
accepted single-photo cold/cache cohort. No production, release, or device
effects were performed in this slice.
