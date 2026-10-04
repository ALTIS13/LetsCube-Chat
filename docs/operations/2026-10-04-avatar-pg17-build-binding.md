# PG17 Build Binding: Public Metadata Only

Date: 2026-10-04. Owner: independent read-only sidecar. Scope: immutable OCI
metadata and one public Nix-cache metadata record, not execution or allocation.
Reuse the frozen [vendor report](2026-10-04-avatar-pg17-vendor-provenance.md),
[prerequisites](2026-10-04-avatar-pg17-prerequisites.md) and completed
[supplied-header diagnostic](2026-10-04-avatar-pg17-header.md); none was replayed.
Nonsecret selected metadata and exact input pins are retained privately at
`.ops-private/avatar-pg17-build-binding-research.json`, not a versioned Git link.

## New Binding Evidence

The finding is **HASH_BOUND_UNSIGNED_BUILD_CLAIM**, stronger than matching tags,
but not authenticated builder/source/dependency closure. Public HTTPS registry
metadata was read using anonymous pull authorization, held only in memory.
No image/rootfs layer, NAR, runtime, database or production configuration was read.
OCI config environment/history and anonymous authorization were not retained.
Exact response bytes were SHA256-checked against each OCI descriptor:

| Object | SHA256, excluding prefix | Bytes |
| --- | --- | --- |
| OCI index | `f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00` | 1609 |
| linux/amd64 manifest | `5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b` | 5775 |
| amd64 config | `f519727303f0af6862882be2a30f420e28710d4209226e681aaddb2c01d12d9b` | 13539 |
| Attached attestation manifest | `50267253045886261c0e46d62b9eb6a65a4d0e85e6efd6a2326ea9ae2325d900` | 565 |
| Provenance statement | `1a175c5c44633dfe368b7e25cb8445781cfff40d5ca1c39f7ed1c21505471f14` | 54189 |

