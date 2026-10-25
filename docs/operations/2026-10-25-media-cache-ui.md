# Media cache settings UI, 2026-10-25

## Resume

Owner: bounded UI worker. Stage: component and synthetic verification ready for
coordinator integration. Source: canonical
`C:/Users/maksi/.codex/worktrees/android-current-20261015/LetsCube-Chat`, branch
`codex/ui-motion-updates-20261019`, starting HEAD `12c4cc45`.
Evidence: focused tests, mutations and pixel inspection below.
Blocker: none within the UI scope. An earlier full application typecheck reported
the in-flight `mediaCache/cache` and `mediaCache/storage` modules missing; both
files are now present. Post-integration application verification belongs to the
coordinator's frozen media QA, not this component-only receipt.
Next: coordinator completes the managed adapter/service and verifies the mounted
searchable row. No commit, deploy, installation or native acceptance in this slice.

## Placement And Ownership

The coordinator's latest placement is **Settings > Данные и память**, searchable
row id `media-cache` in `components/settings/SettingsScreen.tsx`, immediately
before the separate updates row. That row mounts `ManagedMediaCacheSection`,
which supplies this UI's props. It is **not** nested under Updates and has no
Windows-only gate. This worker did not edit the row, wrapper, SettingsModal,
StorageSection, settings search registration, barrel exports or global CSS.

`MediaCacheSection` is a named export from
`artifacts/kub/src/components/settings/MediaCacheSection.tsx`:

```ts
interface MediaCacheSectionProps {
  stats: { bytes: number; count: number; limitBytes: number } | null;
  pending: boolean;
  error: string | null;
  onClear: () => void;
  onLimitChange: (bytes: number) => void;
}
```

There is no invented media-cache hook or service import. The adapter owns account
scope, command failures, re-reading authoritative statistics, and clearing media
only. It must publish fresh statistics before settling `pending`, catch command
rejections, and reset/remount the section on an owner/backend change. Unknown
statistics must be `null`, not a fabricated zero. Error strings are signals;
their raw diagnostic content is intentionally not displayed.

The UI never touches storage, authentication, messages or the send queue. The
existing binary byte formatter is reused without invoking the desktop bridge.
Limits emit literal binary values: `67108864`, `134217728`, `268435456` bytes.
Selection follows returned props, not an optimistic local value. Success needs a
local clear request, settled pending, no error, and both bytes/count equal to
zero. An initial empty cache or limit change is not a successful clear.

## Reference Evidence

On **2026-10-25**, the callable Mobbin `search_screens` plugin was used once with
the specific query `Telegram storage usage settings`, platform iOS, limit 2,
destination code. Both returned images were visually inspected. No collection
was created and no reference images were downloaded or saved.

