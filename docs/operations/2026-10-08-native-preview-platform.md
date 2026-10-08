# Native Preview Platform Probe

2026-10-08. D-335 remains OPEN. This is a separate credential-free diagnostic
app, not the LETSCUBE release, Task5 binding, initialized vault or rich display.
Realme only; A063 untouched. No paid rental, Auth, FCM, personal capture, SQL,
network-policy change or release publication.

## Artifact And Attempt Boundaries

Self-target package `com.letscube.qa.previewvault20261008`, separate app UID,
no Activity/WebView/INTERNET/account permissions/shared UID/backup/debugging.
The APK embeds the actual verification-state, envelope, checked journal,
AtomicFile backend and Keystore reader sources. Marker/fence are not embedded.
The only data is an empty authenticated fictional G8 record and its own test key.

Manual SDK recipe produced APK24,985 bytes:
`7589548CE71B4C4E74F56E57FFFC7E2C398B387FD597D5B04D7BE5AC7F1C4A32`.
Separate ephemeral diagnostic signer, not the release signer. No key material
belongs in this report or Git.

Original failed attempts are retained, not replayed or relabelled:

- First attempt: Android36 javac rejected the diagnostic executor lambda.
  Anonymous Runnable adaptation then exposed a monitor-owner issue; fixed and
  verified against compiled Android bytecode before continuing.
- r1: compile/JAR completed, executor rejected the literal stage name `D8` before
  dispatch. Fixed exact stage/tool mapping; new r2 was a distinct attempt.
- r2: all nine build/sign stages completed; final manifest observation rejected
  actual aapt2 literal `false`. Original r2 result remains FAILED.
- Separate read-only postbuild validation passed actual manifest, DEX classes,
  alignment and signature after a scoped parser correction. No rebuild/re-sign.
  These are artifact checks, not executed Android phases.

Frozen main APK770a29ff and original instrumentation APKba4573c8 remained
byte-identical. Unpublished candidate0.1.15/build16 and published Stable0.1.14/
build15 are unchanged.

## Device Checkpoint

The first `--prepare` refused at install acknowledgement before owner receipt or
instrumentation. The raw acknowledgement was not retained; a streamed-install
banner is a reproduced parser limitation, not a recovered actual response.
Read-only observation confirmed the exact diagnostic APK installed for user0
under a UID different from LETSCUBE, install/update times matching the owned
attempt, primary APK/UID and user digest unchanged. Installer metadata was null;
it is not evidence of an adb installer identity.

Original failed intent remains immutable. A separate explicit reconciliation
and no-install forward phase are required before any instrumentation; missing
old receipts must not be fabricated. Exact diagnostic cleanup is mandatory.
Separate reconciliation ran once, MATCH, without instrumentation. Its new
forward PREPARE then ran once and refused at BACKEND_CREATE: current UID/CE,
missing-namespace/no-auto-create and DP refusals, fixture creation, real
AndroidKeyStore AES256 generation and KeyInfo/reader checks were observed true.
Raw platform root equality with its canonical form was false. The existing
backend rejects that equality before journal I/O; no G8/authentication/restart/
key-loss result was reached or claimed. COLD/KEY_LOSS were not invoked.

Exact owned cleanup ran once and passed: target absent, original primary APK/UID,
user digest and local main/TestAPK preserved. The failed original ACK and new
forward failure remain distinct immutable evidence. No QA app remains from this
attempt. Next is a narrow trusted-platform-root normalization repair, preserving
strict leaf-symlink/traversal and owned namespace/base/new/bak checks, then a
distinct changed-artifact attempt rather than replaying either failed PREPARE.

## R3 Artifact And Recovery Gate

Independent source review accepted the trusted-root repair and narrow new-attempt
helper delta. Actual R3 build passed all nine stages plus manifest/DEX/alignment/
signature checks; source/preserved-file readback passed. APK24,985 bytes,
SHA256 `9F861A9A3712F9EA96498EACFCF84C6DB227A753106C8CC43361F94734BEB6AF`.
It uses repaired backend52B2, unchanged diagnostic Java9F1 and a separate
diagnostic signer. It does not embed marker/inventory/admission-gate leaves.

Original R3 PREPARE refused again at install ACK, before owner/instrumentation.
Exact new APK was installed under its new app UID. Read-only current-incarnation
calibration matched APK/UID/firstInstall=lastUpdate/timestamps and preserved
primary/users/main/TestAPK; installer is null. No historical raw ACK was recovered
and no actual output-shape cause is asserted. Original failed intent remains.
Separate fresh read-only reconciliation and no-install forward phases subsequently
passed after independent recovery-delta review. The original failed intent and
unknown ACK remain unchanged; they are not relabelled successful.
Future install helpers must retain safe bounded ACK observations before checking
the result, so another refused acknowledgement cannot silently lose its shape.

## R3 Physical Results

Each explicit phase ran once under the exact reconciled UID10550, without an
installation replay. PREPARE, COLD and KEY_LOSS each returned PASS/COMPLETE:

- PREPARE, PID21131: actual CE/unlocked and missing-namespace/no-auto-create
  checks; DP refusals; own fictional fixture and AES256 key/KeyInfo; checked
  authenticated G8 round-trip; failed pending write preserved G8; a foreign
  stream refused without being closed; journal retained.
- COLD, PID7350: after stopping only the diagnostic package, a different process
  read the existing own key and authenticated G8. No new fixture/key was created.
- KEY_LOSS, PID21557: another stopped/restarted process authenticated G8 first,
  deleted only its fixture metadata key, retained the journal and observed both
  reader and journal UNAVAILABLE with the key still absent. No automatic repair.

Raw rootCanonicalMatches remained false in all three phases. That observation
is retained: trusted-root normalization, not falsified canonical equality,
allowed the checked backend to operate.

Exact cleanup ran once and passed: diagnostic absent, primary installed
APK770a29ff/UID10533, original user digest and local main/TestAPK preserved.
No diagnostic remains from R3. Fixed scalar receipts are kept privately in the
distinct recovery chain; no content, bearer, key material or personal capture.

## Remaining Acceptance

Real app-UID CE admission and generated-key/reader policy were observed, not
hardware backing or other-user isolation. Checked journal round-trip,
process-restart and missing-key/no-recreation passed in the separate diagnostic.
This does not prove reboot/power-loss, other-user isolation,
application lifecycle ownership, Task5 SDK/Auth/resolver binding or OS-card
privacy. Pristine marker/key initialization and full generation/erasure/provision
remain unimplemented. No protocol1/consent/credential/background integration is enabled.

[Source scope and frozen platform inputs](2026-10-08-native-preview-journal-io.md).
[Initialization contract](2026-10-08-native-preview-vault-foundation.md).

Android's documented [no-backup directory API](https://developer.android.com/reference/android/content/Context#getNoBackupFilesDir())
provides the application-specific absolute path, not a promised canonical string.
The actual noncanonical-root observation above is device evidence, not inferred
from that documentation. Fixed system-directory metadata alone did not establish
the exact alias implementation or private path; no private path was captured.
