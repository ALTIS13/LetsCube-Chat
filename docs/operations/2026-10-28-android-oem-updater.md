# Android OEM Archive Signing Metadata

## Current Checkpoint

Owner: Codex coordinator. Stage: reproduced and source-repaired; release pending.
The owner reports the failure on0.1.36/AE9310I. The connected INONE device reports
modelAE9310, Android13/API33 and installed0.1.39/build40. Its complete installed
APK matches the original published40 bytes. No downgrade or app-data reset.

## Observed Cause

The ordinary installed React download control fetches the complete Stable43 APK
(7,834,805 bytes), then Runtime refuses it with`SIGNER`, before an installer is
opened. Native provider resolution and the standard system InstallStart activity
are available. This is distinct from the WebView-thread defect repaired in34.

An independent in-app archive probe downloads the public43 bytes and verifies the
whole SHA256 before asking this device's PackageManager:

| Archive flags | Parsed expected package/version | modern signingInfo | Sole release signer |
| --- | --- | --- | --- |
| GET_SIGNING_CERTIFICATES | yes | absent | unavailable |
| GET_SIGNATURES | yes | absent | legacy matches |
| both flags | yes | present | modern and legacy match |

Changing the file suffix from`.part` to`.apk` does not repair modern-only parsing.
Installed package metadata with the modern flag is valid. This isolates the
archive-collection compatibility failure on the measured OEM; it is not evidence
that all Android13 devices behave this way.

## Repair And Safety

Runtime requests both collection flags onAPI28+, but still trusts only modern
`signingInfo.getApkContentsSigners()`. No fallback to legacy identity is added.
The sole-signer pin, installed/archive equality, package/version, entire-file SHA,
size, origin, owned paths and generation controls remain mandatory. API24--27
keeps the existing GET_SIGNATURES path.

The new regression compiles actual Runtime.verify and Policy unchanged, supplying
only controlled Android leaves calibrated to the measured archive behavior. Its
public certificate fixture comes from the published40 APK, not a keystore or
private key. Baseline valid-OEM verification fails withSIGNER; repaired8/8 pass,
including missing/foreign/multiple modern signers and loaded flag/identity mutants.
Affected native policy/thread/deadline cases58/58 pass. Mounted updater controls
29/29 pass with`KUB_QA_ALLOW_MUTATIONS=0`. One initial run omitted that required
environment flag and refused its hook before29 cases; that was a harness invocation
failure, not a product failure. No such refusal is counted as acceptance.

Private scoped receipts: primary`.ops-private/ae-updater-20261028/`. Only updater
state, fixed identity metadata and archive booleans are retained; no personal
content, capture, raw signatures, Auth/DB or PC-network change.

## Release Boundary

The old installed native verifier cannot receive this repair through its own
rejected APK on an affected OEM. A one-time ordinary APK replacement is required;
it must retain the package, signer and app data. Manual/ADB replacement is never
reported as successful self-update. A later genuine higher-version update is the
separate full download-to-installer acceptance boundary.

The parallel [priority-intake repair](2026-10-28-priority-intake.md) protects a new
unread browser notification from stale pending close work. It does not close all
of the tester's remaining microphone/read/sound/latency complaints.
