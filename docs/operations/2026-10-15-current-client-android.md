# Current Client And Android Candidate, 2026-10-15

Owner: coordinator. This continues the accepted network-revival stage without
replaying its 165/30 source checks or warm4/recovery1 browser cases. Last accepted
shared-web runtime remains 5828284e; no web deployment, DB change or native
publication is part of this preparation.

## Build Path Repairs

The maintained signed-release builder captured then discarded successful child
output. It now surfaces only anchored SW/Vite/Gradle completion records after a
successful child exit; arbitrary output remains unforwarded. The regression runs
real child processes, including failure, ANSI, plugin-stderr, embedded-data and
multi-unit-duration boundaries. An additional actual Windows reproduction found
that an absolute executable under Program Files failed before execution. Paired
outer cmd quotes and verbatim Windows arguments repair that path.

Actual RED-to-GREEN and final affected 28/28 pass. A separate stale version test
expected 0.1.13/14 while the checkout had 0.1.16/17; it now exercises an independent
temporary checkout with literal 7.8.9/765, not another time-bomb release number.
Independent source review found no remaining P1/P2. Existing product cache,
layout, privacy gates, package identity and signer are unchanged.

Feature commits 8a6fd22d/f466aa49 were copied narrowly into a managed candidate
checkout over 5828284e. Candidate HEAD 0dfb98a10d16cf14e9cd4a1e901f89905dd79740
adds only those three build/test paths and Android metadata 0.1.20/build21. The
three unowned sidebar/search paths and main's unowned 0.1.19/build20 overlay are
byte-identical to the before-state.

## Actual Candidate

Build started 17:08:25.806 UTC, completed 17:10:50.467 UTC. Actual completion output:

```text
sw.js build 797eb809f25e8343
built in 35.61s
BUILD SUCCESSFUL in 1m 33s
```

- APK 7,634,643 bytes, SHA256
  `87f1de4f0e78b76d1a55fe30a29eedf953d06cc550accc9e6a8f6b66bcefc535`.
- AAB 7,269,570 bytes, SHA256
  `76228a6ba20cb7fe46d553ce14637cf5d0be6e72879f1be255da0c5c409cb6cc`.
- Maintained APK verifier accepts version/build, canonical package, single
  release signer/v2/Digital Asset Links, non-debug, exact permissions/exports and
  all four Firebase initialization resources. Their actual values also match
  the canonical private Firebase config in RAM; no values are reported.
- Web 34 files -> synced 36 files, with only two verified empty Cordova shims.
  APK/AAB contain the same 35 eligible files, byte-identical. AAPT's dot-directory
  exclusion omits only `.well-known/assetlinks.json`, the HTTPS-served association
  independently used by the APK signer verifier. No remote server.url is embedded.
- AAB JAR signature and certificate match pass. Independent AAB manifest/version
  decoding remains unperformed; do not describe this as full AAB release QA.
- Kub typecheck passes on this exact source; its result from the earlier failed
  build attempt is reused, not run twice. Source-after and four protected hashes
  pass. Native artifacts are retained privately, never staged in Git.

The first ordinary launcher refused before a build due to a forward-slash cmd
executable path; this is separate from the reproduced product-builder space-path
bug. The next attempt passed typecheck but Vite lacked its Windows esbuild
binary after offline ignore-scripts installation. The existing pinned 0.27.3
binary was reused byte-identically, with no download/global change. Only then did
the above real build run. Its first parity observer refused the omitted web-only
association file. A new narrow inspection accepted the unchanged artifacts at
17:14:23.781 UTC; the original refusal remains failed, not relabelled or rebuilt.

Codex Process Jobs rejected win32 before launching any job. The coordinator used
ordinary finite foreground execution; no detached job/completion is claimed.

## Device And Publication Boundary

Read-only Realme RMX3830 metadata confirms installed 0.1.19/build20. No application
launch, primary upgrade, data clear, profile mutation, personal capture or A063
access occurred. Actual candidate acceptance is **artifact-only**. Android Stable
catalogue was read at 16:53:54 UTC: 0.1.16/build17, available, nonmandatory.

