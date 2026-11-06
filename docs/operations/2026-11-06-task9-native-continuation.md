# Task9: physical checkpoints after search and provisioning diagnosis

2026-11-06. Android Stable remains optional `0.1.49` / 50. No new Android
publication or iPhone card acceptance follows from these checkpoints.

## Realme

- The [first abort cleanup](2026-11-06-task9-realme51-preflight.md#one-notice-cleanup-boundary)
  was verified at 02:27:25Z. The separate calibrated 51 run reached the
  test Staff SID, exact private task creation and grant. It stopped at
  `TASK_QA_PRIVATE_TASK_SEARCH_NOT_ENTERED` at 02:29:22Z, before any card,
  draft, revoke or regrant. The exact task is tombstoned, all three new
  sessions were retired, and Realme returned to guest/Home. At 03:01:15Z
  a separate guarded transaction with a fresh complete project backup
  removed that run's single synthetic notice. Independent readback
  confirmed one removed feed event, zero related queues, the unchanged
  old SID/notice baselines and the retained tombstone. Neither old intent
  was replayed.
- A no-task-write probe verified one unnamed edit, focus and the real
  keyboard, but not the exact long query. The separate A/B probe completed
  at 02:38:52Z: the full 53-character synthetic query produced a projected
  52-character value with 51 common leading characters. The 12-hex unique
  terminal fragment was observed exactly in the field and filter, with
  Clear and the empty result both before and after hiding the keyboard.
  This localizes the failure to full-string synthetic input in that
  observation; it does not prove that ordinary Android typing loses
  characters. The next fixture must still match the exact full card and
  modal title, not just a partial locator. Both diagnostic Auth SIDs were
  retired; no task or notification writes, media or raw AX retained.
- Android candidate `0.1.51` / 52 is built, signed and installed, not
  published. Source `1638b8d8930af0aecbacd65b78503ac52aa91b4e` changes only
  version metadata over deployed web `2d350009`. SW
  `75a1b31450f30b07`, APK SHA-256
  `292d54fa644042c801620b466d2820baed5d0e60ab245ba518e38381a22ba009`.
  Original signer, four Firebase values, APK/AAB parity and ordinary flags
  passed; verified exact named-search marker from the embedded APK entry.
  `adb install -r` upgraded Realme from 51, retained UID/data/first install,
  matched every installed APK byte, showed guest with no fatal events and
  returned Home. This is not an updater, card or real role acceptance.
- At 03:04:09Z the first signed 52 workflow stopped at
  `TASK_QA_PRIVATE_TASK_SEARCH_NAME_NOT_OBSERVED` before any fixture
  effect; task and notice writes were zero. Exact retirement of the three
  new SIDs, retained old SIDs, guest and Home passed. MobileCLI's Android
  projection exposes the hint separately from the label. The locator
  now reads both channels without calling a hint an accessible name.
  Verify the actual physical projection and then use exact query,
  empty-list and full-card checks before any new fixture or acceptance.
- At 03:08:29Z the installed 52 exposed one edit, no name and no hint in
  that MobileCLI response. Its focus, keyboard, exact fragment and Clear
  were independently observed before and after hiding IME; no fixture
  writes and the diagnostic SID retired. The 03:14:13Z calibrated
  workflow then opened the exact full card and dialog after live grant.
  It stopped at `TASK_QA_PRIVATE_COMMENT_NOT_OBSERVED`, before revoke.
  The task was tombstoned, all three new SIDs retired, and Realme returned
  to guest/Home. That run left one exact synthetic QA notice to clean.
- A test-controller mismatch was reproduced: the spatial witness for
  an unnamed empty textarea wrongly required the intentionally disabled
  Send button to be enabled. The controller now uses the button only for
  geometry, checks exact editor focus, and records dialog, empty field
  and focus separately. Sixteen focused tests passed. This explains a
  concrete locator failure mode, not a proven native user-input defect.

## iPhone PWA

On deployed `fbf03e4ad9f38675` the Tech Admin self-owned fixture passed
admission and was created with no notices or related queues. The first
new allocation was acknowledged; the controller rejected a changing
provider device ID before launch or login. Ordinary cleanup tombstoned
the task, retired its only new API SID and verified the original Auth and
refresh baseline. The allocated device was released separately by its
exact allocation binding; provider ACK and absence were both observed.
No device Auth, no screenshots, no data capture.

The provider can replace a pending inventory ID under the same allocation
before it becomes ready. A focused regression reproduced the controller
refusal, then passed with physical ID pinned only after the ready model
is verified; 14 affected controller checks passed. This is a test-tool
repair, not iPhone UI evidence. A separate run requires independent
readback of the first fixture, exact API session and lease before any
new allocation.

The corrected run at 02:51:42Z reached an online physical device under
the exact allocation, then refused the hard-coded viewport before Safari,
the PWA or Auth. The controller itself released it with provider ACK and
absence, and the separate fixture and only new API SID were retired.
No incomplete cleanup, active iOS leases or iPhone card evidence follows.

The next targeted delta uses the dimensions and scale reported by
[MobileCLI 1.0.13](https://github.com/mobile-next/mobilecli/blob/1.0.13/devices/ios.go)
and a bounded portrait coordinate range, not the previous exact
440-by-956 requirement. Synthetic logical and scaled physical sizes
reproduced the refusal and now pass, along with 15 affected controller
checks. This does not assert what dimensions the rejected live lease
reported; the next run retains only the numeric size projection.

At 03:10:39Z the online hosted device returned no numeric screenSize
fields on three tries. The lease and both synthetic resources were
cleaned; no device sign-in. The next controller path uses an independently
observed, unique full-origin SpringBoard accessibility window if device
metadata is absent. Logical/scaled/absent and ambiguous window controls
are covered; no frame or physical iPhone card is assumed from local tests.
