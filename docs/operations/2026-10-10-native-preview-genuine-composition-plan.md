# Genuine QA Foreground Composition Implementation Plan

> For execution: use the approved coordinator/reviewer arrangement and the
> relevant implementation/verification skills; do not create sidebar tasks or
> another permission round. This sidecar writes only this plan.

**Goal:** accept one genuine, same-invocation verifier-to-vault composition in
the full isolated QA Capacitor application, then erase its exact credentials.

**Architecture:** add a one-use, QA-only native diagnostic request to the actual
`MessagePreviews` plugin. The next ordinary JS `verifyBinding` call uses the
existing runtime and real MainActivity authority, but provisions through the
retained initializer worker instead of the ordinary verification executor.

**Tech stack:** existing Java/AndroidKeyStore/AtomicFile, Capacitor, Firebase SDK,
Supabase Auth/resolver transport and Node/JVM test harnesses; no new dependency.

**Spec/boundary:** the direct 2026-10-10 continuation and
[physical composition](2026-10-10-native-preview-physical-composition.md),
[producer report](2026-10-09-native-preview-verification-producer.md), and
[Task5/D-355 result](2026-10-10-push-session-retirement.md).

## Resume Record

The single current resume record is in [HANDOVER](../HANDOVER.md); the
[source-stage report](2026-10-10-native-preview-genuine-composition.md) records
implementation, review and focused evidence. This approved plan remains the
sequence, not a competing live status. The original planner performed no Git
effect. Accepted original-deadline/Task5/D-355/offline R2 evidence is reused;
R1 remains FAILED. Genuine combined Auth/vault physical acceptance is pending.

R2 proves conditional offline AndroidKeyStore composition, not the actual
MainActivity-only issuer, genuine Task5 producer, explicit preview choice,
consent or cards. Ordinary genuine Task5 login/binding/logout and D-355 are
already accepted independently; do not rerun their unchanged suites or SQL.

## Global Constraints

- Public `getCapabilities()` remains exactly `{protocol: 0}`; generic push stays
  unchanged. `nativePositive`, richPreviewEnabled and canPublishRich stay false.
- No protocol1, consent write, refresh-token custody/preview refresh flow,
  background-card consumer, public release, SQL, provider change or migration.
  Ordinary application's existing Auth behavior is not rewritten.
- Only the separate full QA application/owned account may exercise composition;
  primary/test packages, personal data, users and Happ connectivity stay intact.
- No secrets, token/hash/tuple dumps, screenshots, traces, video, message send,
  private-file reads or execution by this sidecar. Logging must be disabled in
  the actual QA bridge configuration, not merely inside the plugin.
- Coordinator owns native compilation/build/device/Git/cleanup. The existing
  reviewer owns R2 static review; any next review is coordinator-assigned.
  At most three concurrent workers, non-overlapping writes, no new delegation here.

## Existing Contracts To Preserve

Paths below are repository-relative. These are source observations, not new runs.

| Source | Exact relevant boundary |
| --- | --- |
| `android/app/src/main/java/com/kub/messenger/MessagePreviewVerificationProducer.java` | Constructor takes runtime, ForegroundAuthority and public key. `arm(Identity)` is credential-free, calls main-only capture and admits only an unattempted exact runtime ticket. Guarded `verify(Identity, String, long, Current)` produces a one-use Verification; the unguarded overload refuses. |
| `MessagePreviewVerificationRuntime.java` / `MessagePreviewVerificationState.java` in that directory | `beginBinding` mints epoch; no ticket getter. Actual chain is JWT/public-key validation -> Auth GET -> own SDK token -> exact resolver POST -> second identical SDK token -> finish/producer completion. `startProducer` clamps the supplied deadline; `ProducerPermit` retains exact irreversible revocation and deadline. Ordinary verification already consumes the ticket. |
| `MessagePreviewForegroundAuthority.java` | `getOrCreate(Application)` and `capture()` require main; current checks are memory-only. Only exact `MainActivity.class` resume is admitted. Instance/epoch retires on pre-pause/stop/destroy and ordinary callbacks; a terminal registered issuer cannot be recreated. |
| `MessagePreviewPristineInitializer.java` | Main-only `getOrCreate(context, issuer, authority)` retains all three object identities and one `NmpvPristineOwner` thread. No upgrade from a previously null/different authority. `initializeExplicit`, `beginOwned`, `provisionExact`, `observeOwned`, `retireExact`, `observeRetirement` admit on main; their completions can run on worker. Internal ProvisionResult.ticket must not cross JS. |
| `MessagePreviewVaultProvisioning.java` | `provision` invokes the guarded authority with owner Current, verifies exact borrowed access/Identity once, encrypts and decrypt-matches, and retains producer permit. Initializer's final owner-monitor publication also checks permit expiry/revocation. Observation is credential-free DORMANT, not authority. |
| `MessagePreviewsPlugin.java` | Ordinary runtime uses real Tasks.await/Firebase and MessagePreviewHttpTransport. Verification executor is 1-thread/SynchronousQueue, with an 8_000ms deadline scheduler. Access/public key are removed from PluginCall data; capability and ACKs are protocol0/epoch/verified/applied only. Destroy closes runtime/executors, not durable erasure. |
| `artifacts/kub/src/lib/platform/nativeMessagePreviewVerification.ts` and `nativeVoiceCalls.ts` | Binding change automatically runs begin -> getSession -> verify, with process-wide safe revisions, exact owner/account/binding checks, 10_000ms pending deadline and retirement on stale replies/dispose. It does not obtain consent or expose a provisioning tuple. |

