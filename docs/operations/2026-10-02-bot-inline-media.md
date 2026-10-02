# Bot Inline Media Ingest - 2026-10-02

## Resume

Owner: Codex coordinator. Stage: D-258 bounded upload accepted in production.
Source baseline: `c0b79cb0`; branch `codex/bot-inline-media-20261002`.
All three workers are closed. Goodall independently approved the final
runtime/SQL/SDK integration; coordinator owns deployment and live acceptance.
Android build/install/publication remains held. SQL is already applied once;
do not reapply the first-install file. No native release is part of
this backend/shared-web wave. Gateway/web/worker source `2900eeb7` is healthy,
and the synthetic public-API canary passed 9/9. Accepted-copy web `2bb761ed`
passed deployed documentation 3/3. The [read-only audit](2026-10-02-bot-media-reconciliation.md)
then passed 9/9 fixture cases and the guarded production snapshot. Next: reviewed
lifecycle/fencing contract before orphan/quota reconciliation; no automatic
cleanup or quota release is part of this wave.

## Observed Cause

The shipped `sendDocument`, `sendVideo` and `sendVoice` accept existing references
and `file_id`, not new bytes. Their 256 KiB JSON parser rejects ordinary inline
media before a handler runs. Photo uploads already work; do not reopen that
completed feature. An independent audit found that the existing photo upload
also lacks a durable admission reservation and total storage budget.

## Bounded Contract

- Preserve existing `media` and `file_id` requests and response envelopes.
- Add typed JSON/base64 `document`, `video` and `voice` inputs. Accept PDF;
  MP4/WebM video; WebM/Ogg/MP3 audio. No arbitrary URL fetching or claim of
  Telegram multipart compatibility. Each new byte upload is at most 6 MiB.
- Authenticate before the 9 MiB parser. Limit concurrent admission before
  buffering, both globally and per bot. Text retains the 256 KiB parser.
- New byte uploads do not yet accept topics, replies or inline buttons, matching
  the existing photo-byte restriction; existing reference sends retain them.
- Decode canonical base64, validate actual content, and derive duration and
  dimensions from a constrained media probe, not caller-supplied metadata.
- Reserve `(bot, key, method, fingerprint)` durably before Storage. Bind the
  lease to the active token, chat, generated path, MIME, byte count and digest.
  Same-key/different-payload fails before upload. Same completed retry returns
  the prior result; an active equivalent lease is retried later, not concurrently.
- Count all reservations, including failed uploads, against rolling/lifetime
  budgets. Retried identical sends do not consume the budget again. Initial
  bot budgets: 60 MiB/24h, 256 MiB retained and 1000 objects. Initial global
  budgets: 600 MiB/24h, 2 GiB retained and 20000 objects. These are explicit
  conservative service limits, not Telegram's limits or an unlimited promise.
- Upload insert-only and verify a duplicate object's actual bytes before reuse.
  The final grant, message and completion receipt commit atomically. Recheck
  token and membership then; an in-flight revoked token cannot commit.
- Never delete an attachment because a send response was lost. Unconfirmed
  objects stay quota-charged and retry-stable. Dedicated, race-safe operator
  cleanup is a follow-up; this wave does not claim automatic orphan reclamation.
- Protect only the Storage bot namespace from ordinary-user writes; preserve
  ordinary attachment paths and same-chat readable `file_id` resends.

## Evidence Boundaries

The initial actual loopback Gateway check accepts all three `file_id` controls,
rejects all three new byte shapes, and returns 413 for large bodies. SQL archives
explain candidate risks but are not proof of current deployed function parity.
No personal content, native build, phone installation or paid device session is
needed for this server contract. Live proof must use explicit QA identities and
must not log tokens, bodies, signed URLs or production media.

## Reference

Telegram Bot API `Sending Files`, `sendDocument`, `sendVideo` and `sendVoice`
were consulted on 2026-10-02: <https://core.telegram.org/bots/api>.
That is an API reference, not a measured native Telegram client. LETSCUBE's
smaller JSON/base64 contract and response shape are intentionally documented.

## Implementation And Review

`sendDocument`, `sendVideo` and `sendVoice` have new typed byte sources, with
the existing `media`/`file_id` shapes retained. The four media methods authenticate
before buffering and share process-global admission: four requests, one per bot,
including a disconnected response whose handler is still running. Parsing errors,
failed auth and interrupted bodies cannot retain a stale permit.

The owned seekable FFprobe file permits trailing-moov MP4, disables MOV external
references and all network protocols, and uses a restricted container/codec set.
The probe inherits no service credentials. PDF uses Poppler. Three independent
review findings were reproduced and repaired before rollout:

