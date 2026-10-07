# Android queued read-card reconciliation

## Cause and scope

D-353 / tracker91 is a distinct follow-up to the accepted D-351 ownership repair
and Android Stable0.1.12/build13. A calibrated actual-source queue/hook fixture
failed when OLD was visible, NEW was queued, and NEW was marked read before the
OS exposed its card. Exact cleanup correctly preserved OLD, but the JS caller
ignored a zero-removal result and permanently deduplicated NEW's confirmed read.
After the simulated OS queue flushed, already-read NEW remained visible.
The two controls preserved unread NEW and removed NEW when read after flushing.
This initial reproduction was source/queue evidence, not physical FCM delivery.

## Repair and source evidence

Native cleanup returns `{ removed: 0|1, pending: boolean }`. Only an exact
confirmed latest intent can be pending. Unknown/missing-ID cards, voice cards,
different latest messages and retired owners do not trigger polling. The JS
cleaner coalesces identical in-flight requests and checks document/account
ownership before every IPC and after its completion. There are four attempts
with 250ms spacing, not an unbounded OS poll.

Malformed or missing acknowledgements, failure and an exhausted pending window
return `retry`, not successful deduplication. The hook preserves eligibility,
but requires five seconds and another successful fetch before retrying. Realtime
events alone do not create repeated native cleanup calls. Retirement cannot
commit a result into a replacement owner's deduplication map.

The combined baseline RED1/controls2 became GREEN3/3. Changed native pending
checks17/17 include six compiled mutants; affected ownership controls19/19 pass.
Cleaner44/44, native adapter6/6 and hook14/14 include nine, one and six compiled
mutants respectively. QA-user isolation5/5 includes four compiled mutants:
an explicit positive user must match the actual process; primary/mismatched or
malformed users refuse. Typecheck passed. These focused results are reusable;
the already accepted unrelated recording/authentication suites were not replayed.

Independent review found two adjacent P2 cases before packaging: rejected
capability negotiation stayed cached forever, and a visible generic OLD card
vetoed pending cleanup for exact read NEW. Capability RED3/control1 became6/6
with two compiled mutants; its ignored causal fixture became3/3. Generic OLD
RED1/controls2 became10/10 with two compiled mutants. The rejected Promise is
released only by a current reader with matching identity. Generic OLD still
cannot be cancelled; only exact latest read intent controls pending eligibility.
Whole-project typecheck passed after these deltas.

The private physical-QA validator also failed four refusal cases while three
controls passed: JUnit's `OK (1 test)` can include an assumption skip. The repaired
validator requires the exact start/success statuses `[1,0]` and one terminal
runner result `-1`; skip, unknown status, missing end and assumption diagnostics
refuse before writing a PASS receipt. GREEN8/8 includes a compiled omission
mutant; independent new pure controls8/8 pass. Existing real accepted output
was reused as controls without rerunning those device tests.

## Candidate and physical acceptance

Version0.1.13/build14 was introduced through literal release metadata RED3 plus
one valid malformed-input control, then GREEN4/4. Previous0.1.12 APK/AAB were
preserved byte-identically. Publication waited for signing/Firebase/bundled-asset
and selected physical QA gates, then advanced Stable to0.1.13 as recorded below.
Changed release metadata/build/configuration checks18/18 pass with no skips.

Realme's ephemeral QA profile was user11, not removed user10. Its exact
identity and old0.1.12/build13 were verified before anonymous launch. Primary
user/data were not cleared or logged out; A063 remains excluded. Instrumentation
requires an explicit matching non-primary user. No personal UI capture is used.

The actual signed release build completed in47.244s with fresh embedded web
marker `3f015b12c84f8ad3`. APK size7,629,759 bytes; SHA-256
`f2f990dd0b6cd360ff152a4e3b16460951071497edf05f9d386368f8f4e20e4c`.
The existing signer, Firebase initialization, native plugin DEX and all33 bundled
runtime assets passed verification. There is no remote `server.url`.
Independent runtime source review accepted the fixed capability/generic-OLD
cases, with no remaining P1/P2.

