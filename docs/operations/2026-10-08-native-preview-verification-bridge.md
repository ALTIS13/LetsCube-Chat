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
No outstanding P1/P2 in those reviews. Source acceptance is distinct from the
following actual execution. No main deployment or release publication occurred.

## Actual Candidate And Failed Device Check

Sourcecommitb97a9b54,0.1.15/build16. Own web build/cap sync passed; the first Gradle
launch failed before task compilation on its exact cleanup lock. A separately
reviewed Gradle-only resume completed35.76s, instrumentation13.167s. Original
failure and previous APK/AAB are preserved; no cache deletion/global JDK changes.

Signed APK SHA256
`770a29ffd10a58157dc7fd5fb3e5d76c184c8d444164532a61e403a50cd26321`,
7,649,251 bytes, unchanged signer. Artifact inspection passed Firebase resource
names,33 local web-asset byte comparisons/SW4d8b8253303f69cd, packaged loggingnone,
native DEX presence and exact test manifest/source/signer. Original test APK
SHA256`ba4573c84fa16c001774c428b45f83fc1af30719e9eb9fcc353d2c32331887b9`.

Actual server BEFORE passed for the owned QA identity, with zero live Android
devices/Android rows/preview choices. Candidate and test installed on new Realme
ephemeral QA13; primary data preserved/A063 untouched. One selected test failed
after120s, fixed refusal NMPV_VERIFICATION_NOT_OBSERVED; no successful new Auth
session or Android row observed. Native positive and normal logout were not proved.

A separate private guest diagnostic passed1/0: mounted native Android at /login,
unique enabled writable form/fields/submit, no captcha or boot recovery. No Auth
or SDK token request in that test. Its namespace was removed only from QA13;
original test APK restored byte-identically, main APK unchanged. A local Chromium
calibration of the exact built form passed ordinary fill and original Java setter/
submit literals: one correct fictional Auth POST each, intercepted before network,
zero backend dispatch. The setter failure hypothesis is not reproduced there;
neither later guest readiness nor Chromium proves the original Android cause.

The separate calibrated test used actual native keyboard input and observed one
DOM submit event. Its signed test APK was built; the unchanged main APK and
original test APK were rehashed after restoration. One selected case failed
after120s: mounted/form/submitted=true, verified/logout=false. The test namespace
was removed only from QA13. Fresh matched server BEFORE/AFTER passed: unrelated
device digest and preview choices preserved, own Android/live bindings/choices0.
Read-only Auth inspection found the QA account confirmed and unblocked, with no
recent own session/login-audit row. This is not an Auth HTTP-attempt/result proof.
Nonempty rendered fields do not prove exact credentials or React submit state.

The following anonymous network diagnostic's first build failed Android javac:
Authenticator.getDefault() is not available in that platform API. No device case
ran and no successful build receipt was written. Main770/original testBA byte
restoration passed. Preserve the original network-* logs/intent and use a distinct
network-r1-* evidence namespace for the repaired private test. It must not inspect
hidden APIs, change global cookie/authentication handlers or repeat credentials
blindly. The repaired private Java removes the unavailable native lane completely;
only its fixed native_other_failure flag is set. Changed API controls compile
against the actual Android SDK jar, not only JVM stubs. The same scoped Gradle
cache is intentionally reused; a proposed fresh-cache requirement was withdrawn
after independent review found no concrete impact. Actual AndroidTest javac
executed (not UP-TO-DATE), build succeeded, main/original test bytes were restored,
and the distinct signed test APK has SHA256
`14ff37de9f46d38edb6bb51db84aa840b216e468923ba57bf5a95f5cdfa5f442`.

One actual selected diagnostic passed1/0, zero skips. WebView measurement completed
with web_response=false, web_timeout=false, web_failure=true; own temporary state
and test package were removed. This does not classify DNS/TLS/CORS. Phone shell
read-only evidence: clock within five minutes, domain ping reply, curl with config
disabled/default TLS/no body capture returned401. PC health GET with localhost
Origin returned401 and wildcard CORS. Manifest/package INTERNET grant was observed;
background restriction disabled and no QA13 always-on VPN/lockdown configured.
Shell/PC connectivity does not prove target-app UID or WebView trust/policy.

