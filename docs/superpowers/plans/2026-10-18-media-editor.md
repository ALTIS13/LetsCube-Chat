# Pre-Send Media Editor

Continuation of [completion Task3](2026-10-18-production-completion.md),
tracker25. Owner delegates design/implementation/reviewed rollout; no renewed
approval round. This extends the existing attach flow, not a new upload path.

## Design and Contracts

- Gallery keeps selection circles/order and adds an explicit edit button.
  One full-screen, stable-size editor owns its focus and Escape; the attach
  sheet is inert underneath. Keep the existing material and controls.
- Photo tools: crop/zoom/aspect, quarter-turn rotation, opaque cover, pen,
  undo/reset, preview, Apply/Cancel. Crop interaction uses react-easy-crop6.2.4
  (MIT); do not implement a second crop gesture engine. GIF animation is not
  silently flattened: only still canvas candidates enter this editor.
- Geometry uses natural, already oriented source pixels. Crop coordinates are
  relative to the rotated bounding image. Marks use normalized coordinates of
  the cropped result. Cover is fully opaque black and baked into exported pixels.
  Pen width is relative to the shorter result edge. Geometry changes discard
  marks only after an explicit reset/back action, never by a hidden transform.
- `lib/photoEdit.ts` exports PhotoEditRect, PhotoEditPoint, PhotoEditMark,
  PhotoEditIntent, PhotoEditResult, `renderPhotoEditPreview(file,intent,signal?)`
  and `exportPhotoEdit(file,intent,{signal?,quality})`. Preview is a lossless PNG
  File plus dimensions; final export uses existing photo encoding/size rules.
  An unchanged intent returns the identical input File (`changed:false`).
  Abort/decode/invalid crop/export errors reject; no unedited fallback.
- AttachPhotoEditor props: `file`, `url`, `quality`, `onApply(result)`,
  `onCancel()`, optional explicit `onRestore()`. onApply may refuse with false
  (for example if result URL allocation fails); keep the editor recoverable.
  It owns geometry/marks/async cancellation only. AttachSheet owns
  owner/accountEpoch/chat/topic/pick-generation fences and atomic replacement.
  Cancel preserves File/order/caption/HD. The current edited File is the only
  byte-bearing outgoing source; raw originals/undo never enter persisted metadata.
- Add a RAM-only `preparedPhotos` map to AttachSendRequest: File -> dimensions
  and actual MediaQuality. ChatWindow skips only the additional photo encode
  for those exact Files, retains location stripping/size/scope checks, and records
  the actual quality. Unedited members of a mixed album still follow normal HD.
  Changing HD after Apply does not falsely relabel an already baked File.
- Keep the existing reload veto while picks/editor exist. Close, deselect,
  chat/topic changes, owner switches and A-null-A retire the editor synchronously;
  late decode/export cannot replace or send a pick. Dispose every owned URL.

## Work Sequence

1. [x] Linnaeus: image compositor/types/export + real synthetic pixel tests26/26;
   source acceptance only, no native/export or publication inference.
2. [x] Nash: editor UI, cropper dependency/lock and packaged MIT/BSD notices;
   focused component tests. No AttachSheet/Gallery/ChatWindow writes.
3. [x] Coordinator: gallery entry, sheet ownership and existing preparation path;
   final pending-Send intent repair/review and combined flow27/27 pass.
4. [x] Pascal: independent mounted integration/cancellation/owner/DTO tests16/16
   and real omission control; final combined photo/video flow27/27 and scoped
   spec/quality review pass after the confirmed P2 repairs.
   No production or personal captures.
5. [x] Inspect exact editor390/1440, both themes; crop/cover/pen/keyboard/touch,
   Apply/Cancel/no-op/album/caption/reload/owner controls. Typecheck + build.
6. [ ] Commit/review/publish shared web after own-tree import and production
   image/content checks. Native packages are separate immutable release steps.
7. [x] Video source: bounded trim/preview using installed Mediabunny1.56.1; invalidate
   ladder cache by actual File identity; no original fallback after an edit
   failure. Check installed allowRotationMetadata API, copy:false, required
   tracks, cancellation/disposal and actual encoded interval/audio. Crop/rotate
   for video are optional follow-ups, not a reason to delay the requested trim.
   Same-size replacement cache readiness is repaired; actual mounted RED/GREEN
   plus22 adjacent pure checks pass. Keep item25
   open until its required video and photo subcases are released. Local WebKit
   explicitly refuses unsupported encoding; successful native/iPhone editing is
   not inferred. [Evidence and remaining release checks](../../operations/2026-10-18-media-editor.md).

## Acceptance Boundaries

Every changed behavior gets a failing shipped case or omission control, not a
source-name scan alone. Use actual Chromium/WebKit pixels and cold bytes-DTO
restore/retry with synthetic files. Browser encoding is not native iPhone proof.
No SQL, storage schema/outbox rewrite, FFmpeg WASM, codec installation or global
runtime change. Reuse D371--D373 accepted tests rather than replay their cohorts.

## Reuse Evidence

Existing [reference section18.3](../../operations/reference-clients.md)
records actual Telegram Android12.10.3 on2026-09-20. Official sources:
[cropper usage](https://github.com/ValentinH/react-easy-crop),
[MIT licence](https://github.com/ValentinH/react-easy-crop/blob/main/LICENSE),
[conversion guide](https://mediabunny.dev/guide/converting-media-files).
Installed types take precedence over newer online API names. Packaged notices
must include the cropper and its shipped normalize-wheel dependency.
