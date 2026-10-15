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