Realme's selected ordinary ownership, cold-post, fresh-process cold-read and
anonymous bundled-web checks each passed1 test/0 skips. Natural OS queued-window
attempts3/3 skipped because that timing was not observed; they are **NOT PROVEN**
and have no PASS receipt. No further unchanged timing retries are scheduled.

A separate deterministic physical integration test uses the actual release
producer, durable intent store, NMS cards, release adapter parser and cancellation.
Only its first visibility snapshot is controlled. Both ordinary OLD and generic
missing-ID OLD preserve actual NEW with pending/removed0/cancel0, then actual NEW
is removed with pendingfalse/removed1/cancel1 after250ms. Exact metadata and
generations are asserted. Realme selected this method:1 test/0 skips PASS.
This is **controlled-snapshot physical integration**, not natural NMS queue
reproduction, FCM transport or proof of autonomous JS retries on the phone.
The actual-source combined queue/hook fixture covers that retry behavior.

Only the QA instrumentation APK was rebuilt for this test; the release APK
remained byte-identical. The refreshed test APK has the same signer, and its
hash/source/install linkage is sealed in private evidence. The explicit
publication alternative requires that exact method, label, profile and linkage;
31 pure checks refuse skips, identity/hash changes and false transport claims.
The prior native/cold/guest/cleanup and catalog-CAS gates remain mandatory.

Temporary QA user11 and test package are removed; current user0 and primary
package/data remain. No logout, personal captures or A063 operations occurred.
The initial remove-user command refused during ephemeral-profile auto-removal;
the separate read-only cleanup-finish gate confirmed actual absence, not a
presumed success. Final independent QA/helper review is SOURCE_ACCEPTED with no
remaining P1/P2. New independent controls:1 positive,6 negatives and3 killed
compiled omissions; reviewed source and APK hashes remained frozen.

This bounded reconciliation does not promise cleanup for arbitrary OS delay:
timeouts retain paced-fetch recovery. The native lease is a presentation fence,
not authentication or universal atomicity with the OS. Rich recipient previews,
actual FCM transport and unidentified tester D-349 remain separate contracts.

## Published and verified

Android Stable0.1.13/build14 was published nonmandatory and verified at16:56
Moscow,2026-10-07. Its public catalog and redownloaded APK match the reviewed
size/hash above; the full Android artifact verifier passes. The previous0.1.12
catalog was retained byte-identically under the publication lock. No package,
signer, provider or database change is included in this release.

[Android APK](https://api.letscube.ru/releases/files/android/0.1.13/letscube-0.1.13.apk).

Runtime source is96977e72; QA-only instrumentation/docs follow-up is36f313dc.
Web/main36f313dc was accepted at16:58 Moscow: exact sole healthy container/image,
new pending-state markers versus the retained preceding entry, public/container
JS and SW byte parity, and anonymous home/login mounted200 with0 page errors.
Public JS SHA-256:
`b04cc5c0f733d87f8b8577b2dbbb8271546c7c2d99845cfa8f5e2955c79d80ea`.
Public SW SHA-256:
`c301da3abb82223e2ad1b8c0d2bb1ff046cd5043154498e7643844439376a723`.
Public web and embedded APK are separate builds; their marker/ownership behavior
is checked without asserting that their build-specific byte hashes are identical.

D-353/tracker91 is closed for this bounded reconciliation contract. Natural
OS timing is still NOT PROVEN; this closure makes no transport, universal
OS atomicity, rich-preview or unknown-client D-349 claim.

## Rollback

The existing signer and package identity must remain unchanged. Publication uses
an immutable version path and a locked compare-and-swap against the verified
0.1.12 catalog, retaining its byte-identical backup. Catalog rollback restores
that previous manifest atomically; it does not delete artifacts or downgrade
installed clients. Web rollback retains the previous image and hashed entry.
No database or provider mutation is part of D-353.

[Previous accepted release](2026-10-07-android-read-cleanup-release.md).
[Separate DB rehearsal](2026-10-07-native-preview-pg17-rehearsal.md).
