# Network Revival Fixture, 2026-10-15

## Stage

Coordinator-owned continuation of item87 after the accepted four warm-open
strata. The changed-input recovery case passes1/1. Two independent cross-gap
source failures are reproduced and repaired; independent review finds no P1/P2.
The affected165/165 log and stable source pins were independently inspected;
the reviewer did not rerun accepted tests. Narrow rollout is next.
Shared-web main/runtime5828284e is accepted16:32UTC; actual evidence is below.

## Acceptance

Use the existing isolated full-application fixture, installed SDK and local
RealtimeFixture. Start with the real hidden-channel returned ping and verified
history. Hold a finite REST read before headers, lose the fixture socket, and
observe actual loss of trust. Restore the fake service and raise the browser's
online signal through useConnectionRevival, not its internal completion event.

The held old-route read must fail, a replacement must complete, the channels
must rejoin and privacy must be checked again. Keep approved retained history
where allowed; withhold an unknown row until its authoritative hidden-ID check
finishes, remove rows hidden during the gap, and reconcile without duplicates
or a page reload. Unknown HTTP/socket operations must remain zero.

## Boundaries

- QA0, loopback-only fake configuration, no dotenv or personal session, no live
  backend, screenshots, video, traces or personal-content output.
- A held Playwright route is a preheader/provider wait, not partial native
  response-body EOF. Reuse the already accepted D-362 native-body evidence.
- Reuse the four accepted warm strata. This is a changed network input, not a
  reason to repeat unchanged timing, media/player, native or production checks.
- Source/layout fixture results do not establish physical OEM, VPN, installed
  PWA or APK behavior, a latency SLA, or the cause of the tester's report.

## Two Reproduced Cross-Gap Failures

D-363: the real message hook accepts an old empty hidden-ID response after a
loss/rejoin, even though that response does not establish reusable live trust.
An unknown REST row can therefore enter the projection before its current
privacy check. One no-gap control passes and the gap case fails against the
original source. A hidden-channel read-generation ticket now guards both the
batched helper and each consumer after its await. This also covers the
helper-to-caller microtask boundary; constant-valid and omitted-consumer guards
are separately killed. Lost/joined periods clear retained-ID trust even within
one clock tick. Continuous trusted reuse remains synchronous and unchanged.

D-364: a post-gap clear-mark lookup coalesces with an old pending request, or an
old membership-list read reseeds its pre-gap mark. Connection generations retire
those reads to unknown without retrying an obsolete owner's loader. Old
completion cannot erase a newer same-key pending promise. Per-chat clear keeps
its existing retry/coalescing behavior; deliberately reusable COMPLETED answers
younger than3000ms remain reusable. This is not immediate offline revocation.

Cache evidence:7 RED/6 controls, then30/30 including8 omissions and6 existing
cache cases. Final affected hook/helper/account selection165/165 includes the
new15 tests. These are two separate invocations, not an aggregate195-test run.
Initial broader selection exposed stale VM environment/lifetime stubs and old
serial-batch/now-redundant mutation anchors; they were repaired without changing
the underlying ownership assertions. The first failures are not called product
regressions or silently omitted. No backend/schema/SDK/framework change.

## Actual Recovery Result

Exactly one new case runs under chromium-desktop-1440 at1440x900/dark. It uses
the existing safe server and accepted fixture prefix, not a second cache or
transport. First actual run reached all behavior gates, then failed its navigation
oracle because Playwright counts A/B/A SPA transitions as framenavigated events.
The same document/timeOrigin and49 duplicate-free rows already passed. The
counter was calibrated against those known transitions and checkpointed before
loss; the corrected run passes1/1 in13.6s. No product patch was made for that
test-oracle failure, and the accepted warm4 were not replayed.

Actual result: aged preheader GET cut as network-change by the real hook;
three channel categories rejoin and a new hides ping returns; fresh own-membership
list plus direct mark read; new REST row withheld in sampled frames and DOM
observer until the hidden gate releases; missed hidden row removed,49 allowed
rows present without duplicates, same document/no new navigation; pending0,
unknown HTTP0/WS0, page errors0. Recovery history3/hidden4/membership2 are
observed counts, not a promised single request. Two intentional dark-phase
read refusals may legitimately clear the old view; retention is proved before
loss under a pending background read, not across an explicit boundary refusal.

