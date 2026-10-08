# Native Preview Pristine Initialization

2026-10-08. **INACTIVE_SOURCE_ACCEPTED / ISOLATED_G0_DEVICE_ACCEPTED**. Independent
scoped review found no P1/P2. No plugin/MainActivity/JS consumer, production
lifecycle issuer, protocol1, credential, consent or rich-display capability is activated.
No main deployment, release publication or SQL action follows from this work.

## Composition

One package-private initializer retains the actual process/app-UID/application
Context and trusted passive issuer in one registry, with one non-main worker and
one pending slot. Closed-owner visibility is explicit; no replacement/reset.
Actual platform reads happen outside short registry/owner critical sections so
invalidate/close can retire admission while a native call is still held. The
worker slot stays busy until that call/attempt settles; no stale successor ACK.

Complete bounded current-UID owned-prefix inventory precedes marker reservation
and both key-generator boundaries, with exact-alias absence checked separately.
Exclusive checked marker creation precedes exact AES256/GCM/NoPadding/randomized/
no-user-auth key creation. The existing load-only Reader verifies the native key.
Actual Envelope and JournalIO must write/read authenticated literal EMPTY/G0,
including zero expiry/base/revision and empty alias/operation/blob. Only then can
the current Gate finish initialization. The native-private result is historical
initialization, not an access lease, live context, public durable ACK or readiness.

The sole Backend extension keeps original marker-only admission strict. A
separate post-journal recheck accepts exactly marker plus owned regular bounded
base, never new/bak/extra/link/empty/oversized evidence. It is raw evidence only;
actual authenticated exact-G0 validation remains mandatory. Failure preserves
marker/key/journal residue; there is no delete/recreate or cold recovery API.

## Evidence

New actual-source JVM coverage:20 distinct behavior scenarios and12 compiled
literal omissions across bounded selections, not one final32-case run. A real
draft lock failure was RED2 before repair; held final platform reads now allow
prompt retirement without releasing the busy worker. Existing primitives were
not retested. Files/FDs/AES-GCM are real JVM operations; Android lifecycle,
UID/CE/directory operations and the Keystore provider are explicitly fictional.

The first manual Android36/source8 bootclasspath compile refused javac's
synthetic LambdaMetafactory method. This is not a demonstrated shipping Gradle
defect. Three anonymous-implementation replacements preserve exact prior-source
semantics. Their first affected invocation retained three fixture-liveness
failures; only those three unchanged-input cases repeated once and passed.
No host-load cause, repaired race or watchdog relaxation is inferred. Timing
uncertainty remains open, not erased by the repeat.

One separate final-source Android36 javac compile passed exit0/stderr0, with all
nine selected source classes and exact before/after source readbacks. No API
doubles, Gradle/APK/device execution or legacy evidence retargeting. Independent
source review accepts the composition and syntax delta within those limits.

| Current input | SHA256 |
| --- | --- |
| Initializer | `08F70F1FB995C357F333966B6FD4DD2DE283989EDFECD84898BC24306A6F1BEE` |
| Backend | `056F2C2FFB174760151041F008E681B0DBAF8D312C8378C62F9B8FDF508F0E71` |
| Java probe | `F8A9ADCB1437A4B6BB22CE4879D92A5370A6BC19638FE60FA172880D3181801A` |
| Unit controls | `C89255EE19E833358776689225C4587214394B3E66CE35C7AF6331F5E206B963` |
| API fixture | `E27A67A77F0996102920C1BF0A40192FEDC91C7AB7C6E94ED5D30DB90C87CDD6` |

## Separate Diagnostic Artifact

The new offline self-target diagnostic uses the accepted production bytes in a
different package/UID, not a main-app integration. Its empty internal Activity
uses actual Application resume/retirement callbacks. Independent source review
accepted the fixed phase contract; source controls retained their RED/fix
chronology and were not replayed as a whole suite. Host subset mismatch and an
escaped-duplicate JSON parser P2 were repaired and independently reviewed.

One actual Android36/manual build passed all12 fixed tool stages and binary
manifest/self-target/internal Activity/no-INTERNET, defined DEX classes,
alignment and separate ephemeral QA signature checks. Before/after12 source
inputs and two local primary/test APK byte pins matched. Compiler/keytool stderr
was nonempty; successful exit codes are not described as empty diagnostics.