- Unicode line separators in PDF Title could forge `Pages: 1`; a real synthetic
  10001-page PDF went RED. Physical LF fields, unique Pages/Encrypted fields and
  ASCII field parsing fix it. Seven regressions and four semantic mutants pass.
- Correct expired leases incorrectly mapped to forbidden; they now map to
  `55000 bot_media_ingest_lease_expired` / HTTP 429, retry_after 1. Wrong ownership
  stays forbidden. A fresh lease recovers without another admission charge.
- Rollback could delete a policy another owner changed. Exact policy expressions,
  modes/roles, table owner/RLS and ledger table/column ACL guards now refuse drift,
  under locks that close check-to-drop races. Thirteen drift cases and the guard
  omission mutant prove refusal and catalog preservation.

A same-fingerprint legacy-command bypass was also fenced by the private ledger's
`commit_xid`, not a caller-settable GUC. Only the validated commit transaction can
send an incomplete reservation. Completed receipts survive the legacy 24-hour
idempotency cleanup. Insert-only duplicate Storage verification streams with a
byte bound, digest check, timeout/cancellation and no ambiguous eager deletion.

PocketFlow's `sendBytes` snapshots the bytes and key before retry. It does not
mint another key on conflict or retry an exhausted quota. Its selftest now uses
real new PNG bytes plus `getFile`, rather than declaration-only support. A
standalone `uploadFile` is still unsupported; no multipart compatibility is claimed.

## Frozen Validation

- Final configured unit run: **4946 passed, 0 failed, 1 explicit exclusion**.
  The excluded `Android aggregate assemble fails closed without release signing
  inputs` starts Gradle and is outside the current Android hold. An earlier full
  run inadvertently started that signing-gate probe and timed out; no APK,
  signing, installation or publication occurred. It was not repeated.
- Focused runtime/schema/storage/PDF/PocketFlow: **107/107**, zero skips.
- Existing unchanged server cases: **357/357**. Final new PostgreSQL suite:
  **26/26**, zero skips, with real concurrency, rollback and semantic mutations.
  An earlier concurrent run was invalidated by SQL edits and is not acceptance.
- Fresh full archive restore in isolated PostgreSQL **17.6**: seven groups pass,
  including actual message metadata/grant consumption, lost response, revocation,
  lease recovery, authenticated Storage isolation and exact catalog rollback.
  No network, published ports or host mounts; restored scheduled jobs disabled;
  the exact owned container was removed. Production mutations/provider sends: 0.
- Actual Linux FFmpeg 5.1.9 / Poppler 22.12: **14/14** synthetic parser cases,
  including real MP4/WebM/Opus/Ogg/MP3 and PDF Title injection. Unprivileged,
  readonly network-none container; exact owned image/container removed.
- KUB/API/PocketFlow typechecks pass; actual API build includes the Gateway.
  Public documentation passed Chromium 1440/390 and WebKit 390. Browser extension
  works, and changed elements were inspected at 1440/390 in both themes with no
  console errors or horizontal page overflow. No personal production captures.
- Restored Chrome was used for direct DOM/pixel verification. No paid
  Figma/Mobbin/Rive/MobileNext credit or device session was needed for this contract.

The earlier nine opt-in visual failures were a fixture-address mismatch: the
tests explicitly require 5218, not 5303. All 27 focused fixture cases passed at
5218, then the full configured unit gate passed. No product patch was made for
that harness configuration error.

Migration raw SHA256:
`578e1c60ea40226b050d254ccacd8e9081cd0bdc03b46bc17184151f273d4280`.
Rollback raw SHA256:
`41c5f150e1f0e050c1f603604de1ed30f6c3f66014386e0ba814f7669f44abb4`.
Both copies in `.migration-backup/supabase/migrations/` are byte-identical.
The first verified full backup was `20261002-134829`; the guarded apply helper
takes and verifies another fresh backup before its one transaction.

## Production SQL

Applied once at **2026-10-02 14:45 MSK**, after fresh backup `20261002-144507`.
All 15 archive checksums passed and `pg_restore --list` accepted the full archive.
Its SHA256 is
`fa072c7d552d68491e9469e9f5113f23e5efd925b107a6fd610cc1f48afc3f75`.
The exact migration and rollback are archived mode 600 in
`/srv/letscube/backups/bot-inline-media-20261002`; the directory is root:700.
The apply receipt is written there only after an independent connection checks
all five function bodies/owners/ACL/settings/volatility/security-definer flags,
ledger RLS, all three restrictive policies and zero public tables missing RLS.
PostgREST schema reload was notified. Do not automatically retry or reapply:
the durable ledger deliberately survives rollback.