The automatic error-context file from the failed oracle contains only error
stack/source: installed Playwright1.59.1 skips its page ariaSnapshot when
PLAYWRIGHT_NO_COPY_PROMPT is set. Screenshot/trace/video stay off. Neither a
personal page nor a page snapshot was captured.

The aged GET browser case does not reproduce the younger A/B completion order
or prove physical VPN/device latency. Their source regressions and the mounted
recovery chain are complementary evidence. Item87 remains open.

Run only the recovery case for a changed input; it owns its safe server:

```powershell
$env:KUB_QA_ALLOW_MUTATIONS = '0'
$env:KUB_QA_WARM_BOOT_DIAG = '0'
$env:PLAYWRIGHT_NO_COPY_PROMPT = '1'
pnpm.cmd exec playwright test tests/e2e/chat-warm-open-measurement.spec.ts --project=chromium-desktop-1440 --grep=recovery- --workers=1 --reporter=line --max-failures=1 --global-timeout=120000
```

## Main Candidate Validation

Nine owned files are mechanically integrated into the narrow main-based tree;
the unowned sidebar/search paths and private Android overlay are excluded.
Initial real typecheck finds TS2454 for the promise self-reference in the new
cache cleanup. A definite-assignment type annotation fixes the diagnostic;
actual TypeScript before/after transpilation produces byte-identical JavaScript
(SHA2560e91b370a7cd007953bd11e28f0fcdc782633658266cbfd007d6fc67fbae5e4e).
The accepted behavioral runs remain applicable rather than being replayed for
an erased annotation. Final main typecheck exits0.

Real Vite build emits sw.js build06f96f278cadb6da, built in10.76s and entry
index-Ca4yDOEf.js. Existing sourcemap, mixed-import and chunk-size warnings remain.
No API-server, native artifact or unchanged-suite build was requested.

## Actual Shared-Web Release

Main5828284ec92a0fdea4a0362e934503d4daef0267 contains exactly9 owned files.
The complete outgoing range was read separately;29 aliases and1 relative import
resolve in its own tree. Source/test bytes match the feature checkpointb0e9f030;
the fixture/register/status changes stay on the feature branch. No unowned
sidebar/search, Android overlay or unfinished native-preview source shipped.

Actual before16:17:00UTC: c9f86afb healthy, old/new hidden consumer1/0 and
public/container JS+SW match. One early target acceptance check refused while
the old image was still active; it was not retried as success or overwritten.
Coolify webhook rick9i0jl1ht5tprxflose4c finished16:31:54UTC. No manual service,
network or DNS change was made to hurry the deployment.

Actual after16:31:57UTC: healthy container ea30ae867626, exact5828284e image tag,
image ID sha256:8894bbe3497d07733d6822f54ae9f71b6c59113b3ef7c7a13b6a10926dae7ace.
Compiled old/new hidden consumer0/1,9 captureRead consumers, hidden generation
class1 and clear-mark connection generation class1. Markers are calibrated
against actual old production bytes, actual new source and the local built JS.

Public /assets/index-i73qlLi6.js SHA256
194035b041fd0397a7c7678a60bbcba37e1a55dbbafdc31cdea4e8dda274ac78 and sw.js SHA256
33608d5acdba75c87ea5e10526a8a7537ad6f4cd3071f7dfe24c1088695a6784 match container
bytes. Previous c9f86afb image and entry remain present and byte-identical for
rollback. Local and public bundle hashes differ with their public configuration;
no local build ID was treated as the production expectation.

Fresh anonymous Chromium home -> login smoke16:32:09UTC loads the accepted entry:
page errors0, mutation attempts0, personal sessions/captures0. No real authenticated
chat send, SQL, installed PWA, OEM/device or native artifact acceptance is implied.

## Next Action

Finish the bounded semantic media intake for Nikita, then measure the reported
opening delay on an identified current client. Android embeds its web bundle and
needs a separate current-source candidate plus affected Realme QA before release.
Do not replay the accepted warm/recovery/body/player stages or deferred native
preview parser attempts without a changed input. Item87 stays open.
