# D-348: Voice Recorder Acquisition Diagnosis

Owner: coordinator; bounded diagnosis and independent source review accepted.
Stage: SHARED_WEB_ACCEPTED, narrow main/runtime `0176253a`.
Evidence: original 6 PASS / 2 RED; final affected 53/53 PASS. Independent review
accepts the event-boundary guard; no mounted/device permission proof is claimed.
Next action: preserve the unspecified tester prompt as open; bundled Android
acceptance is separate, not claimed by the shared-web rollout below.

## Scope

[Approved item 84](../PRODUCTION_PRIORITY_TRACKER.md#next-execution-queue) remains
reported_UNVERIFIED: the tester's client, build and system-versus-app prompt are
unknown. This implements option 2 of the retained independent-slice report.

The [new test](../../tests/unit/voice-recorder-acquisition.test.mjs) compiles the
actual useVoiceRecorder hook, audio constraint function, recording rules and
composer scope. AST-selected MessageInput declarations, lifecycle effects and
pointer/start/stop/cancel callbacks are compiled without rewriting their bodies.
Both current recorder-button branches bind the tested pointer-down callback.

Controlled React hook/effect slots, clock, getUserMedia, MediaRecorder and tracks
reuse the accepted voice-recording-intent VM pattern. Only fictional streams and
send/alert ports exist. This is not a mounted React/browser/native test. Gesture
delivery is forced by the fixture; real browsers/OS duplicate delivery is not
established. No actual microphone, account, permission dialog or network is used.

## Actual Focused Result

Command: `node --test tests/unit/voice-recorder-acquisition.test.mjs`, ordinary
Node through CMD; final chunk `5160eb`, exit 1, 385.5988 ms. Eight tests ran:
6 PASS, 2 FAIL, zero skips/cancellations/todos. The two regression assertions
remain actively RED; they were not waived, inverted or fixed in product code.

| Control | Actual getUserMedia calls | Result |
| --- | --- | --- |
| Successful hold, stop, next successful hold | 1 each, 2 total | PASS |
| OverconstrainedError | 1 initial + exactly 1 fallback | PASS |
| NotAllowedError | 1 initial, 0 fallback, 0 streams | PASS |
| Duplicate touch down before the 320 ms timer fires | 1 | PASS |
| Duplicate mouse down while initial request is unresolved | 2, expected 1 | RED |
| Duplicate touch down after first long press, request unresolved | 2, expected 1 | RED |
| Duplicate pointer down after recorder creation | 1 total | PASS |
| Compiled generic extra-call mutation | 2; one-call assertion rejects | PASS calibration |

Each duplicate RED uses the actual pointer callback, same fictional pointer ID,
no intervening release/cancel and an unresolved first request. The mouse case
delivers twice before rerender; the touch case allows the actual second timer to
fire after 320 ms. Neither RED injects a getUserMedia call or edits hook/consumer
source. Mutation is a separate control, not the evidence for these findings.
All fixtures, including RED cases, retire and release every acquired fictional
track exactly once; no recording/gesture timers remain. Normal holds release
their tracks before the next acquisition. No permanent stream is introduced.

Initial chunk `7b80ed` was a harness calibration failure: the new fixture omitted
the accepted harness's UI-only setHoldElapsedMs noop. That port alone was added;
the changed new file was rerun. Initial errors are not product evidence. The
existing 43-case D-350 suite was neither imported as a test nor replayed.

## P2 Source Finding

[MessageInput:783](../../artifacts/kub/src/components/chat/MessageInput.tsx#L783)
accepts the repeated pointer down and reaches startRecorderHold directly for
mouse, or through another long-press timer for touch. Its
[voice start:611](../../artifacts/kub/src/components/chat/MessageInput.tsx#L611)
guards a pending **stop**, not an active/pending acquisition, increments the
intent and invokes voiceHold.start again.

[useVoiceRecorder:134](../../artifacts/kub/src/hooks/useVoiceRecorder.ts#L134)
deduplicates only when recorderRef already exists. During the first await it is
null, so another start increments sessionId and reaches
[getUserMedia:163](../../artifacts/kub/src/hooks/useVoiceRecorder.ts#L163) again.
Session invalidation releases a stale result later; it does not prevent the
second request already dispatched. The settled-recorder control stays GREEN.

This establishes a redundant-acquisition source path under forced duplicate
pending gesture delivery. It does **not** establish that ordinary successive
recordings acquire redundantly or explain the tester's later permission prompt.
No OS prompt persistence, StrictMode mounted behavior or native acceptance is
claimed. No cached permission promise, prompt suppression or product patch was
introduced. Complaint closure still needs its exact client/build/prompt kind.

## Frozen Source Readback

The test checks all five consumed source files byte-for-byte before/after the run.
The accepted D-350 test file also matches the initial read; it was not changed.
SHA-256 readback:

| File | SHA-256 |
| --- | --- |
| useVoiceRecorder.ts | `30d4395bd36a9ec89de7c901d9631e20273a0bf97313e70fcc2287e6fe5a00bc` |
| MessageInput.tsx | `6b6598f3fb88494fca0488483a7447b58fcc07942bd1e956230d47253a981dee` |
| useAudioSettings.ts | `72594f55face31a738761c91e8907c1c1d18caa9eda773029dcc318dd669f825` |
| composerSendScope.ts | `7f59963dcddd42a07eaa5748615126e6d449c53dcf9e0fb0c4021a9fc5a7449c` |
| recordingGesture.ts | `db3b709c3525fe1ff8610c489b12952b9d719d5a9c8afaa18b84ea57861e384b` |
| voice-recording-intent.test.mjs, unchanged/reused pattern only | `48d74c62d81d9fd2b98b22082019b15a8ebdd77be5343c643249978c0be08c98` |
| voice-recorder-acquisition.test.mjs, new | `248efbc0e9915839fb1e1013f2614adff52982d2b8e5a5a4ef809b0d905ac566` |

Only the new test and this report were written. No product changes, old-suite
replay, Auth, network, device, SDK, permission effects or Git operations occurred.

## Coordinator Repair

The original eight-case source diagnosis was observed again against unchanged
product code: chunk `bcfc97`, 6 PASS / 2 FAIL, 410.7088ms. The two actual pending
pointer cases dispatch two microphone requests where the literal oracle requires
one. That is the product RED, not the separate generic extra-call mutant.

The final patch adds one synchronous guard in `handleRecorderPointerDown`, after
`preventDefault` and before replacing pointer capture/coordinates or installing a
second hold timer. An already-active voice hold ignores a redundant down event.
The recorder hook, session ownership, normal start/stop/cancel, fallback, track
release and permission behavior are unchanged. No microphone is kept open.

An initial broader guard in `startVoiceHoldRecording` was withdrawn: the adjacent
suite's direct hook-stop then consumer-start probe was refused. Chunk `90d158`
records 10 PASS / 43 FAIL; the first failure contaminated subsequent fixture
cleanup, so it is not 43 independent product defects. That draft was not committed
or published. Moving the guard to the actual UI event boundary preserves the
existing lifecycle and leaves the adjacent test file byte-identical.

The strengthened new tests resolve the original pending acquisition and verify
the hold remains active and sends exactly once. Cancellation followed by a fresh
hold is admitted; late old tracks stop without affecting current tracks. Removing
the actual consumer guard reintroduces both mouse and touch failures. The original
generic extra-call calibration and all normal/fallback controls remain active.

Final affected run: `node --test tests/unit/voice-recorder-acquisition.test.mjs
tests/unit/voice-recording-intent.test.mjs`, chunk `423815`, exit0, **53/53 PASS**,
1416.2562ms, zero skips/cancellations/todos. The adjacent 43 cases were run because
their start/stop ownership boundary was changed by the draft; these are fresh
affected checks, not a new claim about unchanged device acceptance.

Final source pins:

- `MessageInput.tsx`: `633993cc965bd219cb288aede3d881c63fd88c1ad7c5c39808ccf5623820c956`.
- New test: `9a5204023331694a3c15bb96a6eacc26c5160d23ba88a74eeeeae2ae4830dec6`.
- Adjacent test remains `48d74c62d81d9fd2b98b22082019b15a8ebdd77be5343c643249978c0be08c98`.

Typecheck passed on the draft and must be rechecked at final integration. No new
markup/styles or visual layout were added. This source repair does not close the
unknown tester OS-permission complaint, prove physical duplicate delivery, or
change the already-built private Android19 bundle. Native/runtime release proof
remains a separate boundary.

## Accepted Narrow Integration And Rollout

Source commits `3c8f8562` and `ee74e678` contain only the one-line guard, its
new regression file/report, and the compiled-consumer marker/test. They are on
the feature remote. Their narrow main-based counterparts are `a3469663` and
`0176253a`; the range was read separately before the non-force main push.
All four changed JS/TS files parse and 36 aliases resolve against their own
commit trees. Unowned sidebar/search files and the exact preserved Android19
metadata were excluded. The five consumed product files and two recording
tests are byte-identical to the accepted source run, so its 53 checks were
reused, not replayed. Final integration typecheck: chunk `54f72e`, exit0.

The actual Vite build completes `sw.js build dcb98a39696129a0`, `built in 12.19s`,
chunk `c373a7`, exit0. Existing sourcemap/chunk warnings remain. This local
fixture-config build is not asserted byte-identical to the production build.
The new marker passes 6/6 with real full-source/transpiled/minified controls,
wrong-ref/late/inverted guards and actual omission/duplicate mutations. The
coordinator's full local Vite bundle check `fbcb0e` identifies old0/new1.

Before publication, `5186db` at 21:52:16 UTC verifies the healthy d8 runtime,
voice old1/new0, Storage old0/new1 and actual public/container JS+SW parity.
Own branch push `51f53c` and main push `00a0e1` exit0; remote main readback
`a431c4` matches the full reviewed revision. Rollout source is independently
accepted, review SHA `d53df2f02c9c7a113fef206707e93a051dbda53d95d9355bdc946c84b5d0b8bb`.
The first after-read refuses while Coolify is still deploying; no partial
after files exist. It is not an application failure or an effect replay.

Actual runtime acceptance `0fbcb4`, exit0, at **2026-10-11T22:00:43.824Z**:

- Sole healthy container `b599ba6d0393`, image
  `l64kyyu1sysev2izzjjbizhe:0176253ac1ce1eeb94eb878071f81d5bb491166b`.
- Image ID `sha256:077e2c19a67d559aa1b7e560bba79803fa24be5271b174fb797c57b35f60422d`.
- Public entry `/assets/index-CvsjM-tT.js`, SHA256
  `30e43eb0e8d3189d71b24655dd5e1584f152157631de7be633053053a411cb88`.
- Service worker SHA256
  `a3135e2bd16d8aaadf2d014f76f0e858f6b428d8fca5fa3d94be06b54ba3263e`.
- Voice old0/new1; unchanged Storage old0/new1; both public bytes match the
  container. Runtime identity is stable across observation. The preceding d8
  public entry and exact image are retained unchanged for rollback.
- Private after receipt SHA256
  `e973e25e0c98813a5de8df2cd011ef95b4b7069ed207e441210b131fd41fba41`.

No schema/DB/native activation, signing, Android release or OS-permission claim
is included. The tester's unidentified prompt remains open. No new layout or
markup changed; the existing rendered recording matrix is not replayed.

Fresh anonymous smoke `196048`, exit0, at22:14:36 UTC: existing headless
Chromium1440x900, home200/mounted -> actual public login link -> login/mounted,
0 page errors and0 mutation requests. New isolated browser context, no signed-in
state, service workers disabled and non-read HTTP methods blocked. No captures,
traces or video. Browser plugin/skill is not listed; existing Playwright is used.
This only validates anonymous bootstrap/navigation, not microphone interaction.
