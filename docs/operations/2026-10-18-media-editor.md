# Pre-Send Media Editor

Owner: Codex coordinator, branch `codex/media-editor-20261018` in the existing
canonical worktree. Source implementation/verification in progress; release is
not claimed until the actual image and signed/public APK checks below finish.
[Plan](../superpowers/plans/2026-10-18-media-editor.md),
[master queue](../superpowers/plans/2026-10-18-production-completion.md).

## Product Changes

- Separate edit targets preserve gallery selection/order. One owned editor
  session covers photos and video; a new edit retires earlier pending Send.
- Photos: crop/aspect/zoom, quarter-turn rotation, opaque cover, pen, undo/reset,
  preview, Apply/Cancel. MIT react-easy-crop6.2.4 provides crop interaction.
  Covers and marks are baked into the File, not CSS layered over raw content.
- Video: bounded interval, local preview and precise re-encoding with installed
  Mediabunny1.56.1. Required video/audio tracks survive; discarded intervals and
  their packets are not uploaded. Failures never become raw-original success.
- Apply atomically replaces one pick. Original/undo stay only in sheet RAM;
  Restore is explicit. Only final files reach the existing staging/bytes DTO.
  Caption, mentions, album order and client-message identity remain on that path.
- Already baked photo quality is retained/displayed. HD controls only unedited
  members; exact-File prepared metadata avoids a second lossy photo encode.
  Location removal and size/scope checks still run.
- New editor chunks and their actual static JS/CSS closure are precached from
  Rollup's output graph. No wildcard caching, backend/media cache rule or push
  protocol change. LiveKit and other unrelated dynamic tools are excluded.
- Installed MIT/BSD notices are packaged alongside the existing MPL notice.
  Native candidate is0.1.28/build29, not a changed package identity or signer.

## Reproduction and Review

Actual failures were repaired rather than accepted as limitations:

1. Already edited photos would be encoded/relabelled again by ordinary staging.
   Exact-File prepared metadata fixes that without altering unedited members.
2. Same-ID/same-size video replacements reused old dimensions/readiness/rungs.
   File-bound reads and selection generations retire those facts synchronously.
3. A capability response released after unmount could start an encoder. The
   preparation controller now exists before that await; current ownership gates
   work, results, progress and cleanup.
4. Loading/error fallback leaked keyboard focus to underlying commands. Its own
   capture/focus ownership exists before the lazy component is available.
5. Initial autofocus showed an unsolicited tooltip; the dialog now receives
   focus and keyboard navigation still enters the tools normally.
6. Trim label and44px edit button overlapped in all four gallery renders. The
   label has a separate vertical region, without shrinking the hit target.
7. An actual0.8106875s trimmed source was rounded beyond its valid end. Rounding
   is followed by exact-bound clamping; helper validation is not weakened.
8. A prior awaiting Send could close a newly opened editor and send raw bytes.
   Opening a new edit advances the interaction generation and cancels preparation.
9. Cold installed PWA had no cached editor chunks. Actual old-build cold misses
   and warm byte-positive controls establish the gap; graph-based precaching
   repairs it without changing the worker's deliberate cache-bypass semantics.

## Evidence

All files and screenshots are synthetic; QA mutations are disabled. No real
Auth/session, user media, backend send or personal screen is used by the fixtures.

| Boundary | Actual evidence / limit |
| --- | --- |
| Photo compositor |26/26 Node/Chromium/WebKit; rotated corners, EXIF orientation, mask/pen pixels, alpha/JPEG fallback, literal output sizes, cancellation and failure omissions |
| Photo UI | Chromium17 plus focused startup1; WebKit16 plus corrected-oracle1; not a fresh whole18-case WebKit run |
| Video helper |20/20:13 dependency/control-flow plus7 browser cases; Chromium actual selected scene/tone/packets; WebKit explicit unsupported, not successful trim |
| Video UI |15 initial plus capability, real metadata and exact-endpoint focused cases; real preview/trim, refusal/retry and disposal-before-exit |
| Gallery |5/5 after actual overlap RED;390/1440, both themes, real components/icons/CSS and44px hit targets |
| Staging/identity/cache | Actual staging4, mounted video identity/lifetime1, graph/precache21; earlier adjacent22 ladder/plan checks reused |
| Native metadata |13/13 after explicit literal version29 update; malformed/version-drift/signing/Firebase refusal controls retained |
| Build | Actual Vite13.55s, SW`2ccb5c0ed567a7de`; existing sourcemap/chunk-size warnings remain |
| Built cold offline |20:15:35Z: fresh actual worker controls a new document, offline SHA/length match for all6 graph assets; outside-origin requests0 |

