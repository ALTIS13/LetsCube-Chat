# Inactive Native Preview Credential Envelope

2026-10-08. **INACTIVE_SOURCE_ACCEPTED; SDK_API_COMPILE_PASS**. This fills only
the inner encrypted format required by the current Task6 design inputs. It does
not freeze/complete the full draft, create a key or provision/activate a vault.
The preceding offline C4 physical transitions remain separate evidence.

## Boundary

The metadata codec authenticates its header and opaque credential bytes; it does
not identify their access/session/device contents. The new package-private codec
encrypts supplied access plus exact recipient/session/device/accountEpoch/expiry
and checks an authenticated outer Record against an expected tuple and header.
Only owned ciphertext or a match boolean returns. No decoded access object or
String, key export, storage, clock, thread, Android lookup, plugin or consumer.

Supplied AES key/Owner syntax and authenticated metadata are not live provision
authority. A future caller must establish genuine current Task5 authority before
access retention; cold state remains dormant. No JWT decoder or new verifier is
introduced. Valid authenticated mismatches return false; malformed/framing/tag/
provider failures throw fixed checked UNAVAILABLE without cause, stack or
suppressed detail. Mutable buffers are cleared best-effort, not Strings/provider
memory. The defensive Record copy is already bounded by the outer journal.

## Format

AES/GCM/NoPadding, provider-generated IV12, checked GCM tag128. Encrypted plaintext
uses big-endian version1/access length/access, three UUID36 fields and two int64
values for accountEpoch/validatedExpiry. Printable ASCII access1..8192, overhead132,
plaintext133..8324; blob IV12+ciphertext/tag16 is161..8352 bytes.

Separate domain LETSCUBE-NMPV-CREDENTIAL-v1 binds format1 and all nine canonical
header identities: installation, generation, COMMITTED literal2, owned opaque
alias, expiry, wall high-water, operation, base generation and vault revision.
The maximum composed outer journal is8604 bytes within its existing single16384
ceiling. Generation/base/safe integer/alias/expiry relations and input lengths
are checked before plaintext allocation/provider entry. No caller IV or derived
nonce, token hash/owner in aliases, refresh token or public API key storage.

## Source Verification

Feature-absence RED preceded implementation and is not called a shipped security
regression. Actual classes/JCA and the unchanged real outer seal/open execute
with fictional keys/access/owners. A separate DataOutputStream framing/AAD and
external SunJCE decrypt oracle assert literal layout, domain, fields and bounds,
not both sides of a shared erroneous serializer. Authenticated malformed frames
are independently encrypted/rewrapped to reach decoding guards.

Separate chronological GREEN selections:2/2 healthy/external,47/47 behavioral,
27/27 compiled omissions, then affected4/4 (three behaviors plus one omission).
Final definitions52 behaviors/28 compiled mutants were covered; this is not a
fresh80/80 or81/81 suite. Each mutant compiles, has a healthy control and fails
its exact runtime assertion; setup/syntax/timeout is not a killed rule. Counted
fictional provider controls calibrate ordering/array clearing, not Android policy.

Independent source review accepted specification and quality, no P1/P2. No old
suite replay, dependency or existing primitive modification was required.

| Frozen file | SHA256 |
| --- | --- |
| CredentialEnvelope | `3B04114F8485921BC7EE7B7FC1E83211CD61E369981A5715ECEA4CA330755421` |
| Java probe | `30CDD69B2C1A57D007ED6D05E73E40130FBD35BAEE982C2CEE55BDF71C37754C` |
| Unit controls | `D5F4483316E9F5A6D801E4988EB314CC67A228073962B6CC5233E63B74E23579` |
| Implementer report | `DE71AE13BA27161BB1E25A5FCA94BA2E8DC33D6A26A97458139793DAFC358567` |
| Independent source review | `10DAC7CCBC32FC528D2C4EB9F6AC31145D941A150A20817F5A170AC6A4D1E753` |

## Actual SDK Compatibility

After independent source and compiler-adapter review, the coordinator dispatched
one ordinary javac compile against the existing Android36 public API boot jar.
Exactly four actual production sources (verification state, fence, metadata and
credential envelope), no fixture/probe, processor or implicit project classpath.
The exclusive new output produced five checked class files, CAFEBABE/major52;
compiler exit0, source/tool/helper readbacks and protected main/Test APKs matched.
No Gradle, DEX/APK, signer, device, global Java/PATH or production effect.

Generated intent `24D97180A99AF2C2283F612C299C00EF4C7982A248360CBD5BA42716FBC33C6D`,
compiler metadata `B29B1606F276A5433013FC8BA10609C018DF798EA70C6BA8E232C06F65CB16FB`,
result `CA400DBACA9C3761290FF509DB3C8E19E96D75A934250402701A3C710AE33732`.
Adapter `C3356B` was independently source-accepted in review `B8C93A` after
contract review `84A1CA`. Raw compiler output is neither printed nor retained;
private metadata records exit/stream lengths and hashes only. The finite command
completed and no compiler job remains. These prove API compatibility, not actual
Android provider/Keystore policy, runtime authentication or shipping integration.

## Remaining Acceptance

Next is the inactive exact credential-key custody port. Actual AndroidKeyStore
AES256 policy/provider behavior, exact credential-key
creation/deletion, checked PENDING/COMMITTED/RETIRING sequencing and genuine
Task5/provision/lifecycle/device integration remain separate gates. No protocol1,
background fetch/display, consent, rich-preview or Stable promotion follows.
Current generic notifications/voice/product behavior is unchanged.

[Preceding controlled offline transitions](2026-10-08-native-preview-vault-transitions.md).
[Current device-binding gate](2026-10-08-native-preview-device-binding-plan.md).
