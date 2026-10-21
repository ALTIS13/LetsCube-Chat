# Hidden History Pagination

Owner: Codex coordinator, canonical `codex/ui-motion-updates-20261019`.
Baseline `5773aab6`. D389 is an ordinary history repair, not an enabled disk cache.
Product `c3bcbb30a7f20de591949f57ae8c8df67d314ab3`, Android0.1.34/build35 Stable.
Realme guest/data acceptance, exact shared-web parity and the full actual A063
in-app34->35 update/return acceptance pass. Wider OEM/lifecycle QA remains open.

## Observed Cause

The history query selects100 server slots before own-hide filtering. If all100
are hidden, the visible array has no row from which to build the next cursor.
The shipped hook drops hasMoreOlder; repeated earlier pages can also stall when
the prior visible frontier is reused. Actual compiled hook/installed SDK tests
reproduce this against the shipped source. Local pending/failed entries and the
101st lookahead must never become a server cursor.

There is a second real consumer constraint: ChatWindow does not mount MessageList
for an empty visible array. A repaired hook alone therefore leaves a false empty
greeting and no way to load earlier messages. A one-row list also cannot produce
the top-scroll gesture required by the old-only automatic loader.

## Repair

- Hold the minimum admitted raw server tuple separately from visible messages,
  retaining original timestamp microseconds and UUID order. Exclude lookahead
  and local-only entries; refreshes must not rewind an admitted older frontier.
- Fence scope/account/lifetime/request/privacy before admitting the page or its
  cursor. Clear and scope retirement reset cursor ownership. A late first hides
  channel join can retire both head requests; the current owner schedules one
  coalesced fresh read through the existing recovery timer. Ordinary offline
  failure does not create a self-sustaining retry loop.
- Offer an explicit earlier-history action for empty and short pages, with busy,
  error/retry and44px mobile targets. Truly empty history retains its greeting.
  No automatic unbounded walk through the whole conversation was added.
- Include the history band's presence in its height/anchor compensation. Keep
  the reader's existing entry, prepend and continuing-scroll ownership.

## Verification

- Worker affected hook/SDK cohort281/281, including loaded literal omissions,
  actual cold-join RED, coalescing and retired-request/offline boundaries.
- Mounted Chromium1440/390 and WebKit390, both themes, empty/short matrix12/12.
  The actual SDK's full tuple REST filter is evaluated by the synthetic leaf;
  next visible message is reached, not only a button rendered.
  Independent review caught Enter being refused during the initial scroll guard.
  The exact short-page keyboard case failed before repair; explicit activation
  now releases that guard before loading. The automatic scroll path is unchanged.
  Final12/12 includes focus+Enter for short pages; busy/no-more/duplicate guards
  are retained. Final independent delta review has no new P1/P2.
- Actual desktop prepend/entry/retry/continuing-momentum matrix7/7. Its old
  fixture understood only a timestamp filter; the scoped leaf now evaluates
  the full time/UUID predicate and delays that actual older request.
- Guest-only actual-component pixels inspected in all16 width/theme/control
  states. Corrected preview uses the actual resolved theme and font; an earlier
  uncalibrated theme capture is retained as rejected evidence. Detector[].
- Coordinator's frozen hook281/storage80/cache30 combined cohort completes with
  zero failures, and independent scoped hook14/storage16 controls pass.
- Typecheck passes. Signed-in fixture screenshots/traces/video are disabled;
  the standalone guest preview has no Auth or production data. No SQL change.

Native build/upgrade and exact production image/artifact parity are recorded
below when actually completed.

## Platform Boundary

The shared web repair serves browser, iPhone PWA and Windows remote renderer;
Android embeds it only in the new APK. Native Apple and Windows shell identity
are unchanged. Existing updater34->35 remains a distinct physical acceptance
case, not inferred from source tests or an ADB upgrade.

## Native35 Publication

Fresh build reports `sw.js build 56cce50d61191ac7`, `built in 13.30s` and
`BUILD SUCCESSFUL in 36s`. APK7,816,777B SHA256
`d763cd87db010ee28f36b0dcdc26f37acb784e50538a290812504b140effa07d`;
AAB7,444,556B SHA256
`42694c04df54bc5f70d76459875452c60a87988a28770018e1241fed3d0fe68c`.
Original sole signer/APKv2, four exact Firebase init values, false QA flags,
42-file embedded web/config/DEX parity and updater registration/provider pass.
The AAB manifest was not independently protobuf-decoded; no broader claim follows.

Actual Realme34->35 upgrade retains UID/data/firstInstall, opens guest UI and has
zero native fatal signals. An initial locked-screen refusal was retained; the
next read confirmed normal unlock before installation. No clear/uninstall or
owner PIN entry occurred. Phone returned HOME.

Stable0.1.34/build35 publication and full public APK bytes/hash pass at
2026-10-21T05:11:43Z, mandatory=false, previous Stable34 catalog/artifact retained
for rollback. Notes preserve the one-time bootstrap advisory for0.1.31/0.1.32.
This publication receipt alone is not full in-app acceptance or a new FCM test.

## Shared Web Release

Sole-healthy image `c3bcbb30` / build `b8e796727de22a2d` and public/container
HTML/JS/SW parity pass at2026-10-21T05:14:48Z. New earlier-history text/actions
are absent from baseline5773 and present in the exact served bundle. The
unmounted cache database/module marker is absent from that bundle. Shared PWA
and Windows remote-renderer source is delivered; no physical iPhone/native Apple
or new Windows binary acceptance is inferred. Production SQL remains unchanged.

## A063 Full Update

Installed original34 reached normal in-app download/ready, requested source
permission, returned from Android Settings and launched the ordinary system APK
installer. The probe observed all three normal React controls,110 samples,
current catalog, ready and both permission/installer handoffs. Android source
permission was granted for LETSCUBE through the normal Settings row; its app-op
changes from default to allow. No native source/hash/version/signer check or
confirmation was bypassed, and no target APK was installed with ADB.

Google Play Protect additionally requested a scan. The ordinary scan was run;
its safe-to-install result was followed by its Install action. Play Protect and
device-wide protections were not disabled. The installed35 full APK hash matches
the exact published artifact, version/build match, UID/firstInstall are unchanged.
The subsequent exact35 embedded-source/main check passes in two samples. The
separate diagnostic package is removed after both invocations. A final normal
MainActivity launch passes, all three known old/new diagnostic packages are absent
and the current app process has zero native fatal signals at05:26Z.

Two pre-install diagnostic refusals are retained: this Android's power dump does
not use the guessed Display Power state format, and window/windows lacks a focus
line. Actual awake/screen/interactive policy plus window/displays focus were
calibrated before the successful changed-input attempt. Final offline controls
pass14/14 with an installed admission file still denied to their child process.
The earlier failures did not install the diagnostic or mutate target data.

Instrumentation restarts the target runtime, so this is not uninterrupted-call,
unsaved-draft or exact-conversation-restoration acceptance. Both runner receipts
report focusRestored=false because cleanup did not override an intervening system
surface; the independent final normal launch/cleanup above closes that bounded
return step. No personal screens/message bodies/Auth tokens were captured. No
phone VPN/profile or PC network change. The per-app installation-source grant is
left enabled as the ordinary prerequisite for later user-approved updates.
