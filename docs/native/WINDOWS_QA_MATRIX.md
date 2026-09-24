# Windows QA Matrix

This matrix is a first-party release gate for the Tauri client. Record only
operating system, WebView2 and artifact results. Do not record machine names,
Windows account names, QA credentials or notification content. The owner's
2026-09-24 decision allows first-party distribution without Authenticode;
Tauri updater signature verification is still mandatory. An unsigned installer
may show SmartScreen/publisher warnings and is not eligible for an EXE/MSI
Microsoft Store submission.

Generate a local capability snapshot:

```powershell
pnpm.cmd windows:matrix
pnpm.cmd windows:matrix -ArtifactPath windows-tauri\src-tauri\target\release\bundle\nsis\LETSCUBE_VERSION_x64-setup.exe
```

## Required device coverage

| Environment | Launch/auth | Tray/session restore | Offline/reconnect | Chat/media | Toast route/history | Updater `.sig` | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Windows 11 x64, current WebView2 | Required | Required | Required | Required | Required | Required | Local run required for each release candidate |
| Windows 10 22H2 x64, current WebView2 | Required | Required | Required | Required | Required | Required | Pending dedicated device/VM |
| Windows 11 x64, previous supported WebView2 | Required | Required | Required | Smoke | Smoke | Required | Pending compatibility VM |

Current local capability evidence:

- 2026-09-24: Windows 11 Pro, build `26200`, x64; WebView2 Runtime
  `153.0.4234.48`.
- Public first-party Stable is `0.2.14` build `18`. Its catalog artifact
  matched the published size and SHA-256, and the server-side `minisign`
  verification of the Tauri updater `.sig` passed against the public key in
  this repository. This is not Authenticode verification or a new device-matrix
  pass for this release candidate.
- `windows:matrix -ArtifactPath` reports the Authenticode status only. A
  `NotSigned` result is expected under the current first-party policy; it
  does not verify the Tauri updater signature. Use the release publisher's
  independent `.sig` verification for that check.

## Long-session gate

`pnpm.cmd windows:tauri:qa:long-session` runs against a unique temporary
WebView2 profile. The default duration is 15 minutes. A release rehearsal should
set `LETSCUBE_TAURI_SOAK_SECONDS=3600` and pass:

- one WebView/page for the whole run;
- no main-frame reload;
- authenticated session and local state preserved;
- one forced offline/reconnect cycle with both user-facing states;
- no ErrorBoundary, page error or unexpected failed request;
- no user-owned LETSCUBE process terminated by the runner;
- temporary QA profile removed on success, failure or interruption.

Windows 10 and alternate Windows 11/WebView2 rows cannot be inferred from a
single machine. They remain pending until a real device or isolated VM produces
its own report and completes the same installed-package checklist.
