# Android Search Release Candidate

Owner: coordinator. Current stage: APK 0.1.17 / build 18 independently verified
and installed on Realme without clearing data. Owned QA cleanup is accepted;
physical search acceptance and publication remain pending after a fixture asset
closure failure. Public Stable remains 0.1.16 / build 17.
The web search repair is already accepted live at main `2ad69fc2`; this report
does not reopen its accepted browser/unit matrix. Broad search lag (item 93)
and the separate native-preview ARM diagnosis remain unresolved.

## Source And Artifact

Main-based worktree: `codex/sidebar-search-focus-20261011`, HEAD
`2ad69fc24bdb33822891a46d1b00048d1f477e30`. The only source overlay is
`android/version.properties`: 0.1.17 / 18. Root feature checkpoint is
`5869257e`, with its unrelated sidebar motion hunk and two untracked tests
preserved. No feature-branch native-preview change enters this APK.

APK: 7,630,879 bytes,
SHA-256 `92ac6568fbd8bc5664a87d610eb4ad5929b4d042b7e33d97556fe2fb190aca27`.
AAB: 7,265,802 bytes,
SHA-256 `e4c5a9726ee47a3b300792ffe7a476939845221ccbf30553372504c6daca31ee`.
Embedded web build: `5f45ba4441d2b1c1`.

Actual SDK verification accepted application/version/build, canonical v2
signature and Digital Asset Links, non-debuggable release, exact permissions
and exported components. Four actual Firebase resource-value digests match both
the canonical configuration and the already accepted build 17 baseline; no raw
values were printed. All 36 planned embedded web/configuration files match the
synced source bytes. The compiled search callback retains its frame identity,
committed visibility and connected/visible-element checks with preventScroll.
The 22 native source inputs retain the accepted build 17 fingerprint.

## Retained Refusals And Reconciliation

The source-preparation review exposed two real defects before the SDK build:
stock `assetlinks.json` inventory asymmetry, and resource-name checks that did
not bind actual Firebase initialization values. Both were repaired, with 61
focused source tests and independent R2 review accepted. These tests are not
device or delivery acceptance.

The build command produced both candidate files, but its post-build observer
refused the source snapshot. `cap sync` had rewritten four generated Gradle
plugin paths from relative paths to absolute paths through the shared
node_modules directory. Each plugin name/version and resolved directory was
verified identical. The generated file and original refusal were preserved;
only those four paths were normalized to the committed portable form.

There is deliberately no fabricated successful original `release-build.json`:
the parent observer exited 1, and the original child exit receipt was unavailable.
The existing APK/AAB were admitted independently after the normalization.
The first independent observer also refused its Java resource invocation through
cmd.exe. Direct argv invocation of the same pinned JBR/SDK succeeded and provided
the four measured digests. Both attempt intents remain, and no build was replayed.
Ten focused reconciliation checks pass; one initial fixture path-separator
mistake was corrected without device or SDK effects.

The independent offline search fixture has a separate QA identity and no network
permission. Its retained Java reports 33 diagnostics fields, not the 16-field
JavaScript input envelope; review caught the decoder mismatch before installation.
R2 fixes the strict decoder without changing Java or the retained React bundle:
58 focused checks/five omission mutants and two affected retained checks pass.
Actual SDK compilation/signing produced a 1,229,797-byte QA APK,
SHA-256 `10a79c7fbc2414377f1849b9458e7e71fbb9aa057ae44c6ea8f6478a5afabd69`.
Its original observer refused API36's `minSdkVersion` spelling; the failed receipt
is retained. Independent metadata/signature/permissions/ZIP/alignment inspection
admits the existing file without rebuilding it. Six focused observer checks pass.
Neither this artifact nor the canonical APK yet establishes physical input.

Private, ignored evidence is under `search-android-0.1.17-20261011` and
`search-android-coordinator-20261011`. It contains the actual artifact check,
preserved post-build refusal, path normalization and recovered-build checkpoint.
No credentials, tokens, personal content or raw Firebase values enter this report.

## Realme Continuation