Next: affected current-source Realme QA with fictional data and a separately
owned shell/profile, preserving the release install; then the publication gate.
Do not replay deferred native-preview/parser attempts. Existing artifact policy
uses original completion 17:10:50.467 UTC, not copy/inspection time; its six-hour
deadline is 23:10:50.467 UTC. Neither this record nor a later check renews it.

## Current-Client Measurement

An immutable fictional production-mode QA bundle now builds from 684 literal
main-tree blob pins, 648 graph inputs and SDK 2.105.1. Main product base 5828284e
and checkout 0dfb98a1 are distinct in its manifest. This excludes the unowned
sidebar source. Manifest SHA256:
`0edaf5d917f12ab6772fe9c602d6bc89416035aa95763683609415bc3909dd2e`.

The one new 390/dark warm-unread case passes in one actual run. Twenty-four rows
arrive while A is closed; the real sidebar unread count reaches 24. The intentional
history and then privacy waits show the spinner and withhold new rows. After
release, 73 unique rows render; the first-unread divider/message are in view and
the last unread is offscreen, without a document reload. There are 23 transport/
contract and 4 privacy-shape controls, one returned ping, zero pending gates,
unknown HTTP/WS or page errors. No real backend, snapshots, captures, native
bridge or rented minutes. Measured requests: history 1, hidden 1, membership 0,
media 1, other 2. Actual click-to-history request 25.8 ms and first sampled valid
layout 31 ms after privacy release are separately reported from artificial
history 176.5 ms and privacy 161.5 ms holds. These are single synthetic samples, not physical paint,
an SLA, native WebView or proof of the tester's device/VPN cause. The standalone
Node helper emits a typeless-package warning; no package-wide metadata change is
made merely to silence it.

Independent source reviews of the artifact inspection and the new compiled
case found no P1/P2. The new case answers hidden-ID reads with an empty set; it
does not re-prove denial/loss/rejoin, whose accepted separate evidence is reused.
Before the branch push, the complete origin/main..HEAD range was inspected:
75 commits including this documentation, 34 own-tree frontend files and 391 alias
references resolve. This is
branch preservation, not promotion of that entire feature range into main.

## Private Media Intake

The previously downloaded 12.616667 s, 720x1568 video now has six privately extracted
and OCR-completed frames. Known static loading/error labels matched none of the
six; that is not proof of absence of a defect. One offline medium/int8/VAD audio
pass processes 12.613437 s and produces zero speech segments/zero VAD seconds.
No narration was recognized; audio presence is not a new voice-message report.

The image OCR semantic attempts remain unaccepted: constrained generation failed
sampler initialization, while the unconstrained successor violated the response
schema and source coverage. No new defect is inferred from those drafts. Raw
pixels/OCR/audio/message content never leave ignored private storage. Full media
semantics and the reported VPN/device delay remain open under item 87.

## Physical Current-Client WebView

Two actual coordinator-owned Realme runs use a separate, permissionless debug
package, `qa.letscube.current20261015`, not an upgrade of the installed release.
The shell contains no client bundle, account, native bridge or backend config.
CDP supplies the same frozen current-main client and explicit fictional HTTP/WS
contracts. Actual engine is Chrome137.0.7151.72, native viewport360x800/DPR2;
no viewport emulation, production authentication, captures or rented minutes.
Android's network-unblock refusal stays enforced: networkLoadsBlocked=1 and
networkUnblockDenied=1. A real document/fetch positive control nevertheless
confirms CDP fulfillment before the functional case. This is scoped physical
WebView evidence, not execution of the signed Capacitor APK.

The first run reaches 24 unread, 73 unique rows, first-unread anchoring, real
history/privacy holds and same-document reconciliation. Unknown HTTP/WS,
extra pages, workers, downloads and page errors are all zero. Its subsequent
background stage fails because a DOM hidden state is not observed after HOME.
The HOME command ACK does not prove a native pause. That failed receipt remains
failed: SHA256 `16ca1cc664d0d761299a57855e7716cdfb3f2fac2ba267e7c440b3e9ee8eb59a`.
The native 380.8 ms click-to-request and 505 ms first sampled visible layout after
privacy release are single synthetic observations, not physical paint, an SLA,
or proof of the tester's VPN/device cause.

