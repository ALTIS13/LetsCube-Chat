# PG17 Signed Reference Closure

Date: 2026-10-05. Owner: coordinator. Base candidate `bb89fd0e`.
This follows the [installed-root comparison](2026-10-04-avatar-pg17-installed-nar.md).
It does not authorize database restoration, production changes or native releases.

## Actual Signed Metadata

The frozen inventory contains179 unique store subjects. The collector reused the
root narinfo and obtained178 dependency narinfos with HTTP200. The action-free
validator verifies every Ed25519 assertion under the previously source-declared
vendor cache key, exact subject membership, safe sizes, duplicate refusal,
reference membership and reachability from the root. No reference escapes the
frozen set and no expected subject is unreachable.

The declared signed NAR-size sum is1091551760 bytes; largest subject171250288.
These are signed declarations, not measured installed bytes or a memory cap.
No archives, derivations, database rows or personal media were read.

Actual collection and raw narinfos:
`.ops-private/avatar-pg17-cache-closure-evidence/14772c36-4164-4f60-9a88-b4e8425e56ec/`.
Receipt SHA256:
`9dc10de0f94d96105c05d9c72b592fb30c85377f167a7563eb25c11b094045e0`.
Source validator SHA256:
`28f8bd4d0f4828cffd8add5ebcf9f7a8737daf58ec923d8897f29c61910c1a24`.

## Controls And Collector Repair

The new diagnostic has23 literal cases, actual feature-absent RED23/0 and
GREEN23/23. Five compiled crypto/key-name/membership/reachability/duplicate-ref
omissions fail against their intended oracles. This is test-only source; the
application does not import it. Old unrelated suite results are not rerun or
upgraded to a new whole-suite success claim.

Node's direct HTTPS path timed out for a known root; PowerShell's ordinary HTTPS
path returned200 and its exact saved hash. The first collector retained five
connection failures and refused without an accepted receipt. This is not evidence
of a missing cache object. The v2 collection used the tested PowerShell path,
with no network, service, proxy, TLS or global environment changes. The helper's
32768-byte limit is checked after download, not a hard wire-allocation bound.

Independent review found a P2: v1/v2 statically imported the validator before
checking its SHA. A local fictional module demonstrates evaluation before refusal
(RED). New v3 imports the exact verified bytes instead; the same sentinel is
absent on refusal (GREEN). The actual179-subject collection used v2 with the
unchanged known action-free module, not v3; no unreviewed-code incident is inferred.
Old sources and failures remain immutable; v3 was not used to recollect metadata.

After the repair, offline replay loaded only SHA-checked validator bytes and
reconciled all179 raw metadata hashes, signatures and exact subjects with the
original collection, without another HTTP request. Replay receipt:
`.ops-private/avatar-pg17-cache-closure-offline-evidence/81b40315-8c4b-4402-997a-3a5b6a1d8fca/receipt.json`,
SHA256 `080845febb40a5e869850d3e2b78d44543f64bc48e2a817899b3864d98b3470b`.

## Installed Contents

The previous root hash is reused, not rerun. The178-dependency probe ran against
the same existing container/Nix2.34.6, UID65534, env-i, absent config/home paths
and a remote240-second BusyBox timeout. Four executed steps exit0 with empty
stderr; the batch returned178 canonical bare hashes in8985ms, including SSH.
**177 match; one does not.** The comparator refuses and produces no accepted
closure receipt. It requests no SQL, allocation, store/config write, repair,
substitution or Nix network access. No hash batch was repeated.

The differing subject is
`/nix/store/d43fya852vmrp5hws2lrw47ccq1ngakz-postgresql-17.6`:
- Signed cache assertion: `sha256:182rhxymhv0fphk07di6szk8a4mcjs1yk83yczhzvzwrvbdwbziw`.
- Installed observation: `sha256:0n6wlqqg7y919cqn73zi5rpah1lam4hx8gziic0d16ln3a26mlxb`.

Raw output, source, literal subject order and refusal:
`.ops-private/avatar-pg17-installed-closure-evidence/51e45489-a16d-468b-92d0-7cc251f8b5cb/`,
failure SHA256 `7f8e1f64eff8f424fe074edc923755eea1253148d954001238a6d5c69df335cd`.
Hash output SHA256 `9c8f2365ec4b82957733915279648b354876de3e21d6205d57d349653a05882e`.
Subsequent post-only reuse of the three already-reviewed metadata commands exits0,
empty stderr, exact pre/post version/tool/config-path/container equality. It does
not rerun a hash or turn the refused comparison into an accepted one. Post receipt:
`.ops-private/avatar-pg17-installed-closure-post-evidence/7ce0c910-b8f4-4972-9a4e-d0adbd011523/receipt.json`.

The [Nix2.34.6 hash implementation](https://github.com/NixOS/nix/blob/2.34.6/src/nix/hash.cc#L74-L123)
iterates literal arguments in order and prints one bare hash per argument. Local
parser controls pass9/9; command controls5/5. Five compiled count/comparison/
timeout/UID/offline alterations refuse. The old oracle first accepts its valid
single root, then refuses that root plus a second subject. These are local
diagnostic controls, not native PG17 acceptance or production fault injection.

Independent predispatch review also identified a conditional ambient-SSH-config
P2, not an observed incident. Newv2 isolates this connection only: no config,
local command, forwarding, agent or multiplex reuse; strict existing host-key
verification remains enabled, with automatic host-key updates disabled. Local
[`ssh -G`](https://man.openbsd.org/ssh#G) calibration passes18 literal options
and refuses three compiled omissions/alterations without connecting. Source
SHA256 `a135e9523974c053a8fce051ceb27f754a1adc998bcb4cf3da60cff61d79159f`.
The original review/failures are retained; a pinned coordinator repair gate
confirms that the only dispatcher delta is this SSH profile before launch.

## Remaining Gates

Signed metadata verifies a graph, while installed content closure actually
**refuses** for the one differing package. NarSize, an atomic closure snapshot,
authenticated OCI builder provenance and recipe/output binding remain unproved.
Read-only intent is not a hard kernel sandbox; atime, abnormal failure effects
and remote-child closure after transport failure are not certified absent.

Next: explain the single package difference with bounded file/recipe evidence,
without replacing the signed oracle or altering the running store. The pinned
[vendor Dockerfile](https://github.com/supabase/postgres/blob/d156ba65c14694c12cc5e782bc15b9b8ed2d1376/Dockerfile-17#L107-L152)
integrates PostgreSQL share links and a key-script link; whether this accounts
for the observed package difference is still UNKNOWN, not a proven cause or
security incident. NEW fictional header-only producer preparation can continue
source-only; its allocation remains refused. Do not allocate from this metadata
receipt. Item82/D-342 remains OPEN; full restore/R5, production SQL/admission,
main deployment, native/Android release, reclamation and historical cleanup HOLDs
remain unchanged. No application/runtime edits, native dispatch or HOLD lift.