Fresh read-only inspection found two observer assumptions, not candidate defects:
this SDK prints `appId` instead of legacy `userId`, and the preserved
instrumentation-only `.test` package has literal version `null` / build 0.
The strict device reader now supports one unambiguous anchored ID row and permits
that version pair only for the protected test package. Permission-only user
headers are excluded from CE-state parsing; malformed CE rows remain refused.
R3 and R4 each have four affected RED/GREEN checks and two omission mutants.
Earlier source suites were not replayed. The final device source is frozen at
`9e80a356f69e558674b56f8df67392c2e4353962802167c71199d45d39d5a7cb`.

The actual ephemeral QA profile 15 was created and selected, with acknowledged
creation/switch and exact custody. Primary UID 10533 and CE/DE 30938/31717,
protected test UID 10520 and CE/DE 28210/28213, and the original user digest were
preserved. The owner profile's personal application was not launched.

The original upgrade observer stopped after copying the existing APK without
recording an install ACK. At that checkpoint no accepted upgrade receipt existed.
Independent byte inspection accepted the 7,630,747-byte backup
as the exact build17 APK `f8bc6bec...7fbc152`; state then still had build17.
The original copy-command ACK is unknown and is not reconstructed from the
file's existence, nor is the historical install-attempt phase claimed known.
The separately reviewed continuation source `39dd5b9f` reused the exact frozen
device helper and original custody, independently checked current state/backup,
and installed18 once without repeating the copy or profile creation. Its new
install ACK and post-install state pass; original failure remains retained.
Primary UID10533 and CE/DE30938/31717, protected test UID10520 and CE/DE28210/28213
and original users are unchanged. The following canonical launch ACK refused:
no rendered-login proof and no automatic launch replay are claimed.

The offline fixture's one installation also produced an unknown ACK. A separate
read-only reconciliation verified its exact APK, UID1510574, only installed user15,
and unchanged protected state; it did not reinterpret or replay installation.
Host reviews repaired modern foreground selection and exact launch-component
cardinality. A publisher review repaired boolean ACK admission and requires both
themes' original command journals, not synthetic-case declarations.

Actual automatic launch was acknowledged, but the QA lockscreen's10-second
timeout overrode its screen setting. Own-profile wake/dismiss removed that
override without changing user0 settings or supplying credentials. Read-only
metadata showed eight semantic cases, but strict boot admission refuses6 missing
assets and6 native HTTP404 responses. Those values are not normalized to PASS;
physical light/dark modes were not dispatched. The subsequent resource-closure
repair is recorded below, not attributed to this original attempt.

Exact fixture uninstall and switch to user0 were acknowledged. The subsequent
remove-user command failed because the ephemeral profile disappeared during the
switch. Its failed ACK remains. Frozen cleanup-reconcile then proved user15 absent,
fixture absent, original users restored, and unchanged candidate18/protected test
data without another removal. No successful original cleanup result is fabricated.

## Resource Closure Repair

The pinned HTML/CSS declare seven fonts/icons absent from the original R2 APK.
This explains its native missing-resource failures; the numeric counter6 alone
does not identify the six actually requested URLs. All seven resources match
the canonical candidate18 APK and current public assets by bytes/SHA256.

Narrow helper/source review passed, original APK closure RED0/1, source GREEN13/13
with13 compiled omissions. Parent read-only check passed without SDK/signer/device
effects. One actual repack then added only those seven entries using the existing
JDK/Android tools and separate accepted QA signer. Ten ordered tool stages exited0
with empty stderr. Signature, identity, no permissions and alignment pass; all11
old non-signature entries, including DEX/manifest/web bundle, are byte-identical.
There was no Java/DEX/web/full-Gradle rebuild or rewrite of the original ACKs.

| Retained artifact | Value |
| --- | --- |
| New fictional fixture APK | 1,488,412 bytes |
| APK SHA256 | fd673c178108713d80574965edd5119e634f79f18968768dcc6ead3fd824c9e7 |
| Source binding SHA256 | 46cce1583a64371e828a87a4106cb683dfb7dd19b5452062b3c9d1d19d3fc210 |
| Actual artifact proof SHA256 | 12d4cbea8cbaab5aadd121202f427bc8bd718974026290338d3720471afe039e |