A changed-input second run tests only the missing native lifecycle boundary,
without replaying the accepted 24-unread transition. At18:00:14 UTC it passes:
49 current-main rows and decoded image; creates1 unchanged, pauses0->1 and
resumes1->2; identical document, location, container and row objects; duplicate0;
both control anchors visible; maximum geometry delta0 CSS px. Actual native
counters are retained immediately before/after HOME and foreground. DOM hidden
remains false and is reported diagnostically, never fabricated as true. The
production connection-revival hook separately subscribes to Capacitor's native
App appStateChange; this permissionless shell deliberately does not emulate it.
Unknown HTTP/WS and native console/resource/load/HTTP error counters remain0.
Probe elapsed7.488 s; source SHA256
`cbb614354a1f40c041ab7b4ab41505069423744340b94a29f18f00c118555051`.
Final receipt SHA256
`a2995f307d41913af97bdf511eef34bab5b4fe9f4fa84e7a6c32b7aa6ce6f9df`.

Both runs remove only the exact hash-bound owned package/forward. Primary20,
protected instrumentation package, UID/data state, users and other package
inventory match their before-state. Cleanup accepts no foreign-user install or
replacement socket mapping; four focused controls include two literal mutants.
The old whole-branch, warm4, browser recovery1 and165/30 evidence is reused.

Next affected boundary: fictional transport loss/rejoin/privacy reconciliation
on this physical WebView, then signed-APK guest lifecycle in a fresh isolated
API34 AVD. The latter's first invocation refuses during host-only date parsing:
PowerShell7.6 ConvertFrom-Json returns DateTime, whose culture-dependent string
is not the original ISO value. No AVD/run directory or emulator is created by
that refusal. A new narrowly repaired script is being prepared; the original
source/refusal is not overwritten. No publication or expiry renewal is implied.

## Physical Recovery And Audio

The new physical recovery case passes in16.168 s. A real pre-header read is held,
the fictional transport drops, an unbroadcast hide/new row changes only the fake
server, and the actual online hook cuts the aged read as network-change. Fresh
message/hide/membership subscriptions and ping return. Before the privacy gate
releases, the unknown row remains absent; afterwards the missed hidden row is
removed and49 allowed unique rows/image remain in the same document. Recovery
history3/hidden3/membership1, including one fresh own-membership list read; two
intentional dark reads refuse. Unknown HTTP/WS and page errors0. This is a local
fixture transport disruption on physical WebView, not an actual VPN/router change.
Receipt SHA256 `e1149680b37c9a8da74d290692be065e3c7375fa25dd6bfeff60b8f79b6d07d9`.

Native HTML audio also passes in13.139 s: actual muted30 s synthetic WAV,
three genuine206 byte-range loads, real currentTime advancement, A->B->A
continuity with the same away transport and position3.46->4.15 s. One actual
messages UPDATE tombstone and single-row consumer stop the active audio, clear
its source and remove the global bar; natural ends and media errors0. No media
play/currentTime/event mocks or store injection. Receipt SHA256
`36591c6a1044e91c27405c8d6da8c41e783f091307a43f081484f0479e125f6c`.
Speaker quality, video and hide retirement are explicitly UNVERIFIED by this
audio case. Both additional exact-owned installs/forwards are removed and protected
Realme baseline20/test/users/data/package inventory match their before-state.

## Signed-APK Gate: Accepted Target21 Scope

Every attempted AVD run has checked shutdown and exact generated-data cleanup.
None is reclassified as release acceptance. In order: original host-only date
projection refuses; the first booted API34 run refuses the radio guard before
installing an app; the next two refuse a permission-labelled predicate whose
actual cause was not retained. Source diagnosis proves missing XML also returned
permissionAbsent=false, so the label alone proves no permission dialog. A new
owned-file/RAM XML reader observes a real login/password but not its expected
email accessibility label. Another successor refuses a generic local command;
the cached signed instrumentation/secondary-profile successor times out before
retaining a test result. No raw personal or guest XML is retained on the host.
Normal POST_NOTIFICATIONS was granted only inside disposable owned AVDs; no
physical phone permissions or other runtime grants were changed.

