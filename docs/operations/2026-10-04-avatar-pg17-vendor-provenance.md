# PG17 Vendor Provenance: Bounded Addendum

Date: 2026-10-04. Candidate branch only. Aristotle researched public sources;
coordinator retained the results after the disk-full incident and independently
read the selected wrapper/ELF through strict, read-only SSH. No SQL or allocation.
The [prior runtime inventory](2026-10-04-avatar-pg17-runtime-inventory.md) stays
frozen; this addendum clarifies its selected executable hash.

## Public Build Evidence

[Docker Hub tag metadata](https://hub.docker.com/v2/repositories/supabase/postgres/tags/17.6.1.136)
matches the observed repository digest
`sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00`.
Its linux/amd64 manifest is separately identified as
`sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b`.
Fresh strict SSH readback also returned the exact prior RepoDigest; no pull ran.

The vendor tag points to `d156ba65c14694c12cc5e782bc15b9b8ed2d1376`.
[That commit's release run](https://github.com/supabase/postgres/actions/runs/27547049471)
succeeded. A successful run and matching tag are **not** an authenticated binding
of the running immutable image to the entire source/build/dependency closure.

[Pinned vendor configuration](https://raw.githubusercontent.com/supabase/postgres/d156ba65c14694c12cc5e782bc15b9b8ed2d1376/nix/config.nix)
selects PG17.6. The source checksum matches the
[official upstream tarball checksum](https://ftp.postgresql.org/pub/source/v17.6/postgresql-17.6.tar.bz2.sha256):
`e0630a3600aea27511715563259ec2111cd5f4353a4b040e0be827f94cd7a8b0`.
[The vendor derivation](https://raw.githubusercontent.com/supabase/postgres/d156ba65c14694c12cc5e782bc15b9b8ed2d1376/nix/postgresql/generic.nix)
also has patches and wrapping; an upstream tarball checksum does not identify the
patched installed executable.

## Wrapper And Underlying ELF

Coordinator observed the prior resolved `postgres` path is a 284-byte shell
wrapper. It sets `NIX_PGLIBDIR` and executes sibling `.postgres-wrapped`.
The prior hash `0f4fbc27e32e0863506a2cfffd02d87128c7c90330df996c5c54cc23c04e2ae4`
therefore binds the wrapper, **not** the underlying executable.

The selected underlying file is 11,284,888 bytes, with ELF magic `7f 45 4c 46`:

```text
/nix/store/pf9qdy976vlwwr2qkm9zzhvzr8grsmca-postgresql-and-plugins-17.6/bin/.postgres-wrapped
SHA256 3794a95bd1c4b8224bb7b0af1aa5ff5f0ed16e61dd911fc82a1249739c7f4463
```

This is a readback of one selected installed file, not `/proc` process identity,
all executable/library provenance, installed extension membership, or restore
acceptance. No production config, database, process or role was changed.

## Remaining Dispatch Preconditions

Digest-to-source/build binding, executable/dependency closure, fresh fictional
bootstrap inventory/original role order, installed extension payloads and the
ten [native prerequisite controls](2026-10-04-avatar-pg17-prerequisites.md#finite-acceptance-checklist)
remain open. Local Docker CLI exists, but its Linux daemon pipe was absent; no
daemon was started or installed. Do not use the production data directory as a
shortcut or treat the new supplied-header diagnostic as native evidence.

No native producer was dispatched. `fullRestoreApproved`, `pg17Accepted`,
`runtimeApproved` and `productionApproved` remain **false**. R5/full restore,
production SQL/main deployment, native releases and historical cleanup HOLDs stay.
