# Interface Stability, 2026-09-21

Owner: Codex coordinator, main checkout; baseline `01d18dd0`.
Scope: the owner's latest UI-stability request, tracker 34. Preserve the approved
material in `interface-material.md`; no palette, glass, typography or native
identity redesign. Independent agents audit anchored surfaces and native startup.

## Repair And Review

**D-296:** settings formerly selected two different component trees at 768px.
The phone Profile tab also disappeared after widening because desktop visibility
ignored the tab state. One SettingsSurface now owns the draft; one persistent
SettingsOverlay/modal/field tree changes only its layout. The phone sheet keeps
its footer and full width, desktop keeps the measured overlay, rail and search.
The old SettingsModal entry point delegates to this same surface.

Independent review rejected the initial hook-only repair: nested phone/storage
drafts and selection still reset, and remounting could cover the open discard
confirmation. The final persistent tree and stable close callback resolve these
cases without changing the shared modal primitive. Both independent findings
were reproduced before the correction and passed the reviewer's final 12-case
Chromium rerun. Windows storage uses a synthetic bridge, not the native filesystem.

**D-297:** a cold profile grew from 216 to 361.5px while retaining top=676 on a
900px screen, leaving 137.5px and both actions off-screen. PlacedLayer now observes
border-box size and viewport changes. It measures untransformed layout dimensions,
coalesces frames, avoids unchanged-state render loops, and cleans up observers,
listeners and pending animation frames. Existing placement arithmetic and glass
classes are unchanged. Independent review found no remaining actionable issue.

**D-298 remains open:** aborting the entry module leaves no recovery controls
before React mounts. Native manifestation is unproven. A separate bounded
startup recovery/retry and native readiness acknowledgement contract is next;
document load must not stand in for a rendered application.

No SQL, credentials, account data, native releases or installed apps changed.

## Validation

All E2E use `KUB_QA_ALLOW_MUTATIONS=0`, local fixture backend, and
`KUB_BASE_URL=http://127.0.0.1:5261`. No production screenshots or test writes.

| Check | Result |
| --- | --- |
| `pnpm.cmd --filter @workspace/kub run typecheck` | exit 0 |
| `node --test --test-reporter=tap "tests/unit/**/*.test.{mjs,mts,js,ts}"` | 4035 pass, 0 fail, 1 existing jq-1.7.1 skip |
| `pnpm.cmd --filter @workspace/kub run build` with PowerShell fixture env | exit 0; `sw.js fa42929566a7efb1`, built in 11.30s |
| `git diff --check` | exit 0 |
| `chat-glass-layout.spec.ts`, `shell-escape.spec.ts` baseline | 27/27, Chromium desktop/mobile and WebKit |
| Settings geometry, columns, exit confirmations, initial resize scenarios | 62 pass, 31 intentional desktop/phone-only skips across three projects |
| Final expanded `settings-resize-stability.spec.ts` | 24/24, Chromium + WebKit, no skips; 2.6m |
| `anchored-layer-resize-stability.spec.ts` | 28/28, Chromium + WebKit |
| Existing `profile-two-tier.spec.ts` / `emoji-touch-targets.spec.ts` selected boundaries | 22/22, Chromium + WebKit |
| Independent anchored-layer fault/cleanup review | 10/10, Chromium + WebKit |
| `message-reaction-rpc.spec.ts` | 8/8, Chromium + WebKit |
| Reserved-username source guard in `push-phone-foundation.spec.ts` | 1/1; now reads the actual SettingsScreen owner instead of the obsolete wrapper |

The dedicated settings resize matrix covers 360/390/412/767/768/844/1440 inside
the tests, rather than relying on project names. Both themes cover save payload,
clean close, nested drafts/focus/selection, confirmation hit-testing/Escape and
phone-tab continuity. Its final engine matrix passed before publication.
Two fixture corrections are not product failures: PATCH must return the updated
synthetic profile, and focus restoration must establish a keyboard origin (WebKit
does not focus a button just because a pointer clicked it). No assertion removed.

Exact settings/profile pixels inspected at 1440 and 390, both themes. Existing
Vite sourcemap/mixed-import/chunk-size warnings remain; no new build error.
The local build uses fixture connection values and is **not a distributable APK**.

## Publication And Rollback

The repair is scoped to web source and tests/docs. Main publication updates the
browser and the remote-loaded Windows UI, not an embedded Android bundle. Verify
the Coolify image SHA and healthy replacement, then the served entry, not merely
the webhook or this document. Before publication the public entry was
`index-CYPDJM8O.js`, baseline image `01d18dd05aa934b713a93fd3c26ebb6f8cf196e8`.
The old entry has zero small component functions passing both `screen` and
`isPhone` to one persistent surface; the new fixture build has exactly one.
Use that structural marker plus a successful LETSCUBE entry control after deploy.

Rollback is a narrow revert of the repair commit and the normal web deployment;
there is no database, storage, credential or native identity rollback involved.
Do not reset a shared branch. Read actual image/content status when resuming.

## Platform Boundary

Chromium and WebKit fixture checks use invented users and intercepted local
backend requests with `KUB_QA_ALLOW_MUTATIONS=0`. They do not prove physical
WebView2/Android/iOS lifecycle or GPU behavior.

Read-only inventory: Windows 11 build 26200, installed LETSCUBE 0.2.14,
WebView2 directory 153.0.4234.48; authorized Realme RMX3830 Android 15/API35,
WebView 137.0.7151.72, installed LETSCUBE 0.1.3/build4. Nothing is unavailable
by the owner's instruction. No personal screens, logcat or UI dumps captured.
The Android bundle is embedded: web publication does not update that APK.

The preceding Android call server rollout remains disabled as documented in
`2026-09-21-android-call-rollout.md`; do not repeat it or enable its gates as part
of UI work. Signed candidate and physical delivery remain separate stages.

Remaining coverage: actual WebView2/Android suspend/resume, IME, renderer failure,
and signed-current Android UI. Cards taller than the entire viewport were not
proved by the async-size repair. When ResizeObserver is unavailable, initial
placement and window resize still work, but content growth is not auto-observed.
Next: D-298 recovery, then isolated native lifecycle QA before a native release;
do not call this a completed all-platform stability certification.
