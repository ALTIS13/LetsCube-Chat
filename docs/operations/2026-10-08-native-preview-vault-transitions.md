# Native Preview Vault Transitions

2026-10-08. **INACTIVE_SOURCE_ACCEPTED / SDK_DEPENDENCY_COMPILED /
CONTROLLED_OFFLINE_TRANSITIONS_ACCEPTED**. Approved D335 continuation,
extending the existing retained initializer and its sole worker. No second
namespace writer, consumer wiring, credentials, consent or notification change.

## Contract

The first slice is credential-free: authenticated `EMPTY G0 -> RETIRING G1 ->
EMPTY G1`, then an exact G1 retirement may advance to G2. The checked predecessor
comes only from the real initializer's successful final readback. Caller
generation, existing files or a spent initialization permit cannot create it.

Main-thread admission performs only short memory checks and a single reservation.
The worker authenticates the complete captured predecessor before effects and
checks exact operation/revision/generation, deadline and platform/key availability
around held work. Checked persisted generation and allocated generation are
different states. Stale, duplicate and busy admission must not consume a slot,
replay identity or high-water value.

Timeout, cancellation or callback loss does not release a worker still inside
I/O. Final authenticated EMPTY readback and a fresh operation check precede a
retirement acknowledgement. The private checked head is updated before callback
delivery outside locks. A callback failure cannot replay the write.

An unavailable write may already have committed. Keep its exact correlation and
block successors; after the real call settles, an explicit read-only observation
may establish exact final completion. Older, different, missing, corrupt or
RETIRING records do not establish completion or permit a reset. Metadata key loss
never recreates a key, journal or G0.

## Source Verification

The existing initializer now retains a private checked state and uses its same
worker for retirement and exact read-only observation. Independent spec and
quality review found no P1/P2 in this empty-only scope. The private backend guard
rechecks operation currentness after JournalIO prewrite authentication, before
entering the first write port. The held-provider case failed before that repair.
Already-entered platform validation/syscalls remain non-preemptible; a stale
return cannot begin the next logical write or publish a successful result.

Calibrated feature-absence, malformed-syntax and held-authentication RED cases
preceded their fixes. Separate affected GREEN selections were 3/3, 26/26, 5/5 and
2/2, plus 14 compiled literal omissions with independent healthy controls. These
are chronological runs, not a new final 48/48 aggregate. The controls cover G1/G2,
full predecessor/correlation, busy retention, key loss, corruption, exhaustion,
partial/unknown commit, final publication, old cancellation and callback loss.
Actual JCA and owned JVM files execute; Android/Keystore custody is modeled.

Two compatibility-only harness changes add the real Fence dependency to the old
initializer compile list and update the foreground unit's initializer pin.
The new suite's selected initialization handoff controls are reused; only one
affected foreground Gate-worker check ran, 1/1. Unchanged suites and earlier
physical/SDK receipts were not replayed or retargeted.

| Frozen source | SHA256 |
| --- | --- |
| Initializer and transitions | `5920ED1908B4376687CBF7EE1A19CD968FB48C3DCBBC94257F95A4B5EE469A04` |
| Java probe | `56C446CF15BD996E81B0C16ECB15986B746E90CEA55103315E7292114B29FB6B` |
| Unit controls | `AECC2A07A0C8207A10F3D572C2E631E29C65172C320C18792A6F1B7DE3D4F3E9` |
| Modeled fixture composition | `0CEC822C3AE22E5CBC9B44D199159BE6AE5E03FF60FA23FF6F5E14D2DCAD85F1` |

## Actual SDK Compilation

One independently reviewed, new scoped adapter compiled the reviewed source with
the existing JBR21/Gradle8.14.3/SDK36 and real app dependencies, offline. It reused
the working isolated r2 project cache, not the failed old cache/junction. Exit 0,
97 normal prerequisite tasks and one EXECUTED `:app:compileDebugJavaWithJavac`;
no release/package/test task, APK build, signing or installation.

The outer initializer class changed and both it and InitializedState were freshly
emitted, Java 21 major 65. Typed bytecode references bind InitializedState to the
real Fence; existing issuer/MainActivity/Capacitor closure remained byte-identical.
Source/helper/config/runtime/protected main and Test APK readbacks matched. New
exclusive intent/result records were preserved; no replay or old-receipt update.

Result SHA256 `A2FBD4E01B080621C4722F974178D2573954CC9BD4D9F7E1134943778A8F5B81`;
outer class `7A7FD77FBA177C0BC1AD3E6E7FAC3309EA1A36E329A88F3121437B1A51C01C35`;
InitializedState class `D478976D857524910D7C0D8923FA71719A6362AAA58C034E61FC372FD8750FB8`.
This is changed-source SDK compatibility, not physical transition acceptance.

