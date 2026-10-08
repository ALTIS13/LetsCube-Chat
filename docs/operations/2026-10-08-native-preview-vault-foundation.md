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

Next bounded source slice: one package-private binary envelope codec using
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