At that checkpoint the approach changed instead of replaying those wrappers: a
new narrowly signed QA instrumentation APK would reuse ActivityScenario/WebView,
require
an emulator fingerprint/hardware/model and owned-scope guard, and initialize then
verify CE/DE sentinels through the target app's own Context. Actual Os.stat and
package metadata will distinguish upgrade preservation from an empty fresh install.
No existing physical-device QaUserIsolation guard or product APK is modified.
This probe/build is preparation, not execution or a passing receipt.

The actual fourth build attempt now succeeds with javac and a reviewed test-only
Gradle task graph. Its459,357-byte signed instrumentation APK has SHA256
`2514b2e3f8e3a49c5de9dd28b6ff261b0c052af7f6769306be3596254c4ad5f8`;
canonical signer continuity passes. The product APK was not rebuilt and its
87f1de4f hash/source0dfb98a1 remain unchanged. R9 binds this exact test APK,
single method and original candidate expiry, not a cached/guessed probe. It adds
bounded per-command phase/hash/timing receipts without raw output or nonce values.
Actual emulator execution and resulting guest/custody evidence are still pending.

The first two new instrumentation runs both clean up their exact owned AVD but
refuse the host result predicate. R9 receipt is
`aed143904bf31821cfa981309665454870a0bd73ac9d51f6d5acf3eb95a9f525`;
R10 diagnostic receipt is
`1bc5e96f5a92f187c3033f42b670d8c5c77669755a32b8ee38a31e639d2bc7aa`.
R10 observes the probe's custom status73 and no exception/crash classifiers, but
no final raw result code. Status73 is emitted after the Java assertions; this is
not a standard JUnit completion. The host requested pretty output without-r while
requiring raw result fields. [Android's command contract](https://developer.android.com/studio/test/command-line)
and [AOSP reporter](https://android.googlesource.com/platform/frameworks/base/+/master/cmds/am/src/com/android/commands/am/Instrument.java)
confirm that pretty streams omit those structured result fields. The private R11
successor changes only that invocation to-w-r, not APK or acceptance criteria.
The literal host control rejects old format, accepts raw and rejects omission;
the first inline harness attempt failed shell quoting and is not test evidence.

R11 raw output now exposes actual JUnit status1/-2 and final result-1: the old20
initial guest readiness assertion times out at awaitGuest168/reporttoParent117.
No custom completion report is emitted, and exact owned cleanup passes. Earlier
custom73 runs and this timeout are different observations, not permission to
infer that the APK is broken or to mark any upgrade as passed. Next diagnostic
probe will retain the last closed DOM boolean vector on failure without changing
the product APK, startup timeout or acceptance criteria.

That earlier publication preparation stayed fail-closed. Its source adapter15/15 and exact
native-media reader37/37 source controls pass, including literal omission mutants.
Guest/upgrade descriptors and the effect entry were then PENDING. The existing
22-path native aggregate differs only in useNotifications.ts UPDATE merging:
21/22 paths, including all14 listed Java files, match Stable17. This is not blanket
nativeSourceUnchanged, and the referenced D353/direct-producer receipts are not
genuine Auth/FCM delivery proof. No fresh delivery or authenticated-session claim.

Independent source review also found the inherited publisher's main assertion
still named the old private evidence directory. An exact-one current-OWN repair
passes literal RED-to-GREEN controls and its dependent media-reader checks; the
transport's CAS/backup/immutable-artifact/rollback behavior is otherwise unchanged.
Current publication-source SHA256 is
`1058277e8fe9cb530b2d5af07e20c664a192f80aaee59181d395423810d3b5a7`.
No stage, intent, catalogue or remote side effect was created.

The focused successor R12 passes at19:39:31 UTC. Its signed test APK3be7d306
initializes actual old20 CE/DE SharedPreferences through that app's own Context,
commits and rereads a fictional nonce, and records real Os.stat UID/inodes. It
does not launch or claim old20 UI. This baseline is sufficient for storage
upgrade custody; requiring the old UI would test an unrelated release, not21.
An actual install-r upgrades the canonical package to21 without uninstall/clear.
The new process rereads both markers without writing them and preserves UID and
both directory inodes. Two standard JUnit cases, each selected separately, finish
with status1/73/0, one report, OK1, final-1 and zero skips/failure diagnostics.

Candidate21's actual bundled guest has visible empty email/password fields, real
Capacitor and ChatNotifications/MediaExport/VoiceCalls plugins, nonblank viewport
and no horizontal overflow. Controlled CREATED ->RESUMED retains Activity,
WebView and document identity. Unlike the permissionless physical shell, this
actual signed Capacitor case observes VISIBLE ->HIDDEN ->VISIBLE. Native App
event delivery remains UNVERIFIED; these are not interchangeable observations.
No production account, backend connection, capture or physical release update.

Exact owned AVD processes/data are removed and ports closed. Final receipt SHA256
`85d30bb6cbe1a6fe98009a1ccc905d7ea4195a0b57bc0e00cb79bb20baaf9edc`;
init8163df45, verify38c94d1f, cleanup80a65a6b. Driver SHA256
`6a556dc490f12fb852e801e50e17af005cdd9c0a65cff77e580645da4a0eb0fb`;
Javae5f193b9, actual compiled test APK
`3be7d306b76e068297626387e14d50dca858f72903b582b536356a957cea671d`.
Independent source review found no P1/P2; actual receipt review and final effect
wiring were next. Product APK87f1de4f/source0dfb98a1 and original six-hour expiry
remain unchanged. This proves sentinel storage preservation, not all account
data, authenticated-session survival, FCM21 delivery or every OEM. Earlier
REFUSED receipts remain intact. At that checkpoint no publication had run.

## Actual Android Stable Publication

After the R12 acceptance, new actual-receipt readers pass106/106 focused cases,
including12 compiled omissions and two actual RED baselines. Independent final
review accepts nine-file closure
`933d4899f270fdaa442ddc889da0c6ce25cc35bcb60f79f6bb0d340a0faedebb`
and ready transportcf9d068b. The real coordinator check reads the clean candidate
HEAD/source and all pinned inputs at19:53UTC; no SDK/device/network effect there.
An earlier read-only SSH preflight independently confirms Stable17, free space
and absent target directory, but does not replace the later locked CAS checks.

Three separate once-only invocations complete: stage19:54:29UTC,
publish19:54:41UTC, verify19:55:04UTC. Android0.1.20/build21 is now public Stable,
mandatory=false. Exact candidate APK7,634,643bytes/SHA256
`87f1de4f0e78b76d1a55fe30a29eedf953d06cc550accc9e6a8f6b66bcefc535`
is immutable. A full public redownload and the actual Android release verifier
confirm identity, signature and metadata. The public catalogue SHA256 is
`10696731d2e3a09f39dfaa6e780e405837ec0d406d7417966150da8019707d4d`.
The byte-identical prior Stable17 catalogue is retained under the exact owned
release backup directory; rollback is catalogue-only, not an installed APK downgrade.
No AAB/store publication, package identity change, SQL, web deployment or physical
primary installation. Original expiry was not renewed and does not limit public
download availability. Auth/FCM21 and broader OEM limitations remain explicit.

[Android APK](https://api.letscube.ru/releases/files/android/0.1.20/letscube-0.1.20.apk),
[Stable catalogue](https://api.letscube.ru/releases/v1/android/stable.json).
Publication receipt SHA256
`0b5d04c10f450f23b72954ada49223eb7fbf21a54ad23fbb6d8e58b2eaf95f14`;
public verification receipt
`b0649b5435b48cd31f704a02b490494478b79606e9c93e909ccae6e15e59b7c7`.

## Next Bounded Source Candidate

Read-only player audit finds D-365: detach captures position A in a one-shot
loadedmetadata listener without item/operation/source fencing; close/retirement
clears transport but does not remove that listener. A later global-audio reuse
for C may apply A's old position. Existing detached retirement coverage only
calls leaveChat, not actual detach. This is a P2 source candidate, not runtime
proof, a D-360 regression claim or evidence that hidden media resumes.
Next: an actual detach ->retirement ->C late-metadata RED and a current-detach
positive control, before choosing a minimal cancellation/fencing repair.
