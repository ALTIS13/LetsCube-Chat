# Native preview device binding plan - 2026-10-08

Status: resolver installed once and verified-postchecked; client retirement
SOURCE_ACCEPTED. Actual PG17.6/PostgREST14.12 delta49/49 and rollback passed,
followed by genuine QA-session API post-check. Next: isolated SDK-device binding,
then native capability/vault/card acceptance. Native display remains disabled.
[Installation and proof limits](2026-10-08-native-preview-device-binding-install.md).
No additional permission gate is needed; technical acceptance below is required.

## Accepted Baseline And Actual Gap

D335 installation/post-check acceptance is recorded by the coordinator in the
[PG17 report](2026-10-07-native-preview-pg17-rehearsal.md). Migration
`20261007210924_native_message_preview.sql` and its
[mirror](../../.migration-backup/supabase/migrations/20261007210924_native_message_preview.sql)
both locally hash to
`02681CFB8966EF7DEB362D95538DC4B787986772E4173A0777465A46DC1DE321`.
This source review does not independently repeat its production checks. Do not
reapply it; its retained "SOURCE PROPOSAL ONLY" comment is historical provenance.

The [registration definition](../../.migration-backup/supabase/migrations/20260921114126_android_push_session_binding.sql)
has two public `register_push_device` signatures: seven arguments return `void`;
eight arguments return only `(recipient_id uuid, recipient_session_id uuid)`.
The server derives the session and hashes `btrim(p_token)` itself. Client-supplied
`p_token_hash` is compatibility metadata, not authoritative. The conflict key is
`(provider, token_hash)`; the existing upsert can replace `user_id` and `session_id`.

[Push registration](../../artifacts/kub/src/lib/platform/nativePushRegistration.ts)
receives `{ value: string }`, the SDK token, not a database UUID.
[The controller](../../artifacts/kub/src/lib/platform/nativeVoiceController.ts)
sends `p_device_id: null`; that parameter populates optional **text metadata**,
not the primary key. Only `public.user_push_devices.id` is the UUID required by
the installed preview RPCs. There is no supported direct client SELECT grant on
this private endpoint table; do not add one to solve discovery.

Coordinator's prior legitimate-session probe observed zero current-session
Android FCM devices. A new lookup cannot create a missing registration. No auth
state, credential, endpoint or device data was read for this document.

## Decision

| Option | Effect | Decision |
| --- | --- | --- |
| Add `device_id` to the existing eight-argument ACK | Removes a read round trip, but changes the SQL OUT/return type. It cannot be made by ordinary `CREATE OR REPLACE` while preserving the same return contract; it also changes wrappers and existing catalog guards. | Not selected. Preserve both public signatures and their wire shapes. |
| Add a read-only, hash-selected binding RPC | One extra read after genuine registration; repeats live owner/session checks, never mutates or returns the endpoint. Existing clients remain unchanged. | Selected. |

Do not add a broad device listing, device-id guessing, a client table grant, or a
second registration call just to obtain the UUID. A distinct registration overload
would be a larger write-contract change, not this resolver.

## Proposed SQL And API Contract

New, distinct signature; this is an interface specification, not executable DDL:

```sql
public.native_push_device_binding(p_token_hash text)
RETURNS TABLE (
  binding_v smallint,
  recipient_id uuid,
  session_id uuid,
  device_id uuid
)
-- STABLE, SECURITY DEFINER, owner postgres, search_path = pg_catalog
```

Authenticated public-client SDK call:

```ts
client.rpc("native_push_device_binding", { p_token_hash: registrationHash })
```

Transport is a POST to `/rest/v1/rpc/native_push_device_binding`; the function is
database-read-only. Send the ordinary signed-in user's bearer credential and
existing public API key, never `service_role`. The body contains only the hash
selector; no supplied recipient/session/device UUID, raw token or consent.
Do not use a URL/query-string selector, request-body logging or captured traces.

Success is exactly one row with exactly four keys:
`binding_v=1`, `recipient_id`, `session_id`, `device_id`, all UUID fields valid.
The last field is **`d.id`**, never `d.device_id`. Refusal is `[]`, with no reason
that reveals another account's endpoint. Transport/auth errors remain failures,
not empty-success evidence; client copy/logs must not expose backend bodies.

