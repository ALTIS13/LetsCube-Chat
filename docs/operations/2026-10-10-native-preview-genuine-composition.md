# Genuine Foreground Composition

Owner: coordinator. Source branch `codex/bot-inline-media-20261002`, base
`1194d50f`, source checkpoint `43e6a42f`. Isolated genuine composition and exact
logout retirement are now accepted on Realme; ordinary/rich release remains closed.
The approved [implementation plan](2026-10-10-native-preview-genuine-composition-plan.md)
remains the sequence; completed deadline/R2/Task5/D-355 evidence is reused.

## Cause And Change

The accepted producer had no genuine plugin caller. Capacitor PluginMethod
dispatch is not main, while issuer capture and initializer admission require
main. Plugin destruction alone closes verification, not durable credentials.

- Added a QA-only holder with one native-private diagnostic request, exact
  recipient/bridge/runtime/lifecycle binding,120-second request lease and the
  original8-second verification deadline. No public JS method or ticket getter.
- Early actual MainActivity creation registers the genuine issuer before its
  first resume. Normal builds define the QA guard as false.
- The retained initializer worker composes initialize/begin/provision and the
  genuine producer. Existing verified ACK requires checked COMMITTED/G1 and a
  still-current exact invocation; an ordinary runtime boolean is insufficient.
- Cancellation invalidates the exact producer/context, then queues exact erasure
  before closing the owner. Known PENDING uses G1; a lost PENDING callback uses
  retained BEGIN correlation. Bounded failure remains unknown, not an EMPTY claim.
- Added isolated instrumentation using shared ordinary rendered login/logout
  utilities. Its later actual device result and input limits are recorded below.

## Observed Validation

Before production edits, the new reflection feature case compiled18 actual
source files successfully, failed with
`GENUINE_QA_COMPOSITION_FEATURE_ABSENT:requestQaComposition,hasQaCompositionPhase,MessagePreviewForegroundComposition`,
and checked unchanged source hashes. This is feature absence, not a shipped bug
or a compiler/setup error. Original plugin SHA256:
`c5e53190e4f4cbf21abaa39c84a7d4656d276628b88e72cdc91f8fbec7852c21`.

Affected existing selections passed16/16, zero skips/cancellations:

```powershell
node --test --test-concurrency=1 --test-name-pattern='bridge/I/O: plugin-|malformed-account retirement|ordinary-plugin' tests/unit/native-message-preview-verification.test.mjs tests/unit/native-message-preview-verification-producer.test.mjs
```

Only their necessary actual-source compile closure changed. Logging guards,
malformed/stale begin, ordinary ACK and timeout cases retain their prior oracles.
After final producer-permit and document-reload fixes, the coordinator reran
only this affected selection plus the previously absent feature contract:
17/17 passed, zero skips/cancellations. Unchanged crypto/SQL/device suites were
not repeated.

The new actual21-source JVM boundary selection passed33/33. All16 separately
compiled mutants failed their named runtime assertions, including shorter
producer expiry, original entry deadline, main dispatch, exact COMMITTED result,
logout, reload, lost PENDING correlation and erase-before-close. The first budget
mutant reached the wrong earlier oracle and was not counted; its literal timer
assertion was corrected, then only the two affected plugin cases and that mutant
were rerun (3/3). This is split-run evidence, not a fresh aggregate-suite claim.

Independent review found and reproduced two production defects: final ACK could
outlive the shorter consumed producer permit; an unbound request could cross a
real Capacitor page reload. Both had named behavioral RED before the fix and
GREEN afterward (1/1 and2/2). The final ACK now checks the retained consumed
invocation without exporting its identity. The QA WebViewListener retires both
the holder and runtime; listener removal is deferred outside SDK iteration.

