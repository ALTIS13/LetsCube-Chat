# Offline vault composition instrumentation - 2026-10-10

## Initial R1 Source Checkpoint

This is the implementer's historical pre-build report. The coordinator's later
R1 refusal, calibrated Activity/cleanup repair, separate R2 package and actual
artifact/device results are recorded in the
[physical composition report](2026-10-10-native-preview-physical-composition.md).
The current Java files are R2, not the initial hashes/package described below.

Owner: bounded vault instrumentation implementer. Stage: source-ready, not compiled
or executed. Evidence: the two Java sources below, API/self-review and static checks.
Remaining proof: parent's separately packaged offline build/device invocation.
No production/native-positive/Task5 authority or release claim follows from this work.

Work began at `e7d85a6159ed3a5d6db8dc596b6de36a34edd075` on
`codex/bot-inline-media-20261002`. The pre-existing sidebar/search dirty paths were
not edited. No commits, delegation, builds, signing, device access, network calls,
private credentials or previously accepted test reruns were performed.

## Changed paths

- [VaultProvisioningInstrumentation.java](../../tests/android/VaultProvisioningInstrumentation.java)
- [VaultProvisioningProbeActivity.java](../../tests/android/VaultProvisioningProbeActivity.java)
- This report.

## Runner contract

Installed application and instrumentation target must both be
`com.letscube.qa.previewvault20261010`. Java classes stay in the internal
`com.kub.messenger` package to use package-private APIs. Declare instrumentation
`com.kub.messenger.VaultProvisioningInstrumentation` and the non-exported Activity
`com.kub.messenger.VaultProvisioningProbeActivity` only in that standalone APK.
Use an actual default `Application`, no plugin startup, network permissions,
production components, provider substitutes, clocks or Context mocks. The builder
and device guard are owned by the parent; no manifest/build configuration changed here.

Exactly two string arguments are accepted: `phase=COMPOSE` and `expected_uid`.
UID must match the actual process and Application, be an app UID in Android user 0;
CE must be unlocked. There is one invocation per process and no reset/retry phase.
Fresh owned app storage is necessary: pre-existing initializer residue is a refusal,
not something this runner cleans or repairs.

The issuer is the runner's actual Application lifecycle callback implementation,
scoped to the exact resumed probe Activity. Capture is main-thread-only; immutable
snapshot/epoch checks are memory-only on the worker. API 29 pre-pause/stop/destroy
and ordinary callbacks invalidate the retained owner; any other resumed Activity
refuses continuation. The probe separately gates late launches and has FLAG_SECURE.
This uses the real initialization gate/lifecycle contract, not a fabricated resumed
handle. It does **not** test the production `MessagePreviewForegroundAuthority`
class, which only accepts exact `MainActivity.class`, or genuine account/SID guards.

`FictionalAuthority` is deliberately conditional offline authority, **not genuine
Task5 verification, server verification or production authority**. It binds the
actual current snapshot to one exact Identity object, fictional owner/context,
literal G0/G1 revisions, one access input and one verification. It uses real wall/
elapsed clocks and the initializer's current-aware callback; the legacy verify
overload refuses. No ProducerPermit, provider, HTTP or account is fabricated.

## Exercised sequence (when the parent runs it)

1. Actual retained initializer creates authenticated EMPTY G0, installation marker
   and policy-checked AndroidKeyStore metadata key. A second factory lookup must
   return the same initializer object.
2. `beginOwned(..., revision=1, expectedGeneration=0)` must return PENDING G1 with
   its exact ticket; actual authenticated journal is PENDING with no credential key.
3. `provisionExact` must return COMMITTED G1. The same candidate alias must now be
   the only owned credential alias, with the fictional verification's exact expiry.
4. `observeOwned` must return DORMANT G1, no ticket, with unchanged journal bytes.
5. Actual load-only Reader loads the credential; actual Envelope AES-GCM decrypt/
   match returns true for the bound owner and **false**, not an exception, for a
   different fictional recipient. No access or key bytes are returned or logged.