Resolver body must perform these checks in one statement snapshot:

1. Require non-null hash matching literal `^[0-9a-f]{64}$`; no case folding,
   trimming or client-selected provider fallback.
2. Call the installed `public.native_message_preview_recipient()` and stop on
   NULL. It already requires authenticated, explicit non-anonymous claims,
   matching JWT subject/auth.uid(), bounded unexpired `exp`, and an existing own
   `auth.sessions` row with valid creation time and `not_after`. PostgREST verifies
   the signature; decoding claims in JavaScript or setting fixture claims does not.
3. Obtain `session_id` from the already-validated JWT. Match all FCM rows for the
   exact hash, and require **exactly one row before owner/status filtering**.
   Unexpected duplicates, including one eligible and one ineligible row, refuse;
   never `LIMIT 1`, newest-row ordering or fallback to any same-user device.
4. Return that row only when `d.user_id` and `d.session_id` equal the live pair,
   `d.platform='android'`, `d.provider='fcm'`, `d.enabled IS TRUE`, and
   `d.revoked_at IS NULL`. Legacy unbound rows and foreign/old sessions refuse.
5. Return `1::smallint` and the exact pair plus `d.id`, nothing else. No INSERT,
   UPDATE, DELETE, timestamp touch, backfill, endpoint enablement or consent write.

Use qualified relations/functions under the pinned search path, following the
installed D335 definer pattern because callers deliberately cannot read endpoint
rows. Revoke new function execution from PUBLIC, anon, authenticated and
service_role, then grant authenticated only; verify effective privileges, including
inherited grants. Existing RLS, table/column ACLs, function definitions/default
ACLs and registration behavior must remain unchanged. Do not create a new index:
the existing unique FCM/provider-hash index is the expected baseline; verify it
is valid. A drifted baseline must be refused, not repaired by this migration.

### Hash And Identity Limits

The selector is lowercase SHA-256 of UTF-8 bytes of the server's canonical token.
Current [metadata generation](../../artifacts/kub/src/lib/platform/nativeVoiceCalls.ts)
hashes the raw SDK value, while SQL `btrim` removes edge ASCII spaces. For this
minimal integration, require a nonempty SDK token without edge ASCII spaces
before using that existing hash. If noncanonical or hashing fails, leave preview
binding unavailable; ordinary registration is unchanged. Do not use JavaScript's
broader `trim()` as a purported identical SQL normalization.

The hash is an endpoint identifier, not a secret-derived authorization credential
or physical-device attestation. Keep it only in operation memory; do not persist,
log, return, include in public receipts, or add another server hash column. The
existing server column remains authoritative for comparison. Hash equality alone
does not grant access: owner, session, status and cardinality all remain required.
Do not claim mathematical collision exclusion or OS/device ownership from this
read. A known hash under another account/session must produce the same refusal.

**Important existing write boundary:** normal registration already reassigns a
conflicting endpoint. This resolver never reassigns it, but cannot retroactively
prevent that upsert. Legitimate QA must use only the isolated app instance's own
SDK-issued token, never a primary-profile/copied endpoint. If the requirement is
to prevent *all registration-time reassignment*, a separately reviewed registration
write-contract change is required; a read-only lookup cannot establish that
guarantee. Do not silently include such a change here.

## Client Integration And Retirement

Reuse the actual registration callback in `nativeVoiceController.ts` and the
SDK/RPC adapter in `nativeVoiceCalls.ts`; do not add a second listener/controller
or an unrelated Settings registration flow. The new adapter method has a typed
unknown-to-validated response boundary, separate from `verifiedNativeVoiceBinding`.
Map the exact resolver row to the existing
[MessagePreviewBinding](../../artifacts/kub/src/lib/platform/nativeMessagePreviewContract.ts)
shape `{ recipientId, recipientSessionId, deviceId }`; do not enlarge the voice
bridge binding or reinterpret `p_voice_call_protocol` as preview support.