`MainActivity.onCreate` currently registers the plugin, not the passive issuer.
Local Capacitor `Bridge.callPluginMethod` posts to taskHandler; `execute` is not
main, while `executeOnMainThread` posts to main. Do not call arm/initializer
directly from a PluginMethod or assume the bridge is already on main. The bridge
can log methodData before the plugin strips it: actual logging-none is essential.

## One Bounded Phase

### 1. Wire Only The Isolated QA Invocation

**Smallest write scope:** the above `MessagePreviewsPlugin.java`,
`MainActivity.java`, `MessagePreviewVerificationProducer.java`; one new
`android/app/src/main/java/com/kub/messenger/MessagePreviewForegroundComposition.java`;
one new focused JVM fixture/probe/test and one new full-QA androidTest case.
Do not edit crypto/journal/custody/initializer/state/runtime/SQL/web settings.
The QA-only build guard is supplied by the coordinator's isolated generated
build configuration, false in every ordinary build; no release configuration or
global toolchain edit. If compilation needs a normal-build default field, its
single false definition is an explicit additional scope, not permission for
build.gradle restructuring.

**New native-private interfaces (proposed, not present today):**
`boolean requestQaComposition(String expectedQaRecipientId)` on the actual
plugin, package-private and not
`@PluginMethod`; and `arm(Identity, long originalDeadlineElapsedMillis)` on the
producer, retaining the existing overload's compatibility. The new overload
retains a safe future native deadline in Admission and passes the minimum of
that deadline and the vault-supplied deadline to existing `verifyProducer`.
It does not begin/reset a ticket, borrow credentials, read SDK or initialize.
The new composition holder owns continuation bookkeeping, not another verifier.
Its QA-only observer is package-private `boolean qaPhaseObserved(QaPhase phase)`,
with `QaPhase` limited to INITIALIZED/PENDING/COMMITTED/RETIRED. Set these
historical flags only at checked actual callbacks for this one invocation;
they are test observations, never authority or a public ticket/tuple getter.

- [ ] Register the genuine issuer on main in QA MainActivity creation **before
  the first resume callback**, without initializing storage. No synthetic
  resumed flag, callback replay or widening of exact MainActivity authority.
- [ ] Explicit instrumentation step in the resumed actual full-QA MainActivity
  calls `requestQaComposition(expectedQaRecipientId)` before submitting the
  normal rendered QA login. Validate this owned-QA UUID without logging it.
  It captures a one-use lifecycle snapshot, valid at most120_000ms and only in
  this QA process/bridge incarnation. Absent/duplicate/stale requests refuse;
  normal automatic verification without this request never touches the vault.
  Before binding, the ordinary JS startup/pre-begin clear is only verification
  retirement: it neither activates nor destroys this separate diagnostic intent.
  The first actual verification attempt consumes it, requires that exact QA
  recipient, and binds all revision/epoch/session/account/device fields. A wrong
  recipient consumes/refuses rather than leaving an intent for a later account.
- [ ] The next real `verifyBinding` removes credentials from call data before
  any post, takes `D = elapsedRealtime() + 8_000` once at plugin entry, and posts
  admission to main. Confirm logging-none, QA guard, exact live runtime,
  choice snapshot and finite shapes. Construct one producer using this call's
  public key, one retained initializer with **that exact authority**, and native
  operationId/vaultRevision/baseGeneration; arm before ordinary `verifyBinding`
  or any `state.start` can consume the ticket. No cached hasVerifiedBinding gate.
