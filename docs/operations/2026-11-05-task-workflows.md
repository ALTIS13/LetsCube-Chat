# Tasks And Ordinary-User Workflow Batch

Current Task9 Android follow-up: [card accessibility and the next candidate](2026-11-05-task9-android-card.md).

Owner: Codex coordinator. Current focus: Task9 of the 12-stream completion plan,
with disjoint Task8 interface work. This is not a claim that streams1--8 are done.

## Server Review Authority

The owner reported that the global Owner role receives an insufficient-rights
error on Confirm. Live inspection found all3 Owner accounts satisfy the manager
predicate;2 pending tasks have an Owner as co-executor. The old server deliberately
refused all participant self-review, while the old client checked only the primary
assignee. The generic42501 mapper hid the actual self-review explanation.

The replacement is capability-based, not a role-name bypass. A shared policy
authorizes task_confirm, task_reject and the readonly task_review_access RPC.
Reviewers are existing global managers/admins or holders of tasks.manage globally
or at this task's location, subject to authoritative visibility. Participant
review additionally requires the global tasks.review_own permission. Existing
root permission semantics include Owner and Technical Administrator; explicit
catalogue grants make the capability discoverable in the role editor. Other
roles may receive it deliberately. No location/global role is renamed and no
RLS or table-write grant is relaxed.

Both write actions lock the parent row, reject null/banned/deleted/inaccessible
subjects and invalid statuses, and record self_review plus its capability in the
task event only when applicable. The client consumes the server answer instead
of maintaining another review-role policy. Non-review actions retain their
separate contracts.

## Migration And Evidence

Migration20261105151615_task_owner_self_review is APPLIED on production. Before
it, a fresh2,256,902B schema archive was SHA-checked and its pg_restore inventory
checked for both original functions. Exact definitions/ACLs were captured and
rechecked before dispatch. BackupSHA:
97ce503b715415f66a1526275c62786e978d2806e8bd7980478d93dff9d6550d.
MigrationSHA:
83f6c0fbd0c1364a51784397abe0e5aa8b70c8a55f29967fb0a247d59a56dcf6.

The original owner/co-executor Confirm produces the intended behavioral RED.
After implementation,17 real SQL scenarios pass in a rolled-back rehearsal and
again against the installed functions. They cover participant and independent
reviews, denied ordinary/admin self-review, custom capability grants, locked/
deleted states and unassigned creation. Test profiles, temporary role grants,
synthetic tasks/events/alerts all roll back. No actual user's task was completed.
The first harness syntax/qualification failures are not product RED evidence.

Rollback actually restores both original function definitions exactly within a
rolled-back transaction. Three loaded SQL mutations are rejected: missing
self-review guard, missing custom-role authority and exposed internal helper.
Independent source review approved the migration. Missing-versus-denied write
RPC distinction and the wider ban/null/foreign-location matrix remain bounded
coverage limits, not a full-system authorization acceptance claim.

One-transaction migration with raising self-check and exact rollback is mirrored
byte-identically under .migration-backup in both workspaces. Private technical
receipts: primary .ops-private/tasks-access-20261105/. No credentials, sessions
or personal message data are in this report.

## Interface And Release Work

- SOURCE VERIFIED: authoritative review hook, account/epoch/query ownership and
  explicit permission-denial retirement instead of retaining another user's or
  revoked task data; exact known business errors preserve their explanation.
- SOURCE VERIFIED: explicit unassigned creation using the existing user/null model,
  no invented pool/enum, with all person/location/role/admin/chat routing cleared.
- SOURCE VERIFIED: compact avatar/search/multiple-person filters and a simpler task
  form with progressive optional settings, preserving the liquid-glass material.
- SOURCE VERIFIED: multiple verified release notes plus concrete tester scenarios;
  archival notes are not a source of downloadable artifact authority.
- SOURCE VERIFIED: a discoverable individual-channel notification entry reusing the
  existing canonical topic preference/delivery contract, not another mute store.
