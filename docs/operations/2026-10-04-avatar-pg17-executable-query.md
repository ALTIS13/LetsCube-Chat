# PG17 Executable Closure And Header Query Preparation

Date: 2026-10-04. Owner: coordinator, candidate branch only. Base `f8cd50ea`.
This advances the [PG17 prerequisites](2026-10-04-avatar-pg17-prerequisites.md),
not the full-restore operator. The prior header and PG18 evidence remain frozen.

## Actual Read-only Inventory

Strict SSH, with host-key verification, selected the same `supabase-db` container
and image as the [runtime inventory](2026-10-04-avatar-pg17-runtime-inventory.md).
Container ID/image/running state were equal before and after. No SQL, database
connection, production configuration reads, container allocation or remote file
write occurred. Five tools reported PostgreSQL 17.6 using `--version` only.

The immutable private receipt is
`.ops-private/avatar-pg17-executable-evidence/71d4f0aa-afaa-44e7-b49a-4b6f49b1fb4b/receipt.json`.
It retains the collector source, exact commands, stdout/stderr and hashes. All six
steps exited zero. Thirteen selected files and 29 unique canonical linker-file
paths had equal independently reread byte hashes before and after.

| Selected file | Kind | SHA256 |
| --- | --- | --- |
| `postgres` | wrapper, 284 bytes | `0f4fbc27e32e0863506a2cfffd02d87128c7c90330df996c5c54cc23c04e2ae4` |
| `.postgres-wrapped` | ELF, 11,284,888 bytes | `3794a95bd1c4b8224bb7b0af1aa5ff5f0ed16e61dd911fc82a1249739c7f4463` |
| `initdb` | wrapper, 413 bytes | `57181f0d2107050d623c226bab3a7551248c505f4b16f5b8af1c178c0adf5c12` |
| `.initdb-wrapped` | ELF, 220,720 bytes | `c9056621537a247aa2dc78710707b9e9245be331556ce8b9569897598cd2c157` |
| `pg_ctl` | ELF, 87,776 bytes | `67324d686560b4d7bc5f271dab31274bcd5714a5926dfd58481e8d2e54478abb` |
| `psql` | ELF, 838,960 bytes | `96577e53f4c3558b7f27c5747b533bc7180a4b22a232e8a71af7724257d7efcc` |
| `pg_dump` | ELF, 520,456 bytes | `858f1d46d266b6d3aa514e8483cd4d8ca43ac792b72451b448fcd00903b48eb4` |
| wrapper Bash | ELF, 1,112,912 bytes | `03b13000ff5011a38d8a3f9575b6807d78cf9936c64a0be28f02abf9be8c9c25` |
| native glibc loader | ELF, 253,696 bytes | `1e08370bba3ee9e4f97bb0500d1f32afb0417babca6ae455c6458b9a3edb86a8` |

The other four selected files are the previously pinned `plpgsql`, `pgcrypto`,
`ltree` and `btree_gist` libraries; their bytes also match the earlier inventory.
Ten selected ELF/linker lists include the five actual tool ELFs, four libraries
and wrapper interpreter. Linker resolution is not dynamic `dlopen` coverage,
installed extension membership/history, or identity of the running server process.

### Failed Probe Retained

Initial inventory `425b06b8-a5a0-4ed2-afb9-bc3c548098e1` refused at exit 127.
The container's `/usr/bin/ldd` is the wrong loader for these Nix/glibc files: it
reported glibc relocation failures and resolved some libraries incorrectly.
This is a probe failure, not evidence of a broken PostgreSQL runtime.

