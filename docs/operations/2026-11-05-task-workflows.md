# Tasks And Ordinary-User Workflow Batch

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

Next: actual authorized two-client task review and active/history transitions;
remaining task and interface coverage is in the [12-stream status](../IMPLEMENTATION_STATUS.md).
Keep released notes separate from downloadable catalog authority. On a later
verified Stable release, archive the previous version in `VERIFIED_RELEASE_HISTORY`
before its catalog row is replaced. Do not archive a candidate.
