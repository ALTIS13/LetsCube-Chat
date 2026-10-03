# Authorised Tester Feedback, 2026-10-03

Owner: Codex coordinator. Scope: the user's concurrent request to read exactly
two new voice notes and the latest text from the named tester in their existing
two-person conversation, without interrupting the coverage prototype. This is
an intake, not notification, VPN or installed-client acceptance.

## Selection And Transcription

The existing privately recorded conversation/author scope was reused. PostgreSQL
17.6 identity was verified; queries used `BEGIN READ ONLY`, a ten-second statement
timeout and `ROLLBACK`. Selection was bounded after the prior intake and within
three days: the latest two non-deleted tester audio rows and latest tester text.
No other conversation or participant's messages were exported. Additional image
rows were not fetched or inspected; they are outside this specific request.

| Source | Sent, MSK | Decoded duration | Product feedback |
| --- | --- | ---: | --- |
| V1 | Oct 2, 14:22:53 | 115.5 s | The system notification shade does not give sender/body context; wants separate alerts for one needed channel/topic while the busy parent chat is muted. |
| V2 | Oct 2, 14:23:16 | 16.3 s | VPN enable/server switching reportedly still strands the connection until application restart; asks for a retest of that recovery. |
| T1 | Oct 3, 11:39:49 | n/a | Task changes look good in the web client, but have not reached the mobile version. |

Both audio files were decoded and transcribed **locally**, `faster-whisper 1.2.1`
medium, CTranslate2 4.8.2, CPU/int8, Russian, cached weights only
(`local_files_only=True`). Two completed files, **131.8 seconds** total. No audio
was sent to an external transcription service and no model was downloaded.
ASR is not a human-certified verbatim transcript. The complaints above are clear;
informal speech and uncertain product wording are not technical root-cause proof.

Raw rows, IDs, addresses, audio, timestamped segments and transcripts remain in
ignored `.ops-private/2026-10-03-tester-intake/`. No raw conversation, phone,
email, signed address or credential belongs in tracked files or agent prompts.
No production message, device change or provider send was made.

## Bounded Current-Source Review

A reused read-only reviewer and the coordinator checked the named paths, not
the tester's installed device. The Android/FCM omission is intentional in
[native-push-privacy.ts](../../supabase/functions/send-push-notifications/native-push-privacy.ts#L10):
an accepted push may arrive after token/account rebinding. Both modern data-only
and older auto-display envelopes use generic title/body in
[fcm.ts](../../supabase/functions/send-push-notifications/fcm.ts#L56).
[Android presentation](../../android/app/src/main/java/com/kub/messenger/ChatPushNotifications.java#L83)
draws those fields. The [Web projection](../../supabase/functions/send-push-notifications/index.ts#L793)
retains sender/preview context. No separate user preview toggle was found in the
reviewed native path. This explains a current-source mechanism, not the exact
installed-client report; do not restore personal provider payloads by deleting
the account-switch protection.

Current [category preferences](../../artifacts/kub/src/lib/pushPreferences.ts) and
[chat mute](../../artifacts/kub/src/hooks/useChatMute.ts#L49) do not define
individual topic overrides. [Channel previews](../../artifacts/kub/src/hooks/useChannelPreviews.ts#L79)
select by `topic_id` within a parent `chat_id`; OS Android notification channels
are separate categories, not these topics. An inheritance/override contract and
trusted delivery participation must precede the UI.

The existing [request deadline](../../artifacts/kub/src/lib/supabase/requestDeadline.ts#L38)
and [connection revival listeners](../../artifacts/kub/src/hooks/useConnectionRevival.ts#L42)
are present. Their source is not a new real-device VPN acceptance result. The
reviewer made no edits, tests, SSH/device/private-file calls and is now closed.

## Queue Reconciliation

- **New item 76 / D-335:** useful, privacy-respecting system notification
  previews. Reported, not reproduced. The exact client/build, lock state and
  chosen preview settings are not established by these voice notes. Inspect the
  actual payload and presenter before attributing the missing text to either.
- **New item 77:** individual channel/topic preferences. The reported workflow
  is explicit child alerts with a muted parent; it needs a common trusted
  inheritance/eligibility contract, not merely a local bell icon.
- **Existing item 53 remains open:** source recovery and web evidence already
  exist; real VPN-switch acceptance is still missing. Record this renewed report
  against that item, not as another implementation of the same web fix.
- **Existing mobile delivery gate remains:** the task message is positive web
  feedback plus a version-distribution boundary, not evidence that current shared
  task code is broken. Android embeds the bundle at its build. Its build/install/
  publication HOLD is not lifted by this intake. Identify the tester's installed
  artifact before proposing an update; do not overwrite a release build.

See the [tracker](../PRODUCTION_PRIORITY_TRACKER.md),
[defect register](../INTERFACE_DEFECT_REGISTER.md), and the separately completed
[test-only coverage slice](2026-10-03-bot-media-coverage-protocol.md). New feedback
does not reopen accepted SQL or authorize native release, routing changes,
private preview exposure or a notification-preference migration.
