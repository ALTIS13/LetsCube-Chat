# Cold History Scope And Recorder Feedback

Owner: Codex coordinator. Stage: source reviewed and pixels accepted; native
candidate acceptance pending. Baseline fe40b5e5, runtime85025f59/Stable39.
No production SQL, Auth, native installation or deployment in this source stage.

## Reproduced Causes

The actual ChatWindow scope expressions and useTopics/useMessages consumers,
Zustand store and browser IndexedDB reproduce a cold group display miss. A plain
group is saved as the verified all-message view. After a new JS context, topic
metadata is unknown and the existing network scope becomes root/null. An exact
root cache lookup cannot find the saved all-view page. The private-chat control
continues to restore its message. This independently demonstrated product bug
does not prove the cause of the prior physical PID31720 `open` refusal.

Two stronger selected-channel cases also went RED: a cached root page appeared
under a different explicit channel selection, while a genuinely saved selected
channel could not restore until unrelated general-topic metadata loaded.

Separately, a short voice-recording hint survived a context-menu switch to video.
The status icon preferred the newly selected mode, but its text preferred the old
hint for up to2200ms. The actual mounted component reproduced this at1440/390 in
both themes, without a layout-height change.

## Repair

- Persist a small same-chat pointer to the last committed verified default view.
  It contains all/root plus general-topic IDs, not roles or permission authority.
  Unknown default topology may read that exact page for local display only.
- Selected channels read only their own UUID scope. Unrelated general-topic IDs
  no longer change explicit-channel cache identity. Known exact legacy records
  remain readable; unknown legacy metadata is never guessed or scanned.
- Preserve existing network queries, fresh topic admission, send behavior and
  authoritative responses. Cached topic data never sets scopeKnown=true.
- Serialize default page/pointer writes in invocation order. Publish a pointer
  only after its page commits, capture inputs before awaits, and retain existing
  backend/account/session/generation/clear and hash/TTL fences.
- Clear the obsolete short-hint state and timer before the selected recorder-mode
  feedback. Preserve the existing glass, dimensions, timings and gestures.

The pointer shares the existing ten-record/8MiB/seven-day history budget; it does
not duplicate message payloads or widen retention. An evicted/missing pointer or
page is a soft cache miss, not network authority or permission to borrow another
scope. Existing pre-update default snapshots gain discovery on the next verified
write, not by scanning historical disk records.

## Verification

- Cold composition: original group RED with private control, then9/9 GREEN
  (five coupled cases and four independent literal omission controls),
  including ROOT-alias refusal and explicit-channel positive control. The fixture
  extracts actual ChatWindow statements and invocation; it is not a full App
  or physical-device acceptance test. External network, Auth and mutations refuse.
- Service22/22: exact legacy compatibility, default ordering/write failure,
  caller mutation, scope isolation, retirement and privacy controls.
- Affected suite197/197: cold Auth/sidebar boundaries, Chromium/WebKit storage
  and offline history, page loader, recorder intent and new feedback regression.
  The later added legacy control passes separately in the22-test service cohort.
- Recorder feedback5/5 including timer/ref and three-line omission controls;
  exact changed component at1440/390 in both themes passes and all four final
  pixel crops are inspected. Dock66px and button44x44 remain stable. External
  HTTP/WebSocket0; renderer errors0. Initial Vite504 setup refusal is retained,
  not counted as acceptance; the complete subsequent run passes.
- Independent service/hook/window review finds no new P1/P2. Existing eviction
  budget and the possible reduced retained depth from pointer slots are explicit.
- Client typecheck passes. Native0.1.39/build40 is the next candidate, not a
  relabel of39. Release is recorded only after execution; no inferred physical
  cold-original/gallery acceptance.

Canonical additions: tests/e2e/cold-media-open-fixture.mjs,
tests/unit/cold-media-open-20261026.test.mjs and
tests/unit/ui-micro-feedback-20261026.test.mjs. Private synthetic evidence remains
in .ops-private/cold-media-oct26/ and .ops-private/ui-oct26-audit/.

## Remaining

Build the next immutable Android candidate,
verify data-retaining upgrade and actual affected runtime behavior, then publish
the validated delta. Keep the wider authenticated cold-original/save journey,
Apple audio, background calls and broad UI/motion backlog open. Do not replay
unchanged warm/provider/Stable39 engine baselines.
