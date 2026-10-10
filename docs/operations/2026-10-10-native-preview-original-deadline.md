# Native Preview Original Invocation Deadline

Date: 2026-10-10. Owner: coordinator. Source branch
`codex/bot-inline-media-20261002`; base `280c7b82`.

## Scope And Cause

The next QA composition posts the native invocation to main, then initializes
and provisions through an existing worker. Its original eight-second budget must
not restart when that worker reaches verification. The dormant producer already
retained the verification/vault deadlines, but had no credential-free admission
argument for the earlier plugin-entry deadline. This is a prerequisite for a
new inactive route, not an observed regression in the published application.

`MessagePreviewVerificationProducer.arm(Identity, long)` now retains a safe,
future original deadline in its immutable Admission. Capture is followed by
another future check; current checks refuse at or after that deadline. Guarded
verification validates its supplied deadline before taking the minimum of it
and the retained original deadline. The existing Runtime/State chain propagates
that minimum to every I/O boundary and the exact final-publication permit.

Legacy `arm(Identity)` retains its internal sentinel and does not add a clock
read. Ordinary plugin verification, the public wire and protocol0 are unchanged.
There is no new producer caller, initializer consumer, executor, credential
getter, provider request, APK installation, SQL or release effect.

## Focused Source Evidence

The implementer used the actual producer/runtime/state/provisioning/initializer
classes with explicitly fictional Android, SDK, Auth and clock ports. The
unpatched feature selection compiled and failed on the named reflection absence
`ORIGINAL_NATIVE_DEADLINE_FEATURE_ABSENT`, not a compiler error or a claimed
shipped regression. Legacy literal deadline18000 calibrated before the patch.
The RED source was the actual unpatched worktree, not a separately hash-frozen
Git checkout; no immutable RED snapshot is claimed.

Reported separate runs, not a combined suite:

- Deadline selection17/17, including the feature and legacy calibration.
- Seven compiled mutants reached the expected literal runtime assertion.
- Affected legacy selection12/12.
- Final deadline selection17/17 on the frozen source.

Implementer commands, reused without another run:

```powershell
node --test --test-reporter=spec --test-name-pattern="^original native deadline (feature|boundary):" tests/unit/native-message-preview-verification-producer.test.mjs
node --test --test-reporter=spec --test-name-pattern="^original native deadline compiled mutant:" tests/unit/native-message-preview-verification-producer.test.mjs
node --test --test-reporter=spec --test-name-pattern="^actual dormant producer/composed boundary: (healthy|ordinary-plugin|result-short-deadline|result-identity|refuse-unguarded|admit-cached|context-before|context-after|held-auth|final-before|final-at|final-close)$" tests/unit/native-message-preview-verification-producer.test.mjs
```

Assertions use literal11000 versus18000, tighter vault10500, unsafe/expired
admission with no I/O, expiry during capture, before/at/after current checks,
held Auth at11000 with no further I/O/key, and final publication10999/11000.
The mutated boundaries cover clamp, current, safe/future shape, post-capture
recheck, supplied shape and exact retained Admission deadline. Entered I/O is
not claimed to be preemptively cancelled; stale returns cannot admit another
step or positive publication.

Only four implementation/test files changed. Coordinator diff and hash readback
match the frozen producer/runtime; the unrelated sidebar/search edits are
preserved. Independent source/binding review `01a12324` accepted the exact files:
no blocking findings, unchanged14-source closure, exact80-name set. Review did
not replay tests or compile. Its conclusion is hash-bound, not an independently
verified Git comparison; coordinator separately read the actual four-file diff
against HEAD280c7b82.

## Frozen Inputs

| Production source | SHA256 |
| --- | --- |
| Producer | `b1ce2e39dbe775c9a0ac5b70a434e9a9cf4af71575daf3252b1e3f21659570f9` |
| Runtime | `68c98753ab01637bdd5772bf60c15b3a9901e83a79672faa854cf1a9b36be4b0` |

## Actual SDK Evidence

One new SDK invocation passed by03:14 Moscow using the existing fixed JBR/Android36, Java8,
16 explicit production sources, 80 required fresh named definitions and 21
source/tool/protected-local-APK input pins. The private helper is a mechanical
fork of the accepted prior helper, with a new exclusive output directory.
The new literal binding control first failed against PENDING; after reviewed
two-source binding, the new binding/projection controls passed2/2. The reverse
projection matches the accepted prior compiler recipe exactly, aside from output,
comment and binding. No old compiler/helper suite was replayed.

| Receipt | SHA256 |
| --- | --- |
| Frozen helper | `1913479791b47c46de9480976467a09c18dad33445ffb9961eb85954c016dae2` |
| Intent | `175341153ab574e50cf0f3834a58ce1a952c9b996f5a43bfae17f7fb4c28aec0` |
| Compiler | `b29b1606f276a5433013fc8ba10609c018df798ea70c6ba8e232c06f65cb16fb` |
| Result | `6b4ad6c780bf7f4d476a4c14e8a3a1bfef16b8d1c248b524cff3cb8646d16f0a` |

The compiler exited0, stdout0 bytes/stderr272 bytes. Only counts/hashes were
reported, not compiler contents. Separate coordinator readback checked all three
receipt hashes and their chain, the exact helper, all80 named emitted class
hashes/CAFEBABE/major52 headers and all21 source/tool/protected-APK pins. All
preservation flags matched. Old outputs/receipts were not overwritten or used as
new evidence. There was no APK build, device/provider/SQL effect or Stable release.

## Next And Limits

The prerequisite is complete for source and SDK. Continue the QA-only
real-MainActivity holder/plugin route in the
[genuine composition plan](2026-10-10-native-preview-genuine-composition-plan.md).
The [R2 physical offline result](2026-10-10-native-preview-physical-composition.md)
and [Task5/server retirement](2026-10-10-push-session-retirement.md) remain valid
for their original scopes; do not replay those unchanged checks.

Genuine combined verifier/vault device acceptance, explicit end-user choice,
consent, background/process-death delivery and notification-card activation are
still outstanding. D-335 stays OPEN. NativePositive, richPreviewEnabled and
canPublishRich stay false; Stable Android0.1.14/build15 is unchanged.
