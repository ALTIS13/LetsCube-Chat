# Combined message coverage and retained authority, 2026-10-03

Owner: this Codex chat. Source baseline: `73ccd190`, candidate branch
`codex/bot-inline-media-20261002`. Test-only extension of
[full-schema authority](2026-10-03-bot-media-authority-full-schema.md), not a
production migration, reclamation permission or native release.

## Executed Boundary

A fresh checksum-verified full production backup was restored with roles into
an owned PostgreSQL 17.6 container using the exact deployed database image.
Isolation remained `--network none`, no published ports, no mounts, 1 CPU / 1 GB;
cron launch disabled and restored jobs inactive. Only fictional `e507...` rows
were used by the oracles. Production was read only; copied personal rows never
left the server. No personal screen, account, Storage/provider request, paid
device session or native operation was used.

The operator installed the unchanged retained-authority fixture and unchanged
whole-message coverage candidate together. Bootstrap was first rolled back and
its prestate digest compared. It was then committed in the owned copy for real
independent sessions. Each behavior case used a savepoint; mutation definitions
and all case changes were restored. Server-side full-row multiset hashes covered
public/private/auth/storage and fictional coverage controls; definition hashes
covered private/authority/coverage functions and all non-internal application
triggers. No copied observation was removed or policy widened.

## Results

Final positive gate: **41/41**, zero skips:

| Boundary | Groups | Observable oracle |
| --- | ---: | --- |
| Existing full-schema authority under combined hooks | 18 | Actual send/cached send, forward and table fallback; sanctions, blocks, topic/privacy, legitimate cascades |
| Combined coverage | 6 | Private ACL/actual denials; retained unknown hold; acquired barrier; OLD pointers; closed-state send/forward refusal; independent bound observation |
| Actual enclosing/non-media callers | 9 | Authenticated text/edit, pin/unpin, membership-generated system message, delete RPC/ledger/scrub, atomic refusals |
| Unsupported transaction isolation | 3 | Literal `0A000` for RR, Serializable and Read Uncommitted; no inserted row |
| Two-session savepoint/closer behavior | 5 | Before-savepoint lock retained; after-savepoint lock released; immediate `55P03` and no partial text/member/system/deletion-ledger effects |

Five executable compiled mutants expose **nine exact failures**:

| Removed rule | Literal failure |
| --- | --- |
| Shared barrier acquisition | Lock count `0`, expected `1` |
| OLD references check | Actual update `00000`, expected `55000` |
| Independent bound observation check | Actual update `00000`, expected `55000` |
| Unsupported-isolation refusal | Three actual inserts `00000`, each expected `0A000` |
| Blocking shared acquisition instead of try-only | Three real advisory waiter/blocker edges observed, expected none; a timeout `55P03` cannot substitute for the named `fixture_coverage_busy` refusal |

The post-mutation **23/23** new combined/caller/isolation/concurrency cases pass.
An assertion deliberately thrown immediately after a committed isolation mutant
also restores the original compiled function, verified by the full digest.
Full copied-row/function/trigger digests match after behavior, each mutant and
the repeated gate. The previous 18/19/11 frozen authority results retain their
separate meaning; this extension does not replace that race inventory.

Two setup mistakes were rejected before final acceptance: creation of a new
schema while still impersonating `postgres` (`42501`) and changing a message
type that the real sender-immutability trigger prohibits (`23514`). The final
OLD-pointer test first proves that clearing media fields while retaining the
type succeeds (`00000`) before requiring the closed-state refusal. Neither a
setup failure nor a zero-row RLS update is accepted as coverage evidence.

## Honest Close-State Limit

The copied database contains unresolved/ambiguous observations. The real
fictional closer therefore **must refuse `55000`**, leaving its controls open;
that refusal is explicitly tested. No successful close is claimed here.

Three classes of fault-injection oracle deliberately create an inconsistent
fictional closed state: ordinary text vs unknown media; an independent stale
bound observation; OLD-pointer coverage with only the newly seeded fictional
source observation removed. Savepoints roll back all of them. No copied hold,
resolver, trigger or RLS rule is removed to make a close succeed.

