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