- [Telegram Storage Usage, per-chat byte totals](https://mobbin.com/screens/fef880b8-bc6a-4106-91e6-8d147b8deddb):
  compact rows put their byte usage at the trailing edge.
- [Telegram Storage Usage, maximum cache size](https://mobbin.com/screens/96263ae0-1bf4-4644-bf9f-2512691879b1):
  the visible screen separates cached-media retention from a maximum-size
  control, with four stops and a brief local-device consequence. These are
  observed pixels of a Mobbin capture, not a live-device/version measurement.

Derivation: retain clear separation of actual usage, capacity and a scoped media
action. Deliberate differences: use the requested three 64/128/256 MB segments
instead of Telegram's multi-GB slider; do not invent per-chat breakdowns,
retention settings, a ring chart, or clear-dialog behavior absent from the
inspected frames and supplied service contract. No claim is made that Telegram
uses our values or this clearing workflow.

The existing LETSCUBE material remains authoritative: existing KubButton/KubIcon,
theme and control tokens, no additional glass/card shell, no manual colors or
filters. The parent settings surface owns glass; the fixture uses `kub-glass`
only to reproduce that host. The section is an unframed layout.

## Verification

Browser plugin/skill was not available; existing local Playwright Chromium was
used. No tooling was installed. The isolated fixture bundles the real component,
React and controls and serves the real current stylesheet and local fonts with
Vite `configFile:false`, `envFile:false`. It does not load App, auth or a cache
service. All non-fixture requests are blocked and asserted absent.
`KUB_QA_ALLOW_MUTATIONS=0` is required. Fixture ports are OS-selected and strict;
the final positive run announced `127.0.0.1:25127`. Each owned server/browser is
closed in cleanup. The coordinator's shared server on `5191` was untouched.

The flow under test is: synthetic settings section -> limit selection or media
clear -> controlled pending/result props -> visible usage/result and disabled
commands, without backend effects.

| Check | Result |
| --- | --- |
| Behavioral/component matrix | **20/20 PASS**, no skipped tests |
| Page identity, nonblank, console/runtime health | PASS |
| Actual usage/count, clamped semantic progress | PASS, including over-limit usage |
| Literal limit payloads; no optimistic selected value | PASS |
| Arrow keys, Home/End, roving focus, unknown current limit | PASS |
| Pending pointer/keyboard lock and retained radio focus | PASS |
| Loading, unavailable, empty, failure/retry, confirmed success | PASS |
| Viewports/themes/text | 360/390/1440, dark/light, 100%/200% |
| Clipping, 44px targets, viewport reachability, real wheel scrolling | PASS |
| In-memory behavior mutations | **5/5 rejected** |
| Component + transitive imports + project ambient TypeScript declarations | PASS |
| Impeccable mechanical detector | `[]`, no findings |

TDD: the initial component-presence assertion failed against the starting tree;
the first mounted usage test failed because the new surface was absent. The
keyboard test then exposed native disabled radios losing focus: pending radios
now retain focus with `aria-disabled` and guarded pointer/keyboard handlers.
A separate RED case proved unknown statistics with pending must say loading,
not claim a limit save. Both are green in the final matrix.

Mutation assertions use independent literal expectations. The harness requires a
unique replacement, different SHA-256 before/after, one real named test and its
specific assertion failure, not a build/import failure. Rejected mutations:
64 -> 65 MB, empty bytes OR count, success without a clear request, removal of
the pending lock, and unclamped meter value. An earlier attempted removal of
the success empty predicate was redundant with result retirement and survived;
it was replaced by the actual request-identity violation, not counted as killed.
The fake-empty mutant was parenthesized to preserve the null guard, so its final
failure tests zero-byte cached files rather than a null dereference.

Pixels inspected: all six states at 390/1440 in both themes, plus enlarged mobile
error/success frames. All 72 final synthetic PNGs remain outside the repository
at `C:/Users/maksi/AppData/Local/Temp/letscube-media-cache-ui-20261025/`.
No personal/production capture, trace or video was made. Two fixture defects were
corrected before final evidence: virtual Tailwind utilities did not bound the
desktop column, and application document overflow hid tall fixture content.
The fixture now sets an explicit 476px maximum and a scrollable document;
tests assert the measured width, actual wheel scroll and full button visibility.
At 200% text, segment labels/button text wrap without clipping or overlap.

Commands from the canonical root:

```powershell
$env:KUB_QA_ALLOW_MUTATIONS = '0'
node --test tests/unit/media-cache-settings.test.mjs
node --test tests/unit/media-cache-settings-mutations.test.mjs
# Optional synthetic captures outside the repository:
$env:MEDIA_CACHE_UI_CAPTURE_DIR = "$env:TEMP\letscube-media-cache-ui-20261025"
node --test tests/unit/media-cache-settings.test.mjs
```

`pnpm.cmd --filter @workspace/kub run typecheck` was attempted while the adjacent
core was being created and failed on `appMediaCache.ts`/`loader.ts` imports of
`./cache` and `./storage`. Both files were confirmed present before handoff;
that earlier result is not asserted to describe their completed state. The
isolated UI TypeScript program passes using the app's actual compiler options
and ambient declarations. Syntax checks on all three test/harness files, report
links, whitespace on all five new files and `git diff --check` pass. No
full-suite/build/native or production acceptance is claimed; those belong to
coordinator integration.

## Changed Files

- `artifacts/kub/src/components/settings/MediaCacheSection.tsx`
- `tests/unit/media-cache-settings.test.mjs`
- `tests/unit/media-cache-settings-mutations.test.mjs`
- `tests/e2e/media-cache-settings-fixture.mjs`
- `docs/operations/2026-10-25-media-cache-ui.md`

Concurrent service, core, chat and settings integration edits are preserved.
The coordinator's main record is [2026-10-25-media-cache.md](2026-10-25-media-cache.md).