6. Consumed-ticket replay must return INVALID_REQUEST and leave the journal unchanged.
7. `retireExact(..., revision=2, expectedGeneration=1, correlation=null)` must return
   RETIRED G2, with authenticated EMPTY G2, no credential bytes/alias/expiry and the
   exact retirement operation/base/revision. Credential lookup must refuse.
8. Marker bytes remain identical; the current metadata Reader key must still
   authenticate the retained **in-memory** original G0 ciphertext. G0 is not kept
   as a second disk journal; the actual disk head is G2.
9. Old ticket now returns UNKNOWN. Reinitialization returns UNAVAILABLE; a factory
   lookup still returns the same owner. Marker/G2 bytes and metadata-only inventory
   remain unchanged, and the deleted credential key is not recreated.
10. Disable late launches/authority, invalidate and close the owner; closed-owner
    recreation must refuse. Finish only the owned Activity, observe its actual
    retirement **and destruction**, close issuer and unregister callbacks.

## Exact output schema

Bundle `nmpv_vault` contains `NMPV_VAULT { ... }`, with exactly these 33 boolean
properties. All start false. `nmpv_vault_pid` contains only this process's positive
PID. No UID, generation, owner, operation, ticket, alias, key, access, media,
exception/cause/message or platform diagnostics are added to results or logs.
Fixed unavailable is `pass=false` and finish code 0, never an exception dump.

| Boolean property | Required evidence |
| --- | --- |
| arguments_checked | One invocation; exact COMPOSE/string-UID argument schema |
| uid_owned | Actual process/Application UID equals expected isolated UID |
| ce_unlocked | Actual UserManager reports unlocked CE |
| actual_application | Actual self-target Application/context/package |
| actual_main_entry | Main-looper initializer acquisition |
| actual_resumed_issuer | Real exact-instance resumed lifecycle snapshot |
| single_owner | Same retained initializer before and after composition |
| marker_checked | Bounded owned namespace/files, authenticated marker identity |
| metadata_policy | Actual Reader metadata load/policy validation |
| authenticated_empty_g0 | Actual authenticated EMPTY/G0/revision/base fields |
| pending_g1 | Actual PENDING/G1 and metadata-only key inventory |
| committed_g1 | Actual COMMITTED/G1, exact expiry and candidate key |
| fictional_authority_exact | One current-aware exact fictional verification |
| dormant_g1 | Actual DORMANT observation, no ticket/journal mutation |
| reader_loaded | Actual credential Reader load succeeds |
| decrypt_match | Actual Envelope match succeeds |
| wrong_owner_mismatch | Actual Envelope match returns false for wrong recipient |
| ticket_single_use | Consumed ticket returns INVALID_REQUEST without write |
| retired_empty_g2 | Actual RETIRED/EMPTY/G2 with exact empty fields |
| credential_key_absent | Exact credential alias absent, metadata-only inventory |
| missing_key_refused | Actual credential Reader refuses deleted alias |
| metadata_marker_retained | Identical marker; current metadata key authenticates G0 |
| old_ticket_refused | Post-retirement old ticket returns UNKNOWN |
| repeat_init_refused | Explicit reinitialization returns UNAVAILABLE |
| no_key_recreated | Final G2/marker bytes unchanged and credential still absent |
| phase_completed | Entire composition returns while snapshot/deadline current |
| owner_invalidated | Retained owner invalidated and closed on exit |
| owner_recreation_refused | Closed-owner factory lookup throws fixed Unavailable |
| activity_retired | Exact owned instance's actual retirement callback |
| activity_destroyed | Exact owned instance's actual destroyed callback |
| issuer_invalidated | Previous snapshot cannot remain current after close |
| callbacks_removed | Own lifecycle callbacks explicitly unregistered |
| pass | Successful current completion, all 32 preceding flags, cleanup within budget |