## Remaining Boundaries

Public-API acceptance and exact running-image proof are recorded below separately
from the source, fixture and restored-DB evidence. Operator orphan reconciliation
and quota reclamation are outstanding:
resolve unknown commit outcomes and prove no message references before removing
only receipt-owned objects. This wave does not reset quota on bot deletion,
claim unlimited storage or automatically reclaim failed admissions.

## Production Acceptance

The reviewed candidate was pushed to its own branch, then fast-forwarded into
`main` at `2900eeb71e76cb763fa5a4720c3e7cb49e162ef8`. The outgoing range was
read separately, and all two alias imports in the three commits resolved in
their own trees. Gateway auto-deploy is disabled; deployment
`ldxhqznw2zngrr3qjy6irze4` was deliberately requested. Acceptance waited for
the old replica to leave. Web, Gateway and worker then each had one healthy
exact-revision image. Gateway runs as `node`, with FFmpeg 5.1.9 and Poppler 22.12.

The real public API passed **9/9** in a newly created dedicated QA group:
WebM/Ogg/MP3 voice, MP4/WebM video, PDF and PNG; byte-exact signed-URL download;
unchanged original receipt on an identical retry; a different payload with the
same key refused as 409; same-chat `file_id` resend; exactly 14 bot messages;
and a user's new photo delivered to the full-access bot without mention/reply.
The exact QA group was deleted, token revoked and bot returned to pending
deletion. No personal media or provider messages were used or logged.

Two earlier attempts exposed harness errors, not product failures: total-row
count included one group-join system message, then the user-photo fixture used
the wrong bucket/path. Current web uploads use `media/{user_id}/...`; live
catalog policy and the actual `chatAttachmentUploadPath` confirmed it before
the fixture was corrected. Both attempts cleaned their exact QA state. Their
admissions remain conservatively charged; the test does not reclaim objects.

Public documentation passed **3/3** deployed Chromium 1440/390 and WebKit 390
checks with mutations/screenshots/traces/video off. Public entry
`/assets/index-4fvXYyBb.js` SHA256
`92d1793a93293abc343c88079dee8aab0a550a58e95ec326ba409f218cc356c1`
and service worker SHA256
`0649fb894d2621ca5ad171fdc558c1892f60cc6322302ca1ae225b59c496ebe3`
match the exact running web container. New media/quota markers are present;
the retained `/assets/index-CnzTxZ8s.js` is unchanged, SHA256
`3ae640cb14776e764ea1eae4b966f5836a188bc9a63776e9da0c2f61775b4ffb`,
and lacks the new media-limit marker. Public-table RLS omission count remains 0.
The acceptance-documentation publication is recorded below; its content changes
require neither another Gateway deploy nor a migration.

The final acceptance copy passed KUB typecheck and an actual web build
(`sw.js build d9324cbfbe9c2199`, 19.79s). Five literal rendered assertions now
cover the supported PDF heading, 6 MiB/9 MiB bounds, PDF page/password bound,
stable receipt semantics and absence of the obsolete candidate notice. The
strengthened spec was red against the published candidate copy and green
locally in Chromium 1440/390 and WebKit 390 (3/3). Restored Chrome inspected
the exact updated element in both
themes at 1440/390 with no console errors. Viewport/media overrides were reset,
the ephemeral tab closed and all three owned dev servers stopped.
The final read-only nine-file review approved the copy with no P1/P2 blockers;
its remaining lease-time wording was corrected to 1-120 seconds. Independent
production aggregate proof for the exact `d258:` QA key prefix shows 21 complete
admissions, all with results/completion timestamps, and 35,430 retained charged
bytes across the three attempts. No quota was reset by QA cleanup.

## Accepted Documentation Publication

Reviewed copy `2bb761ed120b3489cf6422b2c74d9d7ef86a5f90` was pushed to the
candidate branch before the main fast-forward. Its one outgoing commit was read
separately; both alias imports resolve in its own tree. The sole healthy web
replica carries that exact image. The strengthened public spec is now deployed
green **3/3**, with mutations and all captures off.

Public entry `/assets/index-CWBgVg3u.js` SHA256
`e5e2d0993054d46996c5b30e55954d139217d75cc0a57e7056984a6fe999436d`
and service worker SHA256
`74d2cd9a7e779853db9af7e9465c61c2d35097489a74c0c8cfd7b6801f2b0cbc`
match the container. The new PDF heading is present and `Кандидат D-258` is
absent. Both retained old entries keep their established hashes; the immediately
previous `index-4fvXYyBb.js` still contains the candidate notice. Gateway/worker
remain on accepted runtime `2900eeb7`; no extra rollout of them was needed.
