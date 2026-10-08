# Native Preview Vault Foundation

2026-10-08. D-335 remains OPEN. This is an inactive native source foundation,
not credential retention, a notification capability or native acceptance.
The running main APK and generic push/voice are unchanged. Protocol remains 0.

## Task 6A: Admission And Erasure

The package-private `MessagePreviewVaultFence` separates captured Task5 context,
live vault intent and generation. Exact target comparison precedes effects.
Retirement needs no surviving authentication context, but must match the current
generation or the exact accepted original-BEGIN correlation. An old operation
cannot complete, refuse or erase its successor. An eligible malformed owner has
an internal erasure-only reservation, never access authority.

All non-retirement admissions retain the final numeric/identity slots for
erasure. Exhaustion refuses without changing either high-water or current work.
The class holds no credentials, storage, key, SDK, network or plugin reference.
Its constructor/context inputs still require a future trusted native owner.

Evidence: initial feature-absence RED, not a shipped behavioral regression;
20 behavior/19 compiled omission controls; affected erasure repair 27/27;
correlation delta 12/12; numeric headroom RED2 then affected GREEN11/11. Unchanged
evidence was reused. No final full 58-case rerun or device proof is claimed.
Independent final delta review accepted the pinned inactive source, no remaining
P1/P2. Constructor/context provenance and durable storage remain outside this
acceptance, not an asserted native credential lease.

| Task6A source | SHA256 |
| --- | --- |
| `MessagePreviewVaultFence.java` | `0DFCC1664B9D513CB0E524A2EAADE4FA595DE5000429A2C6130BD59FE6FF853B` |
| `native-message-preview-vault-fence.test.mjs` | `869A2B7DF0A5DF23D1B9007714716DC78C9FACCE2A3F5BF9CA71932C91D3C924` |
| `MessagePreviewVaultFenceProbe.java` | `4800BBDB56BD530CC181EE221EFEFC85BB05C24C47EF3A6B78AC7C2582C426FC` |

## Task 6B: Authenticated Metadata Envelope

Implemented bounded source slice: one package-private binary envelope codec using
platform JCA AES/GCM/NoPadding. It accepts a caller-supplied metadata key; it
does not create/recreate keys or read files, and has no plugin/SDK integration.
The Android Keystore/AtomicFile adapter is a subsequent slice.

The envelope authenticates empty plaintext with a fresh provider-generated
12-byte IV and 128-bit tag. A fixed domain and length-delimited canonical header
and opaque credential ciphertext are AAD. The entire envelope is at most
16,384 bytes, including all framing, IVs and tags. Parsing authenticates before
returning any generation/alias/correlation. It never decrypts credential bytes.

Fixed binary schema, big-endian, format 1:

- Envelope magic `LCNMPV01`, header length/header, credential-blob length/blob,
  metadata IV (12 bytes) and metadata tag (16 bytes), with no trailing bytes.
- Header: format, installation nonce (32 lowercase hex), generation, kind
  (`EMPTY`, `PENDING`, `COMMITTED`, `RETIRING`), owned credential alias or empty,
  credential expiry in epoch milliseconds, wall high-water in milliseconds,
  operation ID or empty, base generation and vault intent revision.
- Header strings use unsigned 16-bit byte lengths and ASCII, one fixed order;
  unknown versions/kinds, malformed lengths/strings or extra fields refuse.
- Only pristine EMPTY/G0 may omit operation ID. Other records name one operation
  and satisfy generation = base + 1. Intent is nonnegative and distinct from
  Task5 context. No live ticket, Task5 epoch, clear owner tuple or bearer appears.
- Alias namespace is `letscube.nmpv.credential.v1.<installation>.<opaque32hex>`.
  PENDING/COMMITTED require it; EMPTY forbids it; RETIRING may name the prior
  owned key or none. COMMITTED alone carries an opaque blob of at least 28 bytes
  (credential IV/tag framing); others carry none. Only COMMITTED has expiry.
- All integers use existing Task5 safe bounds. Expired COMMITTED metadata can
  remain valid but dormant; parsing is not a deadline or access-readiness check.

Missing/wrong key, tag/AAD mismatch, foreign installation, unsupported/malformed
record or total overflow produce only fixed UNAVAILABLE, without generation,
cleanup, reset or key recreation. This detects alteration, not replay of a valid
old file. Returned objects/arrays must not retain caller-mutable input aliases.

