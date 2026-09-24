# Windows Authenticode And SmartScreen Runbook

Tauri updater signatures and Windows Authenticode solve different problems.
The existing updater signature verifies bytes accepted by the LETSCUBE updater.
Authenticode identifies the Windows publisher and is the public installer
release gate.

## Supported signing providers

The release script supports two fail-closed providers. Select one only in the
controlled Windows release environment:

### Microsoft Artifact Signing

Public Trust is currently limited by Microsoft's organization-country list;
Russia is not on it. Do not use a Private Trust profile for a public EXE: it
does not establish trust on ordinary customer devices. Keep this provider only
for a legally eligible release entity. See Microsoft's
[Artifact Signing prerequisites](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart).

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

For the Russian ООО «КУБ», first confirm with a certificate authority that it
can validate and issue a **publicly trusted organization code-signing
certificate** to this entity and provide a Windows-compatible hardware token
or cloud HSM. Do not buy a TLS, document-signing or Private Trust certificate
for this purpose. Since June 2023, newly issued publicly trusted code-signing
private keys require hardware-backed storage; follow the issuer's provisioning
instructions rather than exporting a PFX. The issuer must confirm its chain is
accepted by the Microsoft Trusted Root Program, plus the RFC 3161 timestamp
service URL. See [Microsoft's signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

After vendor middleware is installed, make the certificate visible with an
accessible private key in `Cert:\CurrentUser\My` for the Windows release account
and set:

```text
WINDOWS_SIGNING_PROVIDER=certificate_store
WINDOWS_CERTIFICATE_THUMBPRINT
WINDOWS_TIMESTAMP_URL
```

The certificate must be currently valid, contain the Code Signing EKU and have
an accessible private key. The timestamp URL must be HTTPS. Never put the
private key, token PIN, PFX or cloud-HSM credential in the repository or chat.
The public certificate thumbprint and timestamp URL are sufficient to configure
the existing `certificate_store` path. A cloud HSM that does not expose the
certificate through the Windows certificate store needs a provider-specific
sign command; do not claim the present script supports it without a test sign.

## Build and verification

Run:

```powershell
pnpm.cmd windows:tauri:signing:preflight
pnpm.cmd windows:tauri:build:signed
```

The production command refuses to build when provider configuration or signing
tools are absent. Tauri invokes the custom signing command for Windows
executables; the post-build gate independently verifies both the release app
EXE and NSIS installer with Windows trust policy. The unsigned internal QA
command remains separate:

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

The current external blocker is a trusted, accessible code-signing certificate
for the release entity. This machine has `signtool.exe`, but no configured
provider or usable code-signing certificate. The existing MSIX Store identity
does not provide an Authenticode private key for the primary EXE installer.
Do not promote an unsigned installer to Stable or submit it to the EXE/MSI Store
product. Microsoft's [EXE/MSI requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements)
also require signatures on the shipped PE files; inspect the final installed
payload on a clean Windows 10/11 machine before Store submission.
