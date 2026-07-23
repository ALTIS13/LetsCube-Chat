# Windows Authenticode And SmartScreen Runbook

Tauri updater signatures and Windows Authenticode solve different problems.
The existing updater signature verifies bytes accepted by the LETSCUBE updater.
Authenticode identifies the Windows publisher and is the public installer
release gate.

## Supported signing providers

The release script supports two fail-closed providers. Select one only in the
controlled Windows release environment:

### Microsoft Artifact Signing

Set these secret-manager or CI environment variable names:

```text
WINDOWS_SIGNING_PROVIDER=artifact
AZURE_TENANT_ID
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
WINDOWS_ARTIFACT_SIGNING_ENDPOINT
WINDOWS_ARTIFACT_SIGNING_ACCOUNT
WINDOWS_ARTIFACT_SIGNING_PROFILE
```

Install `artifact-signing-cli` on the release machine. The application secret
must never be stored in Git, a frontend variable, the Tauri bundle, Coolify
public variables or documentation.

### Certificate store

Import a trusted code-signing certificate with its private key into the current
release account certificate store and set:

```text
WINDOWS_SIGNING_PROVIDER=certificate_store
WINDOWS_CERTIFICATE_THUMBPRINT
WINDOWS_TIMESTAMP_URL
```

The certificate must be currently valid, contain the Code Signing EKU and have
an accessible private key. The timestamp URL must be HTTPS. Do not export a PFX
into the repository.

## Build and verification

Run:

```powershell
pnpm.cmd windows:tauri:signing:preflight
pnpm.cmd windows:tauri:build:signed
```

The production command refuses to build when provider configuration or signing
tools are absent. It signs the installer through Tauri's custom signing command
and then independently verifies the resulting NSIS bundle with Windows trust
policy. The unsigned internal QA command remains separate:

```powershell
pnpm.cmd windows:tauri:build:internal
```

Before publishing:

1. Run `pnpm.cmd windows:matrix -ArtifactPath PATH_TO_SETUP_EXE`.
2. Require `authenticodeStatus: Valid`.
3. Install on clean Windows 11 and Windows 10 22H2 environments.
4. Verify publisher name, install, upgrade, uninstall and rollback.
5. Publish the same immutable bytes to Test.
6. Promote those exact bytes to Stable only after physical QA.

## SmartScreen

An Authenticode signature does not guarantee that a new download immediately
has SmartScreen reputation. Current Microsoft guidance states that EV signing
does not automatically bypass SmartScreen. Keep one stable publisher identity,
avoid unnecessary installer rebuilds, timestamp every signature and submit
false positives to Microsoft when required. Microsoft Store distribution is a
separate option and avoids the browser download reputation path.

The current external blocker is a configured Artifact Signing account/profile
or a trusted code-signing certificate. No signing identity is present in the
repository.
