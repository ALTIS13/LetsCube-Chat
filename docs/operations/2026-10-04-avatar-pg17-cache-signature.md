# PG17 Cache Root Signature Verification

Date: 2026-10-04. Owner: coordinator. Base candidate `78b74678`.
Scope: local verification of already captured public cache metadata, not a
server operation or a restore. The [query/identity slice](2026-10-04-avatar-pg17-executable-query.md)
is reviewed and published candidate-only; its source59/59 and adjacent361/361
remain unchanged evidence, not rerun tests for this document-only slice.

## Declared Anchor And Actual Result

The exact vendor commit's [flake key declaration](https://github.com/supabase/postgres/blob/d156ba65c14694c12cc5e782bc15b9b8ed2d1376/flake.nix#L3-L7)
declares `nix-postgres-artifacts`. Bounded primary-source research retained 20
byte-pinned public responses and three scoped404 results, including the unavailable
named deriver metadata. No NAR/archive/image layer was downloaded. The frozen
research is `.ops-private/avatar-pg17-cache-next-research.json`, SHA256
`8778ae559e07724bfacd3414c9c53204e280a5d7aba91f11bae0b54112d16092`.

Actual local Node24/OpenSSL Ed25519 verification succeeds for the captured root
narinfo under that exact source-declared public key. The source uses the standard
[Node crypto verification API](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback),
not custom cryptography. Nix2.34.6's [fingerprint](https://github.com/NixOS/nix/blob/2.34.6/src/libstore/path-info.cc#L39-L49)
binds version1, StorePath, algorithm-prefixed Nix32 NarHash, decimal NarSize and
sorted full references. Its [signature implementation](https://github.com/NixOS/nix/blob/2.34.6/src/libutil/signature/local-keys.cc#L126-L158)
separately checks the named public key and detached signature.

Verified subject: `pf9qdy976vlwwr2qkm9zzhvzr8grsmca-postgresql-and-plugins-17.6`,
declared NAR size12002232 and56 references. Captured narinfo3098 bytes has SHA256
`6f52111b05d3a4fdc35fe05e799178ddf6082269b7632125447f9f1d2a6714e5`.
No installed serialization or size measurement is implied by those signed values.

The immutable local receipt and source snapshot are under
`.ops-private/avatar-pg17-cache-signature-evidence/ab12d48e-613d-4797-961b-b6854073a300/`.
Receipt SHA256 is `af7503c155dcd4a486e6decce98ff89b28b88b7cc416b4f7233f20a6c50ef570`.
All15 literal diagnostic assertions pass; these are local metadata/crypto controls,
not native PG17, device tests or application integration tests.

## Refusal Controls And Unsigned Fields

Changing a public-key byte, signer name, NAR hash, size, store path, signed
reference or signature byte makes verification false. Missing a reference also
fails. Duplicate fields/references and a truncated signature refuse input rather
than producing a verified result. Reference order is canonicalized as a set;
reversing the same references remains valid, as Nix's fingerprint requires.

Actual mutations of Deriver and archive URL retain a valid signature: these
fields are outside the signed fingerprint. Therefore a valid cache signature
cannot authenticate recipe-to-output binding or the archive transport metadata.
The earlier [unsigned OCI claim](2026-10-04-avatar-pg17-build-binding.md) is still
unsigned. This result does not retroactively authenticate that builder or image.

## Next And Unchanged Limits

Next is a separately reviewed, version-bound read-only installed-root NAR hash
comparison, followed only if needed by the already fixed179-subject dependency
closure. No automatic dispatch, new discovery, substitutions, store repair,
configuration change, Nix installation, image pull or build is granted here.
Matching a root alone would not prove every reference; matching cache contents
would still not prove the source/recipe/build history. Prepare the new fictional
header-only producer independently, but retain the exact-build prerequisite.

`mainApproved`, `nativeHeaderDispatchApproved`, `fullRestoreApproved`,
`pg17Accepted`, `runtimeApproved`, `productionApproved` remain **false**.
No SQL, SSH/native execution, allocation, production data/configuration read,
cleanup/reclamation or HOLD lifting occurred in this offline verification.
Item82/D-342 stays OPEN. Prior source/native evidence and refused snapshots stay
unchanged. Independent source/evidence review precedes candidate publication.
