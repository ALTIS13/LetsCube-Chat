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
physical light/dark modes were not dispatched. Resource-closure analysis is next.

Exact fixture uninstall and switch to user0 were acknowledged. The subsequent
remove-user command failed because the ephemeral profile disappeared during the
switch. Its failed ACK remains. Frozen cleanup-reconcile then proved user15 absent,
fixture absent, original users restored, and unchanged candidate18/protected test
data without another removal. No successful original cleanup result is fabricated.

## Remaining Acceptance

Use a fresh owned ephemeral Realme profile. Preserve the existing primary/test
package UIDs, CE/DE data identities and original users. Verify the actual canonical
upgrade and anonymous launch separately from the offline fictional search
fixture. That fixture must bind its source/APK/signer/current profile and distinguish
eight synthetic semantic cases from actual ordered ADB input in both themes.
Calibration and physical-input proof cannot be supplied by declarations or
isTrusted alone. Confirm exact owned cleanup before publication.

Publish only after those gates, with the existing Stable 17 catalog compare-and-swap,
verified backup, confined owner staging and public full APK redownload/verifier.
No publication has occurred at this checkpoint. No new authenticated send,
natural-FCM delivery, installed iPhone or broad animation/FPS acceptance is claimed.
