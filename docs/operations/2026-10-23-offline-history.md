# Offline received history integration

Owner: Codex coordinator. Stage: RELEASED after actual A063 refusal of native36
and the corrected native37 acceptance. Product `80d0584d`; Android Stable0.1.36/
build37, mandatory=false, rollback35 retained. Candidate36 was never published.
Initial baseline: `7ef703b9`; correction base: `82db2d49`.
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
- [x] Review, shared/native builds, runtime checks, then immutable release and
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

- Private binary-media offline cache is the next separate implementation slice.
- Offline display is last-known, bounded8MiB/ten scopes/seven days, up to1000
  rows per chat/topic snapshot. It is not unlimited history or fresh authorization.
  Media slots/reply text survive, but binary attachments, signed media URLs,
  decorations, contact details and elevated roles are not persisted here.
- Conditional SQL bandwidth optimization still needs its own full-schema/HTTP
  and production migration gates. It is not required for the local display path.
- Inspect ordinary online reply previews outside the loaded window: actual
  self-join arrays are now safe in local snapshots, while the ordinary renderer
  commonly resolves parents from its loaded message map. No outside-window
  renderer defect or server relationship direction is asserted without that case.

## Release evidence

- Build36: `sw.js build 6ec74a5734973e8f`, `built in11.38s`, Gradle25s. Original
  sole signer/APKv2, four exact Firebase values, false QA flags,42-file web and
  native DEX/config parity pass. APK7,823,325B SHA256
  `6a997f987c4de9a278eec38086c11dc342f260252501575242488614092272af`.
- Realme35->36 guest/startup/fatal0 and UID/data/firstInstall pass20:19:59Z.
  A06335->36 manual in-place install and full installed APK hash pass20:22:13Z;
  UID/data/firstInstall retained. These are not cold-cache or FCM proofs.
- Shared-web sole-healthy image82db2d49/build `8ec79ab9995b9cf3`, public/container
  HTML/JS/SW parity and bidirectional source/runtime cache mount markers pass
  at20:25:52Z. Earlier hidden-history actions remain in the served bundle.
  Shared PWA/Windows renderer receive this release; no new Windows or native
  Apple binary is claimed. Windows shell0.2.14 remains deliberately unsigned.

## Actual Native Refusal And Corrections

Candidate36 remains unpublished. A063 renders100 received rows, but actual IDB
contains only the owner/profile records. Crypto/IDB and exact release source are
verified; no message bodies, identifiers or captures are retained in receipts.
The source/browser synthetic shape did not establish real projection acceptance.

- Short `fetchChatBots` records intentionally omit timestamps. Two real sidebar
  bots fail the previous full-timestamp projection and disable the complete list
  snapshot. Exact BotLike input is RED, then GREEN with optional display dates;
  no timestamp is invented.
- Actual self-join replies are arrays:90 empty and10 singleton among the sampled
  100 received rows. The prior object-only projector rejects the whole page.
  Empty/singleton normalization is RED/GREEN; only the exact parent FK may yield
  a quote. Ambiguous/malformed embeds leave the message/parent slot intact without
  exposing an unrelated quote.
- A historical clear mark on initial list hydration purges old disk pages, but
  its own notification was also scrubbing the freshly checked list and disabling
  persistence. Two actual-hook regressions are RED; the fix distinguishes only
  its exact synchronous own purge while preserving external retirement/fetch
  generation fences. Mounted43/43 and three new omission controls pass.
- The combined real-shape fixture (short bot, historical clear, reply array)
  restores offline and reconciles/denies/clears in Chromium1440/390 and
  WebKit390:3/3. Codec/actual IDB15/15 and final typecheck pass. Independent delta
  review approves source only; native37 cold/offline/reconnect is still required.
- Retained private probes are purpose-specific. Early unpopulated-chat selection
  and diagnostic-format problems are not product bugs or accepted runtime tests.
  All temporary test packages were removed; no phone/PC VPN configuration changed.

## Corrected Release37

Final affected58/58, real-shape consumer3/3, typecheck/diff and independent review
pass. Built fixture `d7a5a761d31b5ba8` passes cold browser/expired-token offline and
SDK reconnect. Native source80d0584d reports build `0d50b204ac7d2bf0`, Vite11.34s
and Gradle10s. Original signer/APKv2, four exact Firebase values, false QA flags,
web/config/DEX parity pass. APK7,823,533B SHA256
`0fa72bcfd41dd39618419dde402267923e24f93a6a881a765deb11a37ac26c3d`.

Realme36->37 guest/fatal0 and data identities pass21:13:33Z. A06336->37 manual
upgrade/full installed APK/UID/data/firstInstall pass21:14:41Z. Actual37 warm
normal chat100 rendered +100 durable rows pass21:15:12Z. Fresh instrumentation
process with WiFi/data disabled restores100, shows last-known status while native
connectivity is false, then ordinary connection recovery removes that status,
revalidates and persists a newer snapshot. The list remains usable. Exact source/
signer/data guards, diagnostic removal, normal return and original network
settings pass21:16:34Z. No personal captures/values or VPN profile changes.

Stable37 publication/full public APK hash and rollback35 pass21:17:18Z,
mandatory=false. Shared sole-healthy80d0584d/build `feb80ecef14bab62`, public/container
HTML/JS/SW parity and mounted-history markers pass21:15:51Z. Windows remote
renderer and iPhone PWA receive the shared change; new Windows/native Apple
binaries or new physical iPhone/FCM delivery are not claimed. SQL unchanged.

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
