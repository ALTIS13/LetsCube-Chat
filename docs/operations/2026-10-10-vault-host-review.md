# Offline physical vault composition host review

**Date:** 2026-10-10
**Scope:** static, read-only review of the proposed composition builder, its
private manifest, and the exact-owned device host. No SDK, device, ADB, API,
build, or prior test execution was performed.

## Current Verdict

R2 final artifact/source binding and physical evidence are independently
**ACCEPTED**. The reviewer read only the new R2 source, artifact and eleven
write-once device records; no SDK/ADB/API or test replay. Helper SHA256
`97668bca47cc113de029754df7ec54106bbceba3b50e69e01cdb7c7d58cafe50`,
16 source pins, exact 112 Java/JAR/DEX definitions and all 79 named definitions
matched. Owner/intent/ACK/core/outcome/cleanup bindings were consistent; all
33 booleans true, exact target absent, primary/test/users preserved. The
[physical report](2026-10-10-native-preview-physical-composition.md) retains the
failed R1, causal Activity-order repair and bounded cleanup controls. This is
offline fictional authority, not genuine Auth/production foreground/consent/card.

The remaining sections retain chronological R1 static review and repaired findings.

The following initial findings were repaired and independently re-reviewed.
Final builder specification and core/API/lifecycle/cleanup static contracts are
**ACCEPTED**. This permits one isolated offline build, not a claim that it compiled
or passed on the device. The reviewer did not execute SDK/D8/ADB/API or repeat tests.

The full closure now requires 79 explicit unique named definitions: 70 unchanged
production definitions from the accepted SDK graph, excluding runtime/producer/
parser, plus nine reviewed QA definitions. Unknown named classes refuse; only
anonymous numeric suffixes are dynamically frozen. Fresh Java class definitions
and bytes must match the JAR; the complete descriptor schema and JAR SHA are
sealed before D8. Final DEX independently requires all named definitions and exact
full schema equality. Schema hash and definition count are in the artifact/device
checks. No producer class is allowed.

The canonical 33-boolean schema includes its final `pass`; cleanup failures after
successful composition remain measured unavailable. All thirteen production path
pins are required. Accepted installation has a durable intermediate state and a
bounded two-observation exact-owner recovery/cleanup path. An interrupted accepted
ACK can use `--recover-owner` without reinstalling. An unknown ACK never permits
guessed deletion; it stays explicit `OWNERSHIP_UNRESOLVED`, not PASS or NOT_OWNED.

Parent controls: device host8/8; builder8/8, followed by affected class-gate2/2
after adding a causal compiled missing-nested omission control. The initial
preparation RED was not a shipped regression. There has been no device effect
at this static acceptance checkpoint.

## Initial Verdict

- **Specification verdict: REFUSED for runner freeze or physical execution.**
  Two required properties are not yet proved: mandatory cleanup after every
  accepted install, and an exact DEX class graph with the producer excluded.
- **Quality verdict: strong fail-closed foundation, blocked by two concrete
  correctness gaps and two freeze-time non-vacuity guards.** The exact package,
  self-target, manifest, source/tool/protected-artifact pins, user-0 ownership,
  preservation checks, and no-replay records are otherwise composed coherently.
- `SOURCE_BINDING.status === "PENDING"`, the two runner-source pins, `FLAGS`, and
  `SOURCE_PINS` are intentionally unfinished. Their unfinished state is not a
  finding: it currently prevents the device path from starting.

## Findings

### P1 - An accepted or outcome-unknown install can escape mandatory cleanup

The host records an accepted streamed install and then performs a fresh device
observation. `ownerSealed` becomes true only after that observation, target
validation, and the durable `prepare-owner` write
(`native-preview-vault-composition-device-20261010.mjs:139-144`). The `finally`
block attempts cleanup only when `ownerSealed` is already true
(`:157-161`).

Therefore an accepted install followed by a read failure, target-validation
failure, or owner-record write failure can leave the new package installed. The
same gap exists when ADB times out or returns an ambiguous mutation result after
the package manager has already committed the install: the mutation guard
refuses before owner sealing. The run correctly refuses PASS, but it has no
exact recovery path: explicit `--cleanup` requires the missing `prepare-owner` record
(`:110-114`). This violates the requested mandatory exact cleanup property and
can strand the QA target even though primary/test preservation remains intact.

**Required bounded fix before execution:** after an accepted install, persist a
distinct install-accepted state and make the finally/recovery path establish the
same exact user-0 UID, APK hash, and first/last-install ownership before removal.
The host must not report completion until absence across all users is observed.
If ownership cannot be established, it must remain a documented cleanup blocker,
not silently become `NOT_OWNED`.

