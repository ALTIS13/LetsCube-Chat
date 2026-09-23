# Android Full-Shell Debug Smoke, 2026-09-23

Owner: Codex, D-298 continuation. No production code, database, release signing,
publication, personal-device install or account login in this batch.

## Evidence

`pnpm.cmd android:build:production:debug` built the current web bundle, ran
Capacitor sync and produced `app-debug.apk` with the local ignored Firebase
configuration. The build passed. Vite emitted existing sourcemap-resolution and
chunk-size warnings; Gradle emitted flatDir/deprecation warnings. No credentials
or registration tokens were printed. The QA runner verifies the source commit
marker in the built JS and byte hashes for all web assets packed into the APK
before installation. AAPT omits `.well-known/assetlinks.json`; the two generated
Cordova files are accounted for separately. It records APK/test APK hashes,
web-file count and source commit.

`pwsh -NoProfile -File tests/native/android-boot/full-shell.ps1` passed on an
owned Android 14/API 34 AVD, with both emulator network backends restricted and
airplane mode enabled before APK install. Two AndroidJUnitRunner invocations each
reported `OK (1 test)` and `INSTRUMENTATION_CODE: -1`:

1. Fresh full Capacitor debug APK: rendered React root, a guest login form with
   an email input whose computed style and bounds show visibility,
   `kubBootState=ready`, and recovery surface removed.
   The Activity acquired focus, moved to the
   background and lost focus, returned to the foreground and regained focus,
   then remained React-ready.
2. After an addressed `am force-stop com.kub.messenger` on the owned AVD only:
   a new instrumentation run repeated those checks successfully.

The accepted receipt is
`output/native-boot-android/run-20260923-050451-5c88ef/result.json`; its
`cleanup.json` confirms the owned AVD was removed. The runner uses the existing
AVD ownership checks and an output lock. No personal ADB serial is targeted.
`guest-screen.png` in the same run was captured by the instrumentation while
the Activity had focus. Visual inspection shows the LETSCUBE login form, its
email/password fields and sign-in button, with no native splash over them.
The offline connection banner is expected on the isolated emulator.

## Instrument Limits

An initial CDP approach was abandoned: Playwright's browser-level connection
uses a command unsupported by this WebView; direct CDP intermittently hung on
`Runtime.enable` and `Network.setBypassServiceWorker`. Those are not evidence of
a product failure. An initial Android instrumentation attempt used
`startActivitySync`, which waited for UI idle during ongoing animation and timed
out; it was replaced by asynchronous Activity launch and a concrete React-ready
oracle. Failed probes kept their own logs; all their AVDs were cleaned.

The current test is offline, guest-only, debug-only and healthy-lifecycle-only. It does
not establish full-shell entry-module failure/retry, signed release parity,
FCM registration/delivery, authenticated chat state, Android 15/OEM behavior or
physical-device layout. D-298 remains open for these distinct proofs. Do not
promote a native release from this smoke result alone.
