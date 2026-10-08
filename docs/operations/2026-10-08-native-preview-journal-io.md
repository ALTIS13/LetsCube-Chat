# Native Preview Journal I/O

2026-10-08. Task6C1 is the next inactive source slice after the accepted fence
and authenticated envelope. D-335 remains OPEN; protocol0/generic/voice unchanged.

Implement one package-private checked I/O kernel, not a complete vault. Its
backend owns the exact file/AtomicFile stream; the later Android adapter alone
selects the CE/no-backup namespace and Keystore key. No paths, keys or credentials
are exposed to JS. Do not invent pristine G0 from missing/corrupt storage.

The kernel serializes read/write calls on its instance. The future native owner
must retain one instance/worker for this namespace; no cross-process lock or
generation CAS is claimed here. Live context/intent/tickets and key retirement
remain the fence/foreground transition owner's responsibility.

- Read an input stream with an exact 16,385-byte observation ceiling. Refuse
  overflow, zero-progress read, I/O/close error and metadata authentication failure.
  Authenticate before returning an internal record. Missing is UNAVAILABLE, not
  EMPTY/G0. Never use unbounded readFully/available/file length as authority.
- Clone and authenticate the entire bounded proposed envelope before startWrite.
  Write, flush, sync, finish the owned stream, then bounded exact byte readback
  and metadata authentication. CHECKED means only these I/O checks passed, not
  an operation/credential/durable-erasure ACK or readiness.
- On any failure report fixed UNAVAILABLE. Roll back only a started write that
  has not entered finish; do not invoke failWrite after finish attempted or
  erase/retry/replay an uncertain commit. A rollback failure is not success.
- The kernel never creates/deletes keys, resets generation, deletes the journal,
  imports access, dispatches network/Auth or changes existing application owners.

Acceptance: compiled actual kernel/envelope plus real owned temporary-file
fixture with injected write/flush/sync/finish/readback/close failures; exact order,
bounded reads, bad input before I/O, lost/failed finalization and no rollback
after finish. Fixture file moves are not Android AtomicFile/device durability.
Literal compiled omissions must fail independent runtime assertions. Native
AtomicFile/Keystore/CE adapter and device restart/crash cases remain next.

## Source Evidence

Implemented `MessagePreviewJournalIO.java`, inactive and package-private. No
Android backend, key loading/creation, namespace initialization, vault adapter
or public ACK was enabled. The backend contract owns borrowed-stream release;
finish uncertainty is never handled by rollback/replay here.

Feature-absence RED1 (not a shipped regression), then actual kernel/envelope
and owned real JVM files GREEN9/9. Added supplied-key failure after finish and
held writer/read serialization controls; final affected run11/11 contains those
two cases and nine compiled omissions. The final harness defines11 behavior
cases/nine mutations; no full final20-case rerun is claimed. Untouched envelope
and Task5 suites were not rerun.

The backend fixture writes actual temporary files and uses explicit channel
sync/atomic move, injecting failure only at I/O edges. This is not an Android
AtomicFile/Keystore or power-loss test. A controlled writer latch and observed
blocked reader prove serialization on this instance; the future native owner
must still keep a sole instance/worker. Snapshot readback and authentication are
separate requirements: another valid old record refuses, as does loss of the
supplied key after finish. Missing/corrupt input never initializes or resets.

Affected Android36 bootclasspath compile generated all four selected classes
exit0, no APK/device. Independent frozen-source review accepted, no P1/P2;
the reviewer read the implementation and evidence without replaying suites.

Frozen SHA256:

| Input | SHA256 |
| --- | --- |
| Journal kernel | `27C32B6F867216ED7E578E686D4F80B5362D7C09A0B0D62A3054ED0AE34066A5` |
| Java probe | `00A191682D4E7B984944FCAF351E73C59CB370E99F3B6528014212084FC46E25` |
| Node controls | `140378D265016B6961C088221AC7BECBF168D23D2C28211066141F2401AFBAA5` |

