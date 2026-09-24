# Android media export candidate

Owner: Codex, Android/Windows/web continuation. Stage: source and debug QA;
Android Stable remains 0.1.9/build 10. No native release was published here.

The media viewer now uses a native `MediaExport` bridge when the Android APK
provides it. The bridge validates a first-party HTTPS Storage URL and a media
filename, opens Android's `ACTION_CREATE_DOCUMENT` picker, and streams the
response to the chosen document. It does not request broad storage access or
load a video into WebView memory. If an older shell lacks the bridge, the
existing, explicitly labelled browser fallback remains.

Verification: TypeScript typecheck; 7 focused media-action tests; the complete
Android debug unit suite; production-configured debug APK build; 18/18
media-viewer Playwright cases at desktop and mobile widths. On an isolated
Android 14 AVD, `MediaExport` registered, rejected a foreign host, opened the
system picker, returned `cancelled` after Back, removed an empty destination
after a 404, and saved a temporary 70-byte PNG byte-for-byte (SHA-256 matched).
The temporary QA-account Storage object was removed using the same account;
the emulator download was removed. No personal conversation was opened.

Next action: locate the existing release-signing inputs, then bump to
0.1.10/build 11, build the embedded production bundle and signed APK, verify
Firebase resources and signing continuity against 0.1.9, install/test the
signed candidate, back up the Stable manifest, and publish only after those
checks. Do not present this debug APK as a Stable update.
