# Readable Notification Lookup

Owner: coordinator. Stage: source/SDK accepted; native display remains pending.
Source baseline `cd8ef969`.
The owner's latest request makes readable notifications the first priority.
Evidence: the installed generic Android presenter has no content lookup;
`MessagePreviews.getCapabilities()` remains protocol0. The existing server RPC
and preference schema are not a connected native consumer.

## Current Slice

1. Add a bounded, cancellable call to the existing recipient-authenticated
   `native_message_notification_preview` RPC using the existing HTTPS transport.
2. Validate the exact recipient/session/device/notification/chat/message tuple,
   current preview choice, bounded display strings and short server expiry.
   Admit content only through a current-owner/current-card callback; account
   retirement, cancellation, replacement, timeout and refusal keep generic text.
3. Exercise actual compiled Java with fictional data, unchanged verification
   boundaries and omission controls; obtain one independent final review.

This slice does not enable protocol1, persist credentials, alter provider
payloads or save a user's preference. The response is not a reusable display
lease. Native credential/choice lifecycle and actual receiver/presenter/OS checks
remain necessary before readable cards may be enabled or released.

## Decisions

- Reuse the existing fixed-origin HTTPS/JSON boundary and Java standard library;
  no additional dependency, secret store or database migration.
- Do not replay the Oct11 screen/ARM attempts: their source/SDK evidence is
  retained, their native Settings sequence is still unaccepted.
- Work in the current approved feature branch and keep the unrelated dirty
  sidebar/search paths byte-identical. Do not merge dormant features into main.
- The local Realme is available; A063 remains excluded. No paid device allocation
  is useful for this non-presenting source boundary.

## Verification

- Initial compiled projection/control absence was RED at
  `CURRENT_RECIPIENT_CONTENT_AVAILABLE` and `CURRENT_OWNER_CONTENT_CONSUMED`.
  The transport's independent absence case was RED at
  `CONTENT_PREVIEW_ENTRY_REQUIRED`; these were runtime assertions after successful
  compilation, not compiler/import errors.
- Final affected run:251/251, zero skips,57.58s. This includes51 parser,
  33 consumer,75 transport/integration and92 existing native verification checks.
  Compiled mutants exercise ownership/IDs, consent,96/240 code-point and15-second
  limits,2-second request budget, cancellation, headers/bytes/UTF-8 and existing
  protocol0. A mutation initially targeted the reflective current case rather
  than the literal deadline fixture; the corrected named control kills it.
- The existing Auth/device-binding transport still passes; changed exchange
  checks cancellation after buffered reads and deadline after response headers.
  No retries, redirects, provider text, refresh token or persistent response.
  JVM controls replace the socket/platform JSON boundary with the existing
  fictional fixtures; the three-part integration is real production classes,
  not a live HTTP/Auth/Android JSON decoder or FCM receipt.
- Real Android Gradle Java graph: `BUILD SUCCESSFUL in31s`,83/83 executed tasks.
  Actual generated output contains both new classes and the changed transport.
  The first invocation stopped before tasks on an existing shared Gradle cleanup
  lock. It was retained, not removed; a private project cache and isolated outputs
  then compiled all seven projects. No JDK/JRE/PATH change, signing or APK install.
- MinSdk is24, without core-library desugaring. Source inspection caught
  java.time/Set.of before freeze; strict SimpleDateFormat plus existing collection
  APIs avoid that26+/30+ dependency. UTC/offset/microsecond and invalid date/hour/
  offset controls pass. This is not Android24 device execution.
- Independent frozen review found no actionable defect in the three production
  and six test files. It explicitly retains the caller's final atomic native
  owner/card guard after any future asynchronous handoff.
- The new Java boundary has no rendered UI change, so unrelated theme/browser
  screenshots and paid device minutes were not spent. Realme availability was
  inventoried; A063 was not accessed. Existing sidebar/search hashes are unchanged.

Android Lint is NOT globally green. The offline run first refused an uncached
existing Mockito5.20 dependency. With normal dependency access, the real lint8.13
report completed and returned7 errors/44 warnings; zero issues refer to any of
the three changed Java files. The7 errors are5 NewApi findings in unchanged
VoiceCallRuntime.java:258/259/260/269/278, one optional-camera hardware declaration
in unchanged AndroidManifest.xml:60, and one PropertyEscape in ignored local SDK
properties. The voice entry points already check `supported() >=26`; these static
findings are not proof of an API24 crash. Both tracked files match baseline
cd8ef969; local SDK configuration was not edited. No unrelated lint suppression,
baseline or global toolchain change was made. This baseline cleanup remains
native QA work; this report does not label the complete Android lint gate passed.

A subsequent single metadata-only Realme read observes Dozing/screen off and
keyguard showing, with secure=false. No UI hierarchy, capture, wake or unlock was
performed. It explains only that current read, not the historical ARM refusal;
do not replay a spent attempt or request the owner's intervention on this basis.

## Source Pins

- Content parser: `825d3a9684549bc10bde0ebd98623e719483c53d1065089c90fed3e095683a5a`.
- Content consumer: `d94e441b457b393b4edc84ca37f85b7591ad50ff87fd41aa97581749eded4fc5`.
- HTTP transport: `40a3b5c0e828788e87669d0fe6b3b1489d3ab20b228b261902afae09703a8f58`.

Private compile/test/lint outputs reside in
`.ops-private/readable-notification-lookup-20261016/`; no private data is tracked.
Production remains the previously accepted80e4069e / Android0.1.20 build21,
not reverified or redeployed in this source-only slice.

## Consumer Boundary

The transport uses the existing server contract, not a generic object reader.
The parser permits only the exact12 fields, own tuple, sender/message ceiling,
nonempty96/240-code-point display strings and a future expiry no more than15s.
Sender-only bodies must be generic. Unsafe controls/bidi overrides/unpaired
surrogates refuse the projection rather than changing its meaning.

The consumer has no public cache/result getter and stores no credential field.
It consumes a response through one synchronous callback only after request/card/
owner and both-clock checks. Cancellation disconnects and retires admission even
if a buffered response later returns. An ambiguous throwing callback returns
UNKNOWN, not a false claim that no effect occurred. The Owner port is not a
verifier or atomic authority over another subsystem. A real native publisher
must supply that authority and recheck at its final publication boundary; none
is manufactured here.

## Next

Connect an accepted native credential/choice lifecycle to this lookup, then the
real notification receiver/presenter with final card-generation checks, public
lock-screen fallback, exact-message routing and read/logout cleanup. Only then
run fictional foreground/background/locked/unlocked and replacement/retirement
OS cases on an isolated owned installation.

Also retain the seven Android Lint baseline findings above for a separate scoped
cleanup; they must not be silently represented as a successful whole-app lint.