## Controlled Offline Physical Transitions

One new standalone, no-network diagnostic was built with the existing Android36
tools, a separate package/UID and a fresh QA-only ephemeral signer. Actual binary
manifest, definition-based DEX, alignment, signature and all14 source readbacks
passed. Native normal-return handling and the host's protected-APK read limit
were independently repaired after calibrated RED cases; both fixes and the final
exact14-source binding were independently source-accepted before actual effects.
The old failed inputs/receipts remain unchanged. Fictional VM buffers calibrate
the host size guard; they are not presented as actual filesystem/native evidence.

The reviewed host then read the real build receipt and APK, checked absent target
in all users, preserved primary/Test/users, recorded a durable STREAMED_INSTALL
acknowledgement, bound exact new incarnation UID10553 and ran TRANSITIONS once on
Realme user0, PID21614. An ordinary owner-authorized UI unlock prepared the phone;
fresh Awake/non-showing/unrestricted guards admitted the core. No lock settings,
network, trust, services, personal screen or account data were changed/captured.

All23 fixed native endpoint flags were true, framework code -1: actual target
Application/main/resumed issuer, one initialized owner, marker and Keystore policy,
authenticated EMPTY G0, own A retirement/EMPTY G1, own B retirement/EMPTY G2,
identical non-main callback Thread objects, exact operations, no credential alias,
initial key authenticating final record, unchanged marker, nondecreasing wall and
successful owner/Activity disposal. Transient RETIRING is source/JVM ordering
evidence, not a physically sampled intermediate file. No second writer or poller
was used, and diagnostic lifecycle authority is not production Foreground wiring.

Compulsory cleanup ran once after the core: exact incarnation uninstall SUCCESS,
target absent in all users, primary UID/APK, installed Test UID/APK, host-local
main/Test and user digest preserved. Prepare87025 and cleanup85302 both closed
exit0. No diagnostic remains; no unchanged cold/key-loss case was repeated.

| Actual input/result | SHA256 |
| --- | --- |
| Reviewed host | `6E6053B2D30AC81BACA407A202E478A4CB4B30C95612DE668C1F1373D0C8AD0C` |
| Final binding review | `826451727EAFB4F84A70A6085435E6A637DD9B872FEB96D3AF48E66B78FCCED9` |
| Builder / source14 digest | `DF0D93409A9843D08D2374BB2F340BCF4E08D74FE32208C1A2BA3C44B2F03250` / `EA9389106E363A50BC7A4277DE2D6AC09037E72984426A7338DE15F76F3A449D` |
| Build result | `051002351150BE1615757D1AAE0B9E01C1ECCBDE1EC7CA82FBD877FF12EAC897` |
| Offline APK,49,560 bytes | `C18270BBCF54A2F8AE5F3CE77C88595312F1B4B84D7000313F0E48E7D76E3C87` |
| Fresh public QA certificate | `598723A4E979EDBC3103CD666FA9CC7BC94D3A5C305E6499CA054AA2BA2156A0` |
| Fixed23-flag observation | `E1CE1F46ACD8BE310BDFEBAB045A6B7E1CF932E29F8A587DEDABADC87AED4178` |
| Transitions receipt | `4DFD302819CA9527FC5712906D4A997E5A479B37999322DB88B115F9E0489307` |
| Exact cleanup receipt | `7C9BC77095C53EAFB6F778135202544321069F352AE1BC23BC76B27D0EA51AF6` |

These hashes reference private fixed receipts, not published signing material or
personal data. This proves the credential-free diagnostic's changed-source
endpoint transitions and cleanup, not Task5 networking/Auth/FCM/live authority.

## Acceptance Boundary

Focused source controls compose the actual fence, envelope, checked journal and
retained owner. Android lifecycle/UID/Keystore doubles are explicitly modeled,
not native custody evidence. Source review, actual SDK compilation and the new
controlled offline credential-free endpoint transitions are accepted. Next is
the inactive inner credential codec, then nonempty/provision/live integration.
Old initialization and
foreground receipts remain tied to their original source.

This slice deletes no stored credential key and implements no provision/BEGIN,
cold attachment, background fetch, display capability or Task5 live context seam.
Terminal owner close is not durable erasure. In-process ordering does not preempt
an already-started syscall or prove sudden-power-loss/cross-process guarantees.

Production remains web/main `4765bcad` and Android Stable `0.1.14/build15`.
`nativePositive`, rich previews and Stable acceptance for the preview candidate
remain false. Both previously installed migrations must not be replayed.

[Initialization evidence](2026-10-08-native-preview-pristine-initializer.md).
[Passive foreground authority](2026-10-08-native-preview-foreground-authority.md).
[Device-binding plan](2026-10-08-native-preview-device-binding-plan.md).
