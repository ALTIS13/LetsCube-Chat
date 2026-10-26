# Production Completion Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or bounded
> superpowers:subagent-driven-development. Track the checkboxes below; an approved
> continuation is not a request to restart completed design or acceptance.

**Goal:** Close the agreed LETSCUBE functionality, reliability, interface and
platform backlog with production evidence and no loss of user data.

**Architecture:** Preserve the shared React client, Tauri/Capacitor shells,
self-hosted Supabase, worker, Bot Gateway and LiveKit. Deliver independently
reviewable slices through existing contracts; source tests, actual service wire,
provider/device acceptance and production rollout are separate evidence layers.

**Tech Stack:** TypeScript/React, PostgreSQL17/RLS, PostgREST, Supabase Realtime,
IndexedDB, Web Push/FCM/WNS, Tauri, Capacitor, LiveKit, Coolify.

**Spec:** [owner requirements and queue](../../PRODUCTION_PRIORITY_TRACKER.md),
[current checkpoint](../../HANDOVER.md),
[working lessons](../../operations/working-lessons.md),
[reference mechanics](../../operations/reference-clients.md).
Existing subsystem plans remain authoritative for their exact API/test contracts;
this document coordinates their remaining deliverables, not a replacement design.

## Global Constraints

- Owner on2026-10-18 authorizes implementation, reviewed production rollout and
  necessary migrations throughout this plan without another approval round.
- A migration still requires verified backup, one transaction, raising self-check,
  exact rollback and byte-identical `.migration-backup` copy (CLAUDE.md section10).
- Keep RLS and account/session/privacy fences; never expose secrets or personal
  content. QA screenshots/traces/video stay off when signed in; browser tests use
  `KUB_QA_ALLOW_MUTATIONS=0`. Synthetic owned QA mutations require exact cleanup.
- Realme and bounded paid iPhone/Android rentals are authorized. Latest direct
  owner authority on2026-10-20 also includes A063/ADB for implementation/QA,
  including the reported VPN failure,
  superseding the old Apollo exclusion. Preserve PC Happ/routing and personal
  content. Allocate a rental only for a prepared finite checklist;
  release it in cleanup. Do not install over a release for incidental QA.
- Windows EXE remains unsigned by the owner's explicit decision. Do not change
  Publisher/PFN/MSIX identity or submit to stores. Native Apple release ownership
  remains separate; coordinate changed shared contracts, not acknowledgements.
- Preserve liquid-glass design and actual Telegram/Discord mechanics, not labels
  applied to different behavior. Check reusable modules and licence obligations
  before new infrastructure. No global Java/PATH/routing/Happ changes.
- At most three bounded workers, disjoint write scopes, no recursive delegation.
- Before push inspect `origin/main..HEAD` separately and resolve imports against
  each commit's tree. Main pushes deploy; verify exact image and public/content
  parity. Published artifacts are immutable; current Stable38 and rollback37 are
  retained. Use the next version/build for new embedded-client code.

## Review Focus

1. Cold restore, owner change and concurrent send/discard must preserve FIFO,
   idempotency and account isolation (Task2; retain D-367 negative controls).
2. Parent/child notification decisions, old clients and rollback must not leak or
   revive alerts; a foreign read must fail while an own read reconciles (Task1).
3. Keyboard, safe-area, compact containers and enlarged text must not hide actions
   or introduce double insets (Tasks8/10; exact element at1440/390, both themes).
4. Media permission/source changes must revoke derived access without destroying
   originals or breaking durable retries (Tasks3/5).
5. Slow/offline/reconnected/background clients must recover without reload,
   duplicate effects or misleading delivery/read state (Tasks2/7/10).

## Accepted Baseline (Reuse)

- [x] D389 hidden raw-page cursor plus empty/short load action is released at
  `c3bcbb30` on shared web/buildb8e796727de22a2d and Stable0.1.34/build35.
  Hook281/storage80/cache30, mounted12 including Enter, anchor7, guest pixels16
  and final review pass. Native original signer/Firebase/parity, Realme34->35
  retention and full public APK hash pass; mandatory=false, rollback34 retained.
  Full actual A06334->35 in-app updater/post main/data/hash/cleanup pass separately.
  Wider OEM/call/draft/lifecycle remain open. Disk cache foundation
  is NOT mounted; SQL is NOT installed. [Repair and limits](../../operations/2026-10-21-hidden-history-pagination.md).

- [x] D384 bridge/finalization source3a73975f is Stable0.1.33/build34:87/87 and
  review, original signer/Firebase/assets, Realme33 ->34 guest, A06332 ->34 manual
  data-retaining bootstrap and actual signed-in main/exact entry/native bridge/
  catalog-current. Full public APK hash/rollback33 and healthy shared-web parity
  pass; old in-app32 ->33 stays REFUSED, later full34->35 is accepted above.
  [Release and limits](../../operations/2026-10-21-android-update-bridge-thread.md).

- [x] D388/source `b50dda0f` released on shared web/build `affacc90ed0418d6`
  and Android Stable0.1.32/build33. Final affected155/155/review, signer/Firebase/
  assets, Realme32 ->33 data retention and public APK hash pass; rollback32.
  The actual A063 built-in update case is REFUSED before catalog by a distinct
  native bridge thread bug, subsequently repaired for Native34 above. Do not equate
  the guest ADB upgrade with a successful in-app installation.
  [Current native repair](../../operations/2026-10-21-android-update-bridge-thread.md).