Final combined mounted photo/video flow passes27/27 in12.24953s, including both
pending-Send/new-edit cases and cancellation/DTO controls. Scoped independent
spec/quality review finds no remaining P1/P2 after the endpoint, intent, focus,
gallery and cache repairs. Final frontend typecheck and diff check pass. The
first boundary batch was37/39 only because two explicit native-version literals
still named28; their version29 amendment then passes the native13/13 suite.
These are compositional results, not a fictitious single full-suite invocation.
The first offline probe incorrectly expected immediate document claiming and
used cache-disabling interception/no-store. Those instrument refusals are not
product failures; corrected new-navigation/passive-observer warm controls pass.

Coordinator inspected actual photo geometry/markup and video390/1440 light/dark
pixels, plus the corrected gallery in temp run`7ekOmP`. Earlier copied gallery
images show the genuine RED and remain historical, not final acceptance.

## Device and Release Boundaries

Realme sidecar first refused at a nonsecure lockscreen. A later authorized
standard dismissal allowed the owned loopback page: actual photo crop/opaque
preview and final WebP pixels pass in Yandex/Chromium144 on Android15. That
attempt's synthetic video generator failed before product trimming; it is not
a successful trim or proof of unsupported product editing. The later valid-source
follow-up independently hashes the same known-good AVC/AAC bytes on the phone:
inspection passes, but actual trim rejects with native EncodingError / Decoding
error before output. This does not identify audio versus video or init versus
execute. The editor's rejection path retains the draft/range and returns before
Apply; no raw fallback. A separate single origin-tagged diagnostic is assigned,
not a repeated acceptance run. Exact port/server/foreground cleanup is retained.
Browser-engine evidence is not installed Capacitor WebView acceptance.

Successful native/iPhone encoding is not inferred from desktop WebKit or an API
capability declaration. Unsupported devices retain their draft and the explicit
Cancel path to sending unedited media. A063 remains excluded. No rental held.

## Release

Product source `323d7cfc9ab2ea61d0796c799ebd78614526d1cf` is RELEASED. The
separately inspected outgoing range contains only5d2f5eb6/323d7cfc; own-commit
alias resolution passes11 files/110 imports. Feature push precedes the reviewed
fast-forward main push. D: main fast-forwards cleanly, ignored secrets preserved.
The previous native build was recovered from its immutable result, not replayed.

At21:02:50Z, sole healthy image is
`l64kyyu1sysev2izzjjbizhe:323d7cfc9ab2ea61d0796c799ebd78614526d1cf`, build
`c99fbb6c515e4180`. HTML/SW and all6 graph JS/CSS assets match public/container
SHA256 and byte length. Before rollout, old build6a66afb9a57ceb59 has2 boot
assets/zero editor roots; the new build includes both editor roots and cropper
CSS, without unrelated LiveKit precaching. Changed editor markers and unchanged
notification protocol/boot bindings pass. Rolling replicas retire naturally.
Main JS SHA256 `2caf62db9049b66c94c7ede2fe7dff8c76ab6552a5aa3a816804a2eb5a951509`.

Android Stable **0.1.28/build29**, same source, mandatory=false; rollback28
retained. Actual build markers: SW37a4c73f04bcf7fe / Vite14.08s /
BUILD SUCCESSFUL13s. APK7,790,993B, SHA256:
`ec4410416fe22bce1f460b984efb3533be9c0492daead7a88eaa6a21c677e668`.
AAB7,423,748B, SHA256:
`e0f7a07003fb61c7588c4cfb360b77572195207543821f6dbfa55bf875c5b145`.
Original signer, Firebase4 values, QA flags false, web/config/DEX/APK-AAB parity
and bounded known-secret scan pass. At20:57:53Z actual Realme28 ->29 retains
UID/data/firstInstall, foreground guest/fatal0; no clear/uninstall. Initial
lockscreen refusal is before install; wake followed by standard nonsecure
dismissal permits the single install. At21:03:00Z public catalog and full APK
bytes/SHA pass after guarded catalog CAS with prior manifest/artifact rollback.

[Public Android APK](https://api.letscube.ru/releases/files/android/0.1.28/letscube-0.1.28.apk).
Windows uses the shared remote renderer; shell remains0.2.14/unsigned by owner
decision. Shared iPhone PWA receives the web source, not a claimed successful
iPhone trim or native Apple release. No SQL change, new backend deployment,
Auth/group mutation or rental is part of this slice. Topic enforcement stays ON.
Task3's wider send/retry/view/save journeys stay open. Next bounded work: measured
search motion, remaining media workflow map and the assigned decoder diagnostic.