Only start resolution after a successful eight-argument registration ACK whose
recipient/session exactly match the current context. A legacy void ACK, missing
session, rejected registration, timeout or unknown ACK cannot publish a preview
binding. Legacy ordinary push remains usable. Do not repeat the mutating RPC to
recover an unknown ACK or make legacy success look session-verified.

Capture `{recipientId, recipientSessionId, accountEpoch, generation,
identityRevision, tokenRevision}` and the private hash for that exact ACK. Compare
the authoritative store auth identity/account epoch, controller context and token
revision before dispatch, after completion and before publication. The existing
store epoch already retires real session replacements before profile loading.
Add only a local token revision for the new candidate: rotation must retire it
immediately even when the existing registration operation queues the next token
under the same generation. Do not let the old token's late response temporarily
publish while a newer rotation is waiting.

The resolver is optional, bounded owned work, not a prerequisite for ordinary
`native_active` or voice ACK/commit success. Resolve outside the registration's
success/timeout path; its failure leaves candidate NULL without undoing genuine
ordinary registration or committing an unrelated preference. No busy retry loop:
the next genuine owned registration/refresh can retry the read; it does not force
another registration solely because the resolver is unavailable.

Synchronously retire candidate and in-flight publication on logout, different
account, accountEpoch change (including logout then same account), new same-user
session, disable, token rotation, controller invalidation or disposal. Expired
access cannot authorize a new resolution. Normal refresh with the same session
must not bump the store epoch or reset UI; the controller already advances its
operation generation and can reacquire after its normal registration. Abort when
available, but rely on identity fences rather than abort success for correctness.
Old completion cannot republish; no localStorage/native persistence of this new
candidate in this prerequisite slice.

## Consent, Revocation And Native Boundary

Resolution is not consent. Missing preference stays `none`; discovery must not
write `notification_preview_preferences` or toggle push/privacy settings. The
installed `native_message_preview_capability(deviceUUID)` independently repeats
live session and exact enabled/unrevoked-device checks and reads current consent.
Existing [preview hook](../../artifacts/kub/src/hooks/useNativeMessagePreview.ts)
also fences accountEpoch/auth/operation/expiry and compares the native candidate
again after capability ACK. Preserve that authority rather than bypassing it with
the new JavaScript resolver result.

Revocation, session deletion/expiry, endpoint owner/session replacement or disable
before lookup causes refusal. Changes after the statement can race its response:
the UUID is only a candidate selector, not a lease. Every later preview request
must reauthorize live session/device/consent/source. No resolver can promise atomic
OS display authorization, autonomous background credential refresh or immediate
cross-process card retirement. Those remain separate native lifecycle work.

[MainActivity](../../android/app/src/main/java/com/kub/messenger/MainActivity.java)
does not register `MessagePreviews`; the
[existing adapter](../../artifacts/kub/src/lib/platform/nativeMessagePreviews.ts)
therefore cannot negotiate an actual native preview candidate today. This plan
does not add that plugin/vault/fetch, expose bearer tokens to it or enable rich
payloads. Existing generic chat v1 and voice contracts remain unchanged.
Keep `nativePositive=false`, `richPreviewEnabled=false`, `canPublishRich=false`.
A resolver-positive UUID does not change any of those flags.

## Focused Acceptance And Stages

1. **Additive server slice:** independently review the new function and migration
   only. Require exact target/before-state, absence of any same-name overload,
   unchanged registration/D335 definitions and endpoint ACLs/index. Use section10
   verified fresh before-backup, one transaction, bounded lock/statement timeout,
   transaction advisory lock and raising signature/body/owner/mode/search-path/ACL
   self-checks. Lock/check only relevant dependencies, not unrelated tables.
   Numbered SQL and mirror must be byte-identical. Unknown/lost apply ACK means
   read-only catalog/history reconciliation, never blind replay.
2. **Actual SQL tests:** load the new function plus actual registration and
   installed recipient definitions in the existing fictional SQL harness. Start
   with resolver-absent RED, then genuine registration -> exact `d.id` positive.
   Check wrong hash, malformed hash, foreign user/session, same-user replacement,
   anonymous/expired/deleted/hard-expired session, disabled/revoked/unbound row,
   wrong platform/provider, and duplicate hash with one eligible row. Distinguish
   text `d.device_id` from UUID `d.id`. Assert no endpoint/consent/session writes;
   no new direct table/column grant. Use literal/version/cardinality/owner/session/
   enabled/revoked/output-ID mutants and raising ACL/search-path omission controls.
