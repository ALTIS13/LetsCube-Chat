# Task9 Android task-card diagnosis

2026-11-05. Coordinator; installed Realme RMX3830/API35, Android 48
(`0.1.47`, unpublished). Public Stable still `0.1.46` / 47, optional.

## Device and API evidence

- A dedicated push-off Tech Admin QA account and a single exact, private,
  self-assigned task were admitted. The separate API session under the same
  identity received HTTP 200 from the nested `useTasks` list query, with the
  exact active task in the returned window (85, 86, and 87 rows across the
  three cohorts). These are same-actor API controls, not native HTTP captures.
  On the installed app, Mine and the exact query produced one result, with no
  empty, pending or Retry surface.
- The first broader AX match was a false positive: it activated the search
  filter chip's remove button. Full MobileCLI AX then distinguished the query
  chip and its remove button from the lower, center-of-card button exposed as
  the bulk-selection action. There was no separately named task opener.
  Scrolling moved the latter node without making a title opener appear.
  No production screenshots, tree contents, or user data were retained.
- Each synthetic task was soft-deleted and checked for zero notifications,
  outbox, checklist and comments. Exact API/native SID retirement and
  preservation of prior sessions were checked. The app again reported a
  first logout failure despite server retirement; normal retry reached the
  empty guest form and Home. The original transport cause is still unproven.

## Product change and verification

The row/card had a checkbox inside a custom ARIA button. Both now use a
native button named by the title, a separate selection checkbox, and the same
full-surface pointer target. No task SQL, layout, role or assignment logic
changed. The [ARIA in HTML button restrictions](https://www.w3.org/TR/html-aria/)
agree with separating the interactive controls.

- Mounted Chromium reproduced the missing exact opener on the old row/card
  in both themes. After the patch, Enter, Space and pointer clicks outside
  the title open the task; pointer and keyboard selection do not open it.
- 12 cases passed on Chromium 1440/390, light/dark, including existing
  filter and list/detail rendering controls. All four synthetic row/card
  screenshots were inspected. Typecheck and diff check passed.
- The isolated source change is `9789f0e7`; Android candidate
  `0.1.48` / 49, `923d7cb1`, supersedes 48. Actual production build
  `e3d28d68f8d995ab` passed APK/AAB parity, original signing and all four
  Firebase values. Realme 48 -> 49 retained UID, data directory and first
  install time, matched the complete signed APK SHA-256
  `bd5df2d7b311a3054f0b83948e2a5aa869c41fce268d0ab8dd647311ae2ad0a5`,
  and reached guest/Home with zero process fatal entries. Signed-in exact
  opener, peer update, transient Retry, and permission revoke/restore
  require separate evidence. Nothing was published.

## Signed-in build 49 follow-up

Realme on 49 produced distinct native AX nodes: a checkbox named for bulk
selection and a button with exactly the task title. Tapping the latter
opened the owned detail with the expected title and close control.
The first two draft attempts stopped later at locating the empty checklist
field: the WebView exposes an editable field there but the MobileCLI
projection omits its label. No draft/Realtime/Retry/revocation PASS is
claimed from that observation. Exact fixture/SID cleanup and guest return
were verified on both attempts; no Android publication.

Later installed-build cohorts entered both unsent drafts. One cohort
observed both after Home -> return. A second session updated the owned task,
and the open detail received the changed title. The AX/gesture driver did
not settle both fields after that update; it also could not scroll back to
the comment in a control **before** dispatching a peer update. Do not infer
draft loss or complete peer-refresh acceptance from that selector/gesture
failure. No draft was submitted. All exact synthetic tasks and SIDs were
settled; prior sessions were retained, and Realme returned to empty guest/Home.

At this point logout remained a distinct blocker for Android release. The first native
logout retired the exact SID server-side but showed a failure; normal retry
cleared guest state. The same-actor API cleanup control returned HTTP 204
with Android Origin allowed and no body over both HTTP/1.1 and HTTP/2.
Those controls do not instrument the release WebView. Next: isolate the
remaining physical WebView geometry/Retry/revoke cases without creating
another live fixture, then measure the exact first native logout response.
The later [Task9 workflow follow-up](2026-11-05-task-workflows.md#follow-up-realme-signed-peer-refresh-and-isolated-retryrevoke)
confirmed both drafts after peer refresh, and [Stable 50](2026-11-06-android50-stable.md)
fixed the first logout. Real access revoke and restore in the signed app
remain separate acceptance cases.

## Installed synthetic WebView control

A separate no-INTERNET fixture APK on the same Realme compiled the actual
task hook/modal and reused the established synthetic server responses.
Two real Home -> Activity returns passed: held transient error retained the
same input nodes/values through Retry; absence retired the editor before
the held sibling read completed; regrant opened fresh empty inputs. Zero
mutations. The exact fixture package, debug forwarding and ephemeral build
were removed; production-package build 49 was unchanged. This closes the
physical WebView rendering/lifecycle control only, not live RLS or exact
signed-APK acceptance for the fault/regrant scenario.