- SOURCE VERIFIED: restored chat snapshots no longer manufacture a refused
  network read. Cache identity/privacy/owner fences remain; an actual first-read
  failure is still unavailable and a later genuine failure remains stale.
- SOURCE VERIFIED: an account/session-owned quiet inline recovery status, delayed
  only for persistent stale reads, with actual retry and no red startup card.

Client review/cache ownership and known-error checks pass83/83. Existing affected
task detail/reconnect/co-executor/routing and notification-control checks pass118;
the final existing menu24 and new channel-list12 pass, preserving loaded
omission controls. The mobile rail remains open; Escape and keyboard focus are
owned by the top notification dialog. Changelog34 and quiet notice15 pass;
notice includes literal1199/1200ms, retry, recovery, account change and unmount.
Task workflow fixture52/52 passes at390/1440/both themes. Final review found
two routing/visibility edge cases, reproduced in three behavioral controls.
The revised form passes20/20 (16 new cases) and review hint4/4, without rerunning
the unaffected portions of the52. Compact form, person picker, history, channel,
changelog and notice pixels were inspected. Selection contrast exceeds16:1.
The mounted cold-list matrix43/43 is retained; its changed restore assertion was
rerun1/1. Typecheck and diff whitespace checks pass. These are source/synthetic
browser results, not physical task completion or cross-client acceptance.

## Published Release

Shared web at `736a5c858823cdf9542c84b5a943f9b5fddf97cc`, build
`d86e22971566dee8`: sole healthy image, public/container HTML, service worker
and entry parity, all five changed-product markers verified. The public
download page shows Android47 with tester checks and three expandable previous
releases in an unauthenticated read-only browser. A separate cold catalog request
aborted; the published archive stayed readable and did not pretend to be the
current download. Subsequent bounded positive succeeded; catalog reachability
on arbitrary connections is not claimed.

Android `0.1.46` / build47 published16:39:39Z, mandatory=false, rollback46 retained.
Public APK7,856,137B SHA-256:
`02b0b6fb01f928201a774d0dd2fdd878a92ab5db7e76ed515b4c65a76aae3b5d`.
Original signer, four Firebase resources, APK/AAB web and DEX parity, known
secret scan and release flags pass. Local embedded web build `4962ebcc72b5157e`.
Realme46->47 retained UID/data/first-install time; guest startup, foreground,
fatal0 and whole installed APK hash pass. No authenticated native task completion,
provider delivery, iPhone/macOS or new Windows package is claimed.

Three reviewed outgoing commits resolve310 aliases in23 source files against
their own trees. Publisher295 offline controls pass. Initial staging refused
locally on an old receipt filename; exact remote staging target absent and
Stable46 unchanged were verified before correcting that binding. Final staged
bytes, locked previous-catalog compare-and-swap, rollback copy and full public
hash/length all pass. No repeated build or device install was needed.

Keep released notes separate from downloadable catalog authority. On a later
verified Stable release, archive the previous version in `VERIFIED_RELEASE_HISTORY`
before its catalog row is replaced. Do not archive a candidate.

## Follow-up: Live Task Review And Device Checks

On public web build `d86e22971566dee8`, two fresh browser sessions of the same
owned QA Owner showed one private synthetic task in Mine. The Owner was its
assignee and the first client showed the Confirm control. An ordinary QA
nonparticipant got HTTP 403 / `42501`, with no task or event change. The Owner
confirmed through the API outside Playwright (HTTP 204), recording exactly one
self-review event. Both clients saw actual Realtime, reread the list and moved
the task to History in the same document (Mine removed at 1049/969 ms). The
visible co-executor negative remains SQL rollback evidence, not this live case.
Playwright used mutation flag `0`, forwarded no browser write and made no
production captures. The exact task was tombstoned, both clients closed and
all three new sessions retired. Readback: zero matching active tasks,
notifications or live sessions. Private receipt: `.ops-private/task9-web-independent-20261105/receipt.json`.

