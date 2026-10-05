# PG17 Package Difference Explained Offline

Date: 2026-10-05. Owner: coordinator. Base `00fff8f8`; candidate branch only.
Follows the [signed reference closure](2026-10-05-avatar-pg17-reference-closure.md).
No application/runtime changes, store repair, SQL, allocation or HOLD lift.

## Observed Difference

The previously refused installed comparison remains REFUSED177/1 against the
original signed cache. Its one differing PostgreSQL package now has a bounded
content explanation, not a replacement oracle or authenticated build assertion.

The independently reviewed ten-path metadata probe exits0 in all three steps,
empty stderr, same existing container identity. The proposed `pgsodium_getkey`
cause is **disproved**: that link is absent in the differing `d43...` package.
The runtime profile share paths resolve to a different `plb...` wrapper, not the
previously frozen `pf9...` root. Do not equate those roots or assume the179-subject
inventory establishes the entire active profile. No key-script body was read or
executed. Receipt `.ops-private/avatar-pg17-package-links-evidence/094775d3-be54-49e5-946e-c3c639001ee1/receipt.json`,
SHA256 `7c6c89df87cf8f990b29fdf0106d9081ae61fd54c9cb86993e8fce970dc75cba`.

The public cache archive for `d43...-postgresql-17.6` is6096052 compressed bytes;
its file hash matches the pinned metadata. Decompression to memory yields27968688
NAR bytes with the previously verified signed NAR hash. No member is extracted
or executed. Its manifest contains1290 objects:72 directories,1214 regular files
and4 symbolic links. Receipt `.ops-private/avatar-pg17-package-cache-evidence/84fba76b-1d1d-4aed-b02c-4d855d20e21e/receipt.json`,
SHA256 `133a1700080c7530a0b5780d4847b25e15671a2fe9126d8b3c35d4e954393d76`.

A separately reviewed fixed-package `find/stat/sha256sum/readlink` probe returns
1291 objects, with all three steps exit0 and empty stderr. It requests no writes,
SQL, Nix action or allocation; only metadata/digests are retained, not remote file
bodies. All1290 reference objects match, including regular-file digests, lengths,
owner-execute semantics and existing symlink targets. The sole additional object:

```text
share/postgresql/timezonesets/timezonesets
symlink -> /usr/lib/postgresql/share/postgresql/timezonesets
```

Installed manifest receipt `.ops-private/avatar-pg17-package-manifest-evidence/7b946140-851d-42da-90ca-0536990323ae/receipt.json`,
SHA256 `43f4d6a42115f5a83c7639da157a911a59760d0267029532001742d43c626ee0`.

## Exact Reconstruction

The offline diagnostic inserts that single canonical serialized link into the
signed reference NAR, preserving every existing byte. It adds248 bytes, giving
reconstructed size27968936. Its SHA256 is
`abd36a841a969ad0008bf13fd421a98a06a86e2ef18f63314b21f9f330a6dc58`, exactly the
Nix32 installed hash already captured in the178-subject batch:
`0n6wlqqg7y919cqn73zi5rpah1lam4hx8gziic0d16ln3a26mlxb`.
There is no repeated installed NAR hash, remote NAR capture or store change.
This explains that prior hash difference; reconstructed size is not a measurement
of a current installed NAR or an atomic filesystem snapshot.

The commit-pinned [Supabase Dockerfile lines108-110](https://github.com/supabase/postgres/blob/d156ba65c14694c12cc5e782bc15b9b8ed2d1376/Dockerfile-17#L108-L110)
first links PostgreSQL share entries, then links the `timezonesets` directory
without a no-directory-target option. Inference: following the destination
directory creates this nested link during image assembly. That recipe accounts
for the observed shape; it does not authenticate the builder or its execution.
The offline encoding follows the [Nix NAR format](https://nix.dev/manual/nix/2.34/protocols/nix-archive/):
ordered entries, little-endian lengths, zero padding, executable marker and link
target, without following links or materializing an archive tree.

Explanation receipt `.ops-private/avatar-pg17-package-explanation-evidence/4651c139-56c2-41f8-b9b6-365b31f7d18d/receipt.json`,
SHA256 `68d4bf8f43d934262ba4f96edaf5619f6460ebdccda6894c72b7b75c4fb17140`.

## Verification And Next Boundary

New offline diagnostic tests: feature-absent RED0/12, GREEN12/12; manifest addition
RED12/15, GREEN15/15; three budget controls give final18/18, zero skips. Ten
compiled hash/padding/order/EOF/byte/depth/node/token/executable alterations refuse
against their intended tests. One independent literal fixture-size arithmetic
error224 was corrected to208 (eleven16-byte tokens plus one32-byte target); no
hash/parser rule was relaxed. Mutation receipt
`.ops-private/avatar-pg17-package-controls-evidence/2bbeefe7-51d5-49c9-b53f-0cef5ffd983f/receipt.json`.
Remote-parser calibration has typed positive rows and malformed-input refusals;
neither those fixtures nor test success constitute native PG17 acceptance.

Scope is deliberately restricted to ASCII metadata and32MiB NAR input. Remote
45-second timeout,1500 parsed rows/32MiB observed regular sizes are not hard
pre-read byte/RSS bounds. Sequential filesystem reads are not atomic; atime,
transport-failure child closure and concurrent symlink replacement are not
kernel-certified absent. Public fetch byte count is checked after response read.
No fresh whole-application-suite claim; prior4948/1/13 remains NOTGREEN.

Next: source-only fictional header producer and explicit active-profile/recipe
binding, reusing this explanation instead of repeating archives/hash batches.
The unsigned OCI build claim remains unsigned; original signed-cache equality
is still refused. Native/header allocation, full restore/R5, main/production SQL,
release signing, reclamation and historical cleanup HOLDs remain unchanged.
Item82/D-342 stays OPEN. Do not remove the extra link from the running store.