Artifact:41370 bytes, SHA256
`97443dbfdffe1f0523ad1068e31fb7266dd6311ce187cd718b1aab10e602e0a4`.
QA signer certificate SHA256
`3a3c1bff7f31a9560b5d352c5472fa50025a807247bfc9833b213c487f066b01`.
This is not a release-signer, APK publication or physical initialization proof.

## Device Admission Checkpoint

The first physical preflight refused before intent/install: installed TestAPK
bytes differ from the local original TestAPK. Read-only measurement confirmed
primary APK/UID unchanged and current user0/unlocked. Preserve the installed test
package, not replace it. The narrow new installed-test baseline guard was
independently reviewed; the build/local test protection remains unchanged.

The subsequent install returned code0 but its synced metadata was OTHER/unknown
ACK (stdout70B/stderr0), so native admission refused before an owner/phase receipt.
No raw output was retained and no exact ACK cause is inferred. Separate read-only
measurement found the exact new QA APK/UID/first==last install timestamp. That
measurement is not a native PASS or a recovered historical ACK. A fresh reviewed
exact-incarnation reader/recovery chain returned MATCH without changing the old
refusal. Actual new PREPARE then returned UNAVAILABLE before main initializer
entry or resumed-Activity authority; UID/CE/Application checks alone passed.
COLD/KEY_LOSS were not run. Exact diagnostic cleanup passed, preserving the
primary, users, local TestAPK and separately measured installed TestAPK.

A separate post-cleanup query measured Asleep, then an explicit wake measured
Awake with showing=false/inputRestricted=false. This is not the historical
refusal cause. A new awake-admitted attempt requires separate records; the APK,
old intents, failed observations and ACKs stay immutable. No blind reinstall,
old-intent replay, deadline relaxation or source/artifact retargeting.

## Controlled Offline Device Proof

The first awake-wrapper preflight stopped before installation: full power dump
exceeded its128KiB buffer. A narrow fixed on-device state-line projection repaired
only that observer in a new chain; unchanged predicates/cardinality, ACK/parser,
source/APK and deadlines were reused. Its source delta passed three focused
controls/one compiled omission and independent review, not a replayed whole suite.
A showing keyguard then correctly refused before an intent/install. Normal
authorized device unlock supplied the measured Awake/unrestricted precondition.

One new install of the same41370-byte APK, separate UID10552, used explicit
Stream/no-incremental and the unchanged strict ACK inspector. Actual PREPARE,
COLD and KEY_LOSS all passed in distinct PIDs7715/9383/3908. This observed the
actual factory/main/resumed issuer, single owner, checked metadata key/marker/
journal, authenticated EMPTY/G0, repeat-init refusal, cold read and exact owned
key-loss refusal/no-recreation with retained bytes. Exact cleanup passed with
target absence and primary/local-Test/installed-Test/user preservation. No
diagnostic remains; no primary clear, Auth, messages or personal captures.

This is limited physical acceptance of the initializer's exact frozen bytes in
a separate offline package, not main-app integration or Task5 native positive.
Earlier refusals/unknown ACKs remain unchanged; success after changed foreground
conditions does not establish the original failure cause.

## Next Acceptance

Next: genuine production passive lifecycle binding, serialized generation/
retirement/provisioning and failure/crash acceptance, then Task5/native/privacy/
background card integration. The controlled offline G0 chain is complete and
should not be repeated for unchanged inputs. No paid rental has been used in
this slice. A063 remains excluded.

Historical R3 source52B2 proves separate handmade G8 primitives only, not this
composition. No syscall preemption, interrupted-call/power-loss/reboot,
hostile same-UID/cross-process custody, hardware backing or whole-vault claim.
Genuine production lifecycle binding, serialized generation/erasure/provisioning,
Task5 actual SDK/Auth binding and privacy/card acceptance remain unfinished.
D-335 stays OPEN, generic notifications unchanged, rich/Stable gates false.

[Foundation and limits](2026-10-08-native-preview-vault-foundation.md).
[Earlier isolated platform chronology](2026-10-08-native-preview-platform.md).
