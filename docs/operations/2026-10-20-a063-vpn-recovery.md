# A063 VPN and Chat-List Recovery

## Resume

- Owner: Codex coordinator; canonical `android-current-20261015`, branch
  `codex/ui-motion-updates-20261019`, product `d9991760`, docs baseline `41b775c7`.
- Latest direct owner authority includes A063/ADB and phone VPN toggling for the
  reported whole-app/chat-list failure. It supersedes the earlier Apollo
  exclusion, not the boundary protecting PC Happ/routing and personal content.
- Stage: bounded physical observation complete, no new product patch justified.
  [Released source, Stable32 and next persistence slice](2026-10-20-reconnection-cache-release.md).
- Next: received-text persistence with authoritative current access/revision
  admission. Do not repeat these cohorts unless a changed input answers a new
  concrete question; wider VPN/ISP/long-session coverage remains separate.

## Method

The installed release is Android0.1.31/build32. A temporary original-signer,
test-only Android Instrumentation targets only the owned LETSCUBE package and
checks that it runs in the actual app UID. It reads allowlisted loading booleans,
row counts and ResourceTiming categories, plus a native anonymous health probe.
No input values, chat/message/profile identifiers, body text, request/response
bodies, tokens, screenshots or conversation accessibility trees are collected.

Instrumentation starts a new target process. It cannot describe the pre-existing
hot process or prove a native in-app update. Target version, UID and first-install
identity are compared before/after; the release APK is not replaced and data is
not cleared. A health401 establishes endpoint reachability, not authentication.
ResourceTiming status0 and an absent connection indicator remain UNKNOWN.

## Observations

1. A working-VPN cold start reaches the main interface within five seconds;
   the actual app-UID native health response is401 in142ms. This did not reproduce
   the reported failure.
2. A later transition retains the loaded list but enters CONNECTING. The app-UID
   native health request times out after5035ms. Independent shell requests also
   fail: DNS resolution on app/catalog and a TCP timeout to the core endpoint.
   This establishes an unavailable route beyond LETSCUBE, not its VPN-provider
   cause or a new Auth/cache defect. A quick-settings click intended to turn VPN
   OFF did not prove OFF; this cohort is not an accepted ON/OFF/ON cycle.
3. The next observation starts with a confirmed bad route. The app shell/list
   remains unavailable until the Android VPN disconnect confirmation is accepted
   and the VPN foreground service is absent. Shell health then returns401/257ms.
   In that same instrumented process, without reload or login, the main interface
   and nonempty chat list appear automatically in the next few seconds and stay
   loaded through the rest of the65-sample observation. End app-UID health is
   401/188ms.

### Timing Correction

The OFF action is timestamped by the PC; samples use the device clock. A later
72ms-roundtrip calibration places device-minus-PC time between-1304 and-1232ms.
Subtracting those clocks directly previously yielded0.694s for the shell and
1.696s for the list; those are invalid precise recovery durations. With the later
calibration, observed samples are approximately two/three seconds after OFF,
with one-second sampling and no simultaneous clock calibration. The accepted
claim is automatic recovery within a few seconds, not a benchmark to tenths.

## Cleanup and Limits

The original phone VPN is restored ON and its foreground service is confirmed;
post-restore shell health is401/496ms. That shell response alone is not a new
signed-in UI/native-UID acceptance. The original quick-settings tile list matches
exactly, the test-only package is absent and normal LETSCUBE is foreground.
No VPN profile deletion/change, release reinstall, account/data clear, PC routing
change or paid rental occurred.

An initial30s test-package install timeout had an unknown result: installation
later completed. Recovery first compared the installed test APK bytes to the
exact owned artifact, then removed only that verified package after observation.
The timeout refusal remains retained; exit/timeout alone was not called cleanup.

The connectivity-dump parser counted historical requests as current networks;
its counts/validation flag are not accepted network inventory. Empty native
logging is not absence of failures. Server source-IP/WebView aggregates span
phases and cannot establish this UID's loader completion. Retain these limits.

No new product defect is established by this bounded case. Source-only concerns
about nested bootstrap/profile retries remain hypotheses, not reasons to weaken
Auth/privacy, add reload loops or claim a fix. Released D-386 supervises stalled
replacement WebSockets; it cannot make an unreachable VPN route pass traffic.
Persistent received-text history, cold-offline policy, other VPN routes and the
broader device/long-session matrix remain open.
