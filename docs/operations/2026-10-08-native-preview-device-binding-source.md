# Native preview device binding: source acceptance

Date:2026-10-08 Moscow. Coordinator owns publication; Linnaeus implemented the
bounded source task from BASE `f1613d13`. Status: REVIEW_READY, not installed.
[Contract and remaining stages](2026-10-08-native-preview-device-binding-plan.md).

## Changed Scope

- `supabase/migration-proposals/native_push_device_binding.sql`
- `tests/server/native-push-device-binding-db.test.mjs`
- Plan/source evidence only; existing migrations and runtime sources unchanged.

The new read-only `native_push_device_binding(text)` returns exactly
`binding_v=1,recipient_id,session_id,device_id` or zero rows. Device authority is
the actual `user_push_devices.id`, not text metadata. It uses the installed live
recipient helper, exact session/canonical SHA-256 selector and one FCM match
before Android/owner/enabled/unrevoked filtering. No endpoint/consent write,
registration retry, token return or existing seven/eight-argument ACK change.
Existing registration can reassign a conflicting endpoint; this read-only slice
does not claim to prevent that separate write behavior.

One transaction, bounded timeouts/advisory lock, absent-name guard and post-lock
dependency/ACL/index checks precede the new definition. Raising checks pin raw
body MD5, language/owner/STABLE/definer/search_path, exact input/OUT names/types
and effective authenticated-only execution. Header rollback drops only the new
function with RESTRICT after disabling consumers, never CASCADE or data restore.

## Verification

Only the new-file actual SQL tests and syntax check ran:

```powershell
node --test tests/server/native-push-device-binding-db.test.mjs
node --check tests/server/native-push-device-binding-db.test.mjs
```

Calibrated resolver-absent RED: one assertion failure while two actual registration/
recipient controls passed. The first expanded harness conflated JWT and SQL roles
and an owner mutation stopped at SET ROLE permission; those setup failures were
corrected and are not source RED or acceptance. Final frozen GREEN:53/53, zero
failures/skips,38.66583 seconds; syntax exit0. Preliminary49/49 is superseded by
the changed lock-order/raw-byte/strict-session controls, not counted twice.
No unchanged D335/registration/native or whole-application suites were replayed.

Coverage includes real registration/pgcrypto/recipient bodies, literal UUID versus
text metadata, same-user replacement, foreign/missing/expired/deleted/future
session, caller non-superuser session_user and denied SET ROLE, malformed/wrong
hash, disabled/null/revoked/wrong-provider rows, duplicate before filtering,
read-only transaction and preservation of old rows/functions/RLS/ACL/default ACLs.
Existing-name/index/column-grant drift, post-lock ACL refusal and restricted
rollback pass. Applying raw CRLF-altered bytes correctly refuses the fixed body
MD5; the loader does not normalize away that mismatch.

Twenty-three compiled mutants are rejected:12 behavioral (version, exact UUID,
owner/session/status/provider/hash/cardinality),9 raising definition/ACL variants,
and2 effective inherited-ACL/pre-lock-regression variants. Behavioral mutants
must fail AssertionError, not SQL/import/setup; raising mutants must reach P0001
and leave no partially installed function/grants after rollback.

## Limits And Next Gate

PGlite0.5.8 uses actual pgcrypto and immutable registration/installed recipient
bodies. Claims/rows and the limited endpoint schema are fictional; this is not
full-schema PG17 recovery, signed JWT/PostgREST, SDK/FCM registration, concurrent
physical locking or device/native display proof. No secrets, network, production
SQL dispatch, numbered migration/mirror, native/client edit or device allocation.
All finite test jobs/PGlite instances ended. Detailed local run report is retained
in this plan's ignored SDD workspace; this tracked report is the Git handoff.

Frozen SQL SHA256:
`DEA6A3988B7E3B4060A086FE069A2C214B294EF3AD5334B5713736A5C0C1CBBF`.
Frozen test SHA256:
`1C500B0D494627A44CEC236CDBD9255C3C2E22880C16ED70258E88E82EFE1ABA`.
Installed D335 SQL/mirror remain unchanged:
`02681CFB8966EF7DEB362D95538DC4B787986772E4173A0777465A46DC1DE321`.

Next: independent source review, then focused PG17/JWT delta and reviewed fresh
before-backup/install wrapper/post-check. Client ACK/epoch/token-revision fences,
legitimate isolated device binding and missing MessagePreviews bridge follow.
D335 stays OPEN; nativePositive=false/richPreviewEnabled=false/canPublishRich=false.