Output is retained under `.ops-private/search-android-assets-r3-20261011/build`.
This is artifact acceptance, not a new device boot or physical-input result.
Fresh owned profile/custody and finite light/dark input checks remain required.

## Fresh R7 Device Checkpoint

Frozen R7 source binding42d1d0b90f223ffdf5687a6dae43dc4df7baabb69df4c848d0e1aa37ffcf9ba1
is independently source-accepted. Coordinator byte/source check performs zero
ADB commands. Actual prepare creates/selects ephemeral QA16; installation has a
recognized ACK and exact current R3 APK custody. It does not repeat the earlier
primary18 upgrade or reinterpret old installation acknowledgements.

The sole automatic attempt stops at command016: AM launch exits0 with301 stdout
bytes/empty stderr, but its exact output is not recognised and the ACK staysfalse.
The original raw launch output was not retained; its spelling is unknown, not
guessed. There is no automatic-result or physical-light/dark acceptance receipt.
Separate owned `run-as` read-only diagnostics, observed in the actual tool output
but not reconstructed as a historical receipt, report stage8/fixtureReadytrue,
zero JS errors/rejections,9 native assets served,2 missing/HTTP errors and404.
The seven declared resources are artifact-complete, not a proven complete
runtime request closure. Exact missing routes still require observation/audit.

Actual fixture uninstall and switch0 have recognized ACKs. The subsequent
remove16 fails (exit1/35 stderr bytes); that failure is retained. A new read-only
reconciliation then finds QA16 and the fixture absent, users[0] restored and
primary18/test APK/UID/CE/DE unchanged, without replaying removal. It does not
assert the profile vanished during the switch; its later absence is measured.
Reconciliation SHA256:
f606cc1add5ed5cc6968013657919d4b60467d25280f099168fba45a8b609d4e.
Records remain in `.ops-private/search-android-search-r7-20261011/`.

The shared Bell fix323c4988 is now live in web/Windows, but existing candidate18
predates it. A later bundle/candidate is required; do not overwrite retained18
artifacts or waive its unpassed search gates to claim platform parity.

## Declared JS Resource Closure, R4

Read-only compiled-JS/AST analysis finds ten additional declared brand/product
assets absent from R3. Each matches canonical APK18 and current public source
bytes. Five resolved module edges are two static and three literal dynamic
imports; all module files are already present, no unresolved dynamic import is
accepted. The two native404 counts do not identify two unique requested routes.

Independent source review accepts the narrow recipe. Old actual R3 closure is
RED; focused source checks pass8/8 with twelve detected compiled omissions.
Coordinator check reads no signing material and invokes no SDK or device tool.
One actual SDK repack then passes ten ordered stages with no failures: base and
new signature, exact package/identity, no permissions, alignment and ZIP checks.
All eighteen old nonsignature entries remain byte-identical; exactly ten declared
files are added. No Java/web/Gradle rebuild or original ACK edit occurs.

New fictional QA APK2,345,428 bytes, SHA256:
8617108502242cd8c88a50c5872d200350023f23abfbb6fdb5fc11bf84397fa3.
Actual artifact proof SHA256:
dd152783f4e1c1353fbf68ec122f2f468716673a8f42e576ae1561af41ae6f3c.
Source binding SHA256:
8f34dcd970437f39fe8abdcd8ae97cb0cab09f0d30536ba0b77cd909b3512d85.
Output is retained in `.ops-private/search-android-assets-r4-20261011/build/`.

This is artifact acceptance only. A fresh R8 host observer is being prepared to
accept SDK-defined informational launch states without relaxing component,
status, timing, foreground or zero-native404 checks. Unknown fictional launch
stdout will be retained in a bounded exact record; the historical R7 stdout and
false ACK remain unknown. No new profile/input/boot result or release is claimed.

## Fresh R8 Runtime And Cleanup

R8 source bindingb1482d41 is independently accepted. A new ephemeral QA17 and
fresh R4 fixture installation have recognized acknowledgements; primary18 and
protected-test APK/UID/CE/DE are unchanged. The actual COLD launch has Statusok,
the exact fixture component, TotalTime1258, WaitTime1264 and a Complete footer.
Its original312-byte fictional launch output is privately retained, not inferred
from the older unknown R7 acknowledgement.

