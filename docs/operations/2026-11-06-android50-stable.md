# Android 0.1.49 / 50: Stable release

2026-11-06 MSK. Scope: first logout, task card/refresh and search/bell
navigation fixes already verified on the shared client. No schema, push
provider, WNS, or bucket change. Never treat this release as closure of the
full task/notification/device matrices.

- Exact source: `15af36724d498dc12bc674bffaab100c21da6101`, Android metadata
  only over published web `2e1c3afc`. The eight product source files changed
  since Stable47 are the reviewed task, sidebar, bell and Auth changes.
  Task-detail/card code is identical to the source used by Realme49's signed
  task acceptance. The build adds no remote Capacitor web URL.
- First build failed in the older worktree dependency set. A separate
  non-signing reproduction identified missing `livekit-client`; offline
  frozen lockfile install repaired that worktree, with no JDK/global change.
  Second build: `1fe5b0485a169b7a`, Vite 12.34s and Gradle success.
  Signed APK/AAB passed verified signer, Firebase4, web/native/config parity,
  QA flags off and known private-input/format scan.
- Physical Realme RMX3830 / Android API35 updated `0.1.48`/49 -> `0.1.49`/50
  via one `adb install -r`: unchanged UID, data path and first-install time;
  full installed APK hash, empty guest and zero fatal records. This is not
  an Android updater or every OEM acceptance claim.
- In the same signed APK, one normal login and **one** normal confirmation
  of exit restored empty guest, then Home. Exact new QA SID and bindings
  retired, previous SIDs preserved. Temporary input helper removed. No
  task, message, delivery or SQL writes. Before this build, first exit failed
  even when the server retired the SID. [Cause and browser tests](2026-11-06-web-logout-recovery.md).
- Stable47 was independently read before publication; `0.1.49` path was
  absent. Staging outside the public root proved the exact file hashes and
  shell syntax. Single publisher run used the existing release lock, exact
  prior manifest/previous APK SHA and byte-for-byte manifest rollback copy.
  Public readback at 22:35:36Z confirmed Stable `0.1.49` / 50,
  `mandatory=false`, `7,856,441` bytes, SHA-256
  `48d98ef4caf9b655d98718367631e1186c517a826850a448ba8b7105e8077014`.
  [Public manifest](https://api.letscube.ru/releases/v1/android/stable.json).

Rollback target is `0.1.46`/47 (`02b0b6fb…`), with its immutable APK and
verified previous manifest retained. No downgrade of the installed Realme.
Still open: live revoke/regrant under signed app task permissions, bounded
OEM/locked/long-session and other independent acceptance cases.
