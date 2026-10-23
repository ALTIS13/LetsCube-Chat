# Offline received history integration

Owner: Codex coordinator. Stage: source/browser acceptance; native candidate
preparation, NOT released. Baseline: `7ef703b9`.
Source: owner's2026-10-23 request requires actual offline viewing, not just a
conditional-network cache. Notification wiring is an independent worker scope.

## Rulings

- The fresh-admission-only SQL prototype cannot provide cold offline history.
  Mount a separate local snapshot of the ordinary, privacy-filtered read first.
  The SQL bandwidth optimization remains separately gated; no SQL is needed for
  this integration and its full-schema gate is not waived.
- Local snapshots are last-known display data, never fresh authorization. Scope
  by backend, user and session. Reconnection uses the ordinary RLS-controlled
  reads; a clear/hide/access change retires local data. An offline device cannot
  learn remote revocation until it reconnects. Server operations remain gated.
- Persist an allowlisted display projection only: no credentials, session tokens,
  email/phone, signed URLs, raw bot markup or arbitrary profile fields. Keep
  outgoing retries separate. Restore never writes a read receipt or merges stale
  disk rows into a fresh server answer.
- Reuse the existing transaction-complete IndexedDB storage, integrity hashing,
  durable generations and bounds. Reads/writes are optional and nonblocking for
  the network path. Failure/quota denial means no durable-cache claim.
- Initial budget remains8MiB/10 snapshot scopes/seven days. This is bounded local
  history, not an assertion of unlimited retention or downloaded media binaries.
  Previously viewed attachments still need an independently verified binary cache
  before their offline availability may be claimed.

## Acceptance

- [x] Snapshot projection/integrity, actual Chromium/WebKit disk cold restore,
  retirement, held writer, account/session/backend separation and corruption.
- [x] Actual auth/list/history consumer mounts: cold offline, loaded history,
  reconnect changed/deleted rows, empty/refused answer, no stale overwrite.
- [x] Clear/logout/account switch and privacy events retire persisted data.
- [x] Notification setting/provider/UI source audit and regression tests; prior
  actual device acceptance reused. Fresh Oct23 Realme card/tap is NOT RUN.
- [ ] Review, shared/native builds, runtime checks, then immutable release and
  exact running-image/public-artifact verification. No source-only release claim.

Reference: browser storage can be evicted and writes can fail with quota errors;
the application must retain a working network path rather than rely on disk
success ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)).
Supabase getSession may refresh a stored session; cached display must not await
that network operation or pretend it is proof of current authorization
([Supabase](https://supabase.com/docs/reference/javascript/auth-getsession)).

## Current evidence

- Initial offline service missing:6/6 RED; projected cold display and isolation
  subsequently GREEN. Actual Chromium/WebKit IndexedDB two-document checks pass.
- Independent review found partial reply embeds, wrong-topic snapshots, explicit
  permission refusal, sidebar retirement and overlapping persistence. Reply and
  topic cases were reproduced RED and repaired; final-digest retirement and
  write-order races likewise RED/GREEN. Current pure cohort11/11.
- Actual full application Chromium desktop/mobile and WebKit mobile restore a
  list/history after a503 cold reload, replace edited messages after reconnect,
  retire refused history and clear it through the real UI. A plain HTTP403 without
  PostgREST code was RED, then GREEN after checking the HTTP status as well.
- Final storage/service cohort95/95, affected hook/auth cohort247/247 and
  typecheck pass. Actual prefix retirement preserves sibling/foreign scopes and
  fences held writes. Guest-only status pixels1440/390 in both themes inspected.
- Built fixture `cec3df2a8d41dbf9` passes a real HTTP/service-worker cold browser
  process restart with zero offline HTTP calls, edited-history reconciliation,
  expired-token offline display and a real SDK refresh after reconnect.
  `tests/server/offline-pwa-runtime.mjs` takes an explicit synthetic build path;
  no production configuration, route mocks, signed-in captures or credentials.
- Two test transport traps were isolated, not patched into the product: a service
  worker bypasses Playwright API route mocks; conversely any Chromium request
  routing disables its HTTP cache and changes static requests to cache:reload.
  The consumer fixture blocks workers; the built-PWA fixture instead uses real
  loopback HTTP and a restrictive outbound CSP, preserving actual cache semantics.
- Browser-plugin skill is not installed; existing repository Playwright is used.
  Signed-in fixture captures/traces/video remain off. Only guest component
  fixtures may produce visual captures.
- A063 and Realme both attached on2026-10-23; A063 actual installed version is
 0.1.34/build35. Realme belongs to the independent readable-notification canary.
- Notification source audit finds UI preference/server/native/iPhone paths wired;
  focused smoke6/6. Oct23 Realme canary stopped before login or preferences because
  the phone was locked and the active account was not confirmed as owned QA.
  No new readable-card/tap or all-platform runtime claim follows.

## Remaining boundaries

- Build/sign/check the legitimate0.1.35/build36 release using original custody;
  install without data clear and prove actual native cold offline/reconnect.
- Publish only after those gates, retain rollback35 and mandatory=false; verify
  full public APK bytes and exact shared web container/build parity.
- Offline display is last-known, bounded8MiB/ten scopes/seven days, up to1000
  rows per chat/topic snapshot. It is not unlimited history or fresh authorization.
  Media slots/reply text survive, but binary attachments, signed media URLs,
  decorations, contact details and elevated roles are not persisted here.
- Conditional SQL bandwidth optimization still needs its own full-schema/HTTP
  and production migration gates. It is not required for the local display path.

## REA method

Freshly checked [REA](https://rea.tools/) and
[REA-Prompts](https://github.com/JoasASantos/REA-Prompts) on2026-10-23. REA's
setup entry is `npx rea-agents@latest setup`; it is not currently callable as
an MCP engine here. No engine installation is needed for the present public
source/SDK and owned-app debugging. Reuse the feature-tracing method: identify
UI entry, state owner, persistence/transport, observable failure and a controlled
negative test. Do not copy proprietary assets/code, inspect other people's
accounts, bypass protections or treat a prompt as runtime proof. Consider a
separate bounded engine setup only when an actual binary-tracing gap needs it.
