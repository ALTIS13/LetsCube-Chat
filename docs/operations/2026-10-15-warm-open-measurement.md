# Warm-Open Fixture Measurement, 2026-10-15

## Status And Scope

Four requested strata pass; parent verified the four retained receipts and their
exact source SHA256. Final independent source review accepted the held delta
without remaining P1/P2. Item87 remains
OPEN: this does not reproduce Nikita's device/VPN latency or establish its cause.

Only a new test and its project-selection config are introduced. No product
cache, SDK, DB, provider, native artifact or production configuration changes.
The already accepted D-360/D-362 web release remains main/runtime `c9f86afb`.

The measured working tree is feature source `7a81653c`, plus documentation-only
`dba07163` and the preserved unowned SidebarHeader input. It is NOT an immutable
production build or installed Android/Windows/PWA artifact. The source file
`tests/e2e/chat-warm-open-measurement.spec.ts` has SHA256:

`6226da2584e13cafc7dcc445a0039f734891eb53ce8de8c5a3eac41645ecb9d2`.

## Reused Mechanisms

The probe reuses the real application, existing messageActionsFixture fake
backend, local RealtimeFixture and a layout sampler. It owns a strict loopback
Vite server with dotenv/client-env inheritance disabled and explicit fake public
configuration. HTTP and socket guards fail closed; known Vite dev sockets remain
closed and are counted separately. No personal session, real backend, screenshots,
traces, video, page snapshots or paid device minutes are involved.

Two fictional ordinary groups contain known members,48 text rows and one tiny
synthetic image in A, plus one previously unverified row in B. The application
primes its actual caches; the test does not seed hidden-ID trust manually.
Returned hide ping and actual live/cache predicates are positive controls.
The B privacy response is held and its row must stay absent until release.

On A-to-B-to-A reopening, independent history/media gates stay pending while
retained text is sampled. Unknown operations still refuse; unrelated empty
relations and startup/read-receipt RPCs have explicit source-grounded fake
contracts, not generic successful answers to arbitrary requests.

## Four Separate Results

| Viewport / Theme | First Sampled Visible Text After Intent (ms) | Later Retention Sample From Reset (ms) | Result |
| --- | --- | --- | --- |
| 1440x900 light | 95.8 | 728.6 | PASS |
| 1440x900 dark | 156.9 | 781.9 | PASS |
| 390x844 light | 102.8 | 777.2 | PASS |
| 390x844 dark | 102.8 | 755.5 | PASS |

Every stratum has49 total rows/48 retained text rows, visible text and no duplicate
while both gates are pending. The image is not ready then, and becomes ready after
release/reconciliation. Warm requests: history1, hidden0, membership0, signing0,
media1, variants1; other12 on desktop and15 at the narrow viewport. Final unknown
HTTP/sockets0, pending gates0, browser errors0; two owned dev sockets closed.

First1440/light passed alone, then only the remaining three ran on identical spec
bytes. It was not rerun as part of the later selection. Earlier failed fixture
gates are retained separately, not added to the four passing results. A shell
filter quoting failure launched no test; the later inverse filter selected three.
Visibility, request/socket and mock-contract literal controls were reused rather
than repeating accepted product suites.

## Interpretation Limits

The first metric is a sampled late-layout opportunity with sampler overhead,
not physical paint, pure React cost or a production benchmark. The later sample
proves retention after background-gate entry, not first-visible latency. One
sample per stratum is not a distribution, p95 or an SLA. The narrow strata still
use the desktop Chromium persona with a smaller viewport, not device emulation.

The image is deliberately uncached; signing0 reflects this fixture's public
media mode. No real media-cache hit rate, signing latency, deployed signing-mode
parity, DB-broadcast delivery or native-stream timing is established. Continuous
fixture trust is necessary for the zero hidden/membership reads; losing trust
must still trigger authoritative verification.

## Running The Probe

This file owns its server; do not point it at a production-config dev server.
Project selection prevents multiplying the same internal four-strata flow across
the other generic projects. The standalone-iOS project already excludes it by
its own testMatch. A config-only integration change needs collection proof, not
another unchanged four-run browser pass.
Actual collection-only verification exits0 and lists exactly4 tests in1 file,
all under chromium-desktop-1440, with no browser/server launch. The passing spec
bytes remain unchanged after that config-only integration.

```powershell
$env:KUB_QA_ALLOW_MUTATIONS = '0'
$env:KUB_QA_WARM_BOOT_DIAG = '0'
$run = Join-Path $env:TEMP ('letscube-warm-' + [guid]::NewGuid())
pnpm.cmd exec playwright test tests/e2e/chat-warm-open-measurement.spec.ts --project=chromium-desktop-1440 --grep="per-open" --workers=1 --reporter=line --max-failures=1 --global-timeout=120000 --output "$run"
```

## Follow-Up Accepted

The later changed-input loss/rejoin/revival case passes1/1. It is appended
separately; this accepted baseline prefix remains byte-identical. Collection
now lists5 primary-Chromium cases (warm4 plus recovery1), not a replay of warm4.
The subsequent D-363/D-364 source repairs and shared-web5828284e acceptance
are recorded separately; the historical timings above still describe their
original source, not a benchmark of that newer release. Reuse D-362 body/SDK
evidence; route-response release is not native body EOF. No new cache framework
or owner VPN/routing change was introduced.
[Recovery, repairs and actual release](2026-10-15-network-revival-measurement.md).
