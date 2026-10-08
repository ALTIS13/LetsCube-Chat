# Native Preview Verification Bridge Plan

Date: 2026-10-08. BASE `cd96b6e5`; coordinator-owned approved D335 continuation.
Resolver is installed/postchecked; client sidecar source-accepted. This bounded
slice verifies the actual native SDK/recipient/device boundary before a vault or
background display is introduced. It deliberately does not provision a durable
credential: copying an access token into the existing unencrypted voice file or
preferences would be unsafe and would falsely claim cross-process retirement.

## Frozen Contract

Add `MessagePreviews`, separate from VoiceCalls and generic notification producer.
No new dependency, DB change, consent/UI activation, refresh token, autonomous
refresh, message fetch or display. Reuse Capacitor/Firebase and Android HTTPS.
Ordinary push/voice success never waits for this optional verification.

Coordinator-owned Android configuration pins loggingBehavior=none. The installed
Capacitor Bridge logs full methodData when framework logging is enabled, before
the plugin receives it. Native begin must refuse while that logging is enabled;
JS must require its valid begin ACK before sending access-only credentials.
Verify emitted capacitor.config.json in the actual APK before any sign-in probe.
Do not patch framework files or trust release mode alone to suppress logging.

- `beginBinding({revision,recipientId,recipientSessionId,accountEpoch}) -> {epoch}`.
  Native creates a fresh opaque ticket and first retires the old state. Require
  a strictly newer bounded JS revision, canonical UUID pair and safe integer
  accountEpoch. Older delivered begins cannot supersede a newer retirement.
- `verifyBinding({revision,epoch,recipientId,recipientSessionId,accountEpoch,
  deviceId,accessToken,publicApiKey}) -> {verified:boolean}`. One owned attempt
  per native ticket; exact current ticket/revision/tuple before and after awaits.
  Credential is ordinary current access only, never refresh/service_role; do not
  retain it after this read-only validation. Public key is client configuration,
  not authorization. Fixed `https://core.letscube.ru`, no caller URL/headers.
- `clearBinding({revision}) -> {applied:boolean}`. Only strictly newer revisions
  retire; delayed A clear cannot close B. It also closes pending/unknown begins.
  Plugin load/destroy use an internal unconditional retirement, not stale JS.
- `getCapabilities() -> {protocol:0}` always. No tuple accepted by existing
  Settings parser, no consent selection even after native verification.

JS revision is monotonic for this module's lifetime, including controller restart;
accountEpoch is a local fence, not server authority. Verification is memory-only,
expires and closes on plugin destruction/process death. No persistence claim.
Native-positive display/rich flags stay false; separately name verification proof.

## Native Read-Only Validation

Decode only bounded JWT identity/expiry, then authenticate through fixed Auth GET
user. Require matching canonical user, nonanonymous status, authenticated claims
and unexpired expected session. Decoding is not signature verification.
Obtain FirebaseMessaging's own SDK token inside this app/user, hash canonical bytes
locally, and POST only this hash to the installed resolver. Require exactly one
four-key version1 row matching the expected pair and exact `d.id` selector. Read
the SDK token again before commit; token change refuses. No endpoint registration,
deletion/reassignment, consent write or reason/raw response exposure.

Bound deadline, connect/read times, response/body sizes and concurrent work. No
redirects/retries/raw logs. Worker failure/expiry/owner change closes verification;
late work cannot restore it. Store only unprivileged tuple/expiry/ticket in memory,
never access token or hash. Enforce wall and monotonic expiry; do not extend on
clock rollback. The tuple is not a lease for future display: every later preview
request must independently authorize current session/device/consent/source.

## Client Handoff

One callback from existing sidecar publication/retirement; no second registration
controller/listener/Auth owner. Keep the copied JS getter credential-free.
The adapter rechecks current store identity/accountEpoch and exact sidecar tuple
around ordinary SDK getSession and native awaits. Acquire access privately from
that current session; never export a token getter or token-bearing receipt.
Retirement immediately advances revision on logout/SID/epoch/token rotation,
disable/expiry/invalidate/dispose. Unknown/malformed begin or verify ACK cannot
publish success or trigger another registration. Ignore optional failures for
ordinary push/voice. Existing Settings/hook/native chat projection remain closed.

## Acceptance And Ownership

Native writer: only MessagePreviews Java source/tests and MainActivity plugin
registration; no existing voice/notification producer/service files. Client writer:
only new verification adapter/tests, nativeMessagePreviews and the already owned
nativeVoiceController/nativeVoiceCalls. Coordinator owns docs/build/device/Git.
No overlapping writes; independent source reviews after writers freeze.

Focused RED/GREEN execute actual state/parser/adapter code: held begin/verify A/B,
both completion orders, stale clear/begin, expiry/clock rollback, unknown ACK,
wrong owner/session/device/SDK, disabled/foreign/empty/multirow server response,
refused key/token, teardown and ordinary success. Literal compiled omissions for
revision/ticket/tuple/expiry/live resolver and closed capability, not merely source
substring tests. Reuse prior untouched suites; do not replay unrelated coverage.

Then real build and isolated Realme normal sign-in/SDK registration proof with
current enabled row and primary-account/package/signer preservation. A063 is
excluded. No personal screenshots/traces/video, endpoint copying, fake Auth/device
rows or message send. Source/source-fixture/native binding/FCM delivery/OS display
are distinct evidence. Only affected tested artifacts may be released.

Rollback retires optional verification and removes/disables its handoff/plugin;
retain generic producer, voice/read-cleanup, endpoint/account data and both
installed migrations. Vault, explicit consent, background fetch/card/privacy and
natural OS delivery remain the following stages, not acceptance of this slice.
