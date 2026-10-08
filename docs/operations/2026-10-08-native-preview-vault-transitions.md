# Native Preview Vault Transitions

2026-10-08. **INACTIVE_SOURCE_ACCEPTED / SDK_DEPENDENCY_COMPILED**. Approved D335 continuation,
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

## Acceptance Boundary

Focused source controls compose the actual fence, envelope, checked journal and
retained owner. Android lifecycle/UID/Keystore doubles are explicitly modeled,
not native custody evidence. Source review and actual SDK compilation are accepted;
the new isolated physical transition check remains next. Old initialization and
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
