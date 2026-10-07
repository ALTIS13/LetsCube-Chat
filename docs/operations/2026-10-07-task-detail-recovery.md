# Task-detail refresh and recovery

Owner: coordinator; branch `codex/bot-inline-media-20261002`, source baseline
`84d4117d`. Independent defect D-354, tracker item92. Tester items86/87 remain
unidentified reports, not proved duplicates or repaired by this source audit.

## Observed Cause

The actual `useTask` starts the same loading state for first load and every
realtime/refetch request. `TaskDetailModal` replaces its working content with
the loading branch, unmounting `TaskChecklist` and its locally held draft.
The task query's transient error and successful missing result share the null
task branch, so a timeout appears as unavailable/deleted with no local retry.

An isolated actual-hook probe with fictional backend responses confirmed the
refresh/loading and57014/null-task transitions. Initial success and successful
absence controls pass. It did not mount the modal, prove draft loss on screen,
explain an automatic full-page reload or identify the tester client.

## Bounded Repair

Separate initial loading, same-owner refresh and recoverable read error.
Retain mounted working content and drafts on a transient failure; provide a
compact retry. Confirmed absence or explicit access denial clears the task and
its dependent lists. Task/account/session/latest-request replacement must not
retain foreign snapshots or transplant comment/checklist drafts.

Preserve existing Liquid Glass controls and task/RPC permissions. No new
dependency, redesign, DB mutation or task-action authorization is intended.

Authentication/access refusal is separate from a transient backend failure.
The exact401/403 and42501/PGRST301/302/303 classifications were checked against
[PostgREST14's primary error reference](https://docs.postgrest.org/en/v14/references/errors.html).
PGRST300 is a500 configuration error, not proof of a rejected identity. Do not
infer authority from a backend message string or expose that string in the UI.

Independent review reproduced an additional held-read defect in the first
candidate: `Promise.all` delayed retirement after confirmed task absence or
access denial until an unrelated history read completed. Require immediate
current-owner/current-request retirement and refuse later snapshot resurrection;
the transient-error control must still preserve a same-owner working snapshot.

## Verification Gate

Mount the actual hook, modal and checklist against a fictional backend boundary:
causal RED against shipped source, then GREEN for held realtime refresh, draft
retention, transient error/retry, confirmed absence/access denial, rejected
promises and late task/owner/session/request results. Preserve ancillary list
snapshots only for the same owner. Add focused omission controls for new rules.

Inspect the exact changed UI at1440 and390 in both themes using fictional data;
never capture production screens, personal content, traces or video. Every
browser run uses `KUB_QA_ALLOW_MUTATIONS=0`. No installed Android or physical
iPhone acceptance is claimed here.

## Candidate Evidence

Actual mounted unchanged-source RED:18 failed/1 control passed. First candidate
unit40/40 includes29 behaviors and11 compiled literal omissions; styled Chromium
1440x900/390x844, light/dark4/4. The coordinator inspected all eight fictional
final views. Ordinary held refresh preserves the draft bounding box; the compact
Retry is visible and bounded. No unexpected network, write, page/console error,
personal data or production capture. Existing React/UI/Zustand/realtime components
are mounted; SDK I/O and permission/recurrence/media authority are fictional.

Review's held-ancillary case: causal RED4 with1 passing transient control, then
GREEN10/10 including a compiled terminal-retirement omission; affected prior
controls16/16. The immediate-retirement change does not change the modal/CSS,
so the accepted four styled cases and pixels were not replayed. New hook SHA256
`45f77a1f90975585e652b04109518a2259eb9f20edbceffe0cf681d5a68e2378`.

Final affected typecheck exit0 and fixture-config production build exit0:
`sw.js build f04e8b99cce42f46`, actual13.43 seconds. Local entry
`/assets/index-Ck4CuS6c.js`, SHA256
`c9f93892f75f06ca6f98daf5c8f653fe6bd7a46c41ae539883ead2768ac3fca5`.
These are source/fictional/build observations, not authenticated RLS or installed
client proof. Final independent changed-input review accepted the fix, with no
open P1/P2. Actual web rollout remains due; old runtime36f313dc and public
APK0.1.13/build14 are unchanged.