- [ ] `initializeExplicit` must return INITIALIZED_EMPTY_G0/generation0; then
  `beginOwned(nativeId, 1, 0, exactContext, exactOwner, completion)` returns
  PENDING/G1 with its private ticket. Post each callback back to main and check
  the same lease before `provisionExact(nativeId, privateTicket, borrowedAccess,
  completion)`. The retained owner worker runs the genuine guarded producer,
  not the plugin executor. No new worker, blocking main wait, or I/O under a
  plugin/owner monitor. Busy/unknown callbacks cannot free or replay the slot.
- [ ] Hold the borrowed access only in this pending continuation; clear owned
  references at completion/refusal/cancellation and keep call data scrubbed.
  Native caps remain8192 access/4096 public key even though JS permits larger
  inputs. Never serialize access, refresh token, ticket, alias or Identity.
- [ ] Reply with existing `{verified: true}` only for exact checked COMMITTED/G1
  **and** still-current runtime/choice/lifecycle/deadline. Runtime verification
  alone can succeed before a later vault failure and is not composition proof.
  Read-only `observeOwned` may confirm DORMANT/G1, never re-admit or decrypt.

**Deadline/lifecycle:** scheduler uses remaining `D-now`, not another8_000ms;
the new arm clamp carries D into the original permit and final publication.
Task5 begin+15_000, initializer10_000, BEGIN/vault15_000, supplied deadline,
JWT expiry and the JS pending10_000 retain their independent original limits.
Initializer metadata effects have their own Gate budget; timeout invalidates
that exact Gate, does not claim preemptive cancellation of entered platform I/O.
No new network/credential-key step or positive publication is admitted after
the producer deadline. Entered I/O may finish late; its stale return refuses,
not a claim of preemptive cancellation. Main callback rechecks must refuse
even if the scheduler fires late. Keep exact expiry/retirement scheduled after
a successful reply; cancelling a reply timer must not renew a credential lease.

Once bound, newer begin/clear, expiry, pause/stop/destroy, logout, reload or
rejection cancels only the exact composition lease/producer ticket and
invalidates the owner. Unbound intents also retire on lifecycle loss, their
120_000ms expiry, explicit QA cancellation and bridge destruction.
On main, queue `retireExact` with a new native operationId, vaultRevision2,
expected G1 (or retained BEGIN correlation when the callback was lost).
Erasure runs serially on the same retained worker and deliberately does not need
foreground/Auth. Keep the owner alive until checked retirement or bounded failure;
do not close it first and then fabricate EMPTY. A terminal graph never recreates
the registered issuer/owner on reload. Retire-before-BEGIN failures use their
actual retained generation, not an assumed G1. Unknown remains UNKNOWN.

**Wire/choice:** no public wire addition is needed for this phase. Preserve
begin/verify/clear ACK shapes, JS client and revision domain unchanged.
The private explicit step means "run this isolated QA credential diagnostic",
not sender/message preview consent or proof a person used a settings control.
Never call useNativeMessagePreview.setChoice: it upserts preferences, which is
out of scope. Actual end-user choice/consent remains NOT PROVEN. Persisting or
claiming sender/message consent here would conflict with NO consentwrite;
report that concrete scope conflict if it arises, while finishing this
independent QA composition phase. No owner decision is needed for its stated
diagnostic-only interpretation.

[Completed original-deadline prerequisite](2026-10-10-native-preview-original-deadline.md)
is source/SDK evidence only; it does not complete the holder/plugin or device phase.

## Review Focus

The next source test must force these five failure conditions, not rely on
event timing: real bridge taskHandler vs main; normal pre-begin clear vs bound
revocation; held verification with a late original deadline; lost PENDING ACK
with exact correlated erasure; destroy/reload before the erasure callback.
These are covered by the next task, not claimed as already tested.

### 2. Prove The Changed Source Before Native Effects

- [ ] Add `tests/unit/native-message-preview-genuine-composition.test.mjs` and
  `tests/java/com/kub/messenger/MessagePreviewForegroundCompositionProbe.java`,
  plus `tests/android/message-preview-genuine-composition.fixture.mjs`, using
  actual plugin/holder/issuer/producer/runtime/
  state/initializer/provisioning classes. Framework/SDK/Auth/JCA-file ports are
  labeled fictional. First compile/run against the exact unpatched source:
  absent QA request/route must give a named behavioral RED, not a compiler error
  counted as a regression. Preserve source hashes and the failed attempt.