The one automatic attempt reaches its120-second limit and refuses. Separate
owned read-only numeric diagnostics show all15 native assets served, zero missing,
HTTP/resource/console errors and nativeErrorCode0. JavaScript boot stage8 and
module/fixture readiness pass. This proves the resource repair reached the
device, not full search acceptance. The intentional Java Enter-field aliases
decode to6/8 completed cases,4 page errors, errorCode15 and one completed theme.
Code15 is the fixture watchdog; the source puts the incomplete case in dark-theme
navigation. Neither the timeout nor these counters establish a product cause.
No physical-light/dark mode or automatic replay was dispatched.

Exact owned uninstall and switch0 were acknowledged. The subsequent remove17
command failed; its original failure remains. A separately invoked read-only
reconciliation proves QA17/fixture absent, current user0, original users and
primary18/protected-test state preserved. It does not assert when the profile
disappeared. Reconciliation SHA256:
32edd8cf4951195bfa6b2cc773c36dfb6a784056d641a0c27980482bab868547.
Records remain in `.ops-private/search-android-search-r8-20261011/`.

Next: identify the failed fixture rule without weakening zero-error/semantic
checks, then one separately bound changed-input check. Candidate19 preparation
is independent; no18/19 publication or broad native lag acceptance is claimed.

## Candidate19 Build And Retained Observer Refusal

The main-based tree323c4988 has only the metadata overlay0.1.18/build19. Before
its sole build,82 previous output/dist/sync/config files were privately copied and
verified. Its actual build child exits0, no signal/error, empty stderr,95.365s.
The post-build source gate refuses generated Capacitor absolute paths. Coordinator
restores only those four generated paths to their tracked relative versions;
the tree again has only the intended metadata change. No build is repeated.

The retained79-file candidate includes APK7,631,211 bytes, SHA256
7597eb9b6dd4794887b34a4f6822755f96b51cdc6bc7961308af9193eea6fc8c,
and AAB7,266,145 bytes, SHA256
3cf605995cdde11c977e8ab42cd1b35db6448edb0f6e9b60b9f2d7de600fb529.
Embedded/dist/sync SW49e176d396a0da9d differs from real embedded18 SW5f45ba4441d2b1c1,
local Bell fixture32a0af85cc7c06c0 and Stable17. Independent recovery-source review
accepts all three stale-build refusals and actual preserved APK/sync comparison.
The original build ACK remains postBuildSourceAccepted:false; no ordinary accepted
build receipt is fabricated. Nested build text was not retained by the launcher,
so no invented `built in Ns` marker is claimed.

Coordinator invokes the reviewed existing-artifact observer once at17:00:31 UTC.
It refuses after6.46s, retaining recovery-artifact-intent but no artifact PASS.
The exact throw is unknown because that catch did not record its stage. A source
audit finds a concrete transport regression: this derived observer missed the
accepted18 direct Java executable port and again routed JBR through cmd.exe.
This is an established source defect, not measured causality for the current
refusal. Next input restores that exact port and adds bounded safe stage codes;
the first intent, bytes, source/review records and unknown result remain immutable.
No19 installation, publication or new signer/Firebase acceptance is claimed.
Private records: `.ops-private/android-0.1.18-20261011/`.

## Existing Candidate19 Inspection Accepted

The first artifact refusal remains UNKNOWN. A separate actual source-check of
the new R2 observer exits13 in Node: its top-level await imports a derived driver
which imports the still-evaluating observer. No R2 SDK intent is created by that
failed check. A new, independently reviewed entry first completes the observer's
inert import and then awaits the unchanged derived driver. Real Node child
controls expose old exit13 RED, five amended cases GREEN and an await-omission
mutant; accepted older suites are not replayed.

