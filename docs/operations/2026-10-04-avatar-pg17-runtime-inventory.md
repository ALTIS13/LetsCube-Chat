# PG17 Runtime Identity: Read-Only Inventory

Date: 2026-10-04. Owner: coordinator. Candidate branch only.
Continues the [source prerequisites](2026-10-04-avatar-pg17-prerequisites.md);
it does not replace or modify that frozen source report.

## Observed Identity

Read-only key-authenticated SSH to the owned `ms.letscube.ru`, with batch mode
and strict known-host checking, observed one running `supabase-db` container:

- Configured tag: `supabase/postgres:17.6.1.136`.
- Container ID: `c33cc2b754917c080fcab36d61a05abedb1f70c6ea8124ed365e02152934f27a`.
- Running image ID and repository digest both bind
  `sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00`.
- Image platform: Linux/amd64; container start: `2026-08-20T14:16:17.901477726Z`.
- Actual `postgres --version`: `postgres (PostgreSQL) 17.6`.
- Actual selected binary SHA256:
  `0f4fbc27e32e0863506a2cfffd02d87128c7c90330df996c5c54cc23c04e2ae4`.
- Its resolved path is the image's Nix
  `postgresql-and-plugins-17.6/bin/postgres`, not the local Windows PG18.4 binary.

These resolve the previously unknown running image/binary identity only.
The configured tag, running immutable image and selected binary were observed
separately; a tag or version string alone was not treated as a complete profile.

## Selected Extension Files

Four extension control files and their four libraries were hashed, as were all
17 matching initial/update SQL files present in the image's extension directory.
Control-file defaults are `plpgsql=1.0`, `pgcrypto=1.3`, `ltree=1.3` and
`btree_gist=1.7`. These are **not** observations of installed database extension
versions. Selected library SHA256 values:

| File | SHA256 |
| --- | --- |
| `plpgsql.so` | `97facec283c426e831ca0ee57b4ec4dcbbc93bb46beb77b7d1d3b2c5be71dcc8` |
| `pgcrypto.so` | `0211af02a758b189c8739e59c612a5849a0b3f7485a9624d23f5cbdfc6a6fcfc` |
| `ltree.so` | `0d51d3612a5399d85e3ebf63b72c2cf7990018f75362ce6eba0f5c0f3df8a854` |
| `btree_gist.so` | `b8ebec60677e2b9a1ef25441ceb1fa92857b3abe71d494bc0e6cbc16315dad4e` |

Exact paths and all selected file hashes are retained privately in
`.ops-private/avatar-pg17-runtime-inventory.json`. Two metadata probes failed
(Docker template quoting and BusyBox's unsupported `find -regextype`); bounded
corrected read-only probes succeeded. No failed probe is represented as evidence.

## Next Gates And Limits

No database connection or SQL was used; no server/image/configuration/roles,
extensions, backups or data were changed. No image was pulled, installed or
started, and no production process was stopped.

Next: derive a separately reviewed, exact-image PG17 fictional native prerequisite
producer. It must establish its own native version/catalog header, extension
installation scope, role/bootstrap order and source/binary inputs before any
restore/reference controls. The ten prerequisite gates remain open; this
inventory accepts no PG17 compatibility, full type/DDL recovery, independent
installation, authenticated provenance or concurrent source-fence behavior.

The dated security/17.11 boundary in the source prerequisites still applies:
17.6 is an observed compatibility target, not a new-production recommendation
or permission to upgrade. Full restore/R5, production SQL/main deployment,
Android/native release, reclamation/refunds and historical cleanup HOLDs remain.
All full-restore/PG17/runtime/production approval flags are **false**.
