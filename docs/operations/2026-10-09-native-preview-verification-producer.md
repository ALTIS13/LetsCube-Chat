# Dormant Android preview verification producer

Date: 2026-10-09. Owner: coordinator. Source candidate: `3924d35a` on
`codex/bot-inline-media-20261002`; baseline `ea01f010`. Production web/main
`4765bcad` and Android Stable0.1.14/build15 are unchanged.

## Result

The inactive same-invocation producer is independently source-accepted. One
actual Android36 API compile passed at 16:51:34 Moscow: 16 explicit production
sources and 80 required fresh named class definitions, all checked as major52.
No production caller arms this producer. Protocol0, default-unbound behavior,
generic notifications and the ordinary plugin path remain unchanged.

This is not an APK build, AndroidKeyStore test, real Auth/FCM/resolver result,
physical-device composition, consent or notification-card acceptance. D-335
stays OPEN; nativePositive/richPreviewEnabled/canPublishRich remain false.

## Mechanism And Observed Repairs

`MessagePreviewVerificationProducer` admits a credential-free arm request against
the existing verification state and its private ticket. The same runtime performs
the public-key/JWT checks, Auth GET, own SDK token lookup, exact device-resolver
POST, second SDK lookup and completion. A one-use internal verification reaches
the retained vault owner/worker; no caller-supplied Boolean, public credential
tuple, alternate verifier, cached successful authority or new executor is added.
The guarded authority must match the actual current owner. The legacy unguarded
authority refuses a producer verification; ordinary nonproducer callers retain
their existing compatibility path.

Two draft failures exposed a final-publication gap after the outside authority
check. The publication now also checks the original producer deadline and its
exact ticket's irreversible revocation marker while holding the existing owner
monitor. Beginning/clearing/resetting/invalidating/failing/closing that ticket,
or observing its expiry/regression, revokes only its own marker. A stale prior
ticket cannot revoke a successor. The initializer change is two memory-only
guard lines, not a callback, clock read or transport call under the owner lock.

The original Task5/vault/supplied deadlines and one eight-second verification
budget are retained rather than renewed at intermediate phases. This fences
observed same-process retirement; it does not claim cross-process atomicity,
preemptive I/O cancellation or receipt of an IPC message that never arrived.

## Source Evidence

Independent completed SPEC/QUALITY review: `DAE28AA3`, no blocking P1/P2.
Author chronology: `3533123A`. Full committed review package: `DD910B59`.
Changed scope is five production classes and three focused fixture/probe/test
files; response parser, HTTP transport, plugin/config/SQL/display are unchanged.

The final affected selections passed separately, 15/15 and 11/11. Forty-two
distinct new boundary controls, two feature cases, 18 calibrated compiled
mutants and one baseline attempted-ticket omission are chronological evidence,
not a new combined suite or a fresh aggregate pass. Draft failures, calibration
errors and a noncompiling mutant remain recorded as failures, not mutant kills.

The healthy composed JVM graph exercises checked PENDING, encrypted COMMITTED
G1 and EMPTY G2 on the actual Java classes. JCA/file controls use a real temporary
file backend and SunJCE; Android/Capacitor/Firebase/Auth/resolver collaborators
are explicitly fictional. They do not prove AndroidKeyStore or Android durability.

## Actual SDK Evidence

Independent conditional program review: `02B995A1`; final binding review:
`7AE4BAB1`, both completed before dispatch. Final helper SHA256:
`0C21BF7B5688E7E83C0F62D664E8C2E0495FE41B1019CB86EA38158A4777AA80`.
The final binding control first failed against UNKNOWN and then the two changed
binding/projection controls passed; old suites were not replayed.

One bounded compiler invocation used the existing fixed JBR javac and Android36
boot classpath, Java8 target, no annotation processing or implicit source, and a
new exclusive private output directory. Source/tool/ACL/main-localTest APK
preservation checks passed before and after compilation. The compiler exited0;
the receipt records stdout0 bytes and stderr272 bytes without exposing contents.

| Durable receipt | SHA256 |
| --- | --- |
| Intent | `AFE76CE8E1854010B5536056EB977C005AC36E92208B177B7394CCA1241FF186` |
| Compiler | `B29B1606F276A5433013FC8BA10609C018DF798EA70C6BA8E232C06F65CB16FB` |
| Result | `15A86FADA26D83E160B857D02AA7FD975B5E7A8FF029ECE138E6BC8D6C70BD39` |

A separate readback verified the receipt chain, all 80 required named emitted
class hashes/headers and all 21 fixed source/tool/protected-APK inputs. Anonymous
or synthetic output counts are not used as proof of the named closure. No second
compile, old-output reuse, release signing, APK replacement, device call, SQL,
main deployment or paid-device allocation occurred in this stage.

Independent completed publication readback `B462C9A8` confirmed the receipt chain,
all 80 class hashes/headers and 21 input pins with no blocking P1/P2. Its P3
wording correction is applied above: the 18 compiled cases include a substitution,
so they are called mutants, not all omissions. No test/compiler replay was needed.

## Next

Finish the separately scoped credential-free own-user0 health diagnostic source
and independent review, then measure the previously unresolved normal TLS/WebView
route without changing trust, VPN or network binding. That endpoint-path result
alone cannot admit genuine Task5. Actual owned-QA SDK registration, normal sign-in,
acknowledged device UUID, lifecycle/credential composition, explicit consent and
card/OS acceptance remain required before wiring or publishing rich previews.

[Approved binding plan](2026-10-08-native-preview-device-binding-plan.md).
[Previous D4 retirement and its distinct SDK proof](2026-10-09-native-preview-unmaterialized-retirement.md).