The [index](https://registry-1.docker.io/v2/supabase/postgres/manifests/sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00)
contains the exact amd64 manifest and an unknown/unknown attestation descriptor
whose reference annotation targets it. Its single metadata layer is in-toto JSON
with predicate `https://slsa.dev/provenance/v1`, not v0.2. This layout follows
[Docker's attestation storage contract](https://docs.docker.com/build/metadata/attestations/attestation-storage/).
The [config](https://registry-1.docker.io/v2/supabase/postgres/blobs/sha256:f519727303f0af6862882be2a30f420e28710d4209226e681aaddb2c01d12d9b)
has no observed source/revision OCI labels; the statement supplies the claim instead.

The private JSON also preserves all 29 ordered public config `rootfs.diff_ids`.
These are uncompressed layer identities, not compressed manifest-layer digests.
Coordinator reports installed Docker image ID and RepoDigest as `f371...`, while
the registry config digest is `f519...`: **do not equate those identifiers** or
infer installed config equality. A separate coordinator comparison with selected
image `RootFS.Layers` can test the ordered diff-ID list without environment reads;
no installed-layer comparison or rootfs download was performed by this sidecar.

The [hash-checked statement](https://registry-1.docker.io/v2/supabase/postgres/blobs/sha256:1a175c5c44633dfe368b7e25cb8445781cfff40d5ca1c39f7ed1c21505471f14)
has literal statement type `https://in-toto.io/Statement/v0.1` and:
- Subject SHA256 equal to the exact amd64 manifest, not merely the image tag.
- Source `https://github.com/supabase/postgres.git#d156ba65c14694c12cc5e782bc15b9b8ed2d1376`,
  matching SHA1, path `Dockerfile-17`, target `production`.
- Builder ID [vendor workflow run 27547049471](https://github.com/supabase/postgres/actions/runs/27547049471);
  claimed workflow SHA is the same commit.
- Build interval `2026-06-15T12:47:42.638414782Z` through
  `2026-06-15T12:50:32.006342159Z`.
- Embedded Dockerfile, 8081 bytes, byte-equal to
  [commit-pinned source](https://raw.githubusercontent.com/supabase/postgres/d156ba65c14694c12cc5e782bc15b9b8ed2d1376/Dockerfile-17);
  both SHA256 `4eff99fc93e2c4957d2a866249602f28c3f270f4d9cf775e0be1659e0ba26ff3`.

Four resolved dependencies name the Dockerfile frontend, Alpine amd64 base,
vendor Git commit and pinned Docker-library entrypoint. Their exact digests are
retained in the JSON. There are **zero listed Nix/NAR dependencies**.
BuildKit's `request=true/resolvedDependencies=true` completeness fields are
producer claims, not an independent proof of every network/Nix/cache input
executed inside RUN. [SLSA dependency completeness is best effort](https://slsa.dev/spec/v1.0/provenance#builddefinition).

## Authentication And Nix Limits

The fetched object is a plain statement, without DSSE/signatures. No signer,
certificate, transparency inclusion or trusted signer-builder pair was verified.
Both exact-digest public [repository attestation queries](https://docs.github.com/en/rest/repos/attestations#list-attestations)
returned HTTP404 `Not Found` with API version2026-03-10. This is scoped
unavailability, NOT global proof that signed provenance does not exist.
Digest checks protect bytes relative to the supplied root; they cannot prove
the claim is truthful. [SLSA verification](https://slsa.dev/spec/v1.0/verifying-artifacts)
separately requires trusted provenance authentication.

The public [narinfo for the previously captured store path](https://nix-postgres-artifacts.s3.amazonaws.com/pf9qdy976vlwwr2qkm9zzhvzr8grsmca.narinfo)
exists: 3098 metadata bytes, SHA256
`6f52111b05d3a4fdc35fe05e799178ddf6082269b7632125447f9f1d2a6714e5`.
It names `postgresql-and-plugins-17.6`, NAR size12002232, a deriver, 56 references
(including the previously captured PostgreSQL library path), and a
`nix-postgres-artifacts` signature. Signature presence is not verification:
no NAR/downloaded closure, cache-key trust validation, installed-NAR comparison,
derivation reconstruction or reproducible build ran. A matching store-path name
does not bind the installed wrapper/ELF to those NAR contents. Relevant native
[Nix verification semantics](https://nix.dev/manual/nix/2.34/command-ref/new-cli/nix3-store-verify.html)
remain a separately owned prerequisite, not a command authorized here.

## Finite Remaining Gaps

Coordinator now reports exact read-only pre/post identity for 13 selected files,
29 linker files and 179 Nix metadata requisites, with image/identity unchanged.
The fresh private receipt at
`.ops-private/avatar-pg17-executable-evidence/71d4f0aa-afaa-44e7-b49a-4b6f49b1fb4b/receipt.json`
exists and hashes to `de761548175f1a78366415645ab86ffec339ae2b046b165c74d42d839b48e57b`.
Counts are coordinator-reported, not independently replayed here. The corrected
Nix glibc-loader evidence is distinct from the retained failed musl attempt.
This closes the selected identity readback, not full NAR/dlopen/auth provenance.

Three build-binding gaps remain, not a demand for an unlimited new inventory:
1. **Authenticated assertion:** verify an independently trusted signer-builder
   binding for these exact image subjects. The retrieved unsigned statement and
   scoped GitHub404 responses do not supply it; external signed evidence is UNKNOWN.
2. **Content closure:** independently verify the declared Nix requisite set's
   NAR contents/signatures and correspondence to installed bytes. Metadata,
   paths and selected file hashes alone do not establish that relationship.
3. **Recipe-to-output binding:** link the pinned vendor source/flake/patch/build
   inputs to those actual derivations/NAR outputs, through adequate trusted vendor
   build evidence or separately owned reproducible-build proof. The Dockerfile
   byte match and four BuildKit dependencies do not close nested Nix/RUN inputs.

**Allocation/dispatch remains refused under the current exact-build prerequisite.**
Source-only SQL/producer preparation can continue independently, without changing
that prerequisite or labelling the claim authenticated. Once that gate is closed
and a producer separately reviewed, the next execution can remain strictly
fictional and header-only: exact image/platform/tool identities; no production
mounts/data/configuration; literal `170006/202406281`, ordered32/4/7/26 fields and
both function signatures; wrong identity/header mutants; before-work ownership
and bounded complete teardown. Header matching still proves no full restoration.
The last reported local daemon was absent; no environment refresh occurred here.
Dynamic dlopen, installed extension history, original-rank bootstrap and full-DDL
fidelity remain separate full-admission limits, not claims closed by this research.

`nativeHeaderDispatchApproved`, `fullRestoreApproved`, `pg17Accepted`,
`runtimeApproved`, `productionApproved` are **false**. Item82/D-342, R5,
main/production SQL, native release and historical cleanup HOLDs stay unchanged.

## Validation Boundary

Only the two fresh report/metadata paths were written. JSON parsing, relative
links, descriptor/source literal equality, protected-report pins and whitespace
are document/data checks, not native tests. Initial v0.2-only selection found no
matching blob; inspecting its descriptor correctly selected v1, not absence.
A preliminary broad metadata display was truncated; conclusions and retained
JSON use the subsequent bounded field projection, not truncated output.
No old runner, SSH/SQL/native operation, image pull, install, allocation,
provider mutation, stage/commit/push or delegation occurred.
