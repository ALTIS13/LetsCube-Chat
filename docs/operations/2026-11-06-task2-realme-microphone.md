# Task2 / D-348: Realme repeated microphone calibration

2026-11-06 MSK. Exact Realme RMX3830 / Android API35 with installed Stable
`0.1.49` / 50. Read-only inspection first showed no microphone grant or
recorded app-op for the product. The production package and its permissions
were not changed. The tester's original platform/build and whether they saw
an OS or in-app prompt remain unknown.

A separate temporary package used actual `BridgeActivity` and the pinned
Capacitor Android 8.3.4 permission client, the product `useVoiceRecorder`
hook and the system microphone. Its manifest had no Internet permission,
the page had no connections, and it contained only one recording control.
No account, chat, upload, saved audio or content inspection. The first
native prompt was scoped to that package; selected **while using the app**.

- First capture and immediate cancel passed; all actual tracks ended.
- Second capture in the same document and third after physical Home/return
  also started and released all tracks, with no second permission tap.
- Exact helper removal, ADB forward removal, unchanged Stable50 and Home
  passed. No change to the supported client's permission defaults or code.

This distinguishes ordinary repeat acquisition from a repeated native
prompt under a retained while-in-use grant on one real Android. It does
not establish the exact tester situation, iPhone behavior, Android
one-time permission, or production signed-app composer acceptance.