No production, device, SQL, network, APK or package/signing changes in this slice.

## Next Platform Binding

Task6C2 supplies one inactive `MessagePreviewAtomicBackend`, with fixed
`<CE no-backup>/native-message-previews-v1/journal-v1.bin`. It refuses protected
storage, unknown/locked user, missing namespace directory or noncanonical targets;
it never initializes the namespace, imports/mints keys or infers generation0.
AtomicFile handles only the owned base/new/backup names. Foreign streams refuse
before close/finalize; finish/rollback consume the exact borrowed own stream.
Explicit descriptor sync plus kernel readback are still required for CHECKED.

Source/stub tests and Android SDK compilation are distinct from actual device
AtomicFile/restart/Keystore acceptance. Key/marker initialization, namespace
pristine proof and serialized generation/tombstone transitions remain next.

## Atomic Backend Evidence

Task6C2 is independently source-accepted, no P1/P2 in its inactive single-instance
I/O scope. CE/unlocked/canonical root and base/new/bak checks are repeated per
operation. Exact borrowed-stream ownership precedes filesystem/close actions;
completion releases its stream on failure as well as success. Explicit descriptor
sync does not replace the kernel's exact authenticated readback.

Feature-absence RED1, behavior9/9, eight compiled rule omissions. The initial
mutation selection passed6/8; two oracle calibrations were corrected, then only
the changed subset ran3/3. No fresh17-case whole-suite run is claimed. Separate
Android36 bootclasspath javac passed without doubles. JVM host files/FDs are real,
but Context/lstat/AtomicFile dispatch uses explicitly labeled API doubles; this
is not Android recovery, durability or CE/device proof.

| Input | SHA256 |
| --- | --- |
| Atomic backend | `193BDB5AC2A84F3AD805569FB69637883B278F97B13FB319B52AD38252403BC4` |
| Java probe | `6F555F7EF7EA4FE9E8356DA7795BC6196FC6FE17818045156AC2B01F4E477378` |
| Node controls | `279ED4286F4A2A32EEC68DC997EC745D07EB07235F5300B3EBD60C839E3FB8C0` |
| API doubles | `81C8E7B3AD74B41ED94C1796FB19D8F9446C0286A3D8BF20D51EA2DEC7B5963D` |

Path validation and AtomicFile are distinct syscalls, not directory-fd/O_NOFOLLOW
custody. An already-missing namespace refuses; concurrent same-UID replacement
or deletion between validation/startWrite is outside this proof. Future integration
must retain a sole namespace lifecycle/storage owner. No unconditional no-creation,
symlink-race or cross-process protection is claimed.

Read-only Keystore loading and a standalone owned Android platform probe are next.
The latter uses a separate app UID with fictional metadata and no WebView/network/
account/content access, not the primary release package or old ephemeral QA13.

## Trusted Root Compatibility Repair

The original AtomicBackend pins above describe the first accepted source,
not the current repaired backend. A real separate-UID Realme PREPARE refused
BACKEND_CREATE: raw trusted CE root was not its canonical string. Real UID/CE
and generated-key/reader checks had passed, journal checks were unreached.
Exact diagnostic cleanup passed; the failed phase is not relabelled success.

Normalize only the actual application Context's trusted root after requiring
absolute/no-dot-components and raw final-leaf lstat directory. Capture its
canonical identity; recapture/revalidate it per operation. Strict canonical/
lstat namespace/base/new/bak rules, CE admission and stream ownership remain.
No hardcoded data-path whitelist, fallback, create/repair or same-UID TOCTOU
guarantee was introduced.