- [ ] GREEN assertions pin: QA-disabled/no-choice has zero vault effects;
  one choice/one call gives real-class PENDING -> COMMITTED -> RETIRED;
  attempted ordinary ticket cannot arm; exact main capture and retained worker;
  startup/pre-begin clear preserves only the unbound QA intent, while bound
  clear revokes; a wrong QA recipient consumes/refuses the diagnostic request;
  owner/account/device/epoch mismatch refusal; D-1 vs D final callback;
  held I/O plus clear/logout; no successor revoked by a late old callback;
  lost PENDING ACK correlated retirement; lifecycle/reload terminal refusal;
  no JS ticket/credential leak and public protocol literal0.
- [ ] Compile mutants separately: omit QA/choice guard; dispatch admission on
  taskHandler; omit the original-D clamp; use ordinary verified boolean as
  success; skip exact late-callback lease check; omit logout retirement; close
  owner before erasure. Each baseline scenario first passes; each mutant must
  compile, execute and fail its named literal assertion. Setup/compile failures,
  timeouts, skipped scenarios and missing selected tests are not mutant kills.
- [ ] Run the focused new test, then only affected existing producer/plugin/
  authority selections and `git diff --check` under coordinator ownership.
  Proposed focused command: `node --test tests/unit/native-message-preview-genuine-composition.test.mjs`.
  Require named scenario stdout/counts, not exit0 alone. Reuse accepted unchanged
  crypto/R2/D-355 evidence; do not claim a fresh aggregate. Compile the changed
  dependency closure with existing pinned JBR/Android SDK and real Capacitor/
  Firebase dependencies, fresh named definitions and protected-input readback.

### 3. One Genuine Full-QA Device Acceptance And Cleanup

- [ ] Coordinator freezes the reviewed source/artifact/signature/config graph,
  including the genuine producer, real transport/Firebase and early MainActivity
  issuer. Build one new isolated full-QA artifact, not the offline self-target
  APK or primary release. Prefer the already accepted separate QA package,
  signer and Firebase identity, now removed, with a new artifact/attempt record.
  Reuse provider configuration only if package/signer
  bindings still match; do not copy primary identity or invent provider proof.
- [ ] Add the one case in
  `android/app/src/androidTest/java/com/kub/messenger/NativeMessagePreviewGenuineCompositionTest.java`.
  Reuse the accepted ordinary rendered-login/logout and own-user host mechanics,
  not its old PASS as composition evidence. One owned Realme user0 attempt:
  actual resumed MainActivity, private
  explicit QA request, normal rendered owned-QA login and normal SDK registration,
  then the existing JS bridge call. Require boolean-only actual observations:
  genuine guarded chain completed in this invocation, checked encrypted
  COMMITTED/G1/decrypt match, same owner/worker, protocol0 and no consent write.
  Do not use the transient ordinary hasVerifiedBinding result as the only oracle.
  No account/credential/FCM contents, screenshots or response bodies leave the app.
- [ ] Ordinary rendered logout must revoke the pending/current composition and
  produce exact RETIRED EMPTY/G2, credential-key absence, retained metadata/marker,
  no replay/recreation, then detach/close the owned graph. Read-only own-attempt
  server observation confirms retirement without replaying installed D-355 SQL;
  account/time counts remain account/time evidence, not exact-SID delivery proof.
- [ ] Bounded cleanup records logout, erasure, activity/issuer teardown and
  user0-scoped uninstall independently. Remove only exact new QA target/test/
  observer packages owned by this attempt, prove absence across users and
  unchanged primary/test APK+UID/data boundary and users. Retain unknown ACKs;
  reconcile read-only before any retry. Cleanup must not depend on success-path
  latches. No broad process/service/network/keystore deletion.

## Failure And Handoff

Any refused/late/busy/unknown phase returns no positive composition claim and
leaves protocol0/generic behavior intact. Disable the QA route, revoke the exact
memory lease and use retained exact retirement; never reset generation, clear
primary data, recreate a lost key, replay initialization/provision or reuse old
verification as repair. Physical cleanup failure is a failed acceptance even
when COMMITTED was observed. Preserve residue and failure receipts until exact
owned cleanup is established; package removal alone is not vault-retirement proof.

Completion is the focused RED/GREEN/compiled-mutant evidence, real dependency
compile, one genuine composed QA run and exact cleanup, each reported separately.
This plan executes none of them. No extra permission gate is introduced.
It does not prove production plugin activation, end-user sender/message consent,
refresh/background/process-death recovery, natural FCM timing, notification-card
display, multi-device/OEM coverage, release signing/publication or rich readiness.
