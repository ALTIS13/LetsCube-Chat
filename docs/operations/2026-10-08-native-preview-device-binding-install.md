# Native Preview Device Binding: Rehearsal And Installation

Date: 2026-10-08 Moscow. Coordinator; source BASE `e40925d9`.
Status: resolver installed once and verified-postchecked. D335 remains OPEN;
nativePositive=false, richPreviewEnabled=false, canPublishRich=false.
[Contract](2026-10-08-native-preview-device-binding-plan.md) and
[client source acceptance](2026-10-08-native-preview-device-binding-client.md).

## Before-State And Backup

Exact production container/image/cluster/database/OID/socket were checked before
and after owned phases. PostgreSQL17.6; installed foundation functions3, resolver0.
One fresh backup completed with15 verified checksums and3200 archive objects.
Current full source schema and effective security matched before/after the dump
and matched the sealed backup again before materialization/install. Target and
metadata receipts remain private; no archive, role-password hashes or tokens
were emitted or copied into public documentation.

The guarded wrapper preserves all existing effective ACL/RLS/function metadata
and typed dependencies, including installed consent columns/defaults/constraints/
indexes/triggers. Relevant tables are locked before checks. One BEGIN/COMMIT,
bounded timeouts, advisory transaction lock and raising target/body/signature/
owner/search-path/ACL/preservation checks protect the additive function. Existing
registration ACKs, endpoint rows, consent and the three foundation functions stay
unchanged. Only the exact new function is excluded from after-state comparison.

## Actual PG17 Rehearsal

The first R3 restore passed, but its delta refused before install intent because
clone digest reads used the default search_path while guards used canonical
`pg_catalog,public`. The owned copy was removed by the verified failure handler;
no production SQL ran. Diagnostics exposed only fixed refusal tags/booleans.

R5 uses the same canonical read-only digest transaction as the wrapper and exact
PostgREST14.12 denial classes: ACL401/42501, service403/42501, bad signature
401/PGRST301, expired claims401/PGRST303. This follows the
[exact upstream14.12 source](https://github.com/PostgREST/postgrest/blob/v14.12/src/PostgREST/Error.hs),
not an older tutorial. Independent source review accepted the repaired wrapper,
four generated payload pins and intent-directory fsync barrier; no P1/P2.

A distinct known-clean copy restored the same full archive with network disabled,
dispatch off, equal effective security and only the fixed19 raw-format blocks.
Actual wrapped transaction, signed-JWT HTTP positives/negatives and RESTRICT
rollback passed:49/49, zero skips. Existing data, security, typed dependency and
old function definitions were preserved. The HTTP listener was stopped and
owned copy removal was independently observed by cleanup. These were real PG17/
HTTP tests inside the isolated copy, not production device or delivery tests.

Sealed rehearsal receipt SHA256:
`A3F34B819D1D798016BD80868638CC72FA18C4285A42C192BD2AB837127F7595`.

## Production Installation

Supabase CLI generated the timestamped empty migration; the reviewed generator
materialized it and a byte-identical new mirror:

- `supabase/migrations/20261008004222_native_push_device_binding.sql`
- `.migration-backup/supabase/migrations/20261008004222_native_push_device_binding.sql`
- SHA256: `04E463210864A81AB76871F3D4F60151B818BBC1E9D56FB26E9A171C4B2E6E6B`.

The materializer's first invocation lacked the required QA environment and refused
at its initial local gate; the CLI placeholder was still0 bytes, mirror absent.
The corrected invocation materialized once. No SQL dispatch had occurred then.
Historical proposal comments retained in generated SQL are provenance, not the
current installation status.

The genuine owned QA session was refreshed once through ordinary Auth refresh,
then verified by Auth GET; original state was preserved. Prepared bytes, target,
backup freshness and locked read-only guards were checked before one production
dispatch. At03:44 Moscow the installer returned `stage=verified`,
serverVerified=true, sqlDispatches=1. Catalog/body/privileges and preservation
checks passed; active SQL process and matching terminal receipt were reconciled.

Real production API post-checks: owned live recipient200/matches Auth user,
malformed hash200/[], anonymous401/42501. No fabricated Auth/session/device rows,
copied endpoint, consent change or message send. This is installed resolver and
negative-device authorization evidence, not SDK-device or native card acceptance.
Private attempt receipt SHA256:
`BA25A3B0406DB3AC4BC0954B6FD47F88907EAEE74667B34D9CC591D76C1EB66C`.

Never reapply this migration or installed foundation
`20261007210924_native_message_preview.sql`. Unknown ACK must use observation-only
verification, not replay. Rollback, only after new consumers are disabled:
`BEGIN; DROP FUNCTION public.native_push_device_binding(text) RESTRICT; COMMIT;`.
No CASCADE, data restore, endpoint deletion or foundation drop.

## Next Boundary

Client sidecar SOURCE_ACCEPTED61/61 including10 mutants, adjacent9+4 and
typecheck0. It is not yet installed APK proof. Next: isolated Realme instance's
normal sign-in/SDK registration, exact owner/session ACK and resolver row UUID,
with current enabled row and unchanged primary endpoint independently checked.
Native MessagePreviews plugin, private credential vault, explicit choice,
background reauthorization and physical OS card/privacy/lifecycle acceptance
remain separate work. Generic notification v1 and voice behavior are unchanged.
