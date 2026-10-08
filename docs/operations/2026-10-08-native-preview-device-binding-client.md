# Native Preview Device Binding: Client Source

Date: 2026-10-08 Moscow. BASE `e40925d9`. Status: SOURCE_ACCEPTED,
independent bounded review found no concrete P1/P2. This is not installed APK or native display proof.
[Contract and server stages](2026-10-08-native-preview-device-binding-plan.md).

## Changed Behavior

The existing Android registration acknowledges a recipient/session pair, not
`user_push_devices.id`. The accepted read-only resolver discovers that UUID
separately without changing the seven/eight-argument registration contract.

Changed files:

- `artifacts/kub/src/lib/platform/nativeVoiceController.ts`
- `artifacts/kub/src/lib/platform/nativeVoiceCalls.ts`
- `artifacts/kub/src/lib/platform/nativeMessagePreviewBinding.ts`
- `tests/unit/native-message-preview-binding.test.mjs`

After an exact eight-argument ACK and the existing voice commit, an optional
SDK POST resolves the canonical token hash. The result must be exactly one row
with four own keys, literal version1 and matching owner/session plus UUID.
Legacy/missing/unknown ACK, malformed response or failed read gives no candidate.
The ordinary push/voice success path does not wait for the resolver.

Before the ACK wait, capture store auth identity/account epoch, controller
generation/identity revision, token revision and access expiry. Check them before
dispatch, after completion and before publication. Retire immediately on token
rotation, including a queued rotation during registration, or logout/account/
epoch/session/disable/invalidation/disposal/expiry. The five-second read deadline
and AbortSignal supplement the identity fences; ignored cancellation cannot
authorize a late result. Normal same-session refresh does not reset store epoch.

The copied JavaScript candidate stays in memory only. It is not consent, a native
capability, credential or display lease. The native getter, hook, Settings and
MessagePreviews bridge are unchanged; no local/native persistence or rich rollout.
The existing registration upsert can still reassign an endpoint. This read-only
slice does not claim to change that write behavior.

## Verification

Calibrated baseline RED:2 failures while2 ordinary/legacy controls pass. A fixture
setup error was corrected before accepting RED and is not feature evidence.
Final new focused GREEN:61/61, zero skips/failures, including10 compiled mutants.
Selected adjacent controller9/9 and adapter4/4 pass; typecheck and scoped diff
check exit0. Accepted unrelated native/D335/whole-application suites were not run.

The harness executes actual controller/adapter/parser/push-registration source,
the installed SDK RPC builder and local WebCrypto, with fictional platform/store
edges and intercepted fetch. Held ACK/read orders, queued rotations, epoch/SID/
expiry, read/registration timeout, legacy/malformed/error paths and ordinary
success pass. Literal omission mutants cover ACK, token revision, epoch, owner,
SID, version/cardinality/device UUID, deadline and canonical hash bytes.
All finite jobs ended; no network, production auth/SQL, device, build or deploy.

Frozen SHA256:

- Controller: `686A3EEB448575B6A81442420D422DEE7468C83C9BD57A30739A364D8F20CF5A`.
- Adapter: `622101DBA7575DBB696B35959E203CA34461CF1F62019F591A8A9FB205481D06`.
- Parser: `865C1DEB758E4A4D634FD99D7BE202A0FE4701DC332BED289D7CC23E586B210C`.
- Test: `7D0A112FE87D97358F230F38DA1F91C130A734CB0112E1A0B4E074CF06C212F0`.

## Remaining Gates

Independent source review accepted all four frozen files without suite replay.
The separate real PG17/signed-JWT/rollback and guarded server installation now
passed; see the [installation record](2026-10-08-native-preview-device-binding-install.md).
Genuine isolated SDK registration
must then establish the current owner/session/device UUID without copied endpoints
or fake production rows. Native credential storage, capability negotiation,
explicit consent, background reauthorization and OS card acceptance remain later
work. D335 stays OPEN: nativePositive=false, richPreviewEnabled=false,
canPublishRich=false. Generic chat v1 and voice are unchanged.
