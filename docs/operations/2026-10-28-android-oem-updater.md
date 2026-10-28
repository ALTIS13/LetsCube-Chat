# Android OEM Archive Signing Metadata

## Current Checkpoint

Owner: Codex coordinator. Stage: Android0.1.43/build44 RELEASED/Stable at19:33Z,
mandatory=false; full public APK size/hash verified. Source`f56c4e7f`, product
`c62e785f`. Previous43 catalog/APK retained, not an automatic downgrade claim.
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

The release APK is7,834,869 bytes, SHA256
`dbd10678fc4da4b513b0a704df82849ee1e462cec1ce9f11e72ea031ecb7ec81`.
Original APK/AAB signer, Firebase four values, QA/debug=false, native/web/config
parity and known-secret scan pass. Build markers: shared web bundle6cb559bf4b43f5d8,
Vite27.44s, Gradle32s. Independent source and publication reviews found no blocker.

Actual AE40->44 manual bootstrap retains UID, firstInstallTime and data path; full
installed APK matches the release. Its fixed installed Runtime's own flags,
identity method and Policy signer pin accept the same public43 archive. The
modern-only control remains null, so the device's parser behavior was not changed
to manufacture a pass. Helper and exact temporary archive directory/files are
removed; normal MainActivity return and fatal0 pass. Realme43->44 guest/startup,
same retained identity and fatal0 also pass. An initial Realme lock-state refusal
occurs before install; an independent fresh unlocked check precedes the real run.
No device reset, uninstall of LETSCUBE, downgrade, account/session mutation,
notification delivery or new all-media acceptance is claimed.

The old installed native verifier cannot receive this repair through its own
rejected APK on an affected OEM. A one-time ordinary APK replacement is required;
it must retain the package, signer and app data. Manual/ADB replacement is never
reported as successful self-update. A later genuine higher-version update is the
separate full download-to-installer acceptance boundary. Both measured phones now
have44. A063 and rentals were not used; no SQL, Windows/Apple package or PC/Happ
network changes. Existing accepted cold-media43 evidence is retained, not replayed.

The parallel [priority-intake repair](2026-10-28-priority-intake.md) protects a new
unread browser notification from stale pending close work. It does not close all
of the tester's remaining microphone/read/sound/latency complaints.

Shared web at`f56c4e7f` is accepted19:36:10Z, build`9e1a29680bf352c5`: sole healthy
image and public/container HTML/SW/entry hashes match. The actual new entry carries
the post-ready close guard; the exact retained43 bundle is a calibrated negative
control. Earlier offline-cache/history markers remain present. The native bundle
has its own build`6cb559bf4b43f5d8`; these IDs are not equated. No layout/style change
or new physical browser/iPhone notification acceptance is claimed.