Instrumentation cleanup now runs in finally with a fresh20-second budget, even
after verification expiry. It uses actual rendered logout without a live-binding
precondition or duplicate confirmation, preserves the first failure and separately
reports unknown retirement. Initial focused checks passed14/14 with seven
compiled mutants. Independent delta review then found cross-call confirmation
replay: a delayed main logout could be submitted again by finally. A shared
invocation-local LogoutAttempt now marks dispatch before awaiting its reply;
unknown cannot authorize replay, while a checked false can retry. Actual main
logout -> finally transitions went RED before the fix and GREEN after it in both
ordinary/genuine cases, including lost callback. The entire changed cleanup
fixture passed23/23, zero skips. No physical cleanup proof is inferred.
Final production delta review found no remaining issues and all five production
pins matched; coordinator read the cleanup fix independently.

## Real SDK Attempt

The SDK helper's43 preparation controls and changed-manifest read-only control1/1
passed. Read-only genuine dependency inventory covered26 jars,20 required classes
and21 API signatures. The source was frozen at21 production files/90 named
definitions plus generated ordinary-false BuildConfig. This is a pinned real API
subset, not a full runtime-classpath or APK acceptance claim.

One actual SDK36/JBR invocation in private sdk-20261010-r1 refused with
COMPILER_REFUSED: javac exit1, stdout0 bytes, stderr572 bytes. Its immutable
intent/compiler receipt and protected/source readback remain intact. Raw stderr
was not retained, so the missing dependency or API is not yet diagnosed; do not
call this a production-source bug or accepted SDK compile. Next is a new derived
diagnostic attempt with bounded sanitized public javac diagnostics, not replay or
overwrite of R1. No APK/device-install/provider/SQL/main/release effect occurred.

R2 added the genuine cached Firebase Common API definition and preserved all
21/90 production pins. Its54 preparation controls passed;27 genuine jars had
no required-definition gaps or shadows. Actual javac still refused with one
sanitized diagnostic: `compiler.err.cant.access`, `MainActivity.java:13:35`,
missing `androidx.drawerlayout.widget.DrawerLayout`. Three source/target8
warnings were separate. This diagnoses an incomplete API compile subset, not
an application-source failure. R1's lost raw stderr cannot prove which class it
was missing. R2 remains immutable; a fresh R3 will add the exact cached AndroidX
closure and reuse unchanged controls rather than replay the failed attempt.

The isolated full-QA build recipe's independent review found a stale historical
inventory filename. The actual derived intent-read now uses the candidate file
written by preparation. A candidate-only fictional filesystem reproduced RED;
the corrected behavior and omission mutant passed3/3. Final independent delta
review found no remaining issue. After source checkpoint43e6a42f, candidate
capture and independent current-source readback passed:860 copied files,
88 exact dependency junctions and all21 native/Gradle pins. Sidebar uses only
the explicitly recorded committed HEAD blob. Provider config matched the
accepted separate QA receipt. A reviewed binding was written; no build yet.

R3 preparation checked29 genuine jars,5482 definitions and68 inheritance types
with no missing supertypes or shadows (7 focused checks, unchanged54 reused).
Actual javac exited3 at the pre-existing lambda in MainActivity line159,
`compiler.err.cant.resolve.location.args`; one unsupported line was dropped
rather than storing raw compiler output. This is not a positive SDK result or
a demonstrated application defect. The next isolated attempt will check the
genuine SDK `core-lambda-stubs.jar` boot input; R3 receipts remain immutable.

## Full-QA Device Proof

The reviewed full-QA recipe was executed once. Actual Gradle compilation precedes
packaging and uses the real configured dependency/SDK graph, superseding the need
to rerun the narrower standalone subset. Target artifact acceptance passed:

- APK SHA256 `60ffbebbd5d6fc3ffdf7079ed5a0e3f90f8ef75a8234c304e6d1134d6c0d10bf`,
  7694139 bytes; separate QA package0.1.15/build16 and signer unchanged.
- Web build `fc9ec92652e0c693`, packaged assets matched; genuine Firebase values,
  QA manifest, logging-none and diagnostic DEX descriptors matched.
- All seven Gradle output roots remained owned;860 selected source files and
  QA-only true overlay matched before/after. Ordinary source guard remains false.
