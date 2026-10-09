# Native Preview Provisioning Composition

2026-10-09 Moscow. Coordinator. Conditional source independently accepted after
focused fixes; actual Android SDK API compile passed. Physical composition and
genuine producer acceptance remain pending.
This is inactive internal Android work, not a deployed feature or Stable release.

## Scope

Local candidate `a50ef14f` contains exactly five files, 1051 additions/9 deletions:
new package-private [program](../../android/app/src/main/java/com/kub/messenger/MessagePreviewVaultProvisioning.java),
the existing [retained owner](../../android/app/src/main/java/com/kub/messenger/MessagePreviewPristineInitializer.java),
one [actual-graph probe](../../tests/java/com/kub/messenger/MessagePreviewVaultProvisioningProbe.java),
one [unit harness](../../tests/unit/native-message-preview-vault-provisioning.test.mjs)
and one [fictional Android/provider fixture](../../tests/android/message-preview-vault-provisioning.fixture.mjs).
No plugin, verification runtime, JavaScript, database, package identity, release
configuration or production consumer changed. Existing primitives are reused.

Ordinary construction is unbound and cannot acquire credentials. An explicit
conditional trusted supplier remains a future integration input, not actual
Task5 authority. The same application/UID/retained worker owns initialization,
phase history, exact-key requests, bounded acquisition and one queued erasure.

The acquiring sequence checks the old-alias tombstone/delete/absence, records a
new opaque PENDING alias, consumes a one-use ticket and fresh verification result,
creates a credential key through the existing custody port, seals the inner
credential and verifies the exact authenticated nonempty readback. COMMITTED is
dormant storage, not consent, a background fetch lease or display authority.

Tickets expire no later than BEGIN+15s; fresh verification is <=8s and key creation
<=10s, clipped to the original budget. Effective wall advances with monotonic
elapsed time even after wall rollback. Erasure invalidates memory immediately,
has a separate 10s admission budget and does not renew it after held work settles.
Busy ownership is retained through entered work and the owned cleanup continuation.

## Source Evidence And Limits

Author evidence is chronological, not a fresh final aggregate: one availability
RED/GREEN, 34 distinct behavioral oracles observed GREEN across selected runs,
14 calibrated compiled omissions killed. The final harness lists 49 tests; no
fresh final49/49 run is claimed. Compiler/setup and two mutation calibration
failures were retained and repaired only in affected selections. Draft failures
included stale intent changing context, expiry after held initialization still
allowing mint, and context loss cancelling erasure-only REFUSED work.

The JVM graph compiles thirteen real production sources. UID/clock/foreground,
AtomicFile, verification and Android Keystore API/provider boundaries are fictional;
AES-GCM uses real JCA. That does not prove Android durability, physical erasure,
genuine verification, installed-client integration, FCM or OS-card privacy.

Initial candidate hashes: initializer `C41304FA6424BBE4DD0322A08D09F14898C1A53FD950DD67CD69EC8728D0F4F7`;
program `892A93E74B15265260BB05DBA7C2BF7394B795B9F11A81352E817FEF81A41034`.
The initial independent review found a nested-current elapsed-sample ordering
defect, stale acquisition history after a successful EMPTY retirement, and a
miscalibrated initial-read case labeled preauthentication. The narrow R1/R2/R3
fix in `a0e0fc27` merges the sampled clock before the nested current check,
detaches only the exact completed acquisition after authenticated EMPTY
retirement, and covers the actual JIO preauthentication hold separately.
Its incremental evidence is 13 distinct behavior controls GREEN and four
calibrated compiled omissions killed, not a new aggregate or old suite replay.
Failed original expiry calibration is retained; the corrected input alone and
its exact old-order omission passed separately. Independent final review
E6BB3380 has SPEC/QUALITY PASS with no remaining P1/P2 in this conditional scope.
Accepted hashes: initializer `40B08AFDCE0012E4E693C78F8C7ED02DA3E3287054DDD5502669885FE7EBEA85`;
program `F5BECDE2E49DD8943CF49489A081636AF8DAD277BD2347EF6DCBE2D66B3F6E31`.
The new compiler program's inert controls pass14/14 including4 VM omissions;
these helper controls are not an actual SDK compile. After source acceptance,
the exact final source/class binding passed two affected controls (RED2/GREEN2),
unchanged-body and 69-name closure checks, and independent review3B03C47A.

## Actual SDK Evidence

One actual Android36/JBR compile passed at11:09 Moscow on2026-10-09: thirteen
full production sources, fresh isolated classpath/sourcepath, proc:none and
source8/target8. All69 required named class definitions have fresh checked
CAFEBABE/major52 bytes. Anonymous/synthetic outputs are not included in that
named count. Source/helper/tool and protected main/Test APK equality passed
before/after; no APK/device effect or ongoing compiler job. Result SHA256:
`EB609DA878E7BCEFA4588AEE203109EC2396D2443A5FD44D6E1B58DDB316F393`.
This proves API/source compatibility for `a0e0fc27`, not provider, physical,
credential authority or activation. Subsequent D4 source changes require their
own changed-input acceptance; this compile is never silently retargeted.

## Remaining Integration Boundaries

A reserved BEGIN with no materialized phase has no valid base-generation
predecessor for the frozen custody port. Immediate invalidation still applies;
after settlement the branch remains INCOMPLETE/uncertain, without guessed records,
key deletion, positive EMPTY or successor acquisition. A separately reviewed
retirement-only basis extension is required for positive cleanup of that branch;
it is the next approved D4 implementation slice, not covered by D3 acceptance.

Existing Task5 returns only a Boolean and its verification ticket is attempted
once. A cached flag, raw expiry, reset or second verifier cannot supply this
program's fresh invocation-bound authority. Genuine producer/lifecycle wiring,
real device binding, physical composition and subsequent consent/fetch/card
acceptance remain separate stages. No protocol1/nativePositive/rich/Stable
promotion follows from this source or compiler-program preparation.

The [previous physical custody proof](2026-10-08-native-preview-key-custody.md)
remains accepted for its unchanged primitive. It was not replayed or relabelled as
composition proof. Web/main `4765bcad` and Android Stable0.1.14/build15 remain the
accepted product baseline. No main deployment, APK replacement, paid rental or
database dispatch occurred for this source candidate.
