# Bot Media External-I/O Next Gate - 2026-10-03

## Resume And Boundary

Owner: bounded source-inventory sidecar; the coordinator owns implementation and
execution. Branch: `codex/bot-inline-media-20261002`; tracked runtime baseline
`3976348f`. Stage: local-source inventory only. Blocker: provider terminality,
physical incarnation binding and non-message lifecycle participation are unproven.
Next implementable increment: defer one fictional old PUT across lease takeover
and a newer real SQL commit; assert retained attempt history and unchanged charge.

Coordinator update: the proposed [deferred source gate](2026-10-03-bot-media-deferred-put.md)
is now executed **5/5** on actual captured SQL/local PG18.4 with fake Storage,
including a stale-lease mutant and independent first/late assertion cleanup.
Exact source/executable hashes match and five owned copies are absent. This is
not full-schema/PostgREST/provider proof. The separate
[full-schema transfer](2026-10-03-bot-media-deferred-full-http.md) now passes
4/4 with controlled Storage, exact links and owned cleanup; it does not prove
physical generation or provider terminality. The participant inventory remains open.

The [current resume](../HANDOVER.md#L25) and
[final inline report](2026-10-03-bot-media-inline-http.md#L46) supersede the earlier
trial checkpoint. No private receipts, credentials, copied personal rows, remote
host, Storage/provider, device or native operations were inspected here.
**No production SQL, main deployment or native publication is authorized.** Keep
whole-`chat-media` purge HOLD, Android/native HOLD and A063 exclusion. No cleanup,
path reuse, receipt pruning or quota release follows from any proposed test.
Already applied identity/resolver/observations/hold SQL must not be replayed.

## Reused Evidence, Not New Runs

The coordinator's public report records final exact-source **6/6** through real
PostgREST 14.12 on an isolated full PG17.6 copy, with real handler/repository/RPCs
and **controlled fictional Storage only**. Its
[six cases](2026-10-03-bot-media-inline-http.md#L31) are:

| Executed Inline Case | Boundary Already Observed |
| --- | --- |
| Commit coverage blocker after PNG admission/PUT | Real `55P03` -> `503`, `retry_after=2`; charged reserved receipt, no delivery effects |
| Immediate unchanged retry | Real `55000` -> `429` active lease, no extra PUT |
| Explicit fictional lease expiry | Same path, controlled `409`, download/hash, one commit, original accounting charge |
| Cached success then current membership revocation | No PUT for success replay; fresh authority denial despite complete receipt |
| Lost reply after real commit | Repeat returns committed receipt without another PUT/message |
| Unknown controlled upload outcome | Retained `unknown`, charge and reservation; immediate retry performs no PUT |

The [review controls](2026-10-03-bot-media-inline-http.md#L72) also record real
rollback corruption of ledger target and observation path, exposing wrong links
despite unchanged counts. This sidecar does not independently inspect private
receipts or rerun those gates. Gateway listening/auth/proxy, real provider PUT/GET
and physical generation remain expressly outside that result
([limits](2026-10-03-bot-media-inline-http.md#L100)).

Existing [SQL/runtime upload tests](../../tests/server/bot-media-upload-runtime.test.mjs#L76)
already cover cached commit, an immediately thrown uncertain PUT followed by lease
takeover, lost begin/finish replies and token revocation. The uncertain case
[throws after fictional metadata insertion](../../tests/server/bot-media-upload-runtime.test.mjs#L49);
it does not hold an outstanding upload promise while another caller commits.
Existing [stream tests](../../tests/unit/bot-inline-media-storage.test.mts#L17)
cover equal/changed/short/oversize/broken download bodies with fake RPC replies.
Reuse them as source controls, not real Storage proof; none was run here.

During final inventory a concurrent untracked
[SDK/loopback HTTP candidate](../../tests/server/bot-media-storage-sdk-http.fixture.mjs#L18)
appeared. Its [nine source cases](../../tests/server/bot-media-storage-sdk-http.test.mjs#L4)
cover normal/duplicate bodies, resets, denial and malformed response with controlled
RPC replies, not real SQL admission. No execution/frozen acceptance is claimed by
this sidecar. The deferred real-SQL takeover below is distinct; do not duplicate
the SDK candidate's stream/transport cases or promote them to provider proof.

Coordinator update: that SDK/loopback increment subsequently passed its frozen
21/21 gate, recorded in [SDK evidence](2026-10-03-bot-media-storage-sdk-http.md).
This does not turn the proposed deferred real-SQL schedule below into executed
evidence, or its controlled HTTP replies into provider/durability proof.

## Existing External-I/O Seams

| Participant | Exact Current Seam | Acceptance Limit |
| --- | --- | --- |
| Bot inline | [durable begin -> upload -> finish](../../artifacts/api-server/src/bot/repository.ts#L656), then [handler commit](../../artifacts/api-server/src/bot/methods/messages.ts#L172) | SQL calls bracket external I/O; pending/unknown history is not a physical fence |
| Inline PUT | [`chat-media` upload](../../artifacts/api-server/src/bot/repository.ts#L619), `upsert:false`; successful returned `path` must equal requested path | The [consumed response type](../../artifacts/api-server/src/bot/repository.ts#L36) binds a path, not a provider version/precondition |
| Inline duplicate GET | [`409` classification then streamed download](../../artifacts/api-server/src/bot/repository.ts#L626), `cache:"no-store"`, 45-second abort signal; length and SHA-256 checked; reader cancelled | Equal bytes establish content equality at that read, not historical PUT terminality or immutable incarnation |
| Bot file URL | [signed URL creation](../../artifacts/api-server/src/bot/repository.ts#L789) | URL issuance is not a provider download or generation-bound absence check |
| Human attachment/preview | [ordinary upload](../../artifacts/kub/src/lib/attachmentUpload.ts#L73) and [preview upload](../../artifacts/kub/src/lib/attachmentUpload.ts#L91), both insert-only; [TUS configuration](../../artifacts/kub/src/lib/resumableStorageUpload.ts#L159) uses `x-upsert:false` | Actual bucket is [`media`](../../artifacts/kub/src/lib/stagedAttachments.ts#L117), despite the constant's `CHAT_MEDIA_BUCKET` name; upload precedes message insert |
| Avatar originals | [profile](../../artifacts/kub/src/components/settings/SettingsScreen.tsx#L420), [chat](../../artifacts/kub/src/components/chat/ChatInfoPanel.tsx#L1207), [admin profile](../../artifacts/kub/src/pages/admin/UsersTab.tsx#L1309) upload into `media`, `upsert:false`; [bot](../../artifacts/kub/src/lib/botAvatar.ts#L56) uses `upsert:true` | URL publication is a separate DB/API mutation; generated avatar path names are not provider versions |
| Variant source GET | [message source](../../artifacts/api-server/src/workers/mediaVariantsWorker.ts#L591), [avatar source](../../artifacts/api-server/src/workers/mediaVariantsWorker.ts#L839), [download helper](../../artifacts/api-server/src/workers/mediaVariantsWorker.ts#L894) | Downloads bucket/path to a buffer, with no physical-version binding in this helper |
| Variant target PUT/publication | [upload](../../artifacts/api-server/src/workers/mediaVariantsWorker.ts#L982), `media`, `upsert:true`; [message row replacement](../../artifacts/api-server/src/workers/mediaVariantsWorker.ts#L1017) / [avatar replacement](../../artifacts/api-server/src/workers/mediaVariantsWorker.ts#L1045) delete then insert separately | A successful PUT followed by failed/crashed publication has no lifecycle intent in these inspected paths; ordinary failed rows still carry pointers |
| D103 remove | [claim/remove/finish adapter](../../artifacts/api-server/src/workers/mediaPurgeWorker.ts#L80) and [tick](../../artifacts/api-server/src/workers/mediaPurgeWorker.ts#L46) | Sends bucket plus decoded paths, then finishes queue IDs; no physical-generation/precondition argument. The code's missing-file comment is not verified provider semantics |

These are application call sites, not observations of the currently installed
Storage backend. No guarantee about cancellation, duplicate responses, overwrite
ordering, read consistency or DELETE idempotence is inferred from them.

## Identity Must Stay Explicit

| Identity / State | Exact Fields And Meaning |
| --- | --- |
| Charged admission receipt | [`private.bot_media_ingests`](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L142): `(bot_id,idempotency_key)`, `owner_token_id`, `chat_id`, `method`, `request_fingerprint`, `object_path`, `content_sha256`, `content_type`, `byte_size`; rotating `lease_id/lease_expires_at`; original `created_at`; state `reserved` / `complete`, `result/completed_at`, transaction-local `commit_xid`. [Lease takeover](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L240) changes ownership/lease, not charge time; [quota sums](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L246) include failed/reserved admissions |
| Logical object | [`private.bot_media_object_identities`](../../supabase/migrations/20261002212749_bot_media_logical_identity.sql#L86): `generation_id`, `bucket_id='chat-media'`, `object_path`, `claim_kind='ingest'`, `bot_id`, `idempotency_key`, `chat_id`, `method`, `request_fingerprint`, `content_type`, `byte_size`, `content_sha256`, `receipt_created_at`; unique bucket/path and bot/key. [Explicit comment](../../supabase/migrations/20261002212749_bot_media_logical_identity.sql#L117): NOT a verified physical incarnation; no path reuse/reclamation authority |
| Retained path/attempt/grant binding | [path claims](../../supabase/migrations/20261002212749_bot_media_logical_identity.sql#L79) distinguish `ingest`/`unmanaged`; [attempt binding](../../supabase/migrations/20261002212749_bot_media_logical_identity.sql#L105) maps `attempt_id` to logical `generation_id`; grant claim/binding retains `grant_id -> generation_id, issued_at` beyond prunable grants |
| PUT attempt | [`private.bot_media_upload_attempts`](../../supabase/migrations/20261002155123_bot_media_upload_intents.sql#L68): `bot_id`, `idempotency_key`, `attempt_id` (lease UUID), `owner_token_id`, `chat_id`, `request_fingerprint`, `object_path`, `content_type`, `byte_size`, `content_sha256`, state `pending` / `acknowledged` / `unknown`, `started_at/observed_at`. [Finish](../../supabase/migrations/20261002155123_bot_media_upload_intents.sql#L177) authenticates persisted attempt identity, not the current lease; terminal history is not rewritten |
| Message reference observation | [table](../../supabase/migrations/20261002232331_bot_message_media_observations.sql#L54): `message_id`, `source_kind`, `bucket_id`, `object_path`, logical `generation_id`, `reference_state` registered/unresolved/ambiguous, `hold_reason`. [Resolver](../../supabase/migrations/20261002222251_bot_message_media_references.sql#L87) retains canonical, legacy URL, parent-bucket preview and unsupported metadata independently; absence cannot be inferred from one canonical pointer |
| Avatar/variant address | [`avatarUploadPath`](../../artifacts/kub/src/lib/mediaUpload.ts#L198): bucket `media`, prefix `avatars`, `chat-avatars` or `bot-avatars`, then `<owner>/avatar-<unique>.<ext>`. [Variant paths](../../artifacts/api-server/src/workers/mediaVariantRules.ts#L239): message path uses chat/message/kind; profile target reuses profile/kind; chat target uses SHA-256 of source PATH, truncated to 32 hex characters. That token is not a bytes hash or physical version |
| Variant row / job | [variant schema](../../.migration-backup/supabase/migrations/20260622_media_variants_pipeline.sql#L15) has owner fields `message_id/chat_id/user_id/profile_id`, `source_bucket/source_path`, `variant_kind`, `variant_bucket/variant_path`, `mime_type/width/height/size_bytes` and ready/failed/stale status; [chat-avatar scope amendment](../../.migration-backup/supabase/migrations/20260904040000_chat_avatar_variants.sql#L46) admits chat without message. [Job](../../.migration-backup/supabase/migrations/20260913120000_media_variant_job_queue.sql#L66) uses `scope/target_id`, `claim_token/claimed_at/attempts`; neither is a physical object generation |
| DELETE work identity | [`MediaPurgeItem`](../../artifacts/api-server/src/workers/mediaPurgeWorker.ts#L19) is `{id,bucket,path}`; queue claim/finish identity is not a PUT incarnation |

The inline path is fingerprint-derived, not incarnation-derived
([SQL literal](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L199)).
Commit checks [Storage metadata by bucket/name/MIME/size](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L320),
not a provider version or a SHA-256 obtained from Storage. No verified physical
identity field is consumed by the inspected upload/download/remove seams.
This does **not** establish that the actual provider exposes no such capability:
its deployed API/catalog and supported preconditions were not inspected here.

## Other Writers And Holders

Message hooks alone do not cover the following participants. Preserve existing
RLS, same-chat file reuse and ownership rules; lifecycle admission must not widen
them. The [coverage contract](2026-10-03-bot-media-coverage-protocol.md#L125)
expressly excludes non-message external work from automatic participation.

| Participant | Publication / Reference Boundary To Cover |
| --- | --- |
| Human send, background outbox, direct/legacy/trusted message DML | [background upload -> insert](../../artifacts/kub/src/lib/outbox/appBackgroundUploads.ts#L119) and [direct insert](../../artifacts/kub/src/lib/outbox/appOutbox.ts#L91); canonical, URL, preview and OLD references need coverage, including deleted messages and all authors/chats |
| Forward and bot reuse | [forward fallback](../../artifacts/kub/src/hooks/useMessages.ts#L1600), [copied media fields](../../artifacts/kub/src/lib/messageForward.ts#L79), [bot media/file_id path](../../artifacts/api-server/src/bot/methods/messages.ts#L185); new references need admission even without a new PUT. Existing forward SQL also copies ready variant pointers ([inventory](2026-10-02-bot-media-writer-inventory.md#L43)) |
| Profile/chat avatar URLs and alternate setters | [profile update/clear](../../artifacts/kub/src/components/settings/SettingsScreen.tsx#L431), [chat setter](../../artifacts/kub/src/components/chat/ChatInfoPanel.tsx#L1225), [admin RPC/fallback](../../artifacts/kub/src/pages/admin/UsersTab.tsx#L1266), [profile bootstrap](../../artifacts/kub/src/hooks/useUser.ts#L123); avatar holders may have no message row |
| Bot avatar | [management route](../../artifacts/api-server/src/bot/managementRoutes.ts#L692), [current tracked setter](../../.migration-backup/supabase/migrations/20260919030000_a_refusal_to_set_a_picture_says_why.sql#L119) restrict ordinary URLs to that bot's `media/bot-avatars/` prefix; do not make it accept inline paths. [Clear](../../artifacts/kub/src/lib/botAvatar.ts#L78) leaves bytes. Trusted/legacy `bots.avatar_url` values still belong in inventory |
| Variant queue, scan fallback and worker | [claim](../../artifacts/api-server/src/workers/mediaVariantsWorker.ts#L314), [profile/chat target reload](../../artifacts/api-server/src/workers/mediaVariantsWorker.ts#L389), [avatar work](../../artifacts/api-server/src/workers/mediaVariantsWorker.ts#L843); source read, target PUT and publication are distinct intervals. [Failed rows](../../artifacts/api-server/src/workers/mediaVariantsWorker.ts#L1095) retain source AND target pointers. Job scopes are message/profile/chat, not bot-avatar |
| Moderation and purge | [preflight](../../scripts/bot-media-reference-preflight.sql#L174) counts reports and purge overlap; new/reviewing moderation material and unresolved overlap remain holds. [Whole-bucket guard](../../supabase/migrations/20261002203853_bot_media_purge_hold.sql#L64) prevents `chat-media` claims and excludes the bucket from claim selection, not just today's inline paths |

The [read-only preflight](../../scripts/bot-media-reference-preflight.sql#L96)
inventories profiles/chats/bots; it counts
[both variant pointer directions](../../scripts/bot-media-reference-preflight.sql#L151)
without ready-only filtering. An inventory snapshot is not a writer fence.
Applied observations-only hooks likewise do not seal/delete/refund. The naive
sorted-per-statement fence is [refuted](2026-10-03-bot-media-admission-foundation.md#L59);
do not revive that ordering as an accepted cross-writer protocol.

## Smallest Next Source Test

Historical sidecar proposal, now implemented/executed by the coordinator in
the [local 5/5](2026-10-03-bot-media-deferred-put.md) and
[full-schema 4/4](2026-10-03-bot-media-deferred-full-http.md) gates: one deferred-I/O test with two
terminal variants to the existing
[real SQL/runtime harness](../../tests/server/bot-media-upload-runtime.test.mjs#L16).
It exercises actual handlers/repository and real reserve/begin/finish/commit,
using the existing captured subset schema; this is not full-schema/PostgREST or
provider acceptance. The coordinator selects the runtime. No application change,
prototype installation in production or new provider client is needed.

1. Caller A admits the existing fictional 68-byte PNG. Its fake insert-only PUT
   signals an explicit reached barrier and stays unresolved, without inserting
   metadata yet. From an independent idle SQL session verify A's durable attempt
   is `pending`, its receipt `reserved`, zero messages, one 68-byte charge.
2. Expire only A's exact fictional bot/key/lease via supplied idle SQL; no long
   sleep and no transaction held over the deferred promise. Caller B repeats the
   unchanged public input under a different lease. B inserts fictional metadata,
   ACKs and really commits one message. A is still `pending`; B is `acknowledged`;
   there is still one receipt/charge with the ORIGINAL `created_at`.
3. Resolve A's fake PUT as existing-object `409`, not overwrite. Feed exactly the
   locally recorded B bytes through the real streaming verifier. A's finish must
   ACK only its own attempt; its real stale commit must raise literal
   `42501/bot_ingest_lease_invalid`, mapped to `403/forbidden` with no retry hint.
   The [lease guard precedes completed replay](../../supabase/migrations/20261002020000_bot_inline_media_ingest.sql#L294).
   Assert two PUT attempts / one fictional object creation / one download, one
   message, unchanged B result and initial charge. A cannot replace B's receipt.
4. In a separate isolated variant, release A by controlled transport rejection
   after B commits. Expect `500/internal_error`, A `unknown`, B `acknowledged`,
   B's complete receipt unchanged. B's ACK/cached replay must not erase A's hold.
   A later public repeat returns B's result without another PUT. Never treat the
   rejected promise, lease expiry or B's success as provider terminality for A.

Address exact fictional IDs/key/path only; do not copy the older harness's broad
mutation predicates into a full-schema run. Keep bytes/hash local; SQL metadata
insertion is explicitly fictional. Make fake `remove`/overwrite fail immediately.
Record unexpected adapter assertion/transport failures separately from intentional
fault sentinels and rethrow outside repository error mapping, following the
[existing defense](../../tests/server/bot-media-inline-http.fixture.mjs#L257):
a swallowed assertion must not count as the expected permission refusal.

Concrete invariant: **lease rotation may transfer retry ownership, but cannot
erase an admitted external attempt, move initial accounting time, overwrite a
committed result, deliver twice, or permit cleanup/refund.** Use independent
literal counts/states, exact bot/key/method/message links, not counts alone.
On a later coordinator-owned full-schema HTTP transfer, reuse
[`assertInlineDeliveryLinks`](../../tests/server/bot-media-inline-http.fixture.mjs#L24)
and independently check both attempts bind the SAME logical generation. The
captured-subset gate alone cannot prove those registry/observation assertions.

Required negative control: in the disposable test DB only, remove the compiled
stale-lease check and require the same `42501` oracle to go RED when A can replay
B's complete receipt. Restore the exact definition/digest in `finally`, even if
an assertion fails. Do not replace a real RPC with a fabricated SQLSTATE.

## Minimal Follow-On Fault Matrix

All rows below are proposals. Start with the two deferred cases above; subsequent
rows require their own bounded approval/fixture contract, not a combined rewrite.

| Fault / Schedule | Independent Invariant / Expected Gap |
| --- | --- |
| A outstanding; B commits; A gets controlled 409/verified bytes | Exact stale `42501`, one delivery/charge; both ACKs retained. No real provider completion claim |
| A outstanding; B commits; A response remains unknown | A stays `unknown` beside B ACK; complete receipt replay cannot prune the hold. Zero remove/refund |
| Profile avatar A job paused; URL changes to B and B job publishes; A resumes | A must not overwrite B's stable profile target or publish A as current. Current [target path](../../artifacts/api-server/src/workers/mediaVariantRules.ts#L250) is reused and [publication](../../artifacts/api-server/src/workers/mediaVariantsWorker.ts#L862) uses the captured owner/source without a lifecycle generation recheck; establish a bounded baseline RED, do not claim a shipped protection. Chat path-token separation is only a source-PATH distinction |
| Variant PUT accepted; crash/failed DB publication; source is changed/removed | Source AND target must remain held through recovery, including failed/stale rows and the PUT-to-row gap. Durable pre-PUT target intent is not present in the inspected helper; define test-only lifecycle participation before claiming GREEN. Existing [worker fake-HTTP tests](../../tests/server/media-variant-queue-drain.test.mjs#L94) are reusable transport seams, not Storage evidence |
| Same bucket/path/bytes, distinct synthetic physical incarnations A/B; stale delete reconciliation for A | Logical UUID, path hash and content hash cannot distinguish incarnations. Until an observed provider incarnation/precondition contract exists, refuse reclamation and preserve charge; do not invent a version/ETag field in today's client or execute DELETE. Current purge adapter has no such argument |

## Remaining Real-System Gate

The [lifecycle design](2026-10-02-bot-media-lifecycle.md#L53) proposes separate
active/quarantined/deleting/released state; these are not current receipt states.
Its 24-hour grace and exactly-once release rules are proposals, not permission to
age out pending/unknown work. Runtime `media_gone/410` is not shipped by this slice.

The bounded source oracle and concurrent full-schema HTTP transfer are now
executed; their copied-row/catalog and exact-link evidence are in the reports
above. This alone still uses fake Storage. A separately authorized isolated actual-SDK/Storage gate must
pin the deployed SDK/Storage implementation, prove normal PUT/GET and duplicate
controls, then observe lost/delayed replies and determine whether physical identity
and conditional operations are supported; an absent capability leaves HOLD and
requires a separate design decision. Timeout/abort/metadata disappearance cannot stand
in for generation-bound provider terminality. Unknown evidence keeps HOLD.

Avatar setters, variant source/target work, moderation and D103 must participate
under a reviewed concurrency contract before any closer is enabled. No DB
transaction may span network I/O. No successful DELETE, absent-reference proof,
quota release, production SQL/main deploy or native publication is asserted here.

## Historical Sidecar Validation

The original sidecar wrote only this report. Its validation was relative-link/line-target resolution
and whitespace checking of this file, plus source self-review: 82 relative links
and line targets resolve; trailing whitespace is absent. No application
suite, completed inline case, SQL session or provider/device operation was rerun
by that sidecar. Coordinator implementation/execution updates are linked above.
