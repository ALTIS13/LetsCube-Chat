# Native Preview User Choice Implementation Plan

> For execution: retain the approved coordinator/reviewer arrangement, at most
> three workers and non-overlapping ownership. Use the implementation and
> verification skills task by task; no new permission round or sidebar task.

**Goal:** after genuine Auth/vault retirement and owned cleanup are accepted,
accept an actual isolated-QA Settings choice and its native foreground lifecycle,
without advertising rich-preview readiness or acquiring display authority.

**Architecture:** reuse the real Settings radios, preference hook, existing
recipient capability RPC and owner-row ACK parser. Add a separately marked,
native-guarded QA consent-context route, not a protocol1 capability. A small native
owner records only a finite diagnostic choice intent; ordinary applications and
all display consumers remain closed.

**Tech Stack:** existing React/TypeScript, Capacitor, Java/MainActivity authority,
Supabase recipient RPC/RLS and existing Node/JVM/AndroidTest harnesses. No new
dependency, credential store, verifier, background worker or notification protocol.

**Spec:** the direct bounded continuation of 2026-10-10;
[remaining acceptance, item 2](2026-10-07-native-message-preview-authorization.md#remaining-acceptance),
[accepted preference/capability preparation](2026-10-07-notification-preferences-capability.md),
and [genuine composition boundary](2026-10-10-native-preview-genuine-composition-plan.md).

## Resume And Preconditions

[HANDOVER](../HANDOVER.md) remains the live record. This document neither advances
the current genuine attempt nor declares it accepted. Its planning write scope is
only this new file; every application/test path below is future implementation
scope, not an edit performed by the planner.

Execution follows genuine same-invocation COMMITTED, exact logout RETIRED,
credential-key absence and exact-owned package cleanup. Preserve failed/unknown
receipts. A build, native binding boolean, offline vault result or package removal
alone does not satisfy that prerequisite. This is a technical ordering requirement
from the accepted genuine plan, not another owner-permission gate.

Reuse accepted source/SDK/full-APK, Settings/hook, SQL/RLS and D-355 evidence for
unchanged inputs. Any later QA artifact needs its own changed-source/configuration
binding and owned-attempt receipts; old UID/timestamps or an old artifact PASS are
not a new installation or choice proof.

## Global Constraints

- Ordinary and QA `MessagePreviews.getCapabilities()` remain exactly `{protocol: 0}`.
  Keep `nativePositive=false`, `richPreviewEnabled=false`, `canPublishRich=false`.
- Do not weaken `readMessagePreviewBinding`: protocol0 and the new QA marker must
  still return null there. Never manufacture a protocol1 object for that parser.
- Preserve generic v1, voice, push registration, navigation and read cleanup.
  Optional QA refusal must not block their normal workflows.
- Only a fresh isolated owned QA recipient/application may use this route. No
  primary-account preference change, endpoint copying or personal content capture.
- Consent is the existing account-wide `none` / `sender` / `message` preference.
  No new table, SQL migration, ACL, provider setup or registration contract.
- No access/refresh/public-key/SDK-token handoff in the new bridge methods. No
  vault read/decrypt/provision, credential refresh, background lookup or card post.
- No screenshots, traces, video, message bodies, response bodies, tuple/context
  dumps, raw exceptions or secret instrumentation arguments in output/evidence.
- Coordinator owns later build/device/Auth/cleanup and artifact binding. This plan
  performs no tests, compiler/build, device/Auth/provider/DB/Git/network operation.

## The Protocol0 Conflict And Chosen Route

Current Settings obtains its candidate through `readNativeMessagePreviewCandidate`;
`readMessagePreviewBinding` requires protocol1. The actual plugin returns literal0.
Consequently genuine composition cannot make the current radios selectable, and
the private `requestQaComposition` step cannot be described as consent.

**Decision: a separate QA consent-only context.** Keep the ordinary path intact.
The isolated QA web build may request this different context through a new strict
parser, then use the same hook/RPC/save sequence and the same Settings radios.
The ordinary parser never consumes that context. `status=ready` in this diagnostic
branch means only that the consent control is available, not display readiness;
its `effectiveChoice` stays literal `none`, even when `savedChoice` is `message`.
No display consumer may use the QA context or its recorded choice.

Two independent build guards are required: native
`BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE`, false in ordinary Gradle,
and isolated web `VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE=true`, absent/false
in ordinary builds. A URL, localStorage flag, JS parameter or test capability
replacement cannot arm native QA. Web false performs zero new QA bridge calls;
web true/native false refuses before capability lookup or preference mutation.

This is not the future production capability contract. Production protocol1 still
requires the separately accepted credential/background/current-source/current-card
consumer and OS privacy proof. This phase intentionally supplies none of them.

## Exact Future File Scope

| File | Responsibility |
| --- | --- |
| `android/app/src/main/java/com/kub/messenger/MessagePreviewQaUserChoice.java` (new) | One foreground diagnostic owner, finite context, intent revisions and terminal retirement; no storage/network/credential access. |
| `android/app/src/main/java/com/kub/messenger/MessagePreviewsPlugin.java` | Guarded QA methods and narrow observation of the existing normal verification completion/retirement. Preserve existing ACKs, deadlines and literal0 capabilities. |
| `android/app/src/main/java/com/kub/messenger/MainActivity.java` | Only include the new QA guard in existing early main-thread issuer registration; ordinary creation remains unchanged. |
| `android/app/build.gradle` | Only an ordinary false BuildConfig field if needed. Coordinator supplies isolated true overlay; no Gradle restructuring/toolchain edit. |
| `artifacts/kub/src/lib/platform/nativeMessagePreviews.ts` | Typed QA bridge wrappers, isolated web guard and fixed unavailable results; no token getter or alternate registration owner. |
| `artifacts/kub/src/lib/platform/nativeMessagePreviewContract.ts` | New exact QA-context parser/type, separate from the unchanged ordinary protocol1 parser and existing capability/consent parsers. |
| `artifacts/kub/src/hooks/useNativeMessagePreview.ts` | Reuse the existing load/save barriers and ownership fences with a tagged QA admission branch and native intent notifications. |
| `tests/android/message-preview-user-choice.fixture.mjs` (new) | Reuse established labelled SDK/framework ports to compile actual new owner/plugin code; no fake production graph. |
| `tests/java/com/kub/messenger/MessagePreviewQaUserChoiceProbe.java` (new) | Execute native owner/plugin lifecycle and compiled literal mutants with fictional identities, no private output. |
| `tests/unit/native-message-preview-user-choice.test.mjs` (new) | Focused actual contract/hook/adapter and JVM cases; reuse existing loader patterns, not an entire copied suite. |
| `tests/e2e/native-message-preview-user-choice.spec.ts` (new) | Actual Settings consumer with fictional local backend/native ports, no captures or production mutations. |
| `android/app/src/androidTest/java/com/kub/messenger/NativeMessagePreviewUserChoiceTest.java` (new) | One actual-QA choice/lifecycle case reusing real plugin access and rendered login/logout utilities. |
| `android/app/src/androidTest/java/com/kub/messenger/NativeMessagePreviewVerificationTest.java` (conditional) | Only minimal visibility for already existing real utilities if necessary; put new input mechanics in the new test, not in the old acceptance case. |

`SettingsScreen.tsx` is a reuse consumer, not a redesign/write target: its current
radios already call the real `messagePreview.setChoice`. Reuse
`nativeMessagePreviewBindingSnapshot()` from `nativeVoiceCalls.ts` as an
unprivileged selector; do not edit its registration/controller/verification flow.
The existing AndroidTest utilities may receive only a minimal visibility change
if a required real-input helper is not reusable; no old acceptance changes.

No edits to verification state/runtime/producer, crypto, initializer, journal,
custody, foreground authority or the accepted genuine holder. If the proposed
plugin observation cannot be implemented without changing one of those contracts,
report that exact missing interface before expanding the source slice; finish
independent contract/hook work. Do not silently substitute a cached display lease.

## Concrete Source Contract

### Native Admission And Context

Package-private `boolean requestQaUserChoice(String expectedQaRecipientId)` is
called on main, through the actual PluginHandle, before ordinary rendered QA login.
It requires native QA guard, logging-none, local packaged origin, exact resumed
MainActivity authority and one previously unarmed plugin incarnation. It captures
that authority and a nonrenewable `elapsedRealtime()+120_000` deadline. Duplicate,
wrong-thread, stale/reloaded or foreign-recipient requests refuse with zero effects.

While armed, capture the first real ordinary `verifyBinding` attempt's nonsecret
identity after the existing call-data credential scrub, then observe its completion
only after the existing runtime's exact `matchesVerified(revision, epoch, recipient,
session, accountEpoch, device)` check succeeds. Bind that immutable identity to the
captured QA recipient/authority. A mismatched or failed first attempt consumes and
refuses the request; a later successful attempt cannot replace it. Recheck the
authority on main before publishing the QA context. Do not call a second verifier,
change its 8_000ms deadline, extend its 15_000ms verified state or intercept ordinary
credential handling.

The retained identity is subsequently only a selector for consent RPCs, not a
continuing verified/credential lease. Every Settings operation still requires
current JS Auth/session/epoch and fresh server capability authorization. A delivered
begin/clear/token-rotation retirement closes this owner; undelivered cross-process
events are not claimed as immediately observed. No later preview request can use
this historical selector as authentication.

Proposed PluginMethods; added methods receive no credentials:

```text
getQaUserChoiceContext({recipientId, recipientSessionId, deviceId, accountEpoch})
  -> {qa_choice_v: 0}
  |  {qa_choice_v: 1, purpose: "consent-only", contextId,
      recipientId, recipientSessionId, deviceId, accountEpoch, expiresAt}