The corrected collector explicitly used the observed Nix glibc loader's `--list`
mode with selected ELF paths, never shell wrappers. Both loaders and underlying
files remain separately identified. The old refused snapshot is unchanged.
[GNU's explicit dynamic-linker invocation](https://sourceware.org/glibc/manual/latest/html_node/Dynamic-Linker-Invocation.html)
describes why the interpreter is a separate executable boundary.

## Remaining Identity Limits

The new [public build-binding research](2026-10-04-avatar-pg17-build-binding.md)
found a descriptor-hash-bound SLSA v1 statement connecting the exact amd64
manifest to the vendor commit/Dockerfile/workflow. Its embedded Dockerfile bytes
match the pinned source. It is **unsigned**, not a trusted builder assertion.
Coordinator separately compared the image's ordered `RootFS.Layers` with all
29 ordered `rootfs.diff_ids` from the hash-checked OCI config: exact equality.
The frozen readback is
`.ops-private/avatar-pg17-image-layers-3bb7a545-6a87-4c2f-9fc8-e39fb4d638b2.json`.
It pins the final research metadata hash, not a mutable registry tag.

Reported local image ID/index digest `f371...` and registry config digest
`f519...` are distinct identifiers; they were not equated. Matching layer
metadata and selected file bytes strengthen consistency, not signature trust
or verification of every installed layer/rootfs byte.

`nix-store --query --requisites` reports 179 unique metadata paths. This is a
cached dependency graph, **not** verified NAR hashes or a hash of every byte in
those trees. The observed deriver is
`/nix/store/wlzlr1nxxpfc21mxlrvv4qyz5v51fzah-postgresql-and-plugins-17.6.drv`;
a path name alone does not authenticate that build. No derivation environment or
production environment was dumped. The Nix `nixbld`-group warning is retained;
it did not invalidate this read-only metadata query and no group was changed.

Authenticated image/source attestation, whole extension/bootstrap closure and the ten
native prerequisite controls remain separate. Local Docker's Linux pipe is
still absent; no daemon startup, installation, image pull or clone was attempted.
Freed disk space (115,755,237,376 bytes on D at entry) does not imply native setup
readiness. Previous cache/log preservation links were not removed or reversed.

## Source Work And Acceptance

The new fixed header query is prepared separately from dispatch. It has no
connection, credential, filesystem or process capability. It must report actual
catalog attributes and every overload of the two selected function names; it
cannot discard unknown rows to make the existing header contract accept them.
Source worker's actual PGlite projection tests pass **59/59**, including
**19 compiled SQL mutants**. They independently assert literals for missing/extra
catalog fields, unresolved type slots, function overloads, IN/OUT ordering,
names/modes, NULL versus empty arrays, unsigned OID numeric encoding and control
values. Filtering an unknown field or overload cannot manufacture acceptance.
Each fictional mutation transaction rolls back to the original literal payload.

Unadapted SQL also observes PGlite's actual `180003/202506291` header and 28
constraint attributes, then reaches literal `version` refusal. That is query
execution evidence on the bundled PGlite engine, **not native PG17 acceptance**.
The in-memory fictional sources project `170006/202406281` by design; they are
explicitly labelled test data, not measured PG17 server metadata.

Worker receipt `avatar-pg17-header-query-worker-5a27396c-65ed-4682-86eb-06be76b9529f.json`
retains a fresh RED replay (0/1), GREEN stdout/stderr and pre/post source pins.
The worker observed an original pre-implementation RED and an OID-encoding RED;
their original full logs were not frozen. The retained replay is not passed off
as that original chronology. Coordinator validation and final independent review
are separate from these worker-reported results.

Coordinator source verification independently passes **59/59** and changed plus
adjacent checks **361/361**, with no skips/cancelled tests. Two module syntax
checks and 247 relative document links also pass. Initial frozen validation is
`.ops-private/avatar-pg17-query-evidence/293858af-1747-49bd-800e-c0591fe840d2/receipt.json`:
seven public inputs, 15 protected inputs and 28 private evidence inputs remained
byte-identical during that run. Publication additionally requires independent
review of the final exact seven-file candidate and private evidence pins.

The first coordinator formatter pass retained both successful source runs but
refused its own count parser: Node24 emitted the spec reporter rather than TAP.
Those outputs remain under `6ac5f9ec-982c-4e4f-91fd-49512eaa5d9d`, not an accepted
validation receipt. Explicit `--test-reporter=tap` fixed measurement, not product
code. The prior broad suite's 4948 pass / one unchanged Android cold-Gradle timeout
/ 13 optional skips remains a retained limitation; this is not whole-suite GREEN.

`fullRestoreApproved`, `pg17Accepted`, `runtimeApproved`, `productionApproved`
remain **false**. No main deployment, full restore/R5, native release, reclamation
or historical refused-directory cleanup occurred. Item82/D-342 stays OPEN.
