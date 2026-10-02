# Bot Inline Media Ingest - 2026-10-02

## Resume

Owner: Codex coordinator. Stage: D-258 frozen candidate; guarded rollout.
Source baseline: `c0b79cb0`; branch `codex/bot-inline-media-20261002`.
All three workers are closed. Goodall independently approved the final
runtime/SQL/SDK integration; coordinator owns deployment and live acceptance.
Android build/install/publication remains held. SQL is already applied once;
do not reapply the first-install file. No native release is part of
this backend/shared-web wave. Next: deliberately deploy the Gateway,
run the synthetic public-API canary, then update this record
with the actual running image and acceptance rather than a webhook result.

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

Public-API acceptance and exact running-image proof are separate from the source,
fixture and restored-DB evidence above. Do not close D-258 based only on these
checks. Operator orphan reconciliation and quota reclamation are outstanding:
resolve unknown commit outcomes and prove no message references before removing
only receipt-owned objects. This wave does not reset quota on bot deletion,
claim unlimited storage or automatically reclaim failed admissions.
