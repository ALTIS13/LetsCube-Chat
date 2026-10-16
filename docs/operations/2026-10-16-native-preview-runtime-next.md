# Readable Notification Runtime: Remaining Connections

Owner: coordinator. Derived from current source at51b277dc, not a proposal to
replace the accepted vault or reopen completed preparation. The actual repaired
Realme Settings cycle is accepted; do not use it as a reason to repeat the case.
Item76/D-335 remains first. Ordinary production caller/protocol1 stays disabled
until the connections and real-system checks below exist.

**Current progress:** cuts1-5 below are connected in unpublished source. Their
original sequence remains an acceptance map, not work to restart. Main-based
isolated QA artifacts have SDK/signature/Firebase/web-byte acceptance; ordinary
Realme verification is still open. Continue with the repaired idle-pristine-clear
in R3, then real FCM/card/privacy/routing and publication. Published Stable still
has the older generic-only behavior. Do not redo accepted primitive/renderer
checks. [Current checkpoint](2026-10-16-native-preview-runtime-integration.md).

## Ordered Work

1. **Load an existing authenticated committed vault.** `JournalIO.read()` and
   `MetadataEnvelope.open()` exist. `PristineInitializer` currently initializes
   EMPTY/G0; `observeOwned()` depends on retained in-memory acquisition. Add a
   load-only existing-installation path. Preserve durable generation/revision;
   never turn PENDING/RETIRING, missing key, corruption or uncertain state into a
   new COMMITTED/EMPTY state by inference or automatic pristine initialization.

2. **Consume the decrypted credential briefly in native code.** The existing
   `KeystoreReader` loads keys, not access credentials. `CredentialEnvelope` can
   seal and `verifyMatch(expectedAccess, ...)`, but cannot yet supply decrypted
   access to a bounded native consumer. Reuse the existing JCA/envelope format;
   bind recipient/session/device/accountEpoch/expiry and authenticated current
   head, recheck retirement before publication, scrub temporary bytes, and expose
   no bridge/token getter or logging. A key being loadable is not a credential
   authorization result.

3. **Wire ordinary Auth into durable provisioning/retirement.** Use the existing
   `beginOwned -> provisionExact -> retireExact` owner and VerificationProducer.
   Do not first run ordinary `verifyBinding()` and then the producer: that spends
   the one-use verification ticket before the producer can use it. Refresh/rebind
   must replace the exact credential; logout/account/device replacement must
   close admission immediately and retire the exact old generation. Determine
   and test token refresh ownership rather than adding competing refresh loops.

4. **Wire ordinary confirmed preview choice.** The real Settings hook already
   saves its preference and checks capability after ACK. QA choice/composition's
   120-second foreground/document scope and verification's8/15-second windows are
   not a production background lease. None/account retirement must cancel pending
   content immediately; ordinary pause after a durable production commit is not
   logout. Bind the maximum preview level to the ordinary confirmed setting;
   current credential/metadata envelopes do not carry that choice. Do not enable
   the feature by changing only protocol or QA flags.

5. **Reserve, look up, then publish once.** Main receipt path should reserve a
   generation before the bounded lookup and publish either readable or generic
   once, only while that intent/native owner remains current. Split reservation
   from final initial publication; never hold CARDS across network work. After
   timeout/refusal, do not perform a late rich upgrade of the generic fallback.
   A cold receiver must not depend on WebView Cleanup.Owner as credential
   authority. Keep exact routing, permission/channel/mute policy, read/retirement
   ordering, and a generic public lock-screen projection.

## Why Initial Publication Matters

Android's update API is not conditional on an old card still existing: calling
notify again with the old ID after dismissal creates a new notification. A
getActiveNotifications/notify pair is not an atomic OS compare-and-set. Our
current-card lock orders our own post/read/owner transitions, not an external
swipe between binder calls. The controlled updater may still serve explicit
current-card work; do not call its source tests proof that this OS race is gone.
[Android update behavior](https://developer.android.com/develop/ui/compose/notifications/create-notification).

The native renderer should reuse Builder recovery and platform presentation,
retain the original intent/channel/time/generation, avoid a second sound via
setOnlyAlertOnce, and provide a generic publicVersion. These are platform API
choices, not real OEM privacy/sound acceptance.
[Notification.Builder](https://developer.android.com/reference/android/app/Notification.Builder).

## Acceptance

Each cut needs a genuine RED, affected compiled checks, literal omission controls
and a focused independent review. Credential/storage changes additionally need
the affected real isolated Android boundary, without overwriting release data.
Only a connected receiver on an owned installation can establish readable OS
cards, background/cold/locked behavior, exact routing and read/logout cleanup.
Use Realme first; rent a particular iPhone/Samsung only for a named missing
platform check, then release it. A063 remains excluded. No personal captures.

No database migration is implied by this source map. If a new server contract is
actually necessary, retain the normal backup/transaction/raising-self-check,
rehearsal/rollback and real post-state gates rather than bypassing them.
