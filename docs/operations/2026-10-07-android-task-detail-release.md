# Android Task-Detail Recovery Release

Owner: coordinator; source `4765bcad`, Android Stable0.1.14/build15, accepted
2026-10-07 at20:15 Moscow. D-354's shared web fix was already accepted at19:26.
No DB, worker, provider, package identity, signer or global toolchain change.

## Actual Artifact

- APK:7,630,727 bytes, SHA256
  `d13a8b48cfc09a510d79c6e23e33196247a1c10ad50022740de46a85342bb192`.
- Package `com.kub.messenger`, version0.1.14/build15, existing signer
  `AC8249647E3E32B32E7DBA283C6C7BC835F293401A3CF82115901CE74F4A0839`.
- Actual release build49.365 seconds, instrumentation10.762 seconds, both exit0.
  Fresh embedded `sw.js build af7d72012ed2653a`; production public configuration,
  required Firebase resources, same-signer test APK and full release verifier pass.
- All33 embedded web assets match rebuilt local bytes; six task-read markers and
  frozen hook/modal source match. No remote `server.url` or client service-role
  configuration. AAB retained locally,7,265,663 bytes, SHA256
  `891721823535656d75df83c468dfe4910bf158c43fb9939efb83bfd1ad218f8b`.
- Previous0.1.13 APK/AAB preserved with exclusive byte-identical copies. Existing
  JBR/SDK selection unchanged; no JDK install or global environment edit.

## Device Evidence

Exact Realme RMX3830/Android15; one isolated anonymous ephemeral QA profile,
actual UID12 established by exclusive intent, create ACK and exact-name readback.
No guessed ID, personal login/capture, A063 or paid rental.

Actual0.1.13/build14 baseline preceded `install -r`0.1.14/build15. Primary package
retained; no clear, primary logout or reset. One fresh selected instrumentation
case passed1 test/0 skips: QA-only force-stop followed by ActivityScenario and
the actual bundled anonymous React/WebView, native cleanup/media/voice bridges
and bounded viewport. This cold launch is the same one case, not a second test.

Initial cleanup did not return a PASS. The separate existing `cleanup-finish`
proved ephemeral UID12 absent after switch, current user0, no primary test package
and upgraded primary package retained. The actual owner/timestamp gate binds
baseline <= install <= guest <= cleanup. Independent review repaired two gate
P2s: missing cleanup UID and missing baseline ordering; causal RED2 then33/33
source controls including five compiled omissions, final review no open P1/P2.

All22 native contract inputs are unchanged from the accepted0.1.13 source,
fingerprint `fc09d0ed8ccc51a9aba5c07c74369f50dedf7a899d06065658b11e1866404307`.
Six previous D353 receipt hashes are explicitly referenced, never copied into
new device filenames or counted as fresh tests. Its controlled-snapshot physical
integration remains distinct from natural OS timing, which is NOT PROVEN. No
unchanged native/read/pending suite was replayed. No new FCM delivery, authenticated
task-error/retry, physical iPhone pixels or unknown tester86/87 closure is claimed.

## Publication And Rollback

Fresh server preflight found old0.1.13/build14 catalog bytes unchanged, exact
SHA256 `6c9aebe73fc999eaafdc531d0d8befd53e081172835ffd587e9fe02dccd2ef43`, new immutable
version path absent and over60 GB available. Publisher validated actual new
device/artifact gates, the current native fingerprint and previous receipt hashes.
Under the publication lock it compared catalog/candidate hashes and made a
byte-identical previous catalog backup before publishing. `mandatory:false`.

[Public APK](https://api.letscube.ru/releases/files/android/0.1.14/letscube-0.1.14.apk)
and [Stable catalog](https://api.letscube.ru/releases/v1/android/stable.json) verified
at20:15 Moscow: actual public redownload has identical bytes/SHA and the full
Android release verifier passes. Both immutable APKs remain. Rollback can replace
only the catalog under lock if it still identifies this exact candidate; installed
apps are not silently downgraded. No rollback was needed or executed.

Private immutable receipts remain in `.ops-private/20261007-android-0.1.14-evidence/`.
The source/mounted visual proof and exact web rollout are in
[the task-detail record](2026-10-07-task-detail-recovery.md). D-354 is closed for
the measured refresh/retry/ownership defect, not for unspecified tester reports
or remaining native rich-preview authorization work.