- Independent real compiler readback found all90 named production definitions
  plus BuildConfig (Java21), all90 DEX definitions and four custom plugins. The
  actual compile/package tasks and `BUILD SUCCESSFUL in 35s` preceded artifact
  verification. Narrow standalone R4 preparation was not executed redundantly.

Fresh Realme user0 installation/metadata passed: target UID10562, observer10563;
target first/last SDK install time1791596475659, signer/APK matched. Primary/test
APKs and users were unchanged. This fresh incarnation, not an old install receipt,
bound the later Auth and cleanup checks.

Native-test preparation review found an unbounded closure tree root. One fictional
external-root case reproduced named RED; root containment and row ownership now
pass11/11 changed controls, including a compiled omission mutant. The frozen
instrumentation sources themselves did not change. Their programmatic rendered
form setup does not prove keyboard/input/UI or end-user preview consent.

Fresh host-bound AndroidTest built once: SHA256
`3423095438357ac811b96b677ead4cafcadf64f2be79c982231eaeecd9118c03`,
459793 bytes. The target APK remained byte-identical. Original genuine case and
finally bodies were preserved; only admission used the current host incarnation.

Auth preparation passed11/11 controls and three compiled mutants. Independent
review found a pre-run observer false-positive: an already revoked baseline row
could satisfy the after-check unchanged. Actual R1 derived observer reproduced
named RED. Separate immutable R2 now requires an empty device/session baseline;
delta3/3 incl compiled omission and the affected observer1/1 passed. Other controls
were reused. R2 derivation/seal/readback and independent delta review accepted.
No Auth/device/SQL mutation occurred during that repair; no APK rebuild was needed.

One coordinator-owned R2 invocation selected only
`NativeMessagePreviewGenuineCompositionTest#normalQaSessionCommitsAndLogoutRetiresGenuineComposition`:

- Actual rendered QA login, ordinary SDK registration and genuine MainActivity
  verifier-to-vault chain reached checked INITIALIZED/PENDING/COMMITTED G1.
- Normal rendered logout reached exact RETIRED EMPTY G2, credential-key absence
  and cleared verification through the actual retained owner. The case's normal
  and finally assertions passed; no fictional authority supplied this result.
- Instrumentation exit0, one test/zero skips, stderr0, no fixed/unknown failures;
  output was parsed in memory, hashes/counts only retained. Result SHA256
  `62b13e8bbd1c502e9097433f76f82c44d8e08b5bbb65fd0edee56207c34fbb48`.
- Read-only own-QA-account/fresh-attempt window went from zero device rows and
  sessions to one newly retired endpoint, zero active endpoints/new sessions.
  This is account/time evidence, not exact-SID binding or natural FCM delivery.
- Exact-owned test removal and subsequent target/observer removal passed with
  durable intents/ACKs, fresh incarnation checks and all-user absence. Primary
  `com.kub.messenger` UID10533/APK770a29ff and pre-existing test UID10520/APK146d516d,
  plus user set, stayed unchanged. No QA package residue remains.

Independent actual result/source/artifact/cleanup audit accepted. Preparation
cleared command/candidate credential references; no raw logs, captures or personal
content were retained. Field setup was programmatic, not physical keyboard or a
person's explicit preview selection. Public capabilities stayed literal protocol0
and all rich/nativePositive flags remained false throughout.

Next is the [separate user-choice/lifecycle phase](2026-10-10-native-preview-user-choice-plan.md),
not a repeated genuine Auth/vault test or rich/card activation.

Failed standalone SDK attempts and actual QA device acceptance are distinguished
above. Normal QA Auth/registration/logout made expected own-account changes;
no provider configuration, schema/manual SQL, main deployment or release changed. Stable
Android0.1.14/build15 and all rich readiness flags remain
unchanged. No end-user preview consent, refresh/background custody, card display,
process-death recovery, natural FCM timing or multi-OEM acceptance is claimed.
