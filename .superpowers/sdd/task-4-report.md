# Task 4 review-fix report

## Result

- State-synchronization fix: `29bee4b` (`Fix Windows update state synchronization`).
- Final interaction-guard fix: `65eef0b` (`Fix Windows updater interaction guards`).
- Final channel-behavior fix: `bbbf099` (`Finalize Windows updater channel behavior`).
- Timer-race fix: `dba5b2b` (`Cancel Windows update timer before checks`).
- Push: no.
- Frozen `window.letscubeDesktop` contract remains unchanged.
- Browser/PWA/Android behavior remains inert and unchanged.
- Native ACL blocker was resolved externally in `c974206`; this task did not modify or revert `build.rs`, capabilities, permissions, or `tests/unit/tauri-shell.test.mjs`.

## Review findings addressed

1. All `useDesktopUpdate` consumers now use one module-level external store through `useSyncExternalStore`; MainLayout, the update pill, and Settings receive the same immutable snapshot.
2. Identical commands coalesce to one promise. Distinct commands use a FIFO queue and retain their own parsed result instead of receiving another command's result.
3. Invalid reads and active-state refresh failures publish a bounded sanitized `failed` snapshot and cancel the 250 ms active poll.
4. Strict parsing enforces `mandatory === true` if and only if the phase is stable `critical_update_required`.
5. The critical gate receives focus, traps Tab/Shift+Tab, restores prior focus, and makes the mounted app shell inert and `aria-hidden` without clearing auth or chat state.
6. Channel selection uses `radiogroup`/`radio`/`aria-checked`; determinate download state exposes complete progressbar value semantics.
7. E2E confirms Test explicitly, asserts exact `set:test` then `check` bridge calls, verifies synchronized Settings/pill state, progress semantics, shell blocking, focus trap, and focus restoration.
8. While a critical update blocks the shell, MainLayout's global Escape listener is inert and cannot clear the selected chat or mutate shell state.
9. The Stable/Test radiogroup implements roving focus for ArrowLeft/ArrowRight, ArrowUp/ArrowDown, Home and End; Test still requires explicit confirmation before the channel changes.
10. An immediate stale initial check cancels the temporary one-second idle timeout and leaves exactly one six-hour timer after resolving to idle/current.
11. Direct checks and post-channel checks share one completion helper: successful completion records the timestamp, cancels an early idle timeout, and schedules the next check six hours later.
12. Requesting or focusing the already-selected Stable channel clears stale Test confirmation; ArrowRight then ArrowLeft keeps Stable selected without a bridge call.
13. The shared check helper cancels any idle timeout before awaiting native check completion, so a one-second callback cannot race a delayed automatic or post-channel check.

## RED / GREEN evidence

- RED parser/store: unit test failed because `createDesktopUpdateStore` did not exist; invariant fixtures with inconsistent `mandatory` values were still accepted.
- GREEN parser/store: shared subscription, immutable synchronization, strict invariant, command coalescing/serialization, bounded failure and polling-stop tests pass.
- RED accessibility/E2E: desktop update scenario failed because no element exposed `role="progressbar"`; Test selection did not have exact bridge-call/state assertions.
- GREEN accessibility/E2E: the targeted desktop update scenario and full Tauri suite pass with confirmation, exact call order, synchronized state, ARIA semantics and keyboard focus behavior.
- RED final interaction guards: ArrowRight left focus on Stable; Escape from the critical gate removed the selected chat composer; the deterministic scheduler test retained `{ milliseconds: 1000 }` instead of the six-hour timer.
- GREEN final interaction guards: keyboard focus/confirmation, selected-chat preservation and the single six-hour timer all pass in the targeted tests and full Tauri QA.
- RED final channel behavior: the channel-change scheduler retained its one-second timer, and ArrowLeft focused Stable without closing the Test confirmation.
- GREEN final channel behavior: the deterministic channel-change timer test and ArrowRight/ArrowLeft E2E flow pass; the full Tauri suite remains green.
- RED timer race: the delayed-promise scheduler executed one active `1000 ms` callback while the first post-channel check was still pending.
- GREEN timer race: the early timeout is cancelled before awaiting the check; the deterministic test observes zero fired callbacks and one pending check.

## Files in final fix commit

- `artifacts/kub/src/lib/platform/desktopUpdates.ts`
- `tests/unit/desktop-update-state.test.mts`

## Validation

- `git diff --check`: pass, exit 0.
- `node --test tests/unit/desktop-update-state.test.mts tests/unit/desktop-notification-adapter.test.mts tests/unit/distribution-platform.test.mts`: pass, 28/28, exit 0.
- `pnpm.cmd --filter @workspace/kub run typecheck`: pass, exit 0.
- `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`: pass, exit 0.
- `pnpm.cmd windows:tauri:qa`: pass, 3/3 Playwright scenarios, exit 0, no console errors reported.

## Screenshots and warnings

- The E2E spec captured startup, authenticated shell, update pill, Settings and critical-gate screenshots during execution. The successful Playwright run did not retain image artifacts under `test-results`, so there were no new persisted files to inspect or commit.
- Vite retains existing sourcemap, mixed static/dynamic import and large-chunk warnings.
- Cargo retains the existing bin/lib PDB filename-collision and linker-output warnings.
- No generated build output or screenshots were committed.