Mobile WebKit added four passing isolated History/assignee tests at 390 px in
both themes. On physical Realme, Stable47 was confirmed present, but its
release WebView has no DevTools socket and the installed test runner has no
established Task9 adapter. No install, account, device or backend effects
were attempted there. Two local fixture controls preserved both drafts during
held Retry and retired the view immediately on HTTP 403 or row absence; the
late history reply could not restore it. On restored access in the same modal,
only the local comment draft returned. This is not native acceptance.

MobileNext was already installed; its cloud token required reauthorization.
A rented iPhone 17 Pro Max (iOS 26.3.1, 440x956 accessibility viewport) loaded
the guest login form in Safari. Add to Home Screen created the LETSCUBE icon;
launch reported `com.apple.webapp`, and Home then icon reopened the login view
without the keyboard. With the email field focused, the sign-in button ended
at y277 and the privacy link at y443, above the keyboard toolbar at y585.
MobileNext timed out reading the Safari `/download` accessibility tree, although
Home and the login tree were readable. The changelog on this iPhone remains
unverified; the timeout is not proof of an app failure. No account, push
enrollment, screenshots, native Apple binary or device-configuration change.
MobileNext confirmed release; roughly ten minutes elapsed from online to
release, not a metered billing readback.

## Follow-up: Revalidate After Silent Access Loss

`useTask` can miss a co-executor removal: the departing viewer may no longer
be allowed to read the new event, and the detail does not subscribe to the
membership table. The mounted regression reproduced a retained task after a
foreground signal without CDC. The local fix uses the existing 250 ms debounce
to recheck the exact task via RLS on visible foreground return or network
recovery. It does not poll, start a read for hidden-page signals or keep
listeners after disposal. Once RLS returns no row, the existing terminal path
retires the detail and related rows. Continuous foreground revocation without
any signal is not covered. No migration or release in this follow-up.

The native observation helper projects only a matching synthetic task and
draft markers, fixed screen states, and a unique in-bounds Retry target. It
does not access a device, submit drafts, or store raw accessibility data. Its
four fixture checks pass; Android accessibility calibration on the actual
task still needs an admitted run. The physical Realme reports build47 and a
visible keyguard; no unlock attempt, sign-in, device change or server write.

For an actual revoke/restore case, use an exact private synthetic task owned
and assigned to the QA Owner and a distinct ordinary QA Viewer. First prove
the Viewer cannot see it. `task_set_coassignees` then replaces the full list
with `[viewer]`, `[]`, and `[viewer]`; verify the old list and all exact fixture
attributes before each write and observe RLS visibility `1 -> 0 -> 1`. Do not
assume a revoke event is delivered or replay an ambiguous write. Grant and
regrant can create assignment notifications. Before opening the live cohort,
prepare exact notification/queue cleanup and exclude unintended delivery;
the previous self-assignment cleanup does not cover those effects. No role
change, real account change or broad notification cleanup is needed.

## Follow-up: Realme Unlocked And Revocation Rehearsal

Realme RMX3830 / Android user0 was unlocked and build47 matched. The installed
app's guest accessibility tree exposed two edit controls and the sign-in
button, with object geometry. Only the fixed control types and geometry shape
were retained; returned to Home with no Auth, screenshots, app upgrade or data
clear. This calibrates guest observation only, not the task observer after
sign-in. Android's external link contract is limited to `/auth/callback`; the
native task path must use ordinary sign-in and the Tasks menu. Build47 does not
contain the local foreground revalidation fix.

The read-only preflight bound the previously verified QA Owner and ordinary
QA Viewer on the pinned database. Both are unbanned test profiles. The Owner
has global task view/manage and no active web/native endpoint. The ordinary
Viewer lacks global `tasks.view`/`tasks.manage`/`tasks.view_all_locations` and
has one active native endpoint. This pair is not admitted for a live native
revoke case; no assignment, role change or subscription change was attempted.

