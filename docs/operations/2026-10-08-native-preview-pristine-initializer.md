# Native Preview Pristine Initialization

2026-10-08. **INACTIVE_SOURCE_ACCEPTED / NOT_NATIVE_ACCEPTANCE**. Independent
scoped review found no P1/P2. No plugin/MainActivity/JS consumer, actual lifecycle
issuer, protocol1, credential, consent or rich-display capability is activated.
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

## Next Acceptance

Fresh separate offline Realme app/UID: actual resumed-Activity issuer, initializer
marker/key/authenticated G0, separate cold read, exact owned-key loss/refusal and
no recreation, then exact cleanup preserving primary APK/UID/users/TestAPK.
Its source/artifact/host guards must be reviewed before execution. No paid rental
has been used in this slice. A063 remains excluded.

Historical R3 source52B2 proves separate handmade G8 primitives only, not this
composition. No syscall preemption, interrupted-call/power-loss/reboot,
hostile same-UID/cross-process custody, hardware backing or whole-vault claim.
Genuine production lifecycle binding, serialized generation/erasure/provisioning,
Task5 actual SDK/Auth binding and privacy/card acceptance remain unfinished.
D-335 stays OPEN, generic notifications unchanged, rich/Stable gates false.

[Foundation and limits](2026-10-08-native-preview-vault-foundation.md).
[Earlier isolated platform chronology](2026-10-08-native-preview-platform.md).
