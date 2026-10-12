# Android Fresh20: Actual Build, Upgrade And QA Boundary

Coordinator checkpoint, 2026-10-12, 00:47:42 UTC. Web runtime remains
`d252b4a5`; Android Stable remains `0.1.16` / build 17. Private candidate
`0.1.19` / build 20 is built and installed, not published or behaviorally accepted.

## Build And Artifact

- Exact native22 provenance is resolved: 21 unchanged paths and the identified
  notification hook change. No old aggregate was silently reused. Main source is
  `d252b4a55d32cc063b58ee42308aa52db501471d`, native aggregate
  `1bede7424539e8338146937615a8794e5bfe0842cbda73b28806956cd351d644`.
- Protected local material was preserved before the private version overlay.
  Preparation `8372fd`, preservation `7f1f25` and check `3bf40e` pass.
  Main's version overlay remains private; no identity or Firebase/key mutation.
- One signing-wrapper build ran from 00:10:19 to 00:20:56 UTC. Its child exit
  status is 0, but caller `4c9a99` exits 1: cap sync changed four generated plugin
  paths and the post-build source check refused. This original refusal is retained.
- The four relative-to-absolute paths resolve to identical plugin directories.
  Only those generated lines were restored byte-for-byte. No rebuild or spent
  check was replayed. Artifact inspection `aad226` performs the current source
  and actual SDK/artifact checks and passes. Recovery is explicit:
  `buildRecovered=true`, original observer false, no fabricated ordinary receipt.
- Wrapper output did not contain genuine Vite/Gradle completion markers. Such
  markers are not claimed. Actual command acknowledgement plus actual signed
  artifacts, SDK checks and embedded-byte parity are the retained evidence.
- APK: 7,631,259 bytes, SHA-256
  `d5e4732d754e658f4a173cebb7738283682995725a6c8ccbb40da87583df6aca`.
  AAB: 7,266,190 bytes, SHA-256
  `5940892c861743364615f92a07677d78b57c416c9f802dde161f069e9b8b0c5d`.
- Canonical identity, version/build, signer/Digital Asset Links, non-debug,
  permissions/exports, four Firebase initialization values and 36 embedded web
  files pass. SW build `13f5bf586030ddc1` matches web/sync/APK bytes. Hidden-history,
  notification-read, sound-epoch, Voice and Storage compiled consumers are present.
  Independent source/artifact review accepts the selected boundaries.
- Freshness starts at the original build completion, not artifact inspection:
  deadline 06:20:56 UTC. A later journal never renews it. Frozen execution README's
  recovery instruction to repeat `check` is superseded by the above one-time
  artifact path; the original frozen closure was not edited after execution.

## Protected Upgrade

The first device executor admission refused before ADB/install effects because
its private parent inherited ACLs. The original refusal remains a refusal.
Only that exact private directory's inheritance was protected, retaining its
three trusted rules and original SDDL. No recursive/global ACL change occurred.

New changed-ACL execution `b229e2` / `ecb612` passes in 11,726 ms with exactly
one acknowledged data-preserving install. Actual result SHA-256
`6219cfd3b32c05bb7f689bc0c529a844b1134219fb7e508e29eed20c01e33ebd`.
Primary moves build 19 -> 20; UID and CE/DE identity remain unchanged. Protected
test APK and original users remain unchanged. The actual returned CLI journal
was retained and independently checked against the persisted result, not invented
from the existence of a file. No personal app UI or authentication was launched.

## Strict Isolated QA

Fresh R11 source binding
`de1f711a1426d49158c3be08e1660a6b459c152d8f5a3bace10046e0ed92a6f7`
uses a separately measured actual build20 protected baseline and preserves the
immutable fictional fixture's historical construction provenance. Core source
controls 3/3 and independent source review pass; check `7f8ea9`, materialize
`10bf07`, owned-profile prepare `c61705` and fixture install `84bd07` pass.

Automatic `e69690` refuses after 5.34 seconds, before semantic/physical cases.
Its new sanitized foreground record proves predicate 4 failed: acknowledged ADB
response, 52,203 stdout bytes, zero modern and zero legacy resumed-activity rows.
No raw activity, personal content or screenshot is retained. This narrows the
new failure; it does not establish its cause or reinterpret the old R3 refusal.
No automatic replay, 8/8 semantic result, physical 4+4 or release acceptance.

Exact-owned cleanup `1f9a9d` acknowledges fixture uninstall and switch to user0,
but remove-user ACK fails and remains failed. Separate read-only reconciliation
`26546e`, 00:47:42 UTC, proves fixture/profile absence, current0/users[0], unchanged
primary20 and protected test. It does not replay effects or relabel the failed ACK.
No owned QA profile/app or needed command session remains outstanding.