The [PGlite test](../../tests/server/task-coassignee-revocation-db.test.mjs)
loads the migration's RPC/RLS and archived dependencies into a minimal local
schema. It proves Viewer visibility `0 -> 1 -> 0 -> 1 -> 0`, ordinary viewer
replacement denied with `42501`, and assignment notification counts
`0 -> 1 -> 1 -> 2 -> 2`; four loaded regressions also fail as expected (5/5).
No delivery integration is loaded. The [clone-only smoke](../../tests/server/task-coassignee-revocation-smoke.sql)
adds normal-trigger/outbox assertions and mandatory rollback for an isolated
egress-blocked database; it has not been run against a full clone or production.
Local web build `f0000297e80c2e31` passed with the pinned Windows esbuild binary.

Next: first use a dedicated QA Owner self-assigned fixture for the native draft
positive control, with an exact fresh-SID/local-logout guard. For physical
revocation, use a separate admitted viewer with Tasks UI access, no unintended
delivery and exact fixture cleanup; do not alter the current Viewer. Retry with
a controlled transient failure and signed-in iPhone PWA remain separate cases.
See the [12-stream status](../IMPLEMENTATION_STATUS.md). No rental or release.

## Follow-up: Task Editor Access Lifetime

The mounted detail fixture reproduced stale comment resurrection after an HTTP
403 or successful missing-row response. Checklist state was already lost in
the same path, and an open action confirmation could also be restored. The
visible task snapshot now owns one editor lifetime: a transient failure or
ordinary foreground refresh retains it; confirmed denial or absence retires
the editor and its unsent state. An authorized re-read opens a clean editor.
The modal shell remains mounted, preserving the focused Close button through
the first read. A delete reply from a retired editor cannot close another task;
the successful active-editor control still closes and refreshes the list.

Both restoration cases and the focus/late-delete cases went red before their
fixes. Final verification: 78 focused hook, mounted-detail and observer tests;
6 synthetic visual scenarios in Chromium 1440/390 and WebKit 390 across both
themes; inspected unavailable and restored states. Typecheck and local web
build `2ce1b2d2a5e651f8` passed. No production reads or writes, Android login,
device install, new rental, migration or deployment in this follow-up.

Native admission remains separate: no reviewed headless password input on
Realme without passing credentials as process arguments. Before a native
QA Owner login, prove guest input, capture the exact before/after SID delta,
and verify push preference and endpoint state again after login. Track any
newly associated binding by its row ID as well as SID, since logout can null
the FK; prove old SIDs retained and return to the empty guest form. The
current live Viewer is still excluded. The clone-only smoke is still unrun:
the local Docker engine was unavailable, a current matching schema-only
snapshot was not established, and normal outbox trigger proof needs a
positive control as well as the no-delivery assertion. PGlite remains
subschema/RLS evidence, not delivery evidence.

## Follow-up: Physical Android Browser And Native Admission

On Realme Android 15, a USB/stdin-only helper injected a fictional control
string into the installed login form and refused injection to an unbound UID.
The form was cleared and the temporary device helper was removed. No secret in
arguments, screenshots, clipboard changes or system policy changes were used.
The helper uses Android 15's [target-UID input method](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android-15.0.0_r1/core/java/android/hardware/input/InputManagerGlobal.java).
The production QA Owner has push enabled, so the Owner path was refused before
Auth. A distinct owned QA Tech Admin has task capabilities and no active push
delivery; a QA Location Staff also has location-scoped task visibility and no
active delivery, but was not used for a live revoke case.

The exact local Task9 components ran on the same physical Android in Yandex
Browser, with a loopback-only fictional backend and an isolated ADB reverse
mapping. Two real Home/foreground cycles triggered reads without a CDC frame.
Held transient read and Retry preserved both draft nodes and values. A hidden
row retired the editor before the held history read; later restoration opened
empty fields. Zero fixture writes; HOME, exact mapping removal and local server
shutdown passed. Draft input in this browser test was synthetic DOM input,
not a claim about the native keyboard or live RLS.

