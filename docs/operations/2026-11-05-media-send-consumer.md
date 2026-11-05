# Task3: Mixed Album Send Consumer

## Resume

- Owner: Codex, bounded consumer slice; coordinator owns integration/references.
- Stage: bounded regression complete; production code unchanged.
- Source: worktree `android-current-20261015/LetsCube-Chat`, branch
  `codex/ui-motion-updates-20261019`, baseline
  `1c6fdd0328d57f5b3c18e3f41f6411ba2ba6d65e`, initially clean.
- Evidence: actual AttachSheet `send` -> ChatWindow `sendMediaFromSheet` ->
  `stageFiles` -> `sendStagedAttachments` -> `retrySend` callbacks are executed
  from source. Original source passes; no source defect reproduced in this case.
- Blocker: none. Next: coordinator integration; this executor stops here.

## Contract

When the first edited video upload is refused, the next successfully uploaded
album sibling owns the caption. Retrying the failed placeholder uses the retained
edited File and original client ID, album ID/index/count, timestamp, topic and
reply, without repeating the sibling's caption. Later uploads finishing first
must not reorder message submission. A sheet submission must not consume an
unrelated attachment in the composer while its ref is one render behind.

## Boundaries

Only this report and `tests/unit/media-album-send-consumer.test.mts` are owned.
No production extraction or pipeline rewrite is currently needed. Existing
quality7/layout4 are accepted and are not rerun. No visual/CSS or shared hook
change, Git mutation, deploy, Auth/DB/provider/device/rental action.

Callbacks are AST-selected/transpiled in a source harness, not React-mounted.
Real staging/queue/album/outgoing/placeholder/metadata/location-removal code runs;
dimension IO, accepted ladder output, upload and message-send boundaries are
controlled. Synthetic File bytes are not claimed to be decodable media. No real
upload, server ACK, persistence restart, shell or device proof is claimed.

Coordinator's live reference/tooling work is recorded separately in
[tooling-guide.md](tooling-guide.md). Its inspected Discord iOS flow establishes selection,
explicit Send and a received image only, not encoding, caption or retry rules.
No Telegram reference is claimed; no additional reference calls are needed here.

## Verification

Command: `node --test tests/unit/media-album-send-consumer.test.mts`.
Result: **3 tests, 3 pass, 0 fail, 0 skipped**.

1. The actual sheet closes while submission proceeds. Real staging retains the
   edited MP4 File plus an unchanged GIF and WebM. With the composer ref still
   holding an unrelated file, only this sheet's explicit selection uploads.
   Siblings complete in reverse order; no message is submitted before the first
   item settles. A synthetic 415 refuses that first upload. The GIF carries the
   caption; the WebM is silent. Actual `retrySend` resubmits the retained MP4
   silently with the same File object, client ID, album ID/index/count and
   placeholder time. A new callback with a different current topic/reply still
   sends the retry to its original topic/reply. Outgoing entries and account
   listeners are released; the unrelated tray item remains.
2. Omission control removes only
   `if (captionSentWithAttachment) claimCaption(attachment);` from the loaded
   ChatWindow callback in memory. The same contract assertion detects caption
   duplication: `[caption, "", caption]` instead of `[caption, "", ""]`.
3. No-refusal control keeps all three sends active, in original pick order,
   with only the first caption. It does not "fix" duplication by silencing every
   caption or suppressing a sibling.

Separate behavioral RED: set
`LETSCUBE_MEDIA_CONSUMER_OMIT_TRANSFER=1` in the test process and run
`node --test --test-name-pattern='^actual sheet/staging/send/retry' tests/unit/media-album-send-consumer.test.mts`.
Observed **1 test, 0 pass, 1 fail**, Node exit **1**, at the caption assertion,
not a parser/dependency/harness error. The PowerShell wrapper explicitly
propagated `$LASTEXITCODE` after restoring the environment. Without the flag,
the same source regression is GREEN. This RED is a deliberate omission, not a
claim that baseline `1c6fdd03` contains the defect.

No application suite, build or unchanged quality7/layout4 replay: production
inputs did not change. The explicit ban on replaying accepted unchanged cohorts
overrides the TDD skill's generic full-suite step; the two-file write scope and
Git restriction override extra-ledger/commit steps. This report is the slice's sole resume record.
Self-review checked the source-selected callbacks and scope; integration review
was completed by the coordinator. Controlled bucket metadata was aligned to the
actual chat-media producer, and the final changed-scope test rerun3/3 passes.
The worker performed read-only Git metadata/status inspection; coordinator owns
the subsequent test/documentation integration. Product source is unchanged.
