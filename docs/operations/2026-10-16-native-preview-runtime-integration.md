# Native Preview Runtime Integration

**Published outcome:** Android Stable0.1.21/build22 and product web75096aa3 are
verified. The remaining staged records below are historical, not current release
blockers. [Actual release, cleanup and remaining acceptance matrix](2026-10-16-android-stable22.md).

Owner: coordinator. Active item76/D-335. The owner's direct instruction is to
continue through verified Stable publication; the records below are intermediate
source evidence, not release acceptance. No new approval round is required.

## Current Work

- The existing installation can be adopted by the single native owner without
  resetting its authenticated generation/revision. Independent review found
  missing durable operation-ID replay protection and a dropped marker identity
  between reads. Both have actual compiled RED cases and are repaired: the fence
  seeds the durable ID, and adoption retains/rechecks the original reader.
- Legacy MarkerIO uses Android Os.read/Os.write and explicit FD ownership. Its
  author reports45 marker and27 atomic checks; final integrated checks remain
  separate from the earlier accepted two-process loader device evidence.
- MessagePreviewSession connects ordinary Auth to the existing single-use
  producer, provisioning and exact retirement. A fixed routing authority keeps
  the application's one storage owner across verification invocations. The SDK
  remains the sole token-refresh owner. Refresh replaces the old key; ordinary
  pause is not logout. Immediate native content denial precedes async erasure.
- Consent is stored separately, encrypted and bound to the full committed head.
  The native consumer independently reads the exact server capability before
  accepting a level. Begin denies old content synchronously; confirm requires
  server ACK, fresh owner/head/expiry and durable readback. WebView destruction
  preserves only completed consent, never a pending or uncertain operation.
- The Settings hook now calls ordinary native begin/confirm, includes opaque
  context and account-epoch checks, and receives completion-driven refreshes.
  QA-only consent remains isolated; ordinary unmount is not logout.
- Initial notification reservation and publication are separated. The reviewed
  receiver reserves before a bounded native lookup,
  publish readable OR generic once, retain exact routing/channel/mute policy,
  and use a generic public lock-screen projection. No late card upgrade.

## Evidence And Limits

The early SDK compile executed83 tasks/27s; a separate project cache avoided a
shared-cache lock without deletion or unrelated process termination. Later R1
and R2 isolated main-based QA APK/test builds each executed258 tasks (64s/56s).
QA identity22/0.1.21, non-debuggable, exact v2 QA signer, four Firebase values,
ordinary flags false and33 packaged web files are independently checked. Web
build4ab6aa6cbacbf5c5 is reused only after exact generated-asset comparison.

The ordinary Session has compiled real owner/producer/crypto/files tests,
including commit, refresh, logout, pause and logout while HTTP is held. Adoption
has12 passing cases including both review regressions. Native consent, initial
publication, capability and storage have separate author suites and omission
controls. Integrated affected suites are still being run; do not infer a clean
all-project suite from these counts.

Actual Realme R1 stopped before Auth because the transplant omitted
capacitor.config.ts loggingBehavior none. The privacy guard correctly refused;
R2 changes only that target ZIP payload and its bridge check passes. R2 later
times out awaiting ordinary native verification; no successful choice is claimed.
An independent read-only production observation after cleanup sees zero fresh
QA Auth sessions, one fresh Android device row but zero enabled, choice none.

A separate actual-owner regression proves that signed-out idle clear on a
pristine installation made Session terminal before a later login. Its repair
reuses initializeExplicit's full pristine namespace/key guards, never resets
corruption/unknown keys, and retains cold COMMITTED erasure. Changed12 checks
pass including literal omissions; R3 SDK/device remains the next proof.

R3 actual diagnostic: account menu present, login form/role alert absent;
native Session present, terminal, not loaded. The independent review's held
bootstrap/Auth overlap is genuinely reproduced and repaired by preserving only
installation-metadata bootstrap while latest Auth waits. Foreground cancellation,
loaded credential invalidation and unknown-state refusal remain; changed18 checks
and independent review pass. R4 SDK258/45s, signature and accepted unchanged web
assets pass. After zero-session/device server proof, only owned QA data was
explicitly cleared to remove the interrupted test state. Actual Realme R4 ordinary
login, protocol1, rendered message choice, encrypted readback and Settings remount
pass. A natural owned QA API message produces an actual readable FCM card with
matching sender/body and generic public lock-screen projection. A separate
background probe sends the card's original PendingIntent once: exact action
tuple, route, visible message and read-retirement/card removal pass. This is not
a physical SystemUI tap. The initial cold observation establishes process
absence before sender Auth, not atomic absence at dispatch. None/logout proof
is still open: the host BACK guard only parsed mResumedActivity, while Android15
uses topResumedActivity; that refusal and failed test cleanup remain recorded.
Accepted rich-card checks are not being replayed for this host-only correction.

Main-based closure checks find no missing runtime imports. Two old test loaders
needed the new controller dependencies and import.meta QA setting; their genuine
failures now pass101/101 including literal mutants. Release tooling passes9/9.
Canonical candidate metadata is0.1.21/build22; signing/publication is still pending.

Protected primary build20, existing primary-test UID/APK, positive CE+DE
identities and original user-list digest remain equal. QA packages are separate;
R2 upgrade preserves their UIDs. No personal captures, source schema/provider
change, production native release, main push or Stable change has occurred.
A063 is excluded. Browser Settings checks use fictional data:1440/390 and both
themes, actual save/pending/old-shell/missing-RPC behavior and inspected pixels.
Browser plugin is absent; existing repository Playwright is used. Its temporary
fixture server is stopped. These checks are not native OS acceptance.

## Next Release Conditions

1. Finish independent review and affected tests of Session/Consent/receiver and
   resolve the bounded operation-ledger behavior under repeated real refreshes.
2. Build an isolated QA identity from the exact current production path, with
   Firebase and the existing QA signer. Do not overwrite the protected release
   installation or replay spent private attempts.
3. Verify owned readable OS cards, foreground/background/cold/lock behavior,
   read/logout/none retirement, once-only fallback and exact activation routing.
4. Integrate only the reviewed delta onto current main, not this divergent
   feature branch wholesale. Preserve the foreign sidebar/search edits and
   private Android version overlay. Review outgoing commits and own-tree imports.
5. Produce and verify the next release artifact, then publish Stable with actual
   manifest/download hash proof and rollback retained. Stable is not complete
   until this final step is observed.

Earlier accepted evidence remains in
[the loader report](2026-10-16-native-preview-existing-vault.md) and
[the ordered connections](2026-10-16-native-preview-runtime-next.md).
