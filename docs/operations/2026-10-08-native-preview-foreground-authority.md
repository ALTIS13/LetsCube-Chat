# Native Preview Foreground Authority

2026-10-08. Approved D335 continuation after the isolated offline full-initializer
G0/cold/key-loss proof. This next source slice is inactive: no MainActivity/plugin/
JS consumer, storage/key, credentials, consent, notification producer or rich
display activation. Main-app/native binding and whole-vault acceptance stay open.

## Contract

One package-private owner binds the exact current Application/app UID/process.
Creation/registration occurs on the actual Android main thread before resumed
callbacks. Only the owned MainActivity from this Application can establish a
passive foreground snapshot; no caller-supplied class, JS boolean, URL or token.

Snapshots carry unforgeable in-process owner/epoch/exact-instance identity.
Pause/stop/destroy/close retire them; a delayed callback for A cannot retire a
resumed successor B. Initial/unregistered/closed/malformed/off-main admission
refuses. Clock, key/storage/network work is not performed in lifecycle locks.
Closing first retires memory, then unregisters only the exact owned callbacks;
a detach failure cannot reopen admission. No reset or closed-owner recreation.

## Verification Boundary

Focused RED/GREEN actual-source JVM controls cover registration timing, owner/
thread identity, replacement/late callbacks and close. Literal compiled omissions
must fail independent oracles. Android lifecycle/UID behavior in those fixtures
is modeled, not physical/main-app acceptance. One affected actual SDK/real
MainActivity dependency compile follows independent source review; no APK/release
build or unchanged test replay is required by this inactive source slice.

The earlier diagnostic's private issuer is not silently relabelled production
proof for this new class. Real integration, serialized credential generation/
retirement, background authorization/privacy/card acceptance remain later gates.
Generic v1 notifications and both installed migrations remain unchanged.

[Completed isolated initialization and limits](2026-10-08-native-preview-pristine-initializer.md).
[Native verification boundary](2026-10-08-native-preview-verification-bridge-plan.md).