Calibrated old-source RED1 plus refusal control, affected behavior7/7, seven
compiled omissions and real Android36 compile passed15 selected checks.
Independent scoped source review accepted, no P1/P2; no unchanged suite replay.
New raw SHA256: backend `52B2A9FA8235A943F0282B9A398F2D4BF09163B9FD8A236643B00AC613BDD637`;
probe `C0061DA1DCA0AD7B63FA8957DCFF2688FF6F7429FFE23E2AA471551EB67C392C`;
unit `B667C7B2FA384C9BB3A9E68553E1BF67B7E79B3D82252684DDB3AE05A02E71D0`;
API doubles `3019E9DA4C88F6DF4877BEE0B342A609EEF799B1EABC680D7B2D282AB3FFD919`.
Changed-artifact R3 physical PREPARE/COLD/KEY_LOSS passed on Realme after a
separate read-only incarnation reconciliation, not an install replay. Actual G8
round-trip/restart/failed-write preservation and missing-key/no-recreation are
accepted for that credential-free diagnostic only. Exact cleanup preserved
primary APK/UID/users/TestAPK. Reboot/upgrade/other-user and whole-vault proof
remain separate.
[Actual platform chronology](2026-10-08-native-preview-platform.md).

## Read-Only Keystore Evidence

Task6C3a `MessagePreviewKeystoreReader` is independently source-accepted, no
P1/P2. It is package-private and inactive, loading rather than creating keys.
CE and known unlocked user are checked at construction, before lookup and before
return. Exact lowercase installation/credential alias syntax precedes lookup.

Use only platform AndroidKeyStore and its AES SecretKeyFactory/KeyInfo. Require
an AES SecretKey, exact alias, size256, GENERATED origin, exact ENCRYPT|DECRYPT,
GCM only, NoPadding only and no user-authentication-required policy. Missing/
provider/policy/context failure yields fixed UNAVAILABLE without cause/stack/
suppressed diagnostics. No key encoding/export, cache, enumeration, fallback,
import, recreation or deletion; returned keys stay package-internal.

Metadata alias: `letscube.nmpv.metadata.v1.<installation32lowerhex>`; credential
alias: `letscube.nmpv.credential.v1.<same-installation>.<opaque32lowerhex>`.
Those are internal formats, never public status or personal identifiers.

Feature-absence RED1; initial44-case run passed43/44, with a mismatched positive
observer for the metadata-namespace mutant. Only that observer was refined and
its affected positive/mutant selection passed2/2. Defined coverage is28 behavior
and16 compiled omissions, not a fresh final44/44. Actual source executes in
isolated child JVMs with labeled Android API doubles/fictional JCA provider;
this is not Android Keystore isolation. No prior suite replay.

Android36 SDK bootclasspath compilation generated all six foundation classes,
including backend/reader, exit0, without doubles/Gradle/APK/device. Independent
review read the exact frozen source/fixture pins without repeating tests.

| Input | SHA256 |
| --- | --- |
| Keystore reader | `D0B3C24E318BD1F393FD688F770F775C949CFD43D9DE3E3FFAD219BE8E7976F4` |
| Java probe | `D943FC53E3053FDA2D3682E6AB6E1D1DC38E640046800C854E619F747027F224` |
| Node controls | `4E2F1776DF5377C8AB71F02ED7AEA5199F8DAA520BBD906D2DEA626FC61CA4B2` |

[KeyInfo](https://developer.android.com/reference/android/security/keystore/KeyInfo)
does not expose randomizedEncryptionRequired. Do not claim a readback check for
it; the future explicit creation spec must enforce it via
[KeyGenParameterSpec.Builder](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder).
The accepted envelope already requests provider-generated IVs. No hardware-
backing/other-validity-policy/unlocked lease or native acceptance is inferred.

The subsequent nested MarkerIO port24B218 is source-accepted with focused JVM
controls and repaired-source Android36 compilation. Prior physical52B2 receipts
are historical, not a physical marker test; journal behavior's exact byte
projection is preserved. No key/G0/owner activation follows from that port.
[Marker reservation scope and evidence](2026-10-08-native-preview-vault-foundation.md#marker-reservation-io-source).

Next: complete explicit pristine key/G0 initialization and sole UID owner, then
whole generation/erasure/provision transitions. Task5 SDK/Auth/resolver binding
remains unresolved; no rich/Stable GO.
