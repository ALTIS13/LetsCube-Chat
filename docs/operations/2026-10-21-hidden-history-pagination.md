# Hidden History Pagination

Owner: Codex coordinator, canonical `codex/ui-motion-updates-20261019`.
Baseline `5773aab6`. D389 is an ordinary history repair, not an enabled disk cache.
Android candidate:0.1.34/build35. Publication/device acceptance is pending.

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
