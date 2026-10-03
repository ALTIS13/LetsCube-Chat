# Inline Media HTTP Recovery - 2026-10-03

## Resume

Owner: Codex coordinator. Branch: `codex/bot-inline-media-20261002`, runtime
source `3976348f`. The actual inline handler/repository gate now passes **6/6**
on fresh isolated full PG17.6 and exact PostgREST 14.12. Storage is a controlled
fake, not a provider integration. D-336/D-337 and tracker item 78 remain open
for runtime. No production SQL write, main deployment, reclamation or native
operation follows from this test-only result.

Next: actual Storage SDK/external-I/O boundaries, then physical generation and
the avatar/variant/non-message lifecycle participants. Keep whole-chat-media
purge and Android/native HOLD; do not replay accepted SQL.

## Changed Surface

[Reusable fixture](../../tests/server/bot-media-inline-http.fixture.mjs) calls the
real message handler, repository and error mapper. Reserve/begin/finish/commit
RPCs use actual PostgREST transactions. Only fictional `e507...` inputs are
addressed. Fake Storage writes fictional metadata to the isolated copy and
retains 68-byte PNG content locally. No provider upload, personal data or account
is used. The Gateway router/authentication is not exercised by this fixture.

The reusable `assertInlineDeliveryLinks` oracle reads the exact bot/key delivery
ledger and independently reads the logical object identity. It requires the
returned message, chat, method, canonical path, registered state and generation
to match. Looking only at row counts, or filtering wrong observations away,
cannot pass this oracle.

## Six Cases

| Case | Required Observed Result |
| --- | --- |
| Busy commit after admission/upload | Actual SQLSTATE 55P03 maps to sanitized 503/retry_after 2; charged reservation remains, no message/grant/result/delivery effects |
| Immediate identical retry | Actual 55000 maps to 429 active lease; no extra PUT |
| Explicit fictional lease expiry | Same key/path gets controlled 409, downloads and verifies exact bytes/hash, then commits one message without another admission charge |
| Cached success/current revocation | Successful repeat performs no PUT; revoked membership refuses while preserving the complete receipt |
| Lost response after actual commit | Repeat returns the real complete receipt; no extra PUT or message |
| Unknown controlled Storage outcome | Intent remains unknown and charged/held; no immediate retry PUT or message |

Totals: four controlled PUT attempts (including one 409), one controlled download,
three initial charged reservations. There is no automatic internal retry,
deletion, refund or physical-generation/terminality claim.

## Frozen Final Evidence

Final checksum-verified full backup: `20261003-190929`; database SHA256:
`6288311c6de79a96e527c381718f01a26a722931c1133bf1a64243376cf51bf0`.
The exact deployed-image PG17.6 restore has network `none`, no ports or mounts,
one CPU/one GB, cron launch disabled and restored jobs inactive.

Exact PostgREST 14.12 binary SHA256:
`3b452073d38d5cb9ffb1cace1ef261afe4fa443a447d74062baf041474a1ec02`.
Image: `sha256:54000f24847d01a2c2302e0041cf0618b875c57fb48507d743cfa9aaa50bf43c`.
It uses only the owned copy's loopback/socket and a newly generated QA JWT key.

Before application imports the operator froze **45 reachable source inputs**;
the final and current hashes match. Manifest SHA256:
`8b1c324830478d3f28260faf11ffd71711c8ba6dbef8e8cc85963f43f6c466f4`.
Final 6/6 completed at `2026-10-03T16:11:15.803Z`. Bootstrap rollback matches
application row/function/trigger hashes plus table/column ACL, ownership,
RLS/force-RLS and policy definitions. Original copied relation existence and
row-hash multiplicities are unchanged after the cases.

Production **database container/cluster identity** is unchanged before/after.
This is not a claim that all live web/Gateway application bytes were revalidated.
Trial and final owned copies were removed by exact ID/owner/isolation checks;
both ID/name absences were independently verified. Backups remain. The earlier
trial's 6/6 is historical and is not substituted for this final source-bound run.

## Review And Fault Controls

Review found five P2 verification gaps: catalog security was missing from rollback
hashes, media links were counted instead of verified, a lost launch reply could
leak a listener, partial restore lacked immediate ownership/cleanup, and closing
a blocked SQL session was unbounded. All were corrected before final acceptance.

Six real oracle/fault probes pass on the owned trial copy:

- ACL and policy changes are missed by the old digest, detected by the new one;
  rollback returns to the exact digest. Existing RLS is never disabled.
- Wrong delivery target and observation path fail literal linkage assertions
  despite unchanged row counts; rollback restores the passing control.
- A compiled await-first launch mutant leaks one actual owned listener on a
  lost reply; attempt-first cleanup leaves zero.
- A genuinely blocked SQL connection is cancelled by exact QA application name
  within **4,207 ms**, below the literal 20-second acceptance bound. No unowned
  session is cancelled.

A separate fresh-copy failure immediately after creation returns the expected
nonzero exit: ownership was recorded before full restore, the exact partial copy
is absent and no full-restore receipt exists. Review then found one further P2
in the fault probe's own cleanup. An injected failure after the leaking mutant
now proves unconditional listener cleanup, exact row/catalog rollback and
unchanged production database identity. The corrected positive probes were rerun;
final scoped review has no remaining findings. Fault-source manifest SHA256:
`b5af1bd2800f5e4f66eb14c4880d234a1d46036ed71e35a1ceb61554d23b0dd4`.

## Evidence Boundaries

[Prior caller recovery](2026-10-03-bot-media-busy-recovery.md) remains separate:
64/64 focused/mutation, 27/27 browser/IndexedDB and 9/9 actual caller HTTP. Existing
broad authority REDs remain documented, not an all-green release. Runtime files
are unchanged by this extension, so those valid source-bound results are reused.

This gate does not prove actual provider PUT/GET, request terminality, immutable
physical object generation, Gateway listening/auth/proxy behavior, avatar/variant
publication, or safe seal/delete/refund. Keep runtime authority and automatic
cleanup closed until those separate gates and the reviewed migration/rollback
are accepted. No browser capture, paid plugin/device time or native build was
needed for this backend test slice.
