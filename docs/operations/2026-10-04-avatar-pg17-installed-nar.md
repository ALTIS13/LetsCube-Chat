# PG17 Installed Root NAR Comparison

Date: 2026-10-04. Owner: coordinator. Base candidate `5c7e1654`.
The [cache signature](2026-10-04-avatar-pg17-cache-signature.md) and
[query/identity](2026-10-04-avatar-pg17-executable-query.md) stages are closed,
reviewed and candidate-published. This advances one content comparison, not
database recovery, native PG17/header acceptance or a production change.

## Actual Existing-Root Result

Strict SSH inspected the same existing container, without allocating another.
Four metadata-discovery steps identified the canonical Nix ELF and BusyBox env/sh;
selected paths/byte hashes and container identity were equal before and after.
The separately reviewed version-bound probe then completed all seven steps with
exit0 and empty stderr. Both actual version calls reported `nix (Nix) 2.34.6`.

Nix executable: `/nix/store/3km45gzvnpin7xddlm9gpj5fac4wvjvn-nix-2.34.6/bin/nix`,
3874584 bytes, SHA256
`8293bf7cf93ca9e75961b6acbc3be59830dbc9259b7fd7fbb18756c49d7340b7`.
One direct-filesystem NAR serialization of the literal root
`/nix/store/pf9qdy976vlwwr2qkm9zzhvzr8grsmca-postgresql-and-plugins-17.6`
returned the bare Nix32 hash
`06c94aqwk7xq9xdkxjvjhr36q0k474qbh2pyq485hyx4d1206w4w`.
With SHA256 identified by the command, it exactly matches the prior verified
signed cache assertion. This is an observed serialization, not an atomic or
continuous filesystem snapshot. No NAR bytes were captured or downloaded.

Frozen source, exact commands, raw stdout/stderr and receipt are retained under
`.ops-private/avatar-pg17-installed-nar-evidence/16ef1872-4784-4071-b45c-4249b0bc93f6/`.
Receipt SHA256:
`09ed7b35f086c70fcdff9bdd6d129d6fb73b7e731b4ac4487d0ca264cb997e6c`.
Selected tool bytes/version and container ID/image/running state remained equal.
Zero SQL/database queries, container allocations, requested remote file/config/
store writes, installation, substitutions, repair or Nix network requests.
The authorized strict SSH transport is separate from those Nix-request counts.

## Startup And Probe Controls

UID:GID65534:65534, workdir/, fixed absolute ELF, env-i and literal settings
exclude inherited Nix/user configuration. Both metadata legs confirm absence
of the fixed config/home base and `/--offline`, including dangling symlinks.
Defined-empty `NIX_USER_CONF_FILES` is not an unset variable; `NIX_CONFIG` alone
would not erase earlier file settings. Both version calls enable nix-command
before the [feature check](https://github.com/NixOS/nix/blob/2.34.6/src/nix/main.cc#L124-L130).
The [plain hash branch](https://github.com/NixOS/nix/blob/2.34.6/src/nix/hash.cc#L98-L123)
serializes the filesystem rather than opening a Store, and prints bare Nix32.

The original wrong prefixed-output oracle reached actual local RED; it is retained
unchanged. Corrected literal controls pass13/13; three compiled version/hash/
container bypasses hit their intended refusal. Separate local Windows Git-Bash
fictional path controls pass6/6 and catch three compiled existence/symlink/
first-argument omissions. These local controls are not Linux-container tests.
No production files or configuration were created for negative cases.

The independent predispatch review pins collector SHA256
`532c4bc596b00a4b4e6d10d42fbe3f962b696b1e9ed0b70b6ae06843f42ddd3a`;
review SHA256 `85ac2baad447ca9a59a76efc45402cb45d7c321c8b15ba3a8fea6a72f9d56558`.
Source research retains27 SHA/size-pinned200 replies and four scoped404 results.
Ruling: this is a bounded read-only normal-path command, not a kernel write/network
sandbox. Atime, startup library effects, abnormal syslog/core effects, actual RSS
and remote completion after an SSH timeout are not proved absent. The successful
seven-step result does not certify unobserved failure paths or tool build trust.

## Next And Unchanged Limits

The command does not measure NarSize;12002232 remains the signed declared size.
NAR symlinks encode target text, not target contents. The179-subject cached graph,
reference-content closure, authenticated exact-image builder assertion and
recipe-to-output binding remain UNKNOWN. A matched root does not close them.
Next: separately reviewed bounded closure comparison using the already frozen
subjects, and new fictional header-only producer preparation, not allocation.
Keep source59/59 and adjacent361/361 as unchanged prior evidence, not fresh runs.

Only four documentation files change publicly; no app/runtime source is edited.
Independent final evidence review precedes candidate-only publication. Item82/
D-342 stays OPEN; `mainApproved`, `nativeHeaderDispatchApproved`,
`fullRestoreApproved`, `pg17Accepted`, `runtimeApproved`, `productionApproved`
remain false. No main deploy, native release, full restore/R5, reclamation,
historical cleanup retry, JDK/PATH or connectivity change; all HOLDs persist.
