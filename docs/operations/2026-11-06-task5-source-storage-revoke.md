# Task 5: Source Membership Revocation In Storage

Owner: Codex, LETSCUBE stream 5. Stage: one live source-revoke boundary
measured on 2026-11-06 MSK, then cleaned. Source baseline `f5716276`;
Storage runtime `supabase/storage-api:v1.60.4`. No product code changed.

## New Evidence

The [Task 5 plan](../superpowers/plans/2026-10-18-production-completion.md#task5-trusted-media-authority-78d-336--339)
separates real Storage from source/controlled evidence. The
[earlier signed-media canary](2026-09-27-signed-media-canary.md) tested an
outsider and short-link expiry, not the same reader across a committed revoke.
The [D-336/D-337 wait cases](2026-10-03-bot-media-authority-waits.md) are a
different boundary: in-flight trusted writes, not issuance of a Storage URL.

Reused the [owned gallery fixture](2026-10-25-authenticated-media-qa.md): the
same deterministic 3,608,655-byte PNG, SHA-256
`1d35ba9565d0781d0733c8e5ab5fa027381b2570eeb41a608fdda8d932c08b56`.
Uploaded it once as an ordinary `file` in a fresh group with only its QA
uploader, then added and removed exactly one non-author QA member. Two
confirmed test accounts and the normal authenticated APIs did all writes;
the independent catalog/state audit used `BEGIN READ ONLY`. No real user
account, message, object, or pre-existing session was used as a fixture.

| Live phase | Exact observation |
| --- | --- |
| Reader not yet a member | Fresh single-object sign returned HTTP `400`, Storage `404`; zero rows for the exact message under reader RLS. |
| Reader admitted | Exact message visible; sign `200`; signed GET without credentials `200`, full byte count and SHA-256 matched. |
| Source membership revoked | Owner DELETE returned the exact reader row; DB showed one remaining member, live source and original intact. The **same JWT** got `400` / Storage `404` for fresh sign, and zero exact message rows. |
| Byte reads after revoke | Previously issued 60-second URL, anonymous public URL (no API key or JWT), and uploader's authenticated GET all returned `200` with the full original byte count and matching SHA-256. |

This proves **fresh signature issuance is revoked, not access to the bytes**.
The live catalog independently showed `storage.objects` RLS enabled and
`media.public = true`. Public serving and signing are separate operations
([Supabase Storage serving](https://supabase.com/docs/guides/storage/serving/downloads)).
The pre-issued URL was measured after revoke, not through its expiry; no URL,
token, credential, or account identifier is retained in this report.

## Reproduction And Cleanup

[Opt-in test](../../tests/rehearsal/task5-source-storage-revoke.test.mjs), final
SHA-256 `15b517a660ba1ee3596ffa2c98c17172f6620f7feb81bdaea5d1927b3ff43be6`:

```powershell
$env:LETSCUBE_TASK5_SOURCE_REVOKE = '1'
$env:KUB_QA_ALLOW_MUTATIONS = '0'
node --test tests/rehearsal/task5-source-storage-revoke.test.mjs
```

Final run: **1 pass, 0 failed, 0 skipped**, 30.7 s. No opt-in means no live
requests. One earlier fixture-hash preflight refused before Auth. The first
live cohort reached member sign and GET `200` but stopped at the test's
`Content-Length` requirement before revoke. It cleaned successfully. The
final reader measures the stream length and hashes it within the fixture's
byte cap rather than assuming the header describes the decoded body.

Exact synthetic IDs (chat / file message): first cohort
`c2b911fe-542a-420b-93cd-00064d13071f` / `550c2aa9-cf9e-4abe-b94c-a09f3336bb47`;
final cohort `9b09a8d8-4a7a-476c-b5db-d9432996ac7d` /
`67e98ecf-8b8a-49b7-82c4-e425f0674ae2`. Both used ordinary message deletion,
normal worker purge, then exact group removal and local logout. Readback:
zero matching groups, members, messages, media observations and Storage
objects; anonymous HEAD `400`; old SID sets unchanged, no new SID remained.
Each message retained only three **terminal purge receipts** in that queue:
the original and its two same-stem preview candidates, all `done`; no other
path in those receipts. The worker did not need a bucket-wide operation.

## Still Open

D-336/D-337 in-flight trusted file reuse/forward (including target revoke)
and retry, D-338 avatar publication/lifecycle, and generation-safe reclamation
are not accepted here. This check neither closes the public-read gap nor
changes the accepted D-339 claim repair. No migration, policy/config change,
push, deploy, release or device action. Next independent gate: a real Storage
control for an in-flight trusted write in isolation; do not replay the live
source-signing cohort or change the public bucket as part of that check.