Coordinator invokes the new entry's actual check without the fictional preload:
source main323c4988, metadata19, native22 and Firebase baseline pins pass, effects0.
The separately invoked existing-artifact inspection completes in11.609s at
17:42:00 UTC. Canonical signer, nondebuggable identity, approved permissions/
exports, four Firebase initialization digests,36 embedded web files and compiled
search guard all pass. APK bytes stay7597eb9b/7,631,211, SW49e176d396a0da9d; no
rebuild or ordinary build-receipt fabrication occurs. First intent/refusal and
all historical bytes remain unchanged. This is artifact, not device acceptance.

R2 binding43094a0b and entry amendment3b2793ec are retained with their independent
reviews. Actual records are `artifact-round2-check.json` and
`artifact-round2-diagnostics.json` in
`.ops-private/android-0.1.18-observer-r2-20261011/`.

## R9 Diagnostic Source And Device Readiness

R9 adds a whitelist-only15-integer diagnostic channel, phase/substep markers
around unchanged awaits and a conventional MIME correction. It preserves
eight cases/two themes/zero errors and the120-second native deadline. Neither
the MIME mismatch nor the new source identifies the historical timeout cause.
Independent source reviews accept R9 binding05689515 and finite executor
binding0d0b554a. Coordinator's actual source-only CLI check passes, SDK/signing/
device actions0. One parent-owned preload/Javac/D8/three-entry repack then passes
all14 actual SDK stages. New QA APK2,345,428 bytes, SHA256
1213fcd0f897659e220ee1c485e090ce326a3cbcd2eccc94c8bd52785e5516ad;
actual proof SHA256
000ecc75e9cafce2f4fd5f2087c149b9b7cccc529bb3321965e494563e10d953.
Four fresh Java8 classes are recorded; exact signature/identity/no permissions/
alignment and complete nonsignature ZIP parity pass. Only DEX and two diagnostic
scripts change. The retained React bundle is not rebuilt and existing R4/R8
inputs are immutable. Independent artifact/host reviews subsequently pass as
recorded below; executable DEX semantics and physical acceptance remain unclaimed.
Records:
`.ops-private/search-android-diagnostic-r9-executor-20261011/build-r1/`.

Ordinary wake/power attempts did not make the device ready. A later public
`wm dismiss-keyguard` plus ordinary wake, without PIN/settings changes or
personal capture, is followed by actual strict power/window/activity readback:
Awake/SCREEN_STATE_ON/INTERACTIVE_STATE_AWAKE, keyguard showing/restricted/secure
false. It does not reinterpret Task3's historical refusal or prove a QA target
resumed. Fresh readiness and custody are still required for new device work.
MobileNext local inventory and authenticated remote catalogue work, including
modern Android/iPhone models; no allocation, paid minute or device acceptance
is inferred from that catalogue.

## Device Follow-Up

### Fresh R9 Runtime, Refusal And Cleanup

Independent actual artifact review accepts all14 ordered intent/ACK pairs, four
actual classes and complete ZIP parity:25 other nonsignature entries unchanged,
three exact replacements. Independent executable DEX semantics remain unclaimed;
hash-bound Javac/D8/source proof suffices for this fictional offline measurement
artifact, not production/runtime acceptance. Host bindingc4f59315 and actual
source/local-artifact CLI checks pass without SDK/device effects.

After a fresh public dismissal/wake and strict screen-ready readback, coordinator
creates new ephemeral QA18 and installs APK1213fcd0 with accepted acknowledgements.
One automatic attempt refuses; no physical mode is dispatched. Its whitelisted
numeric record identifies phase5/substep14/theme1, terminal3, visible+empty+focused
predicate14/known127. Two of eight cases completed, semantic error5. It is the
caught no-focus assertion after Back, not the old dark watchdog. Boot stage8,
served15/missing0 and zero page/resource/HTTP/console errors are measured.
Original refusal SHA256:
d67ae5b02529d992a42e8d58cab61a458f25ec442a590d26f6bc98760d757e51.

Source diagnosis finds no new Header focus job on Back. The synthetic DOM click
has not measured navigation focus transfer, and an older fictional Back stub
explicitly clears activeElement. Neither establishes actual browser fixup or a
product regression. Offline DOM/pointer/touch calibration is next; do not insert
a fake blur, remove the assertion, normalize counters or replay this attempt.
The host separately polls to its deadline despite stable terminal3 failure;
a narrow stable-two-read fail-fast amendment is being prepared, with strict
semantic acceptance unchanged.