3. **PG17/API gate:** rehearse only this delta on the accepted isolated full-schema
   mechanism with actual signed JWT HTTP positive/negative cases, schema-cache
   visibility, preserved ACL/RLS/old functions and rollback. Fixture claims alone
   do not prove signature verification. Install once after acceptance; perform
   exact catalog plus legitimate live-recipient post-check, without fake production
   auth/session/device rows. Rollback disables new consumers first and drops only
   `public.native_push_device_binding(text)`, no CASCADE/data restore/D335 drops.
4. **Client slice:** selected actual controller/adapter tests with held ACK and
   held resolver, both response orders, token rotation queued during registration,
   old epoch/new same-user session/dispose, legacy ACK, read refusal/malformed/multirow
   response and ordinary-success controls. Compile literal omission mutants for
   ACK, owner/session, token revision and epoch publication fences. Do not rerun
   unrelated accepted native/D335 suites.
5. **Legitimate device binding:** use the isolated Realme QA app instance's normal
   sign-in/SDK registration, exact acknowledged owner/session and resolver UUID;
   independently verify the exact enabled current-session row and unchanged primary
   endpoint/account. Public evidence contains booleans/counts only. No endpoint
   copying/reassignment, fake production rows, message send or personal capture.
   Zero devices is an observed availability gap, not success. Separate native
   capability/credential/display implementation and physical evidence come later.

Immediate blockers to native preview, not to drafting this resolver: current ACK
lacks row UUID; a real current-session QA registration is still needed; native
`MessagePreviews` is absent. Global non-reassignment would require the separate
write-contract decision above. This document resolves the discovery design only,
not D335 native/display acceptance, FCM delivery or OS privacy proof.

## Task 1 Source Result - 2026-10-08

This historical source checkpoint superseded the initial design-only Task 1;
the current status above and linked reports supersede its pending stages.
BASE `f1613d13`. Added only the
[SQL proposal](../../supabase/migration-proposals/native_push_device_binding.sql)
and [focused actual-SQL test](../../tests/server/native-push-device-binding-db.test.mjs).
Detailed implementation, calibration and evidence limits are in
[tracked source report](2026-10-08-native-preview-device-binding-source.md).

Calibrated resolver-absent RED: 1 failure, 2 actual registration/recipient controls
passing. Final focused GREEN: 53/53, zero skips, including 23 compiled mutants
(12 behavioral, 9 raising definition/ACL, 2 effective-ACL/lock-order). Genuine
registration resolves `d.id`, not text metadata; same-user replacement, live
session/status/hash/cardinality, non-superuser session/ROLE, read-only transaction,
old-row/function/RLS/ACL preservation and RESTRICT rollback controls pass.
Dependency/endpoint ACL/index checks follow the table lock. Raw proposal bytes are
not normalized; changed CRLF body bytes correctly refuse the pinned prosrc MD5.

Frozen SHA256:

- SQL: `DEA6A3988B7E3B4060A086FE069A2C214B294EF3AD5334B5713736A5C0C1CBBF`.
- Test: `1C500B0D494627A44CEC236CDBD9255C3C2E22880C16ED70258E88E82EFE1ABA`.

Actual PGlite pgcrypto and immutable registration/installed recipient bodies were
used; fictional claims/rows do not prove signatures, HTTP, native registration or
device ownership. No old suites, numbered migration/mirror, network, live auth/production SQL
dispatch, runtime/native edit, device, commit or delegation. D335 installed file
and mirror still hash to `02681CFB8966EF7DEB362D95538DC4B787986772E4173A0777465A46DC1DE321`.
All finite test jobs closed. Independent review accepted exact source range
`f1613d13..767d9321`, no P1/P2; it reused the frozen run evidence rather than
replaying tests. Source accepted only; native/rich/display flags
remain false and PG17/live before-state/install acceptance remains a later stage.