Focused acceptance: actual compiled codec/JCA with fictional bytes; all four
kinds, external framing/AAD control, altered header/blob/tag, missing/wrong key,
cross-installation, truncation/overflow/trailing bytes, immutable snapshots and
independent IVs; literal compiled rule omissions. No JVM result is described as
Android Keystore isolation, reboot persistence, durable ACK or native binding.

### Task6B Evidence

Actual compiled codec/JCA with fictional inputs: feature-absence RED1, then
behavior11/11; expanded runner20/20 (11 behavior and nine compiled omissions).
Coordinator also ran the same nine omissions before the expanded worker receipt
arrived: duplicate coverage, not nine additional unique cases. No more replay.
The final external-fixture observer and five new domain/version/IV/tag/AAD
omissions passed6/6. Total defined coverage is11 behavior/14 compiled mutations,
not a fresh final25-case whole-suite run. Java source stayed byte-identical.
Independent source review accepted the final pinned codec/tests, no P1/P2;
no platform/runtime gate is promoted.
An additional compile against the installed Android36 SDK boot classpath
generated all three foundation classes (exit0), without JVM stubs, Gradle/APK
rebuild or device execution. This checks API availability, not Keystore behavior.

The external fixture writes its own schema/AAD and authenticates actual JCA
empty payloads independently. All four kinds reject each one-byte alteration;
literal 16,384-byte acceptance/16,385-byte refusal, foreign installation/alias,
missing/wrong key, malformed authenticated header and immutable snapshots are
covered. Compiled omissions require successful healthy controls and fixed
runtime assertion failures, not compiler errors or timeouts.

| Task6B source | SHA256 |
| --- | --- |
| `MessagePreviewMetadataEnvelope.java` | `EB1B585E237BFF3326B74185AEB1378E3082EA45F6E728FE917E74DE3A2F416B` |
| `native-message-preview-metadata.test.mjs` | `506464523219952B915FC07825A1C72C96DC966E73BD63F98A298B16A4BCC0B8` |
| `MessagePreviewMetadataEnvelopeProbe.java` | `6D9B8F290FE33FE53BB217ADF725B1993DE3B30387E4C6209EB0607156DD349C` |

The codec takes an already-owned AES metadata key. Its origin, AES256 key
generation policy, Android user isolation, no-recreation evidence and separate
credential-key ownership belong to the platform adapter, not this acceptance.
No bearer/owner decryption, key minting, file write or public ACK is implemented.

## Remaining Gates

Task5 actual SDK/Auth/resolver binding was not observed. Realme QA13 was removed,
primary data retained; its failure diagnostic measured no default network and
hostname lookup failure for that caller. Effective policy remains UNKNOWN.
Do not replay Auth or change global networking to guess a repair.

Next: Android CE/no-backup/Keystore/checked AtomicFile storage, serialized
transitions and crash/failure tests, then fresh verification-only foreground
adapter and a narrowly owned working device environment. Consent/background
fetch/display and Stable publication require their separate real-system gates.
Neither installed database migration is to be replayed.

### Task6C Platform Adapter Boundaries

Official platform APIs checked 2026-10-08 before implementation:
[AtomicFile](https://developer.android.com/reference/android/util/AtomicFile),
[no-backup directory](https://developer.android.com/reference/android/content/Context#getNoBackupFilesDir()),
[Android Keystore](https://developer.android.com/privacy-and-security/keystore).
These establish platform behavior, not this application's device acceptance.

- The owned journal belongs only in the current application's credential-encrypted
  no-backup namespace. Reject a device-protected context/unavailable unlocked
  storage; no fallback to external/shared/preferences or voice state.
- AtomicFile requires caller serialization for both reads and writes. Use one
  bounded native worker; no network wait while holding its storage ownership.
- Read via `openRead()` with a hard 16,385-byte observation ceiling, never
  unbounded `readFully()` or trust in `getBaseFile()`/file length alone.
- Write only an authenticated bounded envelope, explicitly flush/sync, finish
  the owned AtomicFile operation and read back exact bytes/authenticated metadata.
  A void finish method is not itself a truthful durable-success ACK. Inject
  write/sync/finish/readback failures in focused tests before platform binding.
- Missing namespace/marker/key/journal with evidence of existing owned state
  refuses; no inferred G0, key recreation or credential import. Only an explicit
  first transition may initialize a proved pristine namespace. Creating the
  metadata key and crash recovery remain unimplemented in Task6B.
- Keystore key presence is not evidence of hardware backing or device-unlocked
  usability. Actual isolation/restart/upgrade/key-loss behavior needs a scoped
  device case. Never log/export a key, bearer, alias or personal tuple.
