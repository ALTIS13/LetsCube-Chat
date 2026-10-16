# Recorder Mode Feedback: D-366

Owner: coordinator. Stage: reviewed shared-web candidate; production acceptance
is recorded below only after actual image/content/rollback readback. No SQL or
native package publication belongs to this slice.

## Cause And Repair

The shipping voice/video feedback was an in-flow, full-width row. The real
MessageInput in the fictional DEV conversation measured dock height66 before
switching and109.328125 afterwards at1440/390, both themes. Its temporary height
also changed the history's measured bottom inset. Four regression cases failed
on this43.328125px delta before the repair.

Feedback is now a compact, pointer-transparent glass status above the recorder.
It names the selected mode, not a recording in progress: «Голосовое сообщение»
or «Видеосообщение», with the matching fixed-width icon and wrapping text.
The same layout fix covers the existing short-recording hint. No new animation
system: existing kub-menu-in, glass material and feedbackDuration are reused;
reduced motion retains the message without movement. Rapid switches replace
the timer, and no side effect remains inside the recorder-mode state updater.

An additional actual candidate failure found1120px² overlap with jump-to-latest
while reading history. Reserving space only while that control is visible
removes the overlap; its click still works. This candidate-without-reserve is
also the omission control for the new geometry rule.

## Verification

- Fictional local fixture only, KUB_QA_ALLOW_MUTATIONS=0; external HTTP and
  WebSocket traffic blocked. The independent review's missing WebSocket guard
  was repaired before acceptance. No personal screen, session or media captured.
- Chromium recorder/feedback16/16 and adjacent unit105/105 passed. The final
  feedback matrix adds the history/jump regression: Chromium10/10; WebKit9/10
  initially, then the one failing setup case passed after replacing unsupported
  mobile-WebKit wheel input with synthetic scroll intent/positioning. This is
  browser geometry, not a physical iPhone keyboard or swipe acceptance.
-1440/390, dark/light;360 constrained-height500 at root text100/125/150%, reduced
  motion; Playwright touchscreen short taps; latest feedback, timeout,
  draft retention, zero microphone/camera acquisition and no recording state.
- Existing hold/cancel/pending-acquisition/pause/send ownership scenarios pass;
  no permission, capture or upload implementation was changed.
- Typecheck passes. Actual production build: sw.js b0b3125f0f9cf9fe,
  built in13.26s. Existing sourcemap/mixed-import/chunk-size warnings remain.
- Impeccable context permits scoped existing-design work. Detector reports only
  three unchanged reply/edit/forward accent-border warnings outside this fix.
  No new components, packages or external design generators were needed.
- Independent source review has no remaining actionable P1/P2 after the test
  isolation fix and jump-space delta.

## Release Boundary

Preflight: single healthy d05815aeb31234bc40b9c7b7e5bcb441dc374114 web image;
old mode copy present/new floating marker absent; public/container JS and SW
bytes match. Previous image and immutable entry are the rollback target.

Candidate publication and post-state readback are still required at this
checkpoint. Android Stable0.1.21/build22 embeds its older web bundle; it does not
receive this change just because the web is deployed. No new APK, Windows or
iOS native package and no physical-device acceptance is claimed here.

## Next

Item87 remains unmeasured for current-client latency: no new cache patch is
justified without an episode tied to platform/build/action and history-vs-media
delay. Do not repeat accepted warm-cache or recovery tests. Next bounded
implementation planning: item77 account-synced topic notification overrides,
including trusted server consumers, not a frontend-only toggle. Item18's broad
microinteraction work and D-335 OEM/lock matrix remain open.
