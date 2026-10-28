# Media Quality Follow-Up - 2026-10-28

Owner: Task3 media sidecar. Stage: one source fix, focused verification complete.
Starting checkpoint: coordinator-supplied canonical `b115e903`; no Git operations.

## Reproduction And Fix

An applied gallery video edit replaces its File and sets `edited: true` in
`AttachSheet.tsx:469`. The full video pick reaches `useVideoSendLadder` at line
408. A compressed send calls `ladder.prepare` at line 583. Its File-to-video map
previously included edited picks, so an encodable lower rung could transcode the
already baked rendition again. This changes the bytes before upload and can add
another lossy generation; the separate prepared-photo path did not protect video.

`VideoSendPick` now carries optional `edited` provenance. Only `edited === true`
picks are excluded from the hook's governed selection, before metadata reads,
selection keys, codec probes, count, rungs, default and summary calculation. The
prepare callback also rejects edited picks defensively. Their exact baked File
stays in its original slot; ordinary unedited videos still use the existing
planner and encoder. An edited-only selection offers no quality slider. No codec,
editor, upload, retry, original-mode or DTO policy changed.

## Verification

Command, from canonical:

```powershell
node --test tests/unit/media-edited-album-quality.test.mts
```

- RED before the product change: both new cases failed on the extra edited-File
  encode and the changed File reaching the staged retry. The real rung and
  transcode planners admit the synthetic 1080p source at 480p.
- Integration-review RED: the initial prepare-only guard still advertised two
  governed videos for a mixed pair and one for an edited-only selection. Both
  projection cases failed before the governed-selection filter was added.
- GREEN after both parts of this one fix: 7/7 focused cases pass.
- Negative control: omit the guard from the loaded actual prepare callback.
  The baked File is encoded again while ordinary video encoding stays active.
- Actual caller wiring: execute the editor's replacement initializer, gallery
  video selection and hook call from `AttachSheet.tsx`, rather than assigning an
  invented test-only flag. The resulting baked pick retains `edited: true` and
  the exact File; the unedited pick and video-only order remain intact.
- The full hook's actual fact effect and count/stops/summary consumers run in a
  two-render source harness. Mixed selection governs only the unedited member;
  edited-only selection has zero governed members and no quality choice. A
  loaded filter-omission control restores the misleading count/rungs/summary.
- The mixed batch preserves baked File identity/bytes and a separately staged
  explicit-original PNG. At the upload port and DTO builder, retry retains the
  same File/client message ID, album ID/order/count and caption carrier. The
  original PNG remains uncompressed and has no fabricated quality label.

The source test executes actual caller expressions, the hook and its prepare callback,
and real staging, album, queue and DTO helpers. React scheduling, container facts,
codec IO and network boundaries are synthetic. It does not mount the attach UI,
claim pixel QA or execute ChatWindow staging, an authenticated send, real codec
output, receive/save or physical acceptance. Shared UI source was read, not edited.
Accepted album/native-photo/cold-cache baseline suites were not rerun. No builds,
Git, production, Auth, DB, remote or device operations were performed.

## Changed-Scope Mounted Validation

```powershell
$env:KUB_QA_ALLOW_MUTATIONS='0'
node --test tests/unit/media-edited-video-quality-layout.test.mjs
```

4/4 pass: 390/1440, light/dark. Actual `useVideoSendLadder` and
`AttachVideoQualityRow` mount in isolated Chromium contexts, with the editor
replacement, video selection and `offersLadder` expressions taken from actual
`AttachSheet` source. Real project CSS and local fonts are used; the fixture is
bundled in memory, with no dev server or shared browser. Controlled container
facts and codec capability IO are not real encoding evidence.

The mixed edited/unedited selection governs exactly one video. Keyboard Home
changes 720p to 480p; the actual row/ARIA value follows and the chosen stop survives
a same-selection rerender. The metadata reader sees only `raw.mp4`, once, and
never the edited File. Removing the unedited member hides the slider and leaves
zero governed/encoding members, with no additional metadata reads or encode calls.
No page errors, unlisted requests, text overflow or document overflow were seen.

All four mixed-480p screenshots were visually inspected; text and slider remain
inside the row at both widths/themes. Evidence is outside Git in OS temp:
`C:/Users/maksi/AppData/Local/Temp/letscube-edited-video-quality-X4zhoA/`
(`390-light`, `390-dark`, `1440-light`, `1440-dark` `-mixed-480p.png`, plus
`metadata.json`). The earlier source 7/7 bytes/DTO/retry/omission evidence was
reused, not rerun. No application/native build or production/device operation.

## Changed Files

- `artifacts/kub/src/hooks/useVideoSendLadder.ts`
- `tests/unit/media-edited-album-quality.test.mts`
- `tests/unit/media-edited-video-quality-layout.test.mjs`
- `docs/operations/2026-10-28-media-quality-followup.md`
