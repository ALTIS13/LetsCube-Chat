# Windows EXE Packaging Audit

Audit date: 2026-07-26.

## Scope and guardrails

The primary LETSCUBE distribution format is the existing Tauri NSIS EXE
installer. This audit does not:

- remove or modify the existing MSIX/PWA Partner Center product;
- reserve, replace, or finalize a Publisher, Package Family Name (PFN), or
  package/application identity;
- submit any product for Microsoft certification;
- change the current Tauri identifier, package identity, installer, or update
  channel.

## Evidence from the current repository and machine

| Evidence | Result |
| --- | --- |
| Tauri bundle target | `nsis` only |
| Installed location | Per-user `%LOCALAPPDATA%\LETSCUBE` |
| Installer registration | Win32 uninstall key, shortcuts, and URL protocol |
| Installed AppX/MSIX package | No LETSCUBE/KUB package found |
| Sparse package registration in NSIS | Not implemented |
| Current Windows notification path | Local toast while the Tauri process/tray is running |
| Windows App SDK push client | Not implemented |
| WNS channel acquisition | Not implemented |
| Killed-process activation | Not implemented |
| Sparse identity tooling | Renderer and unsigned `MakeAppx` validation artifact only |

The installed application is therefore an unpackaged Win32 application. The
custom AppUserModelID and `letscube-notification` protocol registration do not
grant Windows package identity.

## Decision

### Primary installer

Keep the NSIS EXE as the primary installer and update mechanism.

For reliable WNS delivery and notification activation after the process has
terminated, add a **package with external location** (sparse identity) as a
signed companion installed and removed by NSIS. This preserves the existing
application directory and updater while granting the runtime a Windows package
identity.

A full MSIX conversion is not required for the selected EXE-first distribution
model.

### Partner Center product type

The primary Microsoft Store listing should use a separate **EXE or MSI app**
product, with the current NSIS binary submitted as an **EXE** through an
immutable versioned HTTPS URL.

The sparse package is an identity companion installed by the EXE. It is not the
primary binary uploaded to the EXE/MSI product.

The existing MSIX/PWA product must remain untouched until its reserved identity
and display-name relationship with the future EXE/MSI product has been
confirmed in Partner Center.

## Existing Store identity reuse

The existing Store identity is a candidate source for the canonical package
name, Publisher, Application Id, and PFN, but reuse is **conditional**, not
automatic.

Before reusing it for the sparse package, verify:

1. The exact Partner Center product type.
2. The reserved Package/Identity Name.
3. The exact Publisher value.
4. The Package Family Name.
5. The Application Id.
6. The Store ID and reserved display names.
7. That the production package-signing certificate subject exactly matches the
   manifest Publisher.
8. That Microsoft permits the selected PFN to be mapped to the LETSCUBE Entra
   application used by Windows App SDK push.

An EXE/MSI Partner Center product does not itself install package identity.
Creating it does not automatically make the NSIS-installed process packaged.

Do not create a second independently serviced package using the same identity
and conflicting versions. One canonical sparse identity line must be used by
all EXE installs.

## Target installation architecture

1. NSIS installs LETSCUBE files to the final per-user application directory.
2. The installer places the signed sparse identity package and required visual
   assets.
3. NSIS registers it per user with `Add-AppxPackage -ExternalLocation`, where
   the external location exactly matches the executable directory.
4. The installed executable carries the matching side-by-side MSIX identity
   manifest.
5. First launch verifies that package identity is present before enabling WNS.
6. Repair and upgrade idempotently re-register a higher package version.
7. Uninstall unregisters the sparse identity without deleting unrelated Store
   products.
8. Registration failure rolls back installation instead of claiming
   killed-process notification support.

The current renderer references package visual assets but its unsigned
validation package contains manifest metadata only. Production integration must
place the referenced assets where Windows can resolve them and test real signed
registration; successful `MakeAppx /nv` validation alone is not sufficient.

## WNS and notification activation architecture

Package identity is necessary but does not complete WNS. The production path
also requires:

1. Add and initialize the Windows App SDK runtime before using push APIs.
2. Create the required Windows App SDK runtime/singleton deployment strategy
   for supported Windows 10 and Windows 11 machines.
3. Create the LETSCUBE Microsoft Entra application.
4. Obtain Microsoft approval for PFN-to-Entra mapping.
5. Use `PushNotificationManager::IsSupported()` and fail closed when the
   environment is unsupported.
6. Register the app, request a WNS channel, and send the channel URI only to the
   authenticated backend device-registration RPC.
7. Renew/touch the channel on login and resume; revoke it on logout, uninstall,
   and WNS `404`/`410` responses.
8. Never log or expose the raw channel URI.
9. Register packaged push/COM activation so Windows can start LETSCUBE after
   process termination.
10. Read Windows App SDK activation arguments, redirect secondary instances to
    the primary instance, validate the relative route, and queue it until the
    authenticated web UI is ready.
11. Preserve the current semantic notification database as the source of truth,
    with message grouping, task separation, sender exclusion, mute preferences,
    and read synchronization.
12. Prevent duplicate cards when WNS has already presented the system
    notification and the realtime foreground bridge also receives the event.

The current Tauri protocol activation remains useful for an already installed
and running application, but it is not a substitute for packaged
killed-process push activation.

## Store and release gates

Before creating or submitting the EXE/MSI Partner Center product:

- Authenticode-sign the NSIS installer and every shipped PE file with a
  publicly trusted certificate.
- Sign the sparse identity package with a certificate whose subject exactly
  matches its Publisher.
- Provide a silent install path and a standalone/offline installer.
- Verify how WebView2 and the Windows App SDK runtime are provided when missing;
  the Store EXE/MSI path does not permit a downloader stub.
- Publish each version at a new immutable HTTPS URL.
- Keep the Tauri updater as the application-owned update mechanism.
- Complete install, repair, upgrade, rollback, uninstall, reboot, killed-process
  push, and notification-action QA on Windows 10 and Windows 11.

## Data still required

Only public metadata is required for the next decision checkpoint:

- Partner Center product type for the existing MSIX/PWA product;
- Package/Identity Name;
- Publisher ID / exact manifest Publisher;
- PFN;
- Application Id;
- Store ID;
- reserved product names;
- exact Subject of the planned production code-signing certificate.

Do not provide Partner Center credentials, certificate private keys, passwords,
or WNS/Entra secrets.

## Official references

- [Package identity with external location](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps)
- [Windows notifications overview](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/)
- [Windows App SDK push notifications sample](https://learn.microsoft.com/en-us/samples/microsoft/windowsappsdk-samples/pushnotifications/)
- [Windows App SDK deployment for external-location or unpackaged apps](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/deploy-unpackaged-apps)
- [Distribute a Win32 app through Microsoft Store](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-distribute-your-win32-app-through-microsoft-store)
- [MSI/EXE app package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements)
- [Upload MSI/EXE app packages](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/upload-app-packages)