Installed Stable47 authenticated the dedicated QA Tech Admin. The first native
run stopped at the Mine tab selector (its label can include a count); the second
reached Mine but did not find the exact task title in the accessible viewport.
No native draft assertion ran. Each run's one private synthetic task was
soft-deleted; checks found zero task notifications/outbox/comment/checklist
effects. API and native test SIDs were retired, with prior sessions preserved
and no active binding. After the first confirmed UI exit the signed-in shell
persisted even through one app-process restart. One normal UI retry after exact
server retirement restored the empty guest form for each run. Realme was
returned to Home. No data clear, permission changes, APK update or deployment.

Separately reproduced in the installed Auth SDK with fictional transport:
HTTP 503 leaves the local session intact, and the interactive caller used to
ignore the SDK error. A subsequent 403 settles local sign-out in the fixture.
The interactive path now reports failure with a scoped alert and the shared
operation does not let a delayed web preview retirement sign out a replacement
session. All 62 focused Auth tests and typecheck passed; four real UI fixture
cases showed the failure and reached the public signed-out screen on retry
at 390/1440 in both themes. This is not proof of the original Realme response
status. Next native delta: prove task row and
accessible viewport controls on a bounded fixture, and verify the Auth fix in
the release candidate, before using the admitted QA staff for revoke.

Independent Task8 delta: prevent mobile Tab from landing on the clipped search
field while the bar is tucked. The visible opener still supports Enter, and
desktop/tab navigation stays unchanged. Updated the stale-list fixture to
assert retained rows without the obsolete transient warning. 15 focused
product cases and 41 push-notice/fixture-control cases passed. Final local
shared web build with the Auth fix: `3178494c070f3939`. This is not Stable.

## Follow-up: Realme Signed Peer Refresh And Isolated Retry/Revoke

The unpublished signed Android `0.1.48`/49 opened the exact owned fixture via
the newly named native title button; bulk select stayed separate. Both
unsent values survived Home/return and, in a separate check without going to
Home, an actual title update from a second session. The list was filtered by
an immutable prefix so the renamed title could not remove the selected row.
No draft was posted. Exact fixture cleanup, no delivery, exact session
retirement and preserved prior sessions were verified. The first native
logout still showed an error even though the server session was gone; a
second normal logout reached empty guest, followed by a verified Home.

A separate temporary, network-disabled APK on the same Realme WebView ran the
exact editor and resume components with a fictional fixture. The corrected
controller awaited real DOM reads, then verified both drafts on Retry,
editor retirement before the sibling response settled, and fresh inputs
after regrant. No writes; exact helper removal and candidate identity
verified. This is not a live revoke in the signed app or native keyboard
proof. [Card and release evidence](2026-11-05-task9-android-card.md).

## Follow-up: Android 51 and iPhone Card Admission

[Stable 50](2026-11-06-android50-stable.md) passed the first normal Realme
logout. [Signed candidate 51](2026-11-06-android51-candidate.md) is installed
on the same device and not in Stable. Its private coassignee grant worked
through the ordinary Staff API; the physical controller stopped at the
unnamed search field before any card or draft assertion. The exact task is
tombstoned and the new sessions retired. One synthetic in-app notice remains
after a refused guarded cleanup. A separately guarded recovery then removed
only that notice; exact COMMIT and independent readback verified. Keep the
old dispatch closed.
[Native evidence and web search release](2026-11-06-task9-realme51-preflight.md).

The [separate iPhone path](2026-11-05-task9-iphone-pwa.md) passed read-only
admission for a quiet Tech Admin and the named search in the current public
web build. It will use a self-owned private task with zero notifications.
That admission is not the physical iPhone card, keyboard or draft result.