One separately reserved read-only probe at 00:54:06 UTC observes the current
user0 screen `Asleep`, a valid activity-dump header, modern0/legacy0 and one
alternate resumed-prefix row. Raw power/window/activity output stays in RAM;
only fixed scalar classifications, command acknowledgements and hashes persist.
This is present-state evidence after cleanup, not a reconstruction of automatic031
or proof that an alternate marker is equivalent to top-resumed foreground.
The existing setup has no wake/awake precondition. The next minimal source slice
will establish that precondition before an owned launch, keeping the strict
foreground parser and semantic/physical criteria unchanged.

## Awake20 Changed-Input Attempt

A separately measured current-user0 wake/readback at01:08 UTC observes Awake
and the explicit `dumpsys activity top-resumed` root-field format. Pinned AOSP
references support that dedicated command; they are not the OEM's exact source.
The source derivative adds acknowledged WAKEUP/Awake before owned setup and
selects top-resumed for both foreground reads. Expected QA user, exact fixture
package/component and RESUMED/stopped/finishing requirements remain strict.
Source parser RED1 ->7/7 plus four omissions; independent review accepts.

Binding `e9bc3a92` materializes exactly seven modules. Actual materialize
`f94c4e`, prepare `090126` and fixture install `b26e29` pass. Automatic `212483`
refuses after5.76s at first foreground edge033, before semantic cases:
ACK0/no error/signal/stderr,4621 stdout bytes, predicate5 fails lexical token
cardinality. Metadata does not identify which token or distinguish missing from
duplicate; repeated OR-mask bits63/63 do not mean all fields passed. Exact
owner/component/state checks were not reached. No raw dump retained, no native,
physical or publication acceptance.

Cleanup `2d9428` refuses and remains failed. Separate read-only reconciliation
`b9d63e`,01:23:39 UTC, proves exact QA24/fixture absence, current0/users[0] and
unchanged primary20/protected test. Result SHA
`fe3965749b108887764927b8be1a884dc5dab2cea1c30e8c06f28e7b23d54d02`.
No effects replay, personal app launch or needed command remains outstanding.

The parser counts lexical words across the entire dump rather than structurally
binding the root ActivityRecord fields. This is a diagnostic/grammar gap, not a
proven particular duplicate or product failure. The smallest next measurement
is numeric-only root/word assignment cardinality; do not rerun semantic cases
to discover a token. Current-user0 grammar evidence is not the QA24 observation.
Original artifact expiry remains06:20:56 UTC; no read/derivative renews it.

One separately bounded read-only current0 formatter observation at01:37:41 UTC
has two acknowledged commands/196ms, no wake/launch/install/profile effect and
no raw retention. Whole word/assignment buckets are `[1,1,1,1,0,1]` for the six
fixed fields: `stopped` is absent. Root anchors are1111 but lifecycle shape fails
the old contract; root identity/state are not admitted from this observation.
It is not QA24's dump or proof of033's missing/duplicate token.

Direct bounded official HTTPS reads resolve Android15 release
`android-15.0.0_r1` to `4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3`.
Its lifecycle row prints state/delayedResume/finishing, not stopped. Separate
`mAppStopped` is printed only when true. The dedicated top-resumed route dumps
one server record with an empty prefix. This explains why the old mandatory
key is not a portable formatter contract; it is not an exact OEM fingerprint
or a license to assume a missing field false on unknown output.
[Pinned ActivityRecord formatter](https://android.googlesource.com/platform/frameworks/base/+/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/services/core/java/com/android/server/wm/ActivityRecord.java#1247).
Require a bound structural profile and honest conditional-state provenance
before changing the reader. Do not substitute another unverified field name.

A bounded pure four-row reference prototype ends8/8 fictional controls with
native adapter HOLD. It deliberately does not parse the full real root dump;
its result is not readiness, an OEM stop-state proof or another native attempt.
The prototype remains unused/ignored, with no host/SDK/device effect. Do not
repeat its accepted controls or grow a successor framework: establish the
actual root/lifecycle/conditional-stop input, then amend the existing reader.

## Next Actions

1. Preserve the separate current-state probe and original failed packet. Unknown
   keyguard fields remain unknown; do not infer the old failure from this read.
2. Measure and fix structural root-field parsing with literal collision and
   duplicate-root controls before another changed-input native attempt. Wake
   setup is now present; do not repeat its source preparation unchanged. No new
   SDK build solely to redate an artifact or blind automatic/physical replay.
3. Complete native behavior and checked publication before changing Stable.
   Native preview/person/display promotion remains separately unaccepted.
4. Advance item77's channel/topic preference contract independently. Preserve
   unowned sidebar/search files and private main version metadata throughout.
