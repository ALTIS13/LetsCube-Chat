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

## Verification Gate

Mount the actual hook, modal and checklist against a fictional backend boundary:
causal RED against shipped source, then GREEN for held realtime refresh, draft
retention, transient error/retry, confirmed absence/access denial, rejected
promises and late task/owner/session/request results. Preserve ancillary list
snapshots only for the same owner. Add focused omission controls for new rules.

Inspect the exact changed UI at1440 and390 in both themes using fictional data;
never capture production screens, personal content, traces or video. Every
browser run uses `KUB_QA_ALLOW_MUTATIONS=0`. Typecheck/build, final independent
review and real deployment/public-content evidence remain due. No installed
Android or physical iPhone acceptance is claimed here.
