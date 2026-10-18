# Search List Continuity

Continuation of completion Task8 and tracker93. Owner authorizes bounded
implementation and reviewed rollout, not repetition of accepted focus races or
an assertion that every physical animation complaint has been reproduced.

## Observed Failure

At product source323d7cfc, an actual mounted Sidebar with fictional unread chats
replaces ChatList with QuickSwitchList on empty-field focus. Escape creates a new
ChatList/scroller. Both390 and1440, light/dark, reset the original scroll132/160
to0; ChatList mounts1 ->2, unmounts1, and the32 list rows render again. A no-quick-
sections control retains its scroller. Errors/external requests/long tasks are0;
sampled frame gaps around18ms are not evidence of general native jank.

Cause: the mutually exclusive body branches in Sidebar.tsx own the list's
lifetime. This is independent of the already repaired focus-frame cancellation
and reduced-motion token. Existing ChatList also adjusts its scroll when chrome
resizes; a display:none retention patch could manufacture a false top delta.

## Bounded Design

Keep the main list in one stable body slot while quick/global/in-chat search
occupies a separate layer. Preserve geometry, DOM identity, scroll and account/
folder ownership; hidden rows must be inert, aria-hidden and unreachable by
pointer/keyboard. Keep call bars outside this slot. Preserve loading, unavailable,
stale, contacts, typed-query and two-stage Escape semantics. Retire hidden menu/
drag interactions rather than allowing a portalled sheet over search.

Ruling: follow the approved autonomous completion plan rather than reopen the
brainstorming skill's per-patch approval gate. This is a bounded repair to the
existing search flow, not a new design system or virtualizer. Cost if wrong:
reversible sidebar layout/state regression; actual mounted regressions and pixel
inspection are required before rollout.

## Current Checkpoint

Owner: coordinator; branch codex/search-continuity-20261019, source parent700130a7
(docs-only after released323d7cfc). Three component files and the focused test
are frozen. Final frontend typecheck and independent changed-scope review pass;
no remaining P1/P2 after the pending-touch repair.
Candidate Android0.1.29/build30 is reserved, not built/published; literal native
metadata/signing/Firebase fail-closed checks pass13/13. Prior Stable29 is immutable.
Next: build/release with actual artifact/image/content/rollback
checks. No SQL change. Physical general-jank acceptance remains separate.

## Repair And Evidence

The stable body has a retained main list and a separate search layer. Hidden
main rows are invisible/inert/aria-hidden and cannot take pointer or Tab focus;
their geometry remains measurable. UID/accountEpoch keys reset the old owner's
list rather than retaining its rows/menu. The optional ChatList active prop
defaults true for other callers; inactive render removes menu/sheet immediately,
then clears menu substeps/drag and disables the hidden Escape listener. Old menus
cannot reappear when search closes or selects a result. Call bars stay outside.

A new near-top RED exposes clipped compensation: hiding the39px folder strip at
scroll0 requests a negative top which the browser clamps; restoring the strip
invented39px scroll. Carry only the clipped negative chrome delta until the
reverse resize; actual non-compensated scrolling clears it. This is not global
snapshot restoration or decoration-driven height animation.

Actual-mounted Chromium checks:10/10 behavioral PASS in12.753s; separate loaded
source omissions5/5 PASS in14.155s. Three observed REDs precede the repairs:
original scroller detached; old menu resurrected; near-top0 ->39 drift. The
behavioral cases cover unread quick focus/Escape, global query/clear, desktop
in-chat/global precedence, fresh query, keyboard/click, hidden accessibility,
UID/same-UID epoch retirement, loading/unavailable/stale/folders/contacts.
Literal omission controls remove hidden visibility, preserve geometry incorrectly
with display:none, omit active retirement, omit owner key and omit clipped delta.

At390/1440 both themes, equal-final-chrome scroll is160 ->160, original row/
scroller identity is retained, mounts1/unmounts0, and measured anchor remains
unchanged. Near-top0/60 and repeated query/clear also pass. Coordinator inspected
all8 actual synthetic quick/restored PNGs, no new overlap. Top-row clipping is the
intentional retained160px scroll. The fictional call button proves placement
only, not call rendering or delivery. Console errors/unexpected requests0.

Tests use real React/Sidebar/Header/List/Item/search surfaces/CSS/icons/fonts;
controlled read hooks avoid real Auth/SDK. API access throws, only exact local
fictional-origin assets are admitted. KUB_QA_ALLOW_MUTATIONS=0; no personal data,
device/Auth/DB/runtime changes. Browser skill/plugin is absent, so installed
isolated Playwright is used. All owned contexts/browsers close. Earlier missing
fixture resolveDir/locator/blur-state failures are not product REDs. Accepted
focus-race/reduced-motion and unrelated suites are reused, not replayed.

## Pending Touch Review Repair

Initial independent review found one P2: the retained row still owned an earlier
520ms touch timer. Its callback could open a menu after the inactive effect had
closed menus, including inactive ->active before the deadline. Actual mounted
cases reproduce both orders as sheet1 versus expected0 before the repair.

ChatList now passes optional interactionActive to the row (default true for
other callers). Stable timer cancellation runs in layout-effect cleanup on
deactivation/unmount; inactive commit also clears click suppression. No new
inactive pointerdown can schedule a timer. This cancels the original operation,
not a captured-active guard that could become valid again on return. UID/epoch
and contacts unmount retire it too; fresh click and long-press still work.

Final affected Chromium file passes18/18,0 skipped,29.225s, including a literal
loaded omission of the cancellation while retaining the pointerdown guard.
Repeating the affected file is warranted by changed row lifecycle; unrelated
tests are not replayed. Final frontend typecheck passes after this change.
Two additional WebKit pending-touch cases pass in4.998s on that final source.
Earlier WebKit near-top0/60 cases2/2 and in-chat precedence1/1 apply to unchanged
Sidebar/observer code; they are reused, not described as a single five-case run.
This remains controlled browser evidence, not physical native performance.
