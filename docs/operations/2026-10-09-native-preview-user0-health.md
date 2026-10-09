# Isolated Android user0 health diagnostic

Date: 2026-10-09. Coordinator; source branch `codex/bot-inline-media-20261002`.
Production web/main `4765bcad` and Android Stable0.1.14/build15 are unchanged.

## Result

A separate credential-free diagnostic APK was compiled, signed with its own
ephemeral QA key, installed once on Realme and removed. The physical measurement
was **INCOMPLETE**: its initial page was refused before any health GET. It does
not establish network/server failure, Auth/FCM success or rich-preview acceptance.
Installation and exact cleanup passed; both installed LETSCUBE packages and the
device's user set were preserved. No account, primary app, global network/trust,
SQL, main deployment, paid rental or A063 action occurred.

## Source And Build

The two Java classes and INTERNET-only manifest are independently source-accepted
`DC0E1C54`. Source evidence comprises separate 15 JS/manifest and 32 fictional JVM
controls, not a combined physical acceptance result. The app has no Firebase,
credentials, message content or production classes; its Activity is nonexported.
The only intended external operation is one fixed anonymous health GET with
credentials omitted, normal TLS, redirect refusal and bounded cleanup.

The first build failed at javac. A separate bounded compiler diagnosis identified
the missing SDK `LambdaMetafactory` bootclasspath entry. The new R2 recipe adds
the existing `core-lambda-stubs.jar` only to javac's bootclasspath, matching the
[AOSP SDK toolchain recipe](https://android.googlesource.com/platform/prebuilts/sdk/+/b05bfdd9da1836c3e3fbb451764ad7784aeca8b8/toolchains.bzl).
No custom stub, Java/PATH change or release key was used. Failed R1 outputs remain
failed and immutable.

One actual R2 build passed at 17:41 Moscow: 12 stage receipts, 16 fixed inputs,
five fresh major52 class files and 14 own DEX definitions. APK: 20,890 bytes,
SHA256 `B269518D6DEF6A7FBF08C2404AB512E4DF4EBD0EF48D113CC3EE664667A0FD1F`.
Actual result `B0C45001`; independent artifact readback `BFDDEBC3` accepted the
receipt chain, signature/manifest/alignment evidence and artifact byte hashes.
The lambda SDK stub is not packaged. This is a diagnostic APK, not a release.

## Host And Physical Attempt

The original pending host had three actual builder-interface mismatches: source
map order, receipt-field name and APK basename. Its new derivative corrects
those plus the R2 path/tool table; it does not relax identity, ACK, privacy or
cleanup guards. Independent full-host review `5FED1938` and final literal binding
review `F6AF54FF` completed before device effects. A real inert artifact readback
passed; original 20 and new 5 controls were reused, with only two new binding
controls run after the binding delta.

One physical invocation at 18:08 Moscow observed user0/own UID/CE-unlocked,
awake/resumed, secure nondebug window, INTERNET and safe WebView settings.
`local_ready`, `request_started` and `health_get_observed` were false;
`route_refused` and `admission_refused` were true. No HTTP response, rejection,
DNS, TLS, connect or request-timeout category was observed. The existing 35
Boolean fields do not identify the exact refused callback URL.

JS cleanup, WebView destruction, Activity destruction and observer removal were
all true. Exact own uninstall and all-user absence/preservation passed after the
failed measurement. No retry or second instrumentation invocation occurred.
Observation `9884BD00`, outcome `6D88EE1E`, cleanup receipt `7EF9A0F3` remain
private immutable technical records. No screen, hierarchy, logcat, body, header,
credential or personal media was captured. All finite device jobs are closed.

## Next Boundary

Correct the demonstrated diagnostic-page contract or instrument its unknown
callback distinction with bounded noncontent fields before another changed-input
measurement. The JVM WebView fixture substitutes the base URL for a null history
URL; Android documents null history as `about:blank`, so that fixture is not proof
of this real callback behavior. [WebView API](https://developer.android.com/reference/android/webkit/WebView#loadDataWithBaseURL(java.lang.String,%20java.lang.String,%20java.lang.String,%20java.lang.String,%20java.lang.String))

Local Firebase configuration contains only the primary Android client; a genuine
separate QA-package configuration and provider restrictions are not yet established.
Health-path evidence cannot replace normal rendered QA sign-in, own SDK token/
registration, acknowledged UUID/current session and native verification. Keep
protocol0 and nativePositive/richPreviewEnabled/canPublishRich false. D-335 stays
OPEN; vault/consent/card/OS and installed-release acceptance remain separate.

[Approved device-binding plan](2026-10-08-native-preview-device-binding-plan.md).
[Accepted dormant producer and its distinct SDK proof](2026-10-09-native-preview-verification-producer.md).