- [x] D383/D385/D386/D387 released at product `d9991760`, shared web/build
  `2b74d0d5f9bac197` and Android Stable0.1.31/build32. Final affected88/88,
  reviewed source, signer/Firebase/assets, Realme31 ->32 data preservation and
  full public APK hash pass. A063's separate bounded adverse-VPN case establishes
  system-wide route failure and automatic same-process list recovery once the
  route returns; it does not close persistent received history or all VPN QA.
  [Physical acceptance and limits](../../operations/2026-10-20-a063-vpn-recovery.md).

- [x] D-377--D-382 connection/cache repairs released on product `1ef85b8f`, sole-
  healthy web/build `9e82c0d67b28ed43` and Android Stable0.1.30/build31. History
  101+4, avatars132, finite signing23+51, fresh Chromium/WebKit32/32 and peer
  reviews pass. Original signer/Firebase/assets, Realme30 ->31 guest/data
  retention, public/container web parity and entire public APK hash pass.
  Mandatory=false; rollback30 retained. No SQL change, physical iPhone latency
  or complete long-session acceptance claimed.
  [Current performance release and remaining costs](../../operations/2026-10-19-connection-performance.md#release).

- [x] Web sender/text, sender-only, none and exact activation on installed iPhone
  PWA; ordinary Android23 FCM/read/tap/logout; owned QA resources retired.
- [x] D-357--D-364 accepted synchronization repairs; D-365 media position ownership.
- [x] D-367 actual Chromium/WebKit IndexedDB FIFO and discard repair;117 affected
  checks; production owned HTTP FIFO; Android24 in-place guest upgrade.
- [x] Android0.1.23/build24 Stable, mandatory=false, original signer/Firebase and
  full public APK hash; web source5af58c2b, image8159c627. Windows shell0.2.14.
- [x] Chat/task recoverya3cfd1f2 released; current image6f41cccc, product web
  build33dfcab91705590b. Android0.1.24/build25 Stable, mandatory=false, original
  signer/Firebase/assets, Realme24 ->25 guest/data retention and public APK hash;
  previous24 rollback retained. Signed-in native recovery remains separate.
- [x] Topic current runtime is OFF after bounded cohort7d511's temporary ON/
  two-message physical canary and actual rollback/readback. Ordinary feed-v2 and
  the scoped provider cases do not close the whole override/history matrix.
- [x] D-368 local ordinary logout released at14686afd/webb23d4adce4f05bb0 and
  Android0.1.25/build26. Actual rendered local exit/other-SID refresh,97 affected
  checks, original signer/Firebase/assets, Realme25 ->26 guest/data retention
  and public APK bytes pass;25 rollback retained. Actual Native26 ordinary UI
  login/binding/logout and peer refresh `0185bbd86af1` pass; other native cases stay
  separate, including the unclaimed post-logout guest frame.
- [x] D369 shared-web repair initially deployed at `8ce5e18c`/build prefix `9b2`
  with public/container parity and local-scope marker2 ->3; retained proof.
- [x] Source `da28afbd795ee1b3499b815d74160502c43fd474` carries D369 and releases
  D370 on sole-healthy web/build `9fd9efb24b98dfb6` with public/nav-marker parity,
  and Stable 0.1.26/build27. Actual Realme26 ->27 retains UID/data/firstInstall,
  guest/fatal0 and full public APK 7,755,887B/SHA prefix01863eb5 pass;
  mandatory=false, rollback26 retained. D369/D370 are FIXED/RELEASED by the bounded
  compositional evidence, including later actual PWA navigation and Native27
  normal cleanup below. No physical503/held-early-phone or all-platform claim.

Evidence: [notifications release](../../operations/2026-10-18-cursor-return-notifications.md)
and [FIFO/Topic continuation](../../operations/2026-10-18-outbox-restore-and-topic-wire.md);
[latest Native27/web release and limits](../../operations/2026-10-18-production-completion.md#navigation-and-d369-release).

## Task1: Finish Topic Notification Acceptance (#75--77,95)

**State:** Topic enforcement is RELEASED/ON at18:55:56Z after fresh verified
backup/CAS/readback. Actual b875 covers three ON provider/OS cases, ordinary v2
history/read and compatible OFF suppression plus retained administrative data.
The original driver remains REFUSED because it wrongly expected OFF to revive a
disabled child. Accepted prior fullstack/current+old clients compose with these
physical cases; no fabricated same-SID final retain/OS4 claim. Exact recovery and
all QA/rental cleanup pass. D356's remaining actions below are still IN PROGRESS.
[Decision, actual rollout and boundaries](../../operations/2026-10-18-production-completion.md#topic-production-enforcement).
**Files:** `tests/server/topic-notification-realtime-client.hook.mjs`, its focused
control tests, existing notification consumer/SQL contracts and private finite
runtime operators. Product files change only after a reproduced failure.
**Interfaces:** Existing `mountRealtimeClientHook`, `createNotificationFeedV2`,
notification decision/read RPCs; current and pinned old client sources.

- [x] Extend actual-hook actions/observability with regression and omission tests,
  without replacing the SDK, parser, read RPC or reconnect with a fake remount.
- [x] Capture fresh schema-only PG17 and numeric Realtime migrations; start a
  bounded internal PG/PostgREST/Realtime clone with fresh QA-only credentials.
  Actual schema/tenant/fresh registration seed boot passes. Core wire995e35c45096
  now passes policy/read/runtime-OFF/reconnect with automatic cold recovery;
  full matrix/provider/OS acceptance remains distinct and unfinished.
- [x] Exercise ordinary JWTs/current+old hooks: parent-muted child-enabled,
  inverse, independent recipient positive, own/foreign/cross-session read,
  retained history, terminal suppression, rollback and same-document reconnect.
  Actual0629b591d65c also covers old Windows, stale CAS and inherit reset;236
  HTTP requests and exact cleanup. Rollback means retained-data runtime-OFF
  compatibility, not reverse DDL, as required by the existing Topic Task6.
- [x] Prove held pre-CAS response retirement and the fence omission negative
  control: actual4463ef50a208 holds three genuine allowed replies until CAS /
  authoritative denial / RT terminal; stale effects stay zero and a new message
  works. Actual3f0e11bd2344 catches a deliberately omitted fence as a real legacy
  alert in a fresh isolated clone with unchanged RLS/policies. Both cleanup pass.
- [x] Couple actual Edge source to real claim/recheck/ACK HTTP and ordinary
  message/album producers: actual52e7f8c9f43c passes12 Web/FCM cases,148HTTP,
  exact cleanup. Actual3e91d807aa72 separately passes3 legacy single-Web cases /
  25HTTP, including genuine lookup-response hold before disable CAS. Only
  provider leaves are controlled; this is not physical/provider acceptance.
- [x] Reconcile fresh-session/expiry proof against accepted unchanged RPC cases:
  actual HTTP48 b7b31942 rejects a still-present JWT after server SID retirement;
  actual PG17 concurrency84294a19 rejects stale epochs and revalidates a retired
  SID after waiting.52 selected current function bodies match the accepted
  canonical/patch composition. SDK token renewal and D-356's held same-UID/new-
  SID action are not established by these cases; the latter remains below.
  No standalone refreshSession gate was required by the Topic plan.
- [x] Actual physical7d511 messages1/2: A muted-parent/enabled-child FCM ACK and
  exact OS chat/message positive; then allowed-parent/disabled-child FCM0 and
  no NEW ordinal2 (stale card1 may remain). B allowed/inherit and muted/enabled
  both Web ACK/OS synthetic body positives. These two cases are accepted only.
- [x] Accept Linnaeus's RO/source diagnosis: A1 legacy SELECT0 is the expected
  enabled-CAS fence; exact outbox JOIN/ACK proves the underlying notification row.
  Public clients use v2 RPCs. The private raw-table read and fake CAS without the
  fence explain its faulty expectation, not a public producer/feed defect/new D.
- [x] Successor v2 oracle13/driver12 and actual b875 physical/read cases accepted;
  retained OFF disabled enforcement is correct. Exact cleanup and fresh guarded
  production ON/readback pass. Keep original historyVerified=false/failure results
  and limits; ordinary final same-SID retain/OS4 was not run. Reuse the accepted
  HTTP/current+old-client/Edge matrix; do not replay a rental for wrong expected allow.
- [x] Bounded 450s controller retains expected failed=true with API/native cleanup
  PASS, all old SIDs/zero gaps. Fresh verified backup/mirrored guarded OFF and
  separate readback at 17:34:30Z preserve schema/catalog. Initial BACKUP refusal is
  NOT_DISPATCHED; exact owned-parent root -> techadmin owner repair is nonrecursive,
  mode0700 unchanged. Both fully decoded archives retained; no SQL guard relaxed.
- [x] Exact subscription cleanup f3c8d49a170b: one inactive/protocol-retired row,
  one PATCH ACK, fresh API local204/SID absent, all old SIDs retained and
  cleanupComplete. PWA semantic none/pushEnabled true is restored; UI logout
  leaves fresh SIDs0/grants0, both rentals released/registry true. No Auth/
  controller/rental held. Reuse 19 old+5 changed private controls; no UID/time sweep.
  Coordinator owns the commit/fix checkpoint; no worker push.
- [x] Rehearse the actual activation operator on isolated PG: c8901ef3d64a passes
  canonical rollback positive, raising guards, COMMIT with deliberately lost ACK,
  separate ON inspect/no replay, ordinary CAS and compatible OFF. All12 tables
  retain their exact post-ON state through OFF; clone cleanup passes. No fifth
  repetition is required; this is not production/provider/device acceptance.
- [ ] For D-356/#95 hold a real bell read/access response across ordinary Auth
  sameUID/SID1 ->SID2 without reload; release it and require no stale continuation
  while a new action works. Cover invite retirement and replaced/manual jumps
  separately. Its source/browser fixes are already in web/Android24.
- [x] Actual held-access76749ab0ab0f: genuine HTTP200 held before consumer;
  ordinary UI local logout/login gives sameUID/newSID in the same document.
  New-SID HTTP/Realtime token and exact second notice route/jump pass. Old reply
  completes unchanged; all7 observable late counters remain zero. Two owned
  messages tombstoned/notices scrubbed/read and all3 fresh SIDs absent. Held
  read/settings/invite/manual-jump/native cases are not inferred from this.
- [x] Record this cohort's final OFF and cleanupComplete; close only the covered
  subcases, not the remaining Topic matrix. A1 legacy0 is diagnosed as expected;
  the private oracle repair is separate from the public product.

## Task2: Nikita Intake and Synchronization (#2,52--53,79,83--87)

**State:** IN PROGRESS; shared-web warm/offline baseline and reproduced redundant
recovery/sanitizer read repair are accepted and released in web/Android25.
Remaining native/intake boundaries are not closed by these cases.
The separate last-known profile/list/received-history snapshot is mounted and
RELEASED at80d0584d on shared web and Stable0.1.36/build37, after real A06336
refusal exposed short-bot/reply-array and clear-retirement contracts. Actual37
persists/restores100 rows in a cold offline process and reconciles on reconnect;
built-PWA cold/expired-token and SDK reconnect pass. Candidate36 was never Stable.
[Current integration](../../operations/2026-10-23-offline-history.md).
The conditional SQL/codec/controller optimization remains NOT enabled; its full
schema/HTTP/fresh metadata gates remain in the
[separate continuation](2026-10-21-received-history-cache.md). Media binary cache
and unlimited retention are not implied by last-known message display.
D-368 ordinary global logout is repaired and released on web/Android26; actual
rendered web exit and actual Native26 ordinary UI login/binding/local logout,
peer retention/refresh and cleanup pass. D369/D370 are now FIXED/RELEASED on web/
Stable27 using compositional evidence; broader recovery/platform QA is separate,
not an unclosed product defect merely because physical503 was not injected.
**Files:** Existing intake reports, chat cache/reconnect/outbox modules and their
focused tests; `docs/PRODUCTION_PRIORITY_TRACKER.md` and defect registry.
**Interfaces:** Account-owned warm history, stable client-message identity,
privacy admission, message anchors and lifecycle recovery already in the client.

- [ ] Reconcile new authorized conversation requests against recorded IDs; retain
  no personal message/media bodies in public reports. Establish client/build and
  intended action for unresolved five images/one video before inventing a fix.
- [x] Reconcile the separate newer nine-item intake: 6 text/1 voice/2 images map
  to existing #2/#87 and provisional #52, not nine new defects. Voice semantics /
  queued-versus-acknowledged state remain uncertified; stills are state-only.
  No new D, confirmed cache cause or tester build. Reuse ignored reconciliation,
  not earlier ungrounded model paraphrases or another extraction run.
- [x] Complete the one warm-photo return candidate (#87/#2): GREEN_NO_SOURCE_PATCH
  with actual React/store/signing SDK and browser HTTP cache over a synthetic
  loopback backend. Calibration: 2 loads/1 server request; history and decoded inline
  original appear in the same 57.1ms sample, 39 sampled frames/zero history-only
  frames, zero new object requests and two held history responses. Owner retirement
  plus late release keeps the old photo absent; exact cleanup/zero listeners pass.
  First strict B locator refusal was before the case, not a product RED. No
  production/Auth/device, thumbnail-only or whole-#87 acceptance follows; unknown
  tester build and broader complaints remain. Do not replay or invent a patch.
  [Actual case and limits](../../operations/2026-10-18-production-completion.md#warm-photo-return-candidate).
- [x] Measure current shared-web opening/switching and offline/online episodes:
  warm history renders before held-response release, anchor drift0px; after a
  real transport loss, fresh joins/ping/privacy reads recover without reload,
  same15 rows/anchor. Exact QA cleanup passes. No cache failure is established;
  early-frame latency is inconclusive, and3 online history reads need source
  diagnosis before optimization or a new defect claim. Device cases remain.
- [x] Publish the reproduced recovery/sanitizer repair:153 focused checks,
  review/typecheck/build, changed production marker/exact image/hash parity.
  Actual changed-input offline recovery retains15 rows/0px anchor, fresh joins/
  privacy reads and no reload, with2 history reads instead of3. Native25 original
  signer/Firebase/assets, Realme guest/data-retaining upgrade and Stable public
  bytes pass. This is not signed-in Android recovery acceptance.
- [ ] Close microphone84, read-state85, task-reload86, sound83 and emoji79 through
  their own changed-input cases; do not infer device acceptance from source.
- [x] Release D-368 local ordinary logout:3 actual callback/SDK REDs before the
  two-call repair;97 affected checks/typecheck and actual owned two-session Auth
  survival/refresh pass, all6 prior SIDs preserved. Actual rendered web exit,
  immutable Android26 upgrade/public bytes pass. Security-wide flows and current-
  install browser preview retirement remain intact. Actual Native26 ordinary UI
  login/binding/logout `0185bbd86af1` removes its new SID/binding; a peer survives
  and refreshes, all older SIDs and package identity remain, exact cleanup passes.
  No post-logout guest frame or Auth-failure injection is claimed.
- [x] Publish D369 transient post-login check cleanup: actual callback/SDK503
  reproduces global logout/peer failure; source2dad8198 changes only bansErr
  to local. Four new literal checks plus seven adjacent/typecheck pass; actual
  deployed `8ce5e18c`/build prefix `9b2` has public/container parity and marker2 ->3.
- [x] Carry D369 into immutable Stable27/source da28afbd and verify actual
  Realme26 ->27 guest retention, old26 catalog CAS, public bytes and rollback26.
- [x] Close D369's one-option JS repair: exact LoginForm/installed-SDK503 negative
  and controls plus actual Auth local retirement/peer retention on web, Native26
  and Native27 normal UI cleanup establish the scope contract. APK27 parity
  includes the repair and active-ban/security-wide behavior is unchanged. No
  physical503 was injected; this is an explicit QA limit, not a new closure gate.
- [ ] Verify cold/warm/offline/background/account-switch behavior at the affected
  boundary and publish independently accepted slices.
- [x] Reproduce and repair D371 transaction-ACK/cancel durability, retained-prefix
  ordering, quiet-reload veto, late local ACK and explicit retry distinction.
  Final affected text/caption/restore/metadata integration passes93; forced
  native-disk failure and whole-platform coverage are not claimed.
- [x] Publish D371/D372/D373 and packaged OSS notice at source `efcc9da0`:
  web/build `6a66afb9a57ceb59`, sole-healthy image, old/new markers and public/
  container parity; Stable0.1.27/build28, original signer/Firebase/assets,
  Realme27 ->28 guest/data retention, full public APK SHA and rollback27.
  Browser faults/native guest evidence do not establish forced native disk faults.

## Task3: Media Completion (#25,29,104--105)

**Oct26 physical follow-up:** Realme40 actual warm original/viewer hash passes;
cold newPID has binary bytes but no timeline row. All exact cleanup/normal guest
passes. A legitimate concurrent-write clock race is independently reproduced and
repaired in source (122 affected/typecheck); candidate41/review and full physical
cold/save remain before closure. [Current work](../../operations/2026-10-26-history-write-clock.md).

Candidate41 is NOT published: actual cold still lacks the history page while
binary bytes remain, with all exact cleanup/guest restoration settled. A second
post-finally privacy/disk race is reproduced and repaired (10 focused cases,
three mutants, typecheck; affected182+actual-helper harness9). Candidate42 and
actual cold proof are next, not a claim that the native41 cause is fully proven.

**Oct26 source delta:** cold default group history and explicit-channel scope
selection are repaired with display-only discovery; service22/coupled9/affected197
and typecheck pass. Review/pixels, original signer/Firebase/parity, retained-data
Realme39->40 guest/fatal0, full public APK and actual healthy shared-web/content
parity pass. RELEASED97e07de8/Stable0.1.39/build40; mandatory=false/rollback39.
Existing physical cold/save limit is unchanged.
[Evidence and boundaries](../../operations/2026-10-26-cold-history-scope.md).

**Oct25 gallery delta:** local Android10+ original image/video gallery export is
RELEASED at85025f59/shared-web7d22d125aa0f30b1 and Stable0.1.38/build39. Actual
Realme WebView/native/MediaStore offline PNG/WebM bytes/hash/MIME/size/decode,
abort/wrong-hash refusals and exact cleanup pass. Full public APK/rollback38 and
healthy web image/public-container parity pass. No authenticated large-message
or Apple-audio closure follows. [Release](../../operations/2026-10-25-offline-gallery.md).

**Oct25 delta:** bounded managed binary cache, consumers and settings are RELEASED
at product20b57a45/shared-webfd39a7c4346dffb7 and Android Stable0.1.37/build38.
Original signer/Firebase/parity, Realme data retention, synthetic native cold
image/audio engine proof and full public APK hash pass; rollback37 retained.
Reviewer repairs, mounted/offline/IDB/pixel evidence and remaining native/Apple/
export limits are in the [current record](../../operations/2026-10-25-media-cache.md).

**State:** IN PROGRESS; D372 durable media representation/cancel/reload repair is
released in webefcc/Stable28 with61/61 source checks, including23 actual
Chromium/WebKit cases without skips. Pre-send editor is released at323d7cfc on
verified web and Android Stable0.1.28/build29 under
[its bounded plan](2026-10-18-media-editor.md). D-365/#104 is DONE, not an outstanding
position repair.
**Files:** Existing media upload/playback/album/cache/editor components and tests.
**Interfaces:** Existing HD/original choice, durable upload identity, variant
metadata and positional intent; preserve original bytes and explicit downloads.

- [x] Map accepted albums, HD/original, auto-small/manual-large download/cache and
  recorder feedback evidence without replaying accepted cases.
  [Remaining workflow map](../../operations/2026-10-18-media-editor.md#remaining-media-workflows).
- [x] Repair/release cold default group cache discovery and selected-channel
  isolation without cached authority or network/send changes (Stable40/shared web).
  Exact legacy reads, write ordering, caller mutation and privacy fences pass.
- [x] Actual Stable39 ordinary receiver login and mounted preview/explicit large
  original open: original absent before tap, then durable IDB and actual viewer
  Blob SHA/bytes/dimensions match. Warm acceptance is bounded, not cold/save or
  FCM acceptance. [Physical QA](../../operations/2026-10-25-authenticated-media-qa.md).
- [ ] Execute the uncovered current physical large-original receive/open/native
  save/reopen/hash workflow with owned Auth/media and exact cleanup; patch only
  an observed failure, not an assumed missing auto-download implementation.
  Oct25 cold new-PID case stopped at `open`; diagnose exact cached row/control
  before another cohort. Warm baseline and release checks must not be replayed
  merely to widen instrumentation. Final normal guest/network/helper and all
  owned fixture cleanup pass; full cold/gallery journey remains OPEN.
- [ ] Finish missing grouping, quality defaults and save/cache semantics with
  focused behavioral tests and rendered desktop/mobile states.
- [x] Release bounded private media IDB and mounted photo/file/voice/viewer/settings
  integration, with durable privacy retirement, SHA-256 integrity, separate
  preview/original representations and actual browser/native engine cold proof.
  Android offline gallery export is accepted separately below; the wider
  authenticated journey stays open.
- [x] Release bounded Android10+ cached-original gallery export through actual
  native MediaStore byte/hash proof without network, with retained-data upgrade,
  original signer/Firebase, complete public APK and shared-web parity (Stable39).
- [x] Implement/release the pre-send photo/video editor as a separate slice:
  maintained MIT cropper and installed Mediabunny, explicit unsupported/error
  states, no raw privacy-edit fallback. Source/UI/bytes/native upgrade/public
  release checks pass; successful Realme/iPhone encoding is not inferred.
- [ ] Accept actual send/retry/view/save behavior on affected shells and release.
- [ ] Design/implement D376's bounded PCM fallback only after the accepted Web
  Audio feasibility, with decoded-memory/track provenance/cancellation and exact
  both-track trim/alignment checks; no global decoder mutation or raw fallback.

## Task4: Faithful Recovery (#82/D-342)

**State:** IN PROGRESS overall; sealed-only package tool/entrypoint/restore
subboundary is ACCEPTED at `c2d954b5ecab`. Off-host custody/current RPO and wider
recovery guarantees remain separate; migration-specific rehearsals are reused.
**Files:** Existing recovery operators, coverage reports and backup contracts.
**Interfaces:** Backup-alone restoration of roles/ACL/settings/schema/data, not
an already initialized clone whose prerequisites come from production.

- [x] Compare accepted receipts: R6 restore768 constraints and rollback173
  tables/10 sequences are accepted. Roles/settings/default ACL were restored;
  the missing boundary is a sealed backup package without source-derived
  prerequisites. Supplemental GraphQL/net ACL/settings/two indexes must travel
  inside that durable package, not be fetched again from production.
- [x] Verify retained R6 payload availability and seal existing bytes without a
  database/new dump:39 files/27,151,442B, all hashes match, original files intact.
  Independent JSON/byte/hash readback passes; manifest
  `a6db6568a77ed02f0b5a2cbb68081dbee1ab4b6054372cbc89633acc16b50115`.
  Payload-only closure was not recovery acceptance; the closed tool/entrypoint
  and actual sealed-only restore are now accepted below.
- [x] Stage and independently verify V3 closed tools:35 files plus manifest,
  SHA c663b9da434658e41f6d560cdac1b0cd056c676914803617a35a1df73f46d9ca.
  Host has no Node. V4-r2 separates cached RO Node/parser from host Python/PG;
  32 local controls pass. V4-r2 refusals/512MiB OOM proof are retained. V4-r3
  manifest `51fb0150144e42d0406fd260d77105c63438b45366b865d55ff0e8e469cbbbcf`
  stages/readbacks all39 files. Node2GiB/fresh host4GiB guard,7 focused controls
  and canonical clean-exit preflight/custody pass; parser/comparators unchanged.
- [x] Complete the isolated sealed-only rehearsal `c2d954b5ecab`: fresh cached PG17
  consumes only retained package/tool bytes, including GraphQL/net ACL/settings/
  two-index supplements. Full catalog/data/settings/roles/default ACL/sequences
  match;173 tables/124,112 rows. On the same copy the full comparator accepts the
  positive, refuses one concrete schema grant-option loss, verifies that exact
  bit delta and the complete post-ROLLBACK catalog. RLS remains intact.
- [x] Record actual restore360.972s and RO Node DDL verify7.308s:768 constraints
  and schema structure pass the unchanged accepted comparator. Literal
  unfiltered AST equality is NOT claimed (`unfilteredAstEqual=false`). Clean
  Node exit0/OOM=false, State before cleanup and independent artifact/custody/
  exact PG+Node CID absence pass. Initial invoker filename refusal is proven
  NOT_DISPATCHED; hyphen-only dispatch-v2 controls3/3 preserve it, same cohort,
  no duplicate preflight. No live source DB/new dump/old R6 wrapper is used.
- [ ] Close only the remaining external recovery boundaries: off-host durable
  custody, current backup cadence/RPO and wider recovery guarantees. The accepted
  retained-snapshot case does not close all of item82/D-342 or Task4. Cached
  pinned PG17/Node and host Python/Docker remain explicit runtime dependencies,
  not a new air-gap image-export requirement.

Evidence: [actual package-only recovery and limits](../../operations/2026-10-18-production-completion.md#d342-sealed-only-package-restore-1537z).

## Task5: Trusted Media Authority (#78/D-336--339)

**State:** QUEUED; source/isolated/controlled Storage checks exist.
**Files:** Existing trusted writer, forward/avatar contracts and migration plan.
**Interfaces:** Durable source-to-target authorization, idempotency and bounded
busy retry; no public client service-role or path-only authority.

- [ ] Resume the existing candidate at its first uncovered real runtime/Storage
  boundary, rather than rerunning accepted local suites.
- [ ] Prove source/target revoke, retry, deletion and avatar lifecycle with actual
  owned Storage outcomes; preserve unrelated originals.
- [ ] Apply required SQL only through section10 and verify actual consumers before
  promoting or closing the defect family.

## Task6: Groups, Publication and Bots (#19,43--48,80--81)

**State:** QUEUED; existing bot viewer/vocabulary are released.
**Files:** Existing group/channel permission/settings, conversation type and bot
interface modules, contracts and tests. Internal identifiers stay compatible.
**Interfaces:** Group versus Group-chat mechanics; publisher/reader authority,
inherited/scoped permissions, bot message/media visibility and shared UI.

- [ ] Prove actual publisher positive and reader-negative control for publication
  channels, then repair uncovered settings/permission inheritance.
- [ ] Finish structural Group rail and personal/shared bot surfaces without
  rebuilding accepted bot message reading or relabelling the old structure.
- [ ] Implement remaining auto voice-room mechanics behind tested ownership,
  membership, empty-room cleanup and reconnect rules.
- [ ] Accept ordinary-user creation/join/publish/bot workflows, not staff-only UI.

## Task7: Calls (#32,44--45)

**State:** QUEUED; private calls/history already exist.
**Files:** Existing LiveKit, Android call delivery, participant and public-route
call-control modules and their current rollout/checklists.
**Interfaces:** Actual background/killed activation, permissions, identity,
participant lifecycle and group-call state; no duplicate room/call on reconnect.

- [ ] Reconcile current Android30 with disabled call-delivery rollout and accepted
  A/B/C/D2/E/F/G stages; execute only missing lifecycle/device cases.
- [ ] Finish group voice/background/participant paths and readable microphone-to-
  video status with real failure regressions and responsive visual inspection.
- [ ] Verify denial, timeout, logout, stale activation and reconnect, then roll out
  only accepted delivery paths.

## Task8: Interface and Motion (#18,30--31,34,93)

**Oct26 bounded delta:** stale voice short-press text after switching to video
is reproduced and repaired; feedback5 and final1440/390/both-theme pixels pass.
Released97e07de8/shared web and Stable40 with actual rollout/content proof. It does
not close the wider native motion backlog.
[Current repair](../../operations/2026-10-26-cold-history-scope.md).

**State:** IN PROGRESS for the wider UI stream; D-370 itself is FIXED/RELEASED.
Shared-DOM readiness/omission tests, both engines/themes, actual installed-PWA
final navigation/return callbacks and build27 parity close this bounded bug.
Preserve current glass and accepted focus/reduced-motion fixes.
**Files:** Existing navigation, container sizing, search, typography and settings
components; targeted visual/performance fixtures.
**Interfaces:** Stable dimensions, actual container width, keyboard/safe-area
ownership, readable defaults/scale and reduced-motion preference.

- [x] Reproduce actual installed-PWA access-hydration hitbox movement; repair only
  account-owned readiness. Nine focused checks/four omissions, Chromium/WebKit
  four cases and synthetic1440/390 pixels in both themes pass. Source review is
  clean; retain the source/E2E/pixel evidence without replay.
- [x] Publish D-370 at da28afbd on sole-healthy web/build9fd9efb24b98dfb6 and
  Stable27, with public/nav markers and actual guest upgrade/full APK bytes.
- [x] Actual installed da28 PWA after background: Profile ->Settings ->Chats twice
  retains four stable targets/Profile rect[236,862,65,48] and working Settings
  callback. This accepts the final-nav/background/Profile subcase. Early physical
  hydration was not held; actual-hook held-response tests already cover readiness.
  No forced phone Auth/permission fault or all-platform claim is needed to close
  D370; unexercised device/fault/OEM cases remain separate QA coverage.
- [ ] Measure one uncovered native search expand/collapse or compact-container
  defect, including frame/layout evidence before changing animation.
- [x] Complete/release reproduced D375 search-list continuity: actual shared
  Sidebar unmounts the list for quick results and loses its scroll on Escape.
  Source18/WebKit/final typecheck/review/pixels and actual web/Stable30 release
  checks pass at a02be032. This is separate from physical general animation lag.
  [Bounded repair](../../operations/2026-10-19-search-continuity.md).
- [ ] Verify exact changed elements at1440/390 in both themes and enlarged text;
  keep controls reachable, lines aligned and navigation logically persistent.
- [ ] Use available Mobbin/Figma/Rive only for a specific missing reference or
  implementation need; do not spend subscription minutes on repeated exploration.
- [ ] Publish reviewed UI slices and record physical checks separately.

Bounded recorder-feedback slice is released onOct26; this wider checkbox remains
open for the other interface/motion work, not a reason to replay the accepted fix.

## Task9: Product Depth (#17,19--20,27,36--38,92)

**State:** IN PROGRESS; D-354 source/browser fix4765bcad is shipped. Actual
authenticated shared-web draft refresh and transient Retry pass; terminal and
Android cases remain; missed-update/reconnect repair is now actually accepted
on shared web and released in web/Android25.
**Files:** Existing public download/changelog, profile/contact/shared-media,
roles/tasks/staff/support components and their focused tests.
**Interfaces:** Public unauthenticated downloads, scoped roles, contact/phone
privacy, task invalidation, profile history and existing support assignment.

- [x] Reconcile D-354 inclusion: shipped hook/modal/checklist blobs match current;
  accepted hook SHA matches its report. Do not repeat accepted fictional tests.
- [x] Actual owned shared-web two-SID refresh holds a genuine RT-triggered detail
  response; both draft values and original input nodes remain. Separate transient-
  only run exhausts SDK retry0/1/2/3 with transport failure, then one real Retry
  loads latest data without draft loss. Exact synthetic-task tombstone/browser/
  SID cleanup passes. This is not terminal or physical Android acceptance.
- [x] Complete actual missed-update follow-up: reproduced3 rejoins/zero detail
  GET/stale title; reviewed source0bdffb80 passes66 checks and is released with
  the chat repair. Actual new cohort gets one parent read267ms after last rejoin,
  latest title automatically and both draft nodes/values intact throughout8s;
  exact task/two-SID cleanup passes, no reload.
- [ ] On Android25 leave owned task checklist/comment drafts unsaved; update the
  task through a second QA client. Real Realtime refresh must update server data
  without reload/unmount or either draft loss. Test transient error/Retry and
  permission-loss retirement as separate controls.
- [ ] Close remaining ordinary-user journeys with actual positive and denied
  controls; retain accepted support/email/auth/security baselines.
- [ ] Finish remaining marks/history/presence and public product states without
  introducing fake activity, marketing claims or placeholder versions.

## Task10: Platform Delta Matrix (#7,9,28)

**State:** IN PROGRESS; Android35 is released with actual guest upgrade/public
bytes and the full A06334->35 in-app/system-install/post acceptance. Native26
ordinary UI/logout/binding evidence is retained; Native27 normal
UI cleanup and installed-PWA final-nav/background/Profile subcase are accepted.
D369/D370 are FIXED/RELEASED; unexercised physical503/held-early-phone/OEM cases
remain broader QA coverage, not known remaining product bugs. Topic remains partial.
**Files:** Platform QA/release checklists, existing native adapters and manifests.
**Interfaces:** Shared client parity, native activation/download/keyboard, stable
signer/package identity and verified in-place upgrade with retained user data.

- [ ] Build a delta-only OEM/locked/long-session matrix reusing accepted23/24
  evidence and current Stable35. Realme/rentals and newly authorized A063 are
  available; its bounded VPN case is accepted separately, not a full matrix.
- [ ] Coordinate installed iPhone PWA keyboard/safe-area/scale checks on a bounded
  rented iPhone; do not claim native iOS/macOS release from web evidence.
- [x] On the next legitimate higher-build release35, finish actual fixed34 updater
  download/ready/permission/system-install and data retention. Reuse accepted
  bridge/current cases; actual110-sample/three-control A063 path, Play Protect
  scan, exact installed35 APK/UID/firstInstall, post source/main and final normal
  cleanup/fatal0 pass. No dummy release, same-version bypass or fake APK source.
- [ ] Finish Windows killed-process WNS and available Win10/11/offline/long-session
  cases while retaining owner-accepted unsigned EXE distribution.
- [x] For the prior embedded-client delta, build immutable25 and verify
  signer/Firebase/assets, actual upgrade/canary, catalog CAS and public byte hash.
  Realme24 ->25 is guest/data-preserving startup proof; broader signed-in and
  physical Topic cases below remain open. Retain24 as rollback.
- [x] Accept Native26 ordinary UI login/exact active FCM binding/local logout:
  actual `0185bbd86af1` retains/refreshes the peer, retires only the new SID/binding,
  retains all older sessions and package identity; exact cleanup passes. This
  does not prove a post-logout guest frame, transient-login failure handling,
  chat/task recovery, Topic/provider/OEM or long-session behavior.
- [x] Release immutable Android0.1.26/build27 from da28afbd: exact Realme26 ->27
  UID/data/firstInstall retention, guest/fatal0, old26 CAS, mandatory=false,
  rollback26 and full public bytes/SHA match. D369/D370 closure uses the composed
  evidence above, not an invented physical fault test or this upgrade alone.

## Task11: Monitoring and Capacity (#6)

**State:** IN PROGRESS; backup metadata inventory and monitoring source proposal
are recorded. No new monitor/alert is installed; old permission-only hold is
superseded.
**Files:** Existing monitoring, error handling, backup/restore and capacity reports.
**Interfaces:** Secret-free actionable alerts, verified backup age/recovery,
measured resource limits and no speculative platform rewrite.

- [x] Inventory actual daily/offsite backup metadata and alert configuration;
  retain strict-host-key remote-custody refusal rather than bypassing trust.
  [Source-only monitoring contract](../../operations/2026-10-18-backup-monitoring.md)
  is prepared and tested, not installed or delivery-tested.
- [ ] Finish the separate application-error/uptime alert inventory.
- [ ] Implement and prove a controlled alert plus recovery/retirement, with
  explicit redaction and no duplicate noisy notifications.
- [ ] Change capacity/storage only for measured limits; document rollback.

## Task12: Remaining Optional Product Scope (#24)

**State:** QUEUED behind core reliability, not silently removed from owner scope.
**Files/Interfaces:** Existing optional cosmetics/paid-feature proposal; revalidate
commercial/provider constraints before implementing its independently testable
slice. No unrequested purchase, financial commitment or fabricated entitlement.

- [ ] Reconcile requested optional scope with the accepted product design.
- [ ] Implement reversible non-commercial pieces; identify genuine external
  owner/provider decisions rather than presenting them as completed.

## Per-Slice Release and Continuity

- [ ] Reproduce a real failure, add a negative control, implement a narrow repair,
  and run affected checks. Use a fresh reviewer for high-risk contract changes.
- [ ] For SQL retain actual backup/transaction/self-check/rollback proof; for UI
  inspect rendered pixels; for device/provider boundaries use actual acceptance.
- [ ] Commit only owned paths; inspect outgoing commits/imports and deploy. Verify
  exact image/content or immutable native artifact/catalog/readback and rollback.
- [ ] Update the owning tracker item and one short HANDOVER resume; link detailed
  reports. Move immediately to the next ready task, not a new approval ritual.
- [ ] Finish the goal only when all agreed items are genuinely closed or their
  explicit external dependency is accurately reported to the owner.
