# Priority Intake Reconciliation, 2026-10-28

Owner: independent bounded Task2 worker; coordinator owns Android updater/OEM,
release integration and deployment. Original worker stage: SOURCE_ONLY_READY,
not a device acceptance. Canonical source started clean at `a6a086e4`.

Coordinator rollout: this slice is included in AndroidStable0.1.43/build44 and
shared-web`f56c4e7f`/build`9e1a29680bf352c5`, accepted19:36Z by sole healthy image,
public/container hashes and old/new close-guard controls. That establishes shipped
source, not a new physical OS notification test or closure of all#85.
[Combined release and limits](2026-10-28-android-oem-updater.md).

## Reuse And Remaining Boundaries

Only tracked technical intake and retained ignored technical reconciliation were
read. No conversation fetch, extraction, ASR/OCR, personal media, credentials,
devices, Auth, DB, remote calls, commit, push or deployment.

| Item | Accepted evidence reused | Remaining disposition |
| --- | --- | --- |
| Task2 / #2, #52, #53 | D357--364 synchronization, D367 FIFO/discard, D369/370 recovery, later received-history/media cache repairs. Current HANDOVER records Stable43's actual cold received-history/original/gallery acceptance. | This proves those bounded cases, not all unidentified tester symptoms. The retained nine-item intake maps to #2/#87 and only provisionally #52; it does not justify another extraction or a generic cache rewrite. Current updater/OEM work remains coordinator-owned. |
| #79 / D340 | Actual compact-emoji measurement found no forced jumbo at390/1440, both themes, with text-size controls and a calibrated jumbo subject. | Exact tester artifact/preference remains unknown. No sizing patch or redesign is justified. |
| #83 / D343 | Confirmed outbox ACK cue is implemented/released; settings, DND, account/chat/topic, capture and delayed-resume guards already have targeted evidence. | Installed-client audibility is separate. Do not repeat implementation or treat this as incoming-delivery repair. |
| #84 / D348 | D350 repaired stale capture/recording ownership without keeping the microphone open. | Repeated system permission versus app prompt, platform/build and exact gesture are still unidentified. No stream-retention workaround. |
| #85 / D349 | D351 read ownership/horizon and D353 pending native exact-pair reconciliation are accepted. | In-app versus OS presentation and the original tester client remain unknown. The small current browser race below is independently reproduced; it does not close the whole complaint. |
| #86 | D354 task refresh/draft preservation and later missed-update reconnect have accepted source/web evidence. | No new initiating operation, automatic/manual reload or client is established by the intake. Do not reopen the same fix. |
| #87 | Warm-photo candidate was GREEN_NO_SOURCE_PATCH; later bounded cold history/media repairs and Stable43 physical case are accepted. | General UI latency and the tester's exact phase/build remain unknown. One passing cold fixture is not universal closure. |

Sources: [Task2 plan](../superpowers/plans/2026-10-18-production-completion.md),
[queue](../PRODUCTION_PRIORITY_TRACKER.md),
[Oct4 intake](2026-10-04-tester-feedback.md),
[Oct7 intake](2026-10-07-tester-feedback.md),
[retained-media limits](2026-10-15-intake-followup.md),
[send cue](2026-10-05-send-sound-web-rollout.md),
[read/record ownership](2026-10-07-read-recording-ownership.md),
[Stable43 cold-media scope](2026-10-28-android-cold-media-release.md).
Ignored technical reconciliation reused: primary
`.ops-private/nikita-intake-20261018/reconciliation.md` and the sanitized Oct7
accepted-report record. No raw bodies or personal media were inspected/reported.

## One Reproduced Remaining Source Defect

The browser notification effect checks that a read card has no unread same-tag
replacement, then calls `closeBrowserNotification`. That helper awaits
`navigator.serviceWorker.ready` and previously posted a blanket tag-close command
without rechecking. A newer unread row or owner retirement during that wait could
therefore dispatch stale cleanup. This is a current #85-related read/presentation
boundary failure, not a claimed cause of the original tester report.

The repair adds an optional currentness predicate to the helper and rechecks it
after readiness, immediately before postMessage. The sole hook call-site checks
the captured read owner and latest admitted feed rows, not the render-lagged tag
map. Thus an unread arrival is protected even before its next UI paint. Other
chat tags and fully confirmed reads still close normally. Read RPCs, confirmed
horizons, feed authority and native/desktop cleanup protocols are unchanged.

Changed source/test only:

- [browser close helper](../../artifacts/kub/src/lib/browserNotificationPresentation.ts)
- [notification hook call-site](../../artifacts/kub/src/hooks/useNotifications.ts)
- [focused regression](../../tests/unit/browser-notification-close-race.test.mjs)

## Verification

The new test executes the actual TypeScript-extracted presentation effect and the
actual close helper. Feed rows, React paint timing, owner retirement and the worker
readiness Promise are synthetic controlled boundaries, not copied policy output.
Baseline:3 positive controls PASS /2 behavioral RED (new unread and retired owner).
Final:8/8 focused cases, including compiled omission of post-ready and owner guards
and replacement with a render-lagged map. The latter mutant needs the confirmed-
read positive oracle: its stale map vetoes the initial cleanup; its first survivor
was a test-oracle mismatch, not an additional product result.

```powershell
$env:KUB_QA_ALLOW_MUTATIONS='0'
node --test tests/unit/browser-notification-close-race.test.mjs tests/unit/notification-read-sync.test.mjs tests/unit/notification-read-ownership.test.mjs tests/unit/notification-read-realtime.test.mjs tests/unit/notification-read-update-marker.test.mjs
pnpm.cmd --filter @workspace/kub run typecheck
git diff --check
```

Focused plus affected read/ownership/marker tests: **78/78 PASS**, zero skips.
Frontend typecheck:PASS/exit0; `git diff --check`:PASS; all11 local document links
resolve. No rendered layout or visual styles changed. No production configuration/network is used by
these unit fixtures; no screenshots, traces, video or real notifications.

## Handoff Limits

This slice fences the pending pre-dispatch close only. It cannot cancel an already
dispatched worker command and does not claim service-worker queue atomicity, OS
notification acceptance, physical device behavior or a shipped bundle. No worker
protocol/template or Android updater/platform/native/version file was edited.
Coordinator may review/integrate this small independent slice; no unrelated
backlog item or new defect ID is invented or marked closed here.