Exact fixture uninstall and switch0 are acknowledged. Remove18 fails; its
original exit1/unknown acknowledgement is retained. Separately invoked read-only
reconciliation proves QA18/fixture absent, current0/original users[0] and exact
primary18/protected-test APK/UID/CE/DE preserved. It does not claim the profile
vanished during switch or change the failed command to PASS. Reconciliation SHA:
a94d691c3155d7f25c4b19bb21d465142a55e50f582a7f0f38f6f61f19915b87.
Actual records: `.ops-private/search-android-diagnostic-r9-device-20261011/`.

### Private19 Upgrade Source Boundary

Prepared source binds actual19 artifact/R2/entry provenance, private APK only,
36 support pins, protected18/test/users and current absence of all owned QA
packages. Parent source-only CLI check passes; new exact directory's private
three-principal inheritable DACL is established/read back. No install runs.
Independent review reproduces one late source-after receipt save: actual handler
returns PASS at120001ms. Minimal post-save deadline/completion-contract repair
is pending in a separate derivative; frozen original source/report remain.
This is an executor defect, not a production/app failure or reason to retry an
installation. Existing candidate19 artifact acceptance stays valid.

## Remaining Acceptance

### Focus Calibration And Source Repairs

An anonymous offline Chromium/WebKit calibration completes18 paths in7.141s:
DOM click, desktop pointer and emulated390 touch, each with display-none,
clip-only and rendered-hidden controls. All pages/contexts/browsers close; zero
requests, errors or captures. DOM click does not guarantee focus transfer;
display-none return loses field focus in all six groups and does not reproduce
actual R9. Clip-only changes geometry/timing and is not the app's navigation.
This is neither full React nor Android proof; actual R9 root cause remains UNKNOWN.
Records: `.ops-private/search-r9-click-focus-control-20261011/`.

R10 reader binding5d6f78f2 is independently SOURCE_ACCEPTED. Two matching validated
terminal3 packets now refuse promptly rather than polling120s. Eight affected
controls/three compiled mutants pass; original helper goes RED. Original PASS
prefix, strict eight-case/two-theme/zero-error rules and refusal metadata stay
unchanged. No R10 host or device acceptance is claimed.

Read-only actual R9 source/APK admission disproves an assumed passive-init port:
fresh native start-chat invokes the automatic suite; a FAILED suite cannot
activate the passive companion. No host/device runner is dispatched from that
blocked source. A new purpose-only offline diagnostic is being prepared: one
preload entry initializes the existing passive companion, with unchanged DEX,
React, identity and permissions. All release/product/ordinary-matrix gates stay
false; it measures one real touch query/result/Back, not a synthetic PASS bypass.
Blocked source evidence: `.ops-private/search-android-navigation-diagnostic-20261011/`.

Private19 R2 binding12963cfd is independently accepted. It checks the native
budget after source-after completes; the final exclusive local journal has a
separate completion contract. Parent requires returned completion plus exact
result-file SHA, not a result JSON alone. Eight affected controls/two compiled
mutants pass, R1/36 support pins are preserved. Exact private parent DACL and
source-only CLI check pass. No SDK/device/install occurs in that check.
Records: `.ops-private/android-0.1.18-device-r2-20261011/`.

Use a fresh owned ephemeral Realme profile. Preserve the existing primary/test
package UIDs, CE/DE data identities and original users. Reuse the accepted canonical
upgrade; its unknown anonymous-launch ACK is separate from the offline fictional search
fixture. That fixture must bind its source/APK/signer/current profile and distinguish
eight synthetic semantic cases from actual ordered ADB input in both themes.
Calibration and physical-input proof cannot be supplied by declarations or
isTrusted alone. Confirm exact owned cleanup before publication.

Publish only after those gates, with the existing Stable 17 catalog compare-and-swap,
verified backup, confined owner staging and public full APK redownload/verifier.
No publication has occurred at this checkpoint. No new authenticated send,
natural-FCM delivery, installed iPhone or broad animation/FPS acceptance is claimed.
