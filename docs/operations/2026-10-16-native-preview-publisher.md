# Native Readable-Card Publisher

Owner: coordinator. Stage: inactive publisher source/SDK accepted after the actual
Realme Settings cycle. Item76/D-335 remains OPEN. Next: existing-vault loading and
native credential consumption, ordinary Auth/choice lifecycle, then a connected
receiver and real OS acceptance. Follow the [ordered remaining connections](2026-10-16-native-preview-runtime-next.md),
not another Settings or unchanged crypto/provisioning preparation loop.

## Implemented

`ChatMessagePreviewPublisher` reuses the existing Android notification and
`ChatNotificationCleanup.updateCurrent` ordering. It does not install a runtime
caller, negotiate protocol1, send a provider request or open credentials.

- The recipient and notification/chat/message IDs validated by the content parser
  are retained as four immutable fields. The renderer checks them against its
  presentation owner and exact card rather than relying on unbound title/body.
  Existing session/device validation in parse and the lookup stays unchanged.
- Recover a clone of the existing notification, preserving PendingIntent,
  cleanup generation/extras, channel and when. Use readable BigTextStyle,
  PRIVATE visibility and onlyAlertOnce, with a separately built generic
  LETSCUBE / new-message publicVersion and no private cleanup/custom extras.
- Recheck the exact current card and durable intent after builder work. Refuse
  missing/replaced/read/retired cards, changed routing/channel/time, invalid or
  expired projection, positive wall-clock rollback and unavailable OS snapshots.
  A throwing notify propagates uncertainty and never triggers retry or fallback.
- The caller must hold its accepted native credential/choice authority for the
  synchronous call. Cleanup.Owner and the new renderer are not authentication,
  consent, session/device proof or a cold background lease.

These platform API choices were checked against current
[Notification.Builder](https://developer.android.com/reference/android/app/Notification.Builder)
and the [notification update guide](https://developer.android.com/develop/ui/compose/notifications/create-notification).
The OS active-query/notify pair is not atomic against an external swipe: Android
can recreate a dismissed card on a later notify. The main receipt design therefore
uses bounded content lookup before first publication, with one readable or generic
result and no late rich upgrade after fallback. The controlled updater is not
evidence that this OS race has been eliminated.

## Verification

- Genuine compiled absence RED: `NATIVE_CARD_PUBLISHER_ENTRY_REQUIRED`, not a
  compiler error. Publisher57/57 includes identity, sender/message, API24 fixture,
  exact route/generation/time/channel preservation, generic publicVersion,
  read/owner/replacement/dismissal observations and ambiguous notification effect.
  Ten compiled omission controls and the absent-entry control are included.
- The positive builder-time wall rollback case was RED before the final
  non-regression check and GREEN after it. Input time remains bounded by the
  projection's15-second ceiling; this is not a renewable content lease.
- Current-card guard26/26 now also includes a real two-thread replacement race.
  Replacement waits until current publication releases CARDS, then remains latest.
  Removing that lock yields the literal behavioral assertion, not a timeout or
  compilation failure.
- Final combined coordinator run: **292/292, zero skips,58.58s** across publisher,
  parser51, lookup33, cleanup/bridge125 and current-card26. The shared Android stub
  gained only the Notification/Bundle/StatusBarNotification API surface needed for
  this behavior; its change is why adjacent tests were legitimately rerun.
- Actual Android Gradle graph: `BUILD SUCCESSFUL in 34s`; `compileDebugJavaWithJavac`
  ran and real output hashes exist for publisher, cleanup and content classes.
  All project build outputs and project cache are isolated under the private
  publisher QA root. Source before/after and version metadata match. No signing,
  native packaging, installation, publication or JDK/global PATH change.
- Frozen independent review found no actionable defect in the five publisher
  files or the additional current-card thread regression. It does not substitute
  for receiver/Auth/device proof. The Android/Capacitor/FCM I/O in the JVM
  tests is fictional; actual SDK compilation does not prove OS pixels, sound,
  privacy, routing or real delivery.

Private SDK summaries are in
`.ops-private/readable-notification-publisher-20261016/gradle.json` and
`result.json`. No raw build output is retained there. Publisher source SHA256:
`d42364cd9913c953e7b0d2715f9d6e73654082a62d8f3050f90a41cb0b109052`.

The earlier [real Settings/retirement/cleanup acceptance](2026-10-16-native-preview-choice-and-card-publication.md)
is reused, not rerun on another unchanged host. Realme has its original build20,
test data and power setting; temporary QA packages are absent. No A063 or paid
device session was used for this source/SDK stage. Protocol0/generic/richfalse
remain. No production migration, provider/release/deployment change, Windows or
iPhone PWA change; foreign sidebar/search and private Android overlay preserved.
Whole-app lint and unrelated suites were not rerun or reported green.