beginQaUserChoice({contextId, revision}) -> {applied: boolean}
confirmQaUserChoice({contextId, revision, choice}) -> {applied: boolean}
retireQaUserChoice({contextId, expectedIntentRevision, revision}) -> {applied: boolean}
```

Context success has exactly eight keys, no `protocol` key; refusal exactly one.
Canonical UUIDs and safe integer bounds reuse existing predicates. `contextId` is
an opaque UUID memory handle, never a credential/ticket or receipt field.
`expiresAt` is a fixed safe wall deadline captured at arm, with wall high-water and
the independent monotonic deadline checked natively. Context expiry is also bounded
by the caller's current session on JS; neither deadline is renewed by reads/saves.
Return success only after exact expected identity, local origin, logging-none,
live MainActivity snapshot, unchanged bridge/document and native deadline checks.

All added PluginMethods marshal admission to main; Capacitor taskHandler is not
main. A finite 2_000ms JS ACK timeout fails closed, never causes automatic replay.
No caller URL, unknown keys, coercion, guessed owner or public-key/token field.
Native-disabled/missing method/unknown ACK produces no accepted positive choice
result; an unknown ACK is not proof that a remote action had no effect.

`begin` accepts a strictly newer safe intent revision for that exact context and
synchronously closes its previous confirmed intent to `none` before ACK. It
retains one pending revision; a duplicate cannot reopen it. `confirm` consumes only
that exact pending revision once and accepts only the three literal choices.
`retire` is exact-target terminal memory erasure: contextId and expectedIntentRevision
must match the current intent before advancing to its newer revision. Revision0
targets only that context's never-begun intent. No-match has zero effects on native
high-water or a successor, even with a larger proposed revision. Erasure must work
after foreground/Auth/logging loss without reacquiring authority. A late A
confirm/retire cannot change B, including B in the same context with a newer intent.
Native lifecycle/context invalidation directly closes its own entire context;
that internal terminal operation is not a broad JS retirement method.

Retire on pause/stop/destroy, WebView page start/reload, logging loss, context timeout,
newer binding/clear, logout/SID/accountEpoch change, token-rotation notification,
push disable, hook disposal or unknown save/bridge result. No owner recreation in
that plugin incarnation. Package-private boolean observers may expose only latest
confirmed `none/sender/message` and terminal `RETIRED`, not tuples/counters/paths.
Native intent is client-reported diagnostic memory, not independent proof of a
server ACK; confirmation does not permit storage, fetch or display.

### Reused Hook And Save Ordering

Add `QaMessagePreviewChoiceOwner = MessagePreviewBinding & {accountEpoch: number}`,
`QaMessagePreviewChoiceContext = QaMessagePreviewChoiceOwner & {contextId: string;
expiresAt: number}`, and
`readQaMessagePreviewChoiceContext(value: unknown, expected: QaMessagePreviewChoiceOwner,
now: number): QaMessagePreviewChoiceContext | null` to the existing contract module.
It validates the exact QA shape/purpose/identity/expiry and returns an immutable
copy. It must reject ordinary protocol1 capability
objects, protocol0, extras, malformed/foreign/expired contexts and unsafe integers.
The existing ordinary binding/capability/consent parsers remain unchanged.

Inside the hook, tag admission as ordinary or QA. Ordinary performs only its
existing path. QA obtains the current sidecar selector, validates the native QA
context, calls the existing `native_message_preview_capability`, then rechecks
native contextId and every owner/binding field after the await. Reuse existing
account/epoch/Auth revision, operation revision, expiry and owner write barrier.
No client truth is inferred from a build version or ordinary verified boolean.
Schedule QA closure at the minimum of session expiry and the fixed context expiry;
also check that deadline before/after every await rather than trusting timer timing.

For the actual Settings radio's `setChoice(choice)` in QA mode:

1. Immediately publish saving with `effectiveChoice="none"`; allocate a separate
   module-global choice-intent revision, never reset on Settings remount.
2. Await exact native `begin` ACK, then the existing fresh pre-save capability read.
3. Run the existing serialized own-row upsert and validate its exact owner/choice
   ACK with `readMessagePreviewConsent`. No supplied foreign owner or direct SQL.
4. Run the existing fresh post-save capability read and native context recheck;
   the confirmed server choice must equal the selected literal.
5. Send exact native `confirm`, recheck current ownership after its ACK, and only
   then publish `savedChoice`. QA `effectiveChoice` remains `none` in every state.

Wrong/late/error/unknown replies synchronously close JS effective choice and request
native retirement for their captured contextId/intent revision, using a new intent
revision without targeting another hook's successor. A lost confirm ACK can follow an applied native
intent: until checked retirement, native closure is UNKNOWN, not inferred from JS
state or absence of a response. Retain that distinction and the finite native expiry.
Do not invent a saved ACK, retry an upsert/confirm automatically or roll back a
possibly committed server choice from a transport error. Keep the existing explicit
refresh/error behavior for honest server readback; terminal QA context remains
unavailable rather than being rearmed. RLS/server session checks remain authority.

Selecting `none` uses the same real save/ACK/readback chain, while begin closes
native intent before dispatch. Local closure after a failed none save is not proof
that server preference was saved. Logout/lifecycle memory retirement is not vault
key deletion, server consent deletion or universal delivered-card retirement.

## Review Focus

1. Web QA marker with native false/absent guard: zero new server mutations and no
   ordinary parser bypass (Tasks 1-2).
2. Actual input versus `evaluateJavascript(setChoice)`/synthetic change: only the
   former can support the later real-choice interaction claim (Tasks 2-3).
3. Saved server ACK followed by expired native context or lost confirm ACK: report
   partial/unknown, never automatic replay or native-positive publication (Tasks 1-3).
4. A held save/confirm followed by B, logout, reload or disposal: no stale native
   successor mutation or stale Settings publication (Tasks 1-2).
5. A confirmed message choice is not readiness: QA effective none, capabilities
   literal0 and rich flags false before/after selection and cleanup (Tasks 1-3).

## RED-First Execution Sequence

### Task 1: Separate QA Context And Native Intent

- [ ] Freeze the accepted post-genuine source baseline and selected actual plugin,
  MainActivity, adapter/contract and test inputs. Do not freeze current in-flight
  source automatically or replay the accepted genuine/SDK/SQL suites.
- [ ] Add a calibrated feature-absence test named `qa-choice route absent with
  ordinary protocol0 intact`: baseline normal binding/capability controls pass;
  the desired explicitly armed QA context success is absent and fails its literal
  assertion. Compile the baseline actual plugin normally; classify missing QA
  reflection/bridge entry as unavailable for that feature assertion, not a setup
  error. Missing Java method/import/compiler failures are not the behavioral RED.
- [ ] Implement only the guarded owner/plugin/context parser and default-false
  configuration. Probe actual classes with labelled framework/SDK ports.
- [ ] GREEN: main-only one-shot request, exact first verified identity, 120_000ms
  D-1/D boundaries, nonrenewal, wall rollback, input bounds, ordinary false zero
  effects, pre-bind startup clear versus bound retirement, strict context parsing,
  pending/confirm once, exact retirement and closed capabilities.
- [ ] Force taskHandler admission, pause/reload before callback, held A confirm
  versus newer intent, foreign context with larger revision, malformed/unknown ACK,
  context expiry after server save and no successor mutation.
- [ ] Compile omission mutants for native guard, main/authority, expected recipient,
  fixed deadline, exact context/revision, single confirm and literal0 capability.
  Each first has a passing named control; runtime assertion failures kill mutants,
  not setup failures, timeouts, skipped or zero-selected cases.

### Task 2: Actual Settings Consumer And Reused Save Chain

- [ ] Calibrate RED `real Settings QA choice absent; ordinary protocol0 closed`:
  ordinary protocol0 is the passing generic/disabled/zero-upsert control. A separate
  armed QA-context fixture leaves the baseline hook unavailable and fails the
  desired selectable actual-radio assertion. Do not make ordinary cap0 enablement
  the desired outcome. This is feature absence, not a shipped consent regression.
- [ ] Implement the tagged QA hook branch/wrappers with the specified ordering.
  Reuse the actual existing radios; never inject protocol1 or replace setChoice
  with a test-only preference writer.
- [ ] Run the new focused actual-module tests and local Settings spec only:
  `none -> sender -> message -> none`, exact owner-row ACK/fresh capability,
  saving radios retained/disabled, QA effective none and native pending/confirmed
  observations. Local fictional interactions are not physical consent proof.
- [ ] Force held pre-read/upsert/post-read/native-confirm; A/B account and same-user
  SID/epoch changes, remount/write barrier, disposal, expiry, failed none and late
  ACKs. Assert literal RPC/upsert/native call counts and unchanged ordinary path.
- [ ] Mutate parser marker/shape, owner/context recheck, ACK verification, post-read,
  pending-before-upsert, late-confirm fence and QA effective-none rule. Require
  named compiled/runtime failures, not source substring checks.
- [ ] Inspect the exact changed Settings states at 1440/390 in both themes using
  only the fictional local fixture. No signed-in production captures. Reuse
  accepted unchanged preference/Settings suites; run only affected new selections.
- [ ] Coordinator/reviewer inspect the frozen delta and real dependency compile
  evidence for changed sources before a new actual QA artifact. This document
  contains no compiler/build invocation or new runtime acceptance claim.

### Task 3: One Actual Owned-QA Choice And Cleanup

- [ ] Coordinator binds a fresh isolated target/host attempt with the two true QA
  guards, actual logging-none/local origin, four plugins and protected-input
  readback. Preserve ordinary false Gradle and protocol0; reuse accepted provider
  bindings only where exact package/signer metadata still matches.
  This later artifact keeps the separate composition guard false and never calls
  `requestQaComposition`: accepted genuine vault proof is reused, not replayed or
  repurposed as consent. No vault operation is introduced by opening Settings.
- [ ] In actual resumed MainActivity call the private request on main, then use
  ordinary owned-QA rendered login/SDK verification. Remove transient secret
  instrumentation arguments early using the existing real utilities.
- [ ] Require initial server capability choice none for the dedicated owned-QA
  account. A non-none baseline is an observed mismatch, not permission to reset
  somebody else's preference or delete rows. Native context must remain valid.
- [ ] Navigate to actual Settings and select sender, message, then none through
  the real rendered radios. Do not call setChoice or dispatch synthetic JS events
  as the acceptance action. Boolean-only observations establish checked selection,
  save completion/fresh server choice and matching native diagnostic intent.
- [ ] Establish the input mechanism: direct QA tester taps prove that person's
  explicit choice; approved real Android input injection proves the UI input path
  only and must be labelled automated. DOM `.click()`/evaluateJavascript setup
  cannot be upgraded to human consent. No conversation tree or screen capture.
  Automated-only evidence leaves `PERSON_CHOICE_NOT_PROVEN`; it cannot close a
  claimed human-choice acceptance even when UI/save/native observations pass.
- [ ] If the finite context expires, preserve partial/failure evidence and retire;
  do not renew its deadline, repeat Auth/registration, replay a save or synthesize
  a ready context to complete the sequence.
- [ ] Final none needs its own exact ACK/fresh capability, independently of native
  closure. Ordinary logout then closes native intent; observe terminal retirement
  and zero effective display choice without claiming vault erasure from that flag.
- [ ] Exact-owned target/test/observer cleanup uses the established finite host
  mechanism and new incarnation records. Preserve primary/test packages, APK/UID/
  data boundaries and users; retain/reconcile unknown ACKs without blind replay.
  Leave the dedicated account preference explicitly confirmed none; no SQL delete,
  provider mutation or manual data rewrite is part of cleanup.
  Run native retirement, ordinary logout and owned package cleanup in failure
  paths as well, independently of save-success latches. If final none was not
  confirmed, retain that server-preference residue/unknown as FAILED acceptance;
  do not fabricate none, replay a write or withhold independent package cleanup.

## Evidence And Handoff

Report separately: feature-absence RED, actual-source GREEN/mutants, real dependency
compile/artifact binding, physical or automated input provenance, exact saved server
choices, native diagnostic memory retirement and owned package cleanup. Public
receipts contain fixed phases/booleans/counts and public source/artifact pins only;
no recipient/session/device/context identifiers or response/resource values.

Source/local fixture success is not an actual choice; a UI click alone is not a
saved consent ACK; a saved server choice alone is not native lifecycle acceptance;
native intent alone is not independent server authorization. Preserve partial and
unknown outcomes rather than merging these into one PASS.

Completion adds only isolated-QA explicit-choice/lifecycle evidence. Production
activation, refresh/cold credential recovery, current SDK/session/source/read
reauthorization on every preview request, exact-card replacement/retirement,
background FCM timing, lock-screen privacy, OEM coverage and publication remain
later stages. Protocol0, generic fallback and all rich readiness flags stay closed.
No extra permission round is introduced and no implementation/effects are executed
by authoring this plan.
