# Genuine Foreground Composition

Owner: coordinator. Source branch `codex/bot-inline-media-20261002`, base
`1194d50f`. This is an in-progress source stage, not Android/device acceptance.
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
  utilities. It is authored source only and has not run on a device.

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
review found no remaining issue. Candidate capture/build is still pending.

## Remaining Proof

Diagnose and complete real SDK/Capacitor/Firebase compilation; build one isolated full
QA artifact using the already accepted separate provider/signer identity; run one
genuine composed Realme invocation with exact erasure and owned cleanup.

The actual SDK refusal and ADB availability check are reported above; no APK
installation/provider/SQL/main/release effect was performed. Stable
Android0.1.14/build15 and all rich readiness flags remain
unchanged. No end-user preview consent, refresh/background custody, card display,
process-death recovery, natural FCM timing or multi-OEM acceptance is claimed.
