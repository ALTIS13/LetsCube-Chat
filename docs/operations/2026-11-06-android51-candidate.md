# Android 0.1.50 / build 51: signed QA candidate

2026-11-06. **Built and installed on Realme; not published.** Public optional
Stable remains `0.1.49` / 50 until the current acceptance gate closes.

- Candidate source `bcf31625b61cc402fe0b741c2731e85ad934eb23` changes only
  version metadata over `a4b35a79`. Compared with 50, the embedded client adds
  search motion, open TXT preview renewal, the profile-recovery logout path,
  foreground/network task-list refresh and the media-gallery ownership/swipe
  fixes. No Storage mode, package ID, Auth configuration or delivery change.
- The pinned release tools, unchanged Android signing identity, APK/AAB
  web-asset equality and four Firebase initialization values passed. QA flags
  are off. Embedded SW `632c42f1f291d88c`; full APK SHA-256
  `7c98d5c69c81d38fd368ea47bb6ce680c82474c8267160c9d1018219b7c64b49`.
- The exact Realme RMX3830 (API35) installed 50 -> 51 once with `adb install -r`.
  The whole installed APK matched, UID/data path/first install time were
  retained, the guest form rendered, process fatal count was zero and the
  device returned to Home. No uninstall or data clear. This was a device
  upgrade, not the public updater or OEM matrix.

Next: [Task9 foreground/access](2026-11-06-task9-list-foreground.md) in the
signed candidate, on the exact quiet QA cohort with a private task and one
coassignee. Install/guest checks do not close live role or signed-in UX
acceptance. Keep the 50 artifact and manifest for rollback; do not publish 51
until the planned delta checks pass.
