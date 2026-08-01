# Windows Package Identity Runbook

LETSCUBE keeps its existing Tauri executable, NSIS installer and signed updater.
Windows background push requires a stable package identity, so the selected
path is a package with external location (sparse package identity), not a
replacement MSIX application.

Microsoft's current guidance for this model is:

- [Package identity with external location](https://learn.microsoft.com/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps)
- [Windows notification API overview](https://learn.microsoft.com/windows/apps/develop/notifications/)
- [Windows App SDK push sample](https://learn.microsoft.com/samples/microsoft/windowsappsdk-samples/pushnotifications/)

## Current state

The repository contains a fail-closed renderer and Windows SDK validator:

```powershell
pnpm.cmd windows:identity:preflight
pnpm.cmd windows:identity:render
pnpm.cmd windows:identity:pack:unsigned
```

Generated files go to `.local/windows-package-identity` by default. `.local`
is ignored by Git. The unsigned package command validates the manifest through
`MakeAppx.exe`; its result is not deployable and must never be published.

The script locates `MakeAppx.exe` and `SignTool.exe` under the newest installed
Windows 10 SDK even when those tools are not in `PATH`. It also verifies
Windows build 19041 or newer and an installed Windows App Runtime.

The WNS database delta is prepared separately as a proposal:

```text
.migration-backup/supabase/migrations/20260724_windows_wns_push_devices.sql
```

It preserves Android/FCM, adds the exact Windows/WNS provider pair, validates
Microsoft channel URI hosts server-side and includes Windows devices in the
existing semantic native-push outbox. The proposal is contract-tested but is
not applied to production. The live database remains Android/FCM-only until a
manual migration approval.

## Required public metadata

Set these only in the controlled Windows release shell:

```text
WINDOWS_PACKAGE_NAME
WINDOWS_PACKAGE_PUBLISHER
WINDOWS_PACKAGE_PUBLISHER_DISPLAY_NAME
WINDOWS_PACKAGE_APPLICATION_ID
WINDOWS_PACKAGE_FAMILY_NAME
WINDOWS_PACKAGE_VERSION
WINDOWS_WNS_REMOTE_ID
```

These values are public identifiers, not credentials, but they must still come
from the real production registrations:

- `WINDOWS_PACKAGE_NAME`: the reserved stable Windows package name.
- `WINDOWS_PACKAGE_PUBLISHER`: the exact subject of the production signing
  certificate. It must match the identity package and executable metadata.
- `WINDOWS_PACKAGE_PUBLISHER_DISPLAY_NAME`: the human-readable production
  publisher.
- `WINDOWS_PACKAGE_APPLICATION_ID`: the stable application ID inside the
  package manifest.
- `WINDOWS_PACKAGE_FAMILY_NAME`: the exact Package Family Name shown by
  Partner Center. It must start with `WINDOWS_PACKAGE_NAME` followed by the
  Microsoft publisher-id suffix and is included in the public runtime contract
  so the client can fail closed on an unexpected identity.
- `WINDOWS_PACKAGE_VERSION`: four numeric parts, aligned with the Windows
  release being packaged.
- `WINDOWS_WNS_REMOTE_ID`: the Microsoft Entra application GUID approved for
  Windows App SDK push.

Do not guess any value or reuse the Tauri identifier
`ru.letscube.messenger` as a Microsoft-issued identity without confirming the
registration. Do not put the Entra client secret in these variables or in the
client build.

## Generated contract

`windows:identity:render` produces:

- `AppxManifest.xml` for the sparse identity package;
- `letscube-windows-tauri.exe.manifest` with matching `publisher`,
  `packageName` and `applicationId`;
- `wns-client-config.json` with only the public package/application/PFN/remote
  IDs.

The two manifests intentionally use the same values. A mismatch causes Windows
registration to succeed without granting identity to the executable
(`0x80073D54`).

## Production build gate

Before wiring the identity package into NSIS:

1. Obtain the real package identity, publisher and Entra remote ID.
2. Run `pnpm.cmd windows:identity:preflight`.
3. Run `pnpm.cmd windows:identity:pack:unsigned` only to validate the manifest.
4. Sign both the Tauri executable/installer and the identity package with the
   same production publisher through the existing Authenticode release path.
5. Register the signed package per user with its external location set to the
   exact NSIS install directory.
6. Verify package identity from the installed executable.
7. Add matching NSIS post-install and uninstall hooks only after install,
   repair, update and removal are proven on disposable Windows 10/11 clients.

The production installer must fail and roll back if identity registration
fails. It must not silently launch an unidentified executable and claim
killed-process push support.

As of July 2026, Microsoft Artifact Signing Public Trust lists organizational
onboarding only for the United States, Canada, the European Union and the
United Kingdom, with individual onboarding limited to the United States and
Canada. A Russian entity therefore needs either an eligible publisher entity
or another publicly trusted code-signing CA that accepts and verifies it.
Private Trust is not a substitute for public SmartScreen trust.

## Remaining WNS gates

Package identity alone does not complete WNS:

- Microsoft must approve the PFN-to-Entra mapping.
- The contract-tested `windows`/`wns` device/RPC proposal must receive manual
  approval and be applied to self-hosted Supabase.
- The client needs Windows App SDK channel acquisition and COM activation.
- The Edge Function needs WNS credentials in server secrets.
- Foreground, tray, terminated-process, reboot and notification-action routing
  need physical Windows 10/11 QA.

Until every gate passes, Settings correctly states that Windows notifications
work only while LETSCUBE is running.
