# Existing Media Intake Follow-up

Scope: the existing five image OCR records, retained semantic drafts and six
already extracted/OCR'd video samples only. No acquisition, database, model/API,
pixel viewing, device, browser or product changes. No personal text, identities,
media URLs or private fragment values are retained here.

## Alias And Evidence Rules

image-1 through image-5 mean the five entries in the retained image OCR array's
existing order. All five ordinal/file bindings agree with the download metadata
and OCR metadata, checked in RAM without exporting their private identifiers.
Line numbers below are one-based positions within each image's OCR lines.
video-1 means the single existing video. These aliases are not product IDs.

An OCR rectangle is not a DOM/container rectangle, a physical viewport or proof
of paint. Source comparisons below use current controls, not an established
version of the captured client. A visible control is not a defect by itself.

## Confirmed UI Surfaces, Not Confirmed Defects

| Aliases | Grounded observation | Boundary |
| --- | --- | --- |
| image-1, image-4 | Lines 1/2/7 form the rejection-dialog title, reason-field label and rejection footer action. Their vertical order and OCR rectangles fit the respective image bounds. This matches the public control cluster in `TaskRejectModal`. | Does not establish a failed rejection, wrong status, text clipping or request failure. Other text between label and footer is not classified as system status. |
| image-2, image-3 | The waiting-for-confirmation heading occurs at lines 13/2; assignee labels at 24/5; creator labels at 30/10. These match the task-detail surface. Action text appears between the heading and metadata. | Current source shares the heading/metadata, but the complete captured return-action wording does not exactly match current copy. Client version and intended complaint remain unknown. |
| image-1 versus image-4 | Six of seven OCR lines match literally in RAM; known UI labels have a near-uniform translation. | Related views, not proof that both attachments are identical or the one different line is a defect. |
| image-2 versus image-3 | All eleven image-3 OCR lines also occur literally in image-2. Known labels retain their order with approximately the same translation. | Strong evidence of overlapping excerpts. Do not count them as two independently established task failures, or discard either original. |
| image-5 | No reliable cluster from the checked public UI-label vocabulary was established. | Its meaning remains unaccepted; absence from this vocabulary is not absence of UI or a defect. |
| video-1 | Six existing samples over 12.616667 seconds contain recognizable navigation/settings/search labels in different sampled positions. | Only UI context is advanced. No initiating action, expected transition, failure interval, loading duration, platform/build or causal mechanism is established. |

Relevant current source: [rejection controls](../../artifacts/kub/src/pages/tasks/TaskRejectModal.tsx),
[waiting task detail and actions](../../artifacts/kub/src/pages/tasks/TaskDetailModal.tsx),
[status vocabulary](../../artifacts/kub/src/pages/tasks/taskMeta.ts),
[settings menu control](../../artifacts/kub/src/components/sidebar/SideMenuLayer.tsx).

## False-positive And Draft Limits

Six small in-RAM literal controls passed: the complete rejection cluster is
recognized; a single action word, a field label alone and a containing-word
substring are refused; task/empty-task labels do not become loading evidence.
This calibrates label classification only, not rendered visibility or behavior.

The five image OCR records contain no literal Russian loading stem or whole-word
English loading label. The earlier broad task/loading category must not become a
specific loading complaint on this evidence. A graphical spinner can escape OCR.
Existing video metadata's lack of static error-label matches likewise does not
prove an error-free interaction; the prior zero-speech result supplies no meaning.

Four of five selected retained draft anchors match some image OCR literally in
RAM; duplicate excerpts make some matches ambiguous. One anchor does not match.
These checks do not repair the existing schema/coverage/source-admission failure
or validate the proposed observations. No draft is promoted to a confirmed bug.

## Smallest Safe Next Acceptance

Request one content-free attestation for each unresolved group: image-1/4,
image-2/3, image-5 and video-1. Fields: alias; initiating UI action; expected UI
outcome; actual failure category (layout, action result, state refresh, wait or
unknown); client version/platform or unknown. For video, identify the relevant
existing sample pair or time range, without sending another image or message.

This distinguishes rejection-form trouble from confirmation-state trouble and
navigation/wait trouble without more downloads, OCR, model calls or exposure.
Only then derive one fictional fixture reproduction for the stated behavior.
All six attachments remain semantically open as defect reports; no tester latency,
VPN, caching, audio or current-client cause is inferred or closed here.