### P1 - The verifier does not prove an exact DEX class graph

The builder requires the expected top-level classes, but then permits every
descriptor matching broad `MessagePreview\w+` or host-class patterns
(`build.mjs:341-347`). `definitionCount` is returned by `verify`, but neither
`checkBuildReceipt` nor the device host constrains it (`build.mjs:240-252,
356-357`). An additional top-level producer or other `MessagePreview*` class can
therefore coexist with all required classes and still produce a PASS receipt.

The source list does exclude a producer file, and isolated `javac` prevents
ambient source discovery, but that is not equivalent to proving the final DEX
definitions. A pinned source may define another package-private top-level class,
and the current artifact verifier would accept it.

**Required bounded fix before execution:** freeze and compare an exact descriptor
set (including explicitly allowed nested classes), or an equally strict exact
top-level/nested schema plus `definitionCount`. Explicitly reject the producer
descriptor. Carry the exact class schema into the build receipt and device
artifact checks.

### P2 - Observation schema retains a hard-coded 18-key assumption

`parseObservation` requires exactly 18 keys while `FLAGS` is separately frozen
(`native-preview-vault-composition-device-20261010.mjs:42,62-68`). This is a
residual assumption from the previous host. A legitimate composition schema
with another size will always refuse, while leaving the literal unchanged risks
freezing the new runner around an old count rather than its reviewed contract.

**Required freeze gate:** require a non-empty, unique `FLAGS` list containing the
mandatory completion flag, compare `Object.keys(flags).length` with
`FLAGS.length`, and retain canonical key order plus boolean-only values. Do not
copy the value 18 unless the final reviewed runner independently has exactly 18
flags.

### P2 - Per-path source pins can remain empty through a frozen binding

The device host checks `Object.entries(SOURCE_PINS).every(...)`, which is
vacuously true for the current empty object
(`native-preview-vault-composition-device-20261010.mjs:258-273`). The separately
reviewed `sourceDigest` still binds the complete `api.PINS` object, so this is not
an unbound artifact by itself. It is nevertheless a false completion hazard for
the explicit per-path source-pin gate: `SOURCE_BINDING` could be frozen while
`SOURCE_PINS` was accidentally left empty.

**Required freeze gate:** assert that `SOURCE_PINS` has the exact reviewed count
and exact path set, then compare every value to `api.PINS`. Keep the full-object
digest as an additional independent binding.

## Verified static properties

- Exact new package and self-target are both
  `com.letscube.qa.previewvault20261010` in builder constants and the private
  manifest.
- The private manifest contains one non-exported Activity, one self-targeted
  instrumentation declaration, no permission element, no public Activity, no
  shared UID, no backup, no debug mode, and no cleartext traffic.
- The pinned graph is currently **13 production Java sources + 2 host Java
  sources + 1 private manifest = 16 pins**. No producer source is listed.
- `javac` receives only the pinned Java paths; classpath, sourcepath, class
  output, DEX output, APK intermediates, signer, and evidence are isolated under
  the exclusive owned directory. Annotation processing is disabled.
- Nine build tools are hash-pinned. The release and androidTest APK files are
  independently preserved by exact hashes and re-read before, during, and after
  the build.
- Source and binary manifest validators both reject permissions and require the
  internal Activity. The archive admits exactly one DEX file.
- Build and device attempts use exclusive durable records and explicit phases;
  all intent records state `replayAllowed: false`.
- Before install, the target must be absent for every enumerated Android user.
  After install, ownership binds user 0, a fresh non-primary/non-test UID, the
  exact APK hash, and equal first/last install timestamps. Later observations
  must match the sealed owner.
- Primary APK, installed test APK, user inventory, and their UIDs are checked
  against fixed baselines and across each transition. A successful outcome is
  impossible without an exact observed cleanup and all-user target absence.
- Provider output is size-bounded and canonicalized; once the schema guard is
  corrected, every accepted result value is required to be boolean. Public CLI
  output contains only bounded status/reason codes and preservation booleans.

## Runner freeze gates

1. Close both P1 findings before any build or device command.
2. Freeze the two host-source hashes and verify the 16-entry graph still means
   13 production sources, two host sources, and one private manifest.
3. Freeze a non-empty exact `SOURCE_PINS` map and complete `SOURCE_BINDING` from
   reviewed artifacts only; never learn hashes from a live run.
4. Freeze the exact boolean observation schema without the inherited key-count
   literal, and bind the exact DEX descriptor schema into the receipt.
5. Re-review the resulting static delta. Only then may the coordinator decide
   whether to run the separate build/device gates.
