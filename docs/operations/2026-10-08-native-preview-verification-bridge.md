# Native Preview Verification Bridge

Date: 2026-10-08 Moscow. Coordinator, branch
`codex/bot-inline-media-20261002`, BASE `cd96b6e5`.
Approved continuation of D-335; generic notifications remain unchanged.
[Frozen contract](2026-10-08-native-preview-verification-bridge-plan.md).
[Installed read-only resolver](2026-10-08-native-preview-device-binding-install.md).

## Changed Boundary

The optional Android `MessagePreviews` bridge verifies a current recipient,
session and device selector through genuine Auth and the installed resolver.
It obtains the Firebase token from this app/user's own SDK, checks its hash's
exact four-key server row and checks the SDK token again before committing.
No copied endpoint, bearer on disk, refresh token, consent write, message fetch
or display is introduced. Verification expires after at most15 seconds and
process/plugin destruction closes it. The tuple is not a future display lease.

The existing registration controller publishes/retire its optional selector to
one current client verifier; ordinary push/voice never waits for it. Module-wide
revisions, native tickets, current UID/SID/account epoch and expiry fence late
begin/verify/clear. `getCapabilities` stays exactly protocol0, including after
verification. Settings cannot use this slice as permission to expose messages.

Android framework logging is explicitly disabled in `capacitor.config.ts`.
Installed Capacitor8.3.4 otherwise logs methodData before the plugin receives it.
A credential-free begin handshake refuses enabled/unknown logging before the
client sends access-only credentials. Actual packaged logging-off must be
verified before any device sign-in; source configuration is not that proof.

## Focused Source Evidence

Three non-overlapping implementers/reviewers; no unrelated accepted suites replay.

- Client: calibrated RED2;72/72 with16 compiled mutations, then changed-input4/4
  with one further mutation. Adjacent3/3 and typecheck0. Independent source
  review accepted the exact five frozen files, including8s native ACK/15s TTL
  compatibility and noninterference. These are separate runs, not a full aggregate.
- Native:81/81, zero skips, comprising62 actual compiled behavioral cases and19
  literal compiled mutations. Platform JSON/SDK/HTTP/Capacitor I/O are fixtures;
  this is not actual Android TLS/Auth/SDK or installed-device evidence.
- Independent native review found a malformed-newer-account retirement bypass
  in the plugin. Real plugin positive controls reached five RED failures while
  five stale controls passed. A two-line repair routes invalid account through
  the existing state's newer-revision retirement. Affected15/15 pass, zero skips,
  including a compiled shortcut omission. The original81 were not replayed.
- Isolated-device probe: the actual package-private expected-recipient predicate
  is wired; ordinary rendered login and confirmed logout only. Initial6 DOM
  controls are reused; changed5/5 cover forwarding, cleanup, owner fence and
  retired/guest state, with4 compiled omissions plus2 JS selector omissions.
  Host source fixtures do not substitute for an actual AndroidTest.

Native plugin current SHA256:
`C5E53190E4F4CBF21ABAA39C84A7D4656D276628B88E72CDC91F8FBEC7852C21`.
Probe current SHA256:
`03FEA806EE1D31FA209AB91695E0F9E257107C8266B8880D29DEB55E8EDF882F`.

## Build And Device Gate

Previous0.1.14/build15 APK and AAB are preserved byte-identically in restricted
private evidence. Independent review identified a missing AAB rehash before
build dispatch; actual failing control and focused repair close it. Both copies
and their sealed metadata must match before signing/intent/child launch.

Candidate0.1.15/build16 requires its own web build/SW marker, cap sync, signed
APK/AAB and release-test APK. Artifact inspection requires unchanged signer,
Firebase initialization resource names, embedded local web byte parity,
logging-off inside the APK and exact test package/runner/target/source hash.
Resource names and DEX presence alone are not SDK/runtime proof.

Only Realme RMX3830, a newly allocated nonprimary ephemeral profile and normal
allowlisted QA credentials may be used. A063 remains untouched. Durable intent
precedes profile creation; lost ACK uses exact owned-name readback, not recreation.
One selected non-skipped test must observe current own-SDK/Auth/resolver native
verification and then normal rendered logout/closed native state. Strict runner
output remains private; no personal screenshot, trace, video or message capture.

Read-only server before/after witnesses check the same owned QA identity, absence
of pre-existing live Android QA bindings/preview choices, unrelated endpoint digest
preservation and no live Android QA binding after logout. This does not authorize
administrative endpoint deletion or fabricated Auth/device rows.

All bounded source reviews accepted: client, repaired native, bound probe,
build/artifact recipe, owned device procedure and read-only server witnesses.
No outstanding P1/P2 in those reviews. Current gate: actual
build/artifact/isolated device and cleanup. No current candidate build, device
sign-in, main deployment or release publication is claimed by this source report.

## Remaining Work

D-335 stays OPEN: `nativePositive=false`, `richPreviewEnabled=false`,
`canPublishRich=false`. The separately named future proof is
`isolated-native-sdk-auth-resolver-verification`, not FCM delivery/OS display.
Encrypted durable credentials, persisted retirement, explicit choice, authorized
background fetch, notification privacy/card behavior and natural delivery follow.

Rollback disables/removes this optional handoff/plugin and restores the checked
prior artifact if necessary. Preserve generic push/voice, accounts, endpoint data,
package/signing identity and both installed migrations; never replay their SQL.
