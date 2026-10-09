# Exact Unmaterialized Retirement

2026-10-09 Moscow. Coordinator-owned inactive Android source stage D4,
local candidate `81785582`, base `8230cffe`. Independent source review
`46FE5B01` has SPEC/QUALITY PASS with no concrete remaining P1/P2 in this scope.
No product activation, main deployment, APK replacement or SQL dispatch.

## Observed Gap And Repair

An acquisition could reserve generation A without entering a journal phase or
key request, then be cancelled by retirement R. After the held acquisition
settled, authenticated predecessor P was still on disk. Ordinary custody rightly
required P.generation == R.base; that relation did not hold for the abandoned
allocation, so cleanup returned INCOMPLETE. This was an inactive integration
limitation, not a claimed regression in the shipped application.

The narrow repair adds a deletion-only basis with exact retained P/A/R identity:
P.generation == A.base, A.generation == R.base, one increment per operation,
distinct operation IDs and a newer retirement revision. No A journal record is
fabricated. Ordinary custody still requires its exact predecessor; the new mode
cannot create a key, skip arbitrary generations, guess an alias or purge keys.

The retained initializer worker additionally requires the actual cancelled
acquisition, its retired ticket, exact Work/Fence/operation references, and no
attempted phase or possible key entry. Only freshly authenticated, fully equal
P qualifies. Classification permits metadata/journal reads; refusal before
effects means before writes or key changes, not zero I/O.

R retains its original admission+10s budget after the held operation settles.
Busy ownership lasts through settlement and cleanup. It writes actual checked
RETIRING, deletes or confirms absence of P's exact alias, then writes and checks
actual EMPTY before publishing success. A later acquisition can proceed on the
same retained owner. Unknown write/delete, stale history, missing metadata,
attempted/entered-key work, expiry or cold history loss remains INCOMPLETE;
there is no automatic retry, recreation or catch-time repair.

## Scope And Focused Evidence

Three production files changed: [custody](../../android/app/src/main/java/com/kub/messenger/MessagePreviewCredentialKeyCustody.java),
[initializer](../../android/app/src/main/java/com/kub/messenger/MessagePreviewPristineInitializer.java)
and [provisioning](../../android/app/src/main/java/com/kub/messenger/MessagePreviewVaultProvisioning.java).
The existing [probe](../../tests/java/com/kub/messenger/MessagePreviewVaultProvisioningProbe.java)
and [unit harness](../../tests/unit/native-message-preview-vault-provisioning.test.mjs)
provide the controls; the existing Android fixture is unchanged. Total candidate:
five files,417 additions/22 deletions. No plugin/runtime/JavaScript/lifecycle
consumer, release configuration, package identity or database change.

The real held-owner graph first failed at the literal exact-EMPTY requirement,
not compilation/setup/timeout. Expanded prepatch selection retained4 failures
and1 expiry-control pass. Incremental affected runs then observed21 distinct
behavior controls GREEN and10 calibrated compiled omissions killed. Those are
not a fresh31/31, old49 or full-suite result. The two combined-guard omissions
are explicitly combined, not falsely counted as independent single-guard kills.
Final affected2/2 verifies same-owner successor COMMITTED/EMPTY and refusal after
entered-key history even when an older original record is readable.

The harness compiles thirteen real production classes with labeled fictional
Android/clock/provider/AtomicFile/verification boundaries and real SunJCE AES-GCM.
It does not prove AndroidKeyStore, physical persistence, real verification or
installed-client acceptance. Previous D2 physical/D3 SDK evidence is historical,
not silently rebound to these changed files.

Frozen SHA256:

- Custody: `C41D7BAF997C2CD68100FD2C128A9BEEDDC8EDBEFBED634E61FECE7917E99C18`.
- Initializer: `6EC9E31DF193C489B037D44F4AE34BB1FF11EC5897C516C73449E6F2FD3E1875`.
- Provisioning: `E6040DF3DC0B296E4453E58535B1DEE7551407A7B27EF9F21C553A75C2563CEE`.

## SDK And Remaining Work

Current static closure confirms the same69 ordered named definitions across
thirteen sources. The new exclusive compiler program has explicit reviewed
three-source pins and immutable class names. Its changed final-binding control
failed UNKNOWN/FROZEN once, then that control and preserved-body projection
passed2/2; syntax and current18-pin readback passed. These are preparation
controls, not an actual SDK compile. Final binding review66DEB124 passed. Its
initial verdict/body was read before the sole dispatch; the final preservation
note separately observes output presence without claiming SDK PASS. An
interim source-report shorthand was reconciled to final46FE5B01 before evidence
publication; no source/helper/test, verdict or frozen receipt was changed.

One actual fixed-JBR/Android36 SDK compile then passed, observed12:09 Moscow:
thirteen full explicit sources, fresh isolated classpath/sourcepath, proc:none,
source8/target8. All69 required fresh named class definitions have verified
CAFEBABE/major52 headers and hashes. Source/helper/tool and protected main/local
Test APK byte equality passed before/after. A separate read-only witness checked
the new intent/compiler/result chain, all69 definitions and all18 input pins;
it was not a second compile. Result SHA256:
`84C498828C1F67E4DE73E087A02E1ADA3731BA19666C74298EF9A5708D2C1300`.
No SDK job remains. This is API compatibility, not actual provider/physical,
Task5 or product acceptance.

Next: genuine same-verification-invocation producer, real device binding and
physical composition, then consent/fetch/card acceptance. Default construction
stays unbound. COMMITTED storage is not user consent or display authority.
Protocol0/generic notifications remain unchanged; nativePositive,
richPreviewEnabled and canPublishRich remain false. Source/SDK acceptance alone
does not promote Stable. Web/main `4765bcad` and AndroidStable0.1.14/build15 remain
the product baseline; the earlier0.1.15/build16 candidate is not published.

The new search expand/collapse lag is tracked separately as
[item93](../PRODUCTION_PRIORITY_TRACKER.md).
It is a reported symptom, not a reproduced or repaired cause, and does not
interrupt this native stage. No paid rental or device effect occurred here.
