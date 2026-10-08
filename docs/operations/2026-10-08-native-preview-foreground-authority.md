# Native Preview Foreground Authority

2026-10-08. **INACTIVE_SOURCE_ACCEPTED / SDK_DEPENDENCY_COMPILED**. Approved D335 continuation after the isolated offline full-initializer
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

## Source Result

One new package-private class, one focused unit file and two explicitly modeled
JVM fixture files implement the contract. Independent review found no P1/P2 in
this scope. The exact MainActivity class reference is retained; no voice-runtime
boolean, caller class, credential or storage port supplies foreground admission.
API29 pre-pause/stop/destroy retire earlier when delivered; ordinary callbacks
remain the API24-28 fallback. Close retires memory before exact-owned detach;
failed registration/detach or epoch exhaustion cannot reset/recreate the owner.

Calibrated feature-absence RED1, initial behavior23/23, affected9/9 after
pre-callback/order RED cases, and18 compiled literal omissions with healthy
controls were separate runs, not a fresh46/46 aggregate. MainActivity is a
type-only double in those JVM controls; actual Gate code is compiled. Its
worker reads only passive snapshot memory and refuses after retirement. The
final API24-28 comment correction has no semantic change or new test evidence.

| Final source | SHA256 |
| --- | --- |
| Foreground authority | `80E71F4687B65C269B746D5F62589EFEDD758B43544E031C841B0C34C8DE4A8A` |
| Unit controls | `165D7BD80D6CE4840256D6CCF6CC226CEE0141A1979061FB8472BD03447AFED8` |
| API/type doubles | `EF7244B88E57917A88C9C92C1D6D8F8C0BC0FCF024A1ED225F12B893A7A9AFC2` |
| Java probe | `FB858B51AE292D24CB862845162E0FC24DF9328FA0ECDA5C9E9E1E844406CFDA` |

## Actual SDK Checkpoint

One explicit existing-JBR/Gradle8.14.3 offline debug JavaCompile attempt exited1
before any task or new issuer class. Its private r1 receipt retains REFUSED;
frozen sources/configuration and the main/test APK byte pins remained unchanged.
This was not SDK acceptance or a demonstrated Java source defect. Correlated
daemon evidence localized project-cache lock I/O. A separate configuration-only
probe also failed before tasks; its full correlated stack identified a Windows
sharing violation while cache initialization tried to delete the lock file.
The holder, corruption and a junction fault were not established. Neither failed
receipt was overwritten or promoted.

One new r2 compile used a fresh explicit project cache, preserving the old cache
and its junction. Existing JBR21/Gradle8.14.3/AGP/SDK36 and real app dependencies
were unchanged; no download, cleanup, global JDK/PATH or process-stop remedy.
Actual exit0 and97 normal prerequisite tasks included one EXECUTED
`:app:compileDebugJavaWithJavac`, with no forbidden release/package/test task.
The fresh issuer class references actual MainActivity, which extends the real
Capacitor BridgeActivity; class major65. Source/config/protected APK readbacks
matched. This is actual SDK/dependency compilation, not physical callback proof.

R2 result SHA256 `61D2F38FA07F913D804E172D8399C123812C8A3308FEACE6CF499466FDE20084`;
fresh issuer class `4BE399A749603099FE6AFAC4867C0C855C617C0A9A6F7D376AFED03D0F31C80C`.

No APK/release build, signing, installation, network/Auth/SQL action, main deploy
or display activation occurred. Production callback delivery, min-SDK timing,
real consumer integration and Task5 SDK/Auth proof remain open. The earlier
separate offline G0 proof is not retargeted to this class.

[Completed isolated initialization and limits](2026-10-08-native-preview-pristine-initializer.md).
[Native verification boundary](2026-10-08-native-preview-verification-bridge-plan.md).