Total elapsed budget is 45 s; composition reserves 3 s for disposal. Main posts
and startup have 5 s waits, initializer/provision/retire callbacks at most 10 s,
all clipped to the remaining global composition budget. Future polling is local
only, not an IPC retry; timeout cancellation does not interrupt native operations.
Native/Binder calls already entered cannot be forcibly unwound by Java deadlines.
The parent's outer exact-package process guard remains necessary for a platform
hang; partial bytes/keys are retained, never repaired or silently declared erased.

## Source closure

Include the two new sources and these 13 unchanged production Java files from
`android/app/src/main/java/com/kub/messenger/`, **not** the mock JVM probes:

- [MessagePreviewPristineInitializer.java](../../android/app/src/main/java/com/kub/messenger/MessagePreviewPristineInitializer.java)
- [MessagePreviewVaultProvisioning.java](../../android/app/src/main/java/com/kub/messenger/MessagePreviewVaultProvisioning.java)
- [MessagePreviewVaultFence.java](../../android/app/src/main/java/com/kub/messenger/MessagePreviewVaultFence.java)
- [MessagePreviewInitializationGate.java](../../android/app/src/main/java/com/kub/messenger/MessagePreviewInitializationGate.java)
- [MessagePreviewCredentialKeyCustody.java](../../android/app/src/main/java/com/kub/messenger/MessagePreviewCredentialKeyCustody.java)
- [MessagePreviewCredentialEnvelope.java](../../android/app/src/main/java/com/kub/messenger/MessagePreviewCredentialEnvelope.java)
- [MessagePreviewKeystoreReader.java](../../android/app/src/main/java/com/kub/messenger/MessagePreviewKeystoreReader.java)
- [MessagePreviewMetadataEnvelope.java](../../android/app/src/main/java/com/kub/messenger/MessagePreviewMetadataEnvelope.java)
- [MessagePreviewJournalIO.java](../../android/app/src/main/java/com/kub/messenger/MessagePreviewJournalIO.java)
- [MessagePreviewAtomicBackend.java](../../android/app/src/main/java/com/kub/messenger/MessagePreviewAtomicBackend.java)
- [MessagePreviewInstallationMarker.java](../../android/app/src/main/java/com/kub/messenger/MessagePreviewInstallationMarker.java)
- [MessagePreviewOwnedKeyInventory.java](../../android/app/src/main/java/com/kub/messenger/MessagePreviewOwnedKeyInventory.java)
- [MessagePreviewVerificationState.java](../../android/app/src/main/java/com/kub/messenger/MessagePreviewVerificationState.java)

The permitted previous initializer instrumentation source was reused as a
lifecycle/UID/CE/bounded-read/output pattern, not copied as PREPARE/COLD/KEY_LOSS.
No production MainActivity, Capacitor plugin, network verification or account
bindings are in this closure. Android framework/AndroidKeyStore are real platform
dependencies. Source-name closure is **not** Java compilation proof.

## Verification and limits

Performed: manual API/sequence/thread/cleanup self-review; static schema check
(33 unique booleans, no unknown setter or unset evidence flag); source-name closure
(13 production files, no unresolved MessagePreview references); focused whitespace
and report-link checks. No behavioral RED/GREEN, SDK compilation, APK, physical
key custody or lifecycle-device result is claimed. No device observation exists
for these bytes yet. Prior accepted proofs were not rerun or relabelled.

Java SHA256 at handoff:

- Instrumentation: `0f1170b7547b70c17e80915ae62b61c53b7de935ce0631a02358719dd8fa921d`
- Activity: `e706854242254ae252ce4bc0971b61eef642cbbc7085fe2d097b1014dd58442e`

Parent's next evidence is a separately guarded offline self-target build and one
COMPOSE invocation against fresh owned storage, retaining only this boolean schema
and own PID. This task adds no production integration, display/notification path,
genuine provision authority, release change or native-positive promotion.
