# Realme Android 15 / microG Push QA, 2026-09-23

Owner: Codex. Device: owner-authorized Realme RMX3830, Android 15, Android
WebView 137.0.7151.72, microG GmsCore 0.3.15.250932. Scope: local debug APK
and physical QA only. No release signing, publication, production schema/Edge
change or provider credential exposure.

## Installed build and permission

The preexisting LETSCUBE 0.1.3/build 4 had notification permission denied and
zero of six named Firebase initialization resources. The current debug
0.1.7/build 8 had all six names. The owner designated Realme a disposable test
device; only `com.kub.messenger` was uninstalled, then the current debug APK was
installed. Its previous local app session was lost. A QA client account signed
in without credentials appearing in output.

On the new install, the Capacitor plugin returned `prompt` while the settings
row incorrectly displayed blocked/no Enable button. The authenticated
noninteractive push restore mapped an unrequested `prompt` to `native_denied`.
The adapter now returns `native_inactive` for a noninteractive prompt, retaining
`native_denied` for a real denial. The regression failed on the old code and
passed after the change. The rebuilt debug APK on Realme offered Enable; it
opened Android's notification permission dialog, and the resulting permission
was `granted=true, USER_SET`.

## FCM transport result

After permission was granted, the settings row reported unavailable. A focused
Android instrumentation test obtains no token value in its output: the FCM
token request failed with `IOException` after about 10 seconds. The same test
confirmed that Google Play Services availability API reports success. microG
Cloud Messaging was enabled, but its device registration page displayed "Not
registered" and LETSCUBE was absent from the visible registered-app list.
Switching device registration off/on did not register it. Device DNS/ICMP and
TLS to `android.clients.google.com` worked (an unauthenticated HEAD request
returned HTTP 400); this proves transport, not successful check-in.
The official microG setup guidance also recommends a reboot. After reboot, the
phone required its normal manual unlock; no lock-screen bypass was attempted.
The non-root ADB secret-code check-in broadcast was rejected by Android's
permission enforcement.

`node --test` on the native voice adapter/controller, settings rows and push
preferences: 74/74 pass. Kub typecheck: exit 0. Production-configured debug
build and Android instrumentation APK build: exit 0, with existing Vite/Gradle
warnings. Physical instrumentation: Play Services availability 1/1 pass;
FCM token 0/1 pass (`IOException`). Instrumentation's shell exit code is 0 even
on JUnit failure, so the test result must be read from `FAILURES`, not that exit
code. No raw FCM token or QA credential was printed or committed.

## Remaining proof

1. Unlock Realme normally and recheck microG device registration and its
   self-check, then rerun the token-only instrumentation test.
2. Only after token registration succeeds, verify server device registration,
   foreground/background/process-stopped delivery and notification-tap routing
   using QA accounts. Do not infer this from Play Services availability alone.
3. Compare on an official-GMS device separately. microG compatibility cannot be
   generalized from a single unregistered device.

Reference: [microG installation and background-service requirements](https://github.com/microg/GmsCore/wiki/Installation),
[microG Cloud Messaging network roles](https://github.com/microg/GmsCore/wiki/Google-Network-Connections).