The independent exact-input AndroidTest was built and executed once, PASS1/0,
zero skips. TestAPK SHA256
`0d67ef3ff5d3d59d06ca0e7ee2f4c0a9cc28aeb7466a377de7aadce5beb2fc84`.
Its four Boolean receipt fields were true: input attempted, email exact, password
exact, fields cleared. It used ordinary native keyboard input and no submit/Auth;
its namespace was removed onlyQA13, main770/original testBA unchanged. Input
corruption was not reproduced in this attempt. Exact DOM values do not establish
React state, an outgoing Auth body or successful Auth/device binding.

The separate target-UID WebView diagnostic is now source-accepted after the cold
readiness repair (RED1/warm control1, affectedGREEN5/5; old suites not replayed).
One signed test-only build and actual selected case passed1/0, zero skips.
TestAPK SHA256
`6c07c4ff9854bce4bb73945338974ab93213000d1d8e7e467ede5d72be6bfce3`.
Main770/original testBA remained byte-identical and its namespace was removed
onlyQA13. Original WebView client and own JS state were restored/cleared.

Actual target UID matched and had INTERNET; JS was enabled and WebView network
loads were not blocked. Background restriction was disabled. The target's
ConnectivityManager observed no active network/capabilities; the fixed health
GET was observed, then its resource error category was DNS and its JS outcome
was TypeError rejection. No SSL error was observed in this measurement. Callback
absence alone does not prove universally healthy TLS/CSP. This is a measured
QA13 network-availability gap, not proof that the product code is at fault or
that an Auth POST was attempted. Shell/PC401 remains a different UID/context.

Read-only adjacent checks found QA13 RUNNING_UNLOCKED and the target UID on
neither recognized background blacklist nor whitelist. The first unsupported
user-unlock command returned unknown, not locked; the supported user-state
command supplied the positive observation. No app policy/permission, network,
Happ/VPN, firewall, certificate or trust settings were changed. Next: narrowly
review the QA connectivity boundary without guessing a global repair, then exact
owned-profile cleanup. The source-only review leaves the effective caller-network
rule UNKNOWN: the queried lists are not all UID policies and no active network
can mean no default or caller-blocked. Metered=true with unavailable capabilities
is not proof of a metered transport. A future passive callback/UID-specific policy
measurement is a separately scoped option, not an active request or repair.

Original cleanup executed once. It removed the original test onlyQA13 and switched
to user0, then explicit remove-user13 raced Android's automatic ephemeral removal
and refused. The original failed exit/intent are preserved. A distinct read-only
reconciliation, with two focused source controls, passed: exact QA13 absent,
original user-ID count/digest restored, main0.1.15/build16 retained, all owned
20261008 test namespaces absent from primary user, main770/testBA/probe03 unchanged.
No primary clear, A063 access, capture or additional removal command. This proves
the checked final cleanup state, not success of the first helper or native binding.
Private result is device-cleanup-reconciliation.json; it does not replace the
missing original device-cleanup.json or promote the release gate.

Independent Task6 contract delta was accepted without execution: erasure-only
retirement survives Task5 clear/expiry, context and vault-intent fences are distinct,
and an authenticated empty metadata envelope protects cold generation reads without
decrypting the bearer. Next: a credential-free isolated admission/fence foundation,
no plugin integration/Keystore/storage/background consumer yet. Task5 native
acceptance remains unresolved; no protocol1 or rich capability is enabled.

Task6A is now independently source-accepted: exact target/context/intent fences,
erasure after context loss, refused-BEGIN lost-ACK correlation and reserved final
numeric/identity erasure slots. Final changed numeric input ran11/11 after RED2;
unchanged evidence was reused, not called a new full suite. The inactive class
contains no credentials/store/SDK/plugin. [Task6 foundation](2026-10-08-native-preview-vault-foundation.md)
records current pins and the next metadata-only codec. No native binding or
publication gate is promoted by source acceptance.

Original failed evidence remains immutable. No Stable GO from progress alone;
source acceptance, diagnostic JUnit success and Auth/SDK acceptance are distinct.

## Remaining Work

D-335 stays OPEN: `nativePositive=false`, `richPreviewEnabled=false`,
`canPublishRich=false`. The separately named future proof is
`isolated-native-sdk-auth-resolver-verification`, not FCM delivery/OS display.
Encrypted durable credentials, persisted retirement, explicit choice, authorized
background fetch, notification privacy/card behavior and natural delivery follow.

Rollback disables/removes this optional handoff/plugin and restores the checked
prior artifact if necessary. Preserve generic push/voice, accounts, endpoint data,
package/signing identity and both installed migrations; never replay their SQL.