## Effective API Settings

Read-only capture from the deployed `supabase-rest` executable reports
**PostgREST 14.12**, not an assumed v12 default. Only whitelisted non-secret
configuration fields left the server:

- `db-tx-end = "commit"`, `db-config = true`, empty `db-pre-request`;
- `db-hoisted-tx-settings` includes `default_transaction_isolation`;
- exposed schemas `public,storage,graphql_public`, anonymous role `anon`;
- database default `read committed`; no relevant database/all-role or
  authenticator/anon/authenticated/service_role overrides in the connected
  database, and no isolation override in exposed `public` functions.

This configuration capture plus real SQL transactions is **not HTTP commit or
retry acceptance**. A successful HTTP RPC must still be observed from a separate
session; fresh authority must be checked on gateway/outbox retries, without
replaying stale operation results. Function volatility, impersonated/hoisted
settings and transaction completion follow
[the deployed major version's transaction contract](https://docs.postgrest.org/en/v14/references/transactions.html).
Supabase changelog was checked; neither the PostgreSQL upgrade nor gateway
replacement was applied as part of this bounded test-only slice.

## Frozen Inputs

| New/combined input | SHA-256 |
| --- | --- |
| `tests/server/bot-media-combined-coverage.fixture.mjs` | `e86d895461565f35f3b9240f18322374b0166711296c15cb34793626a488a257` |
| `tests/server/bot-media-caller-compatibility.fixture.mjs` | `17a22548beb9d1965f78045f8f6496b6de3147b84923e8a181b88d2e7859bfa0` |
| unchanged `tests/server/fixtures/bot-media-coverage-candidate.sql` | `fee4dc29439322a4f6c5357323e3c434342a5a865b124beaa98a0c078d51a018` |

The 15-source manifest is captured **before importing the application fixtures**
and compared with final/current bytes. It includes eight unchanged authority
inputs and four private operator/helper sources, including the runner itself.
The receipt also pins the restore receipt, exact owned container identity and
deployed PostgREST image. Final receipt SHA-256:
`6edb98036e7728198189acba094283726be3c17084c73cb60f0d5cd1f4144e9d`.
Sensitive operators/receipts stay ignored and root-protected, not in Git.
Rehearsal method: verified owned copy -> rollback bootstrap -> committed
fictional bootstrap -> existing authority gate -> savepoint-isolated combined
and caller modules -> unsupported-mode and two-session gates -> exact mutants
with digest restoration -> repeated positive gate -> exact owned-copy cleanup.
The transport-free modules do not load private files, select a host or install
themselves in production.

## Remaining Gate

D-336/D-337 and tracker item 78 remain **open for runtime**. Next: isolated
same-version PostgREST HTTP commit/rollback and actual gateway/outbox
fresh-authority retry acceptance, then remaining lifecycle/ingest boundaries.
No production admission, closer, physical DELETE, accounting/refund authority,
UPDATE-fallback completeness, migration or release follows from this result.
Whole-chat-media purge hold, Android/native HOLD and A063 exclusion stay intact.

## Review And Cleanup

One fresh independent whole-stage review found three P2 verification defects,
no P0/P1: timeout could masquerade as immediate refusal; hashes were sampled
only after execution; a setup error could bypass committed-mutant restoration.
The coordinator addressed all three in one fix pass, then executed the final
41/41, five/nine mutation and 23/23 repeated gates above. The blocking mutant
proves the live wait probe, the pre-import/final manifest prevents source drift,
and the assertion-fault probe proves compiled-definition restoration. No second
review or independent receipt inspection is claimed.

Both workers and all finite sessions are closed. Cleanup verified the exact
owned ID/owner/network/image/no-mount identity before removal, then confirmed
that ID absent and the production runtime identity unchanged. The fresh backup
and root-protected receipt remain. No unrelated container was stopped.
