# Task 4 Report

## Changed files

- `artifacts/kub/src/lib/platform/desktop.ts`
- `artifacts/kub/src/lib/platform/desktopNotifications.ts`
- `artifacts/kub/src/types/desktop.d.ts`
- `artifacts/kub/src/hooks/useMessages.ts`
- `artifacts/kub/package.json`
- `pnpm-lock.yaml`
- `tests/unit/distribution-platform.test.mts`
- `tests/unit/desktop-notification-adapter.test.mts`

## Root cause

`useMessages.ts` only emitted browser `Notification` objects inside the hidden-tab web branch. The Tauri shell already exposed synchronous `window.letscubeDesktop` detection, but there was no bounded frontend adapter that lazy-loaded the official Tauri notification API for the same realtime message event.

## TDD evidence

### Red

Command:

```powershell
pnpm.cmd exec node --test tests/unit/distribution-platform.test.mts tests/unit/desktop-notification-adapter.test.mts
```

Result:

- Failed with `ERR_MODULE_NOT_FOUND` for `artifacts/kub/src/lib/platform/desktopNotifications.ts`.
- Existing distribution assertions stayed green, proving the missing adapter was the new gap under test.

### Green

Command:

```powershell
pnpm.cmd exec node --test tests/unit/distribution-platform.test.mts tests/unit/desktop-notification-adapter.test.mts
```

Result:

- `8` tests passed.
- Verified:
  - Tauri/native desktop wins over Windows browser heuristics.
  - Synchronous `window.letscubeDesktop` detection stays intact.
  - Desktop notifications stay inert for browser/Android paths.
  - Desktop notifications lazy-load only after desktop detection.
  - Denied native permission prevents desktop delivery.

## Verification commands

### Focused tests

```powershell
pnpm.cmd exec node --test tests/unit/distribution-platform.test.mts tests/unit/desktop-notification-adapter.test.mts
```

- Exit code: `0`

### Frontend typecheck

```powershell
pnpm.cmd --filter @workspace/kub run typecheck
```

- Exit code: `0`

## Concerns

- None from the focused frontend scope.

## Review fixes

- Restored runtime metadata lookup to the existing async `getRuntimeInfo()` contract; synchronous bridge usage remains detection-only.
- Added an explicit Capacitor Android no-load/no-delivery regression case.
- Added visibility gating so native Windows toasts are silent while the chat window is visible and appear only while hidden/in tray.
- Updated Windows settings copy to describe running-process delivery without claiming killed-process push.
- Re-ran focused tests: 11/11 passed; frontend typecheck passed.
- Final branch review aligned the visible Settings status with running-process delivery; killed-process delivery remains explicitly pending.
