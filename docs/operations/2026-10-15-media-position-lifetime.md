# Media position ownership, 2026-10-15

## Resume

Owner: coordinator. Stage: D-365 reproduced and repaired locally over main
`5828284e`; independent review's one P2 is fixed with native RED-to-GREEN,
and final rollout remains pending. Preserve the
unowned root sidebar/search changes and the main-based private Android version
overlay. Android Stable is already 0.1.20/build21; this change is not in that APK.
Next: finish affected renewal validation, review, actual build, then narrow web
promotion with before/after consumer and rollback proof. Item87 latency/VPN
attribution and the remaining private media intake are not closed by this repair.

## Observed Cause

The actual detach API transferred the inline element to the application's audio
element. Its one-shot metadata callback retained the old position independently
of message, resource, account, transport and explicit seek lifetime. Eight of ten
initial behavioral cases failed: a retired position of17 seconds replaced a new
track's zero or a user's explicit9-second seek. Current/paused transfer controls
passed. The previous detached retirement test exercised leaveChat, not detach.

Cancelling that listener alone passed the controlled transport cases but failed
with a real, unmodified HTMLAudioElement decoding a generated30-second WAV:
after retirement and a new load, the native element still held17 seconds.
Setting currentTime before metadata sets the native default playback start
position; load/source replacement does not reliably clear that pending intent.
This is not hidden/deleted audio restarting and does not reopen D-360.

## Repair And Reuse Decision

One positional-intent mechanism now owns both transfer and explicit seeks, with
a cancellable metadata subscription. A new transport,
message/resource, explicit seek, close/account retirement or synchronous layout
unmount cleanup cancels it. A surviving callback checks current message/chat,
source, active element and current access admission. Pause/resume keeps an
otherwise valid transfer.

Independent adjacent review found the same native risk in explicit seek(). A
new real-native pending-A seek9 -> retirement -> C case failed with C at9; the
same-A9 positive passed. Both entry points now use requestPosition rather than
patching their symptoms independently.

No pre-metadata seek is written into the native element. A transfer applies
immediately only when the same resource is already metadata-ready; otherwise
its cancellable metadata callback owns the seek. This addresses both independent
retention mechanisms, not just their visible wrong-position symptom.

Existing player/state admission and native EventTarget/AbortController are
reused; no playback dependency, new player framework or cosmetic timeout is
introduced. Primary references inspected2026-10-15:
[HTML media offsets](https://html.spec.whatwg.org/multipage/media.html#offsets-into-the-media-resource),
[abortable DOM listeners](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener).
They define platform semantics, not Telegram's UI or device acceptance.

## Verification

- Actual mounted player and existing producer/retirement suite90/90, zero skips.
  Thirteen controlled transfer cases plus real native metadata cases cover old
  deletion/hide, account/close/unmount, replacement including same-ID replay,
  changed source, manual seek, pause/resume and a second transfer. Real native
  ready-resource reuse also applies the new9-second position immediately. Native
  explicit seek before metadata is preserved for A and cancelled before C. The
  controlled seek oracle asserts literal[9] writes, so obsolete17 ->9 intermediate
  writes cannot silently pass merely because the final position is right.
- Five omission mutations and two real-native position mutations are rejected.
  Restoring the eager pre-metadata write reproduces the native17-second leak even
  when listener cancellation remains enabled.
- Final source/test byte pins: player188fb79e, player testsf065c475, renewal
  tests2319f087. Final kub typecheck passes; actual build4e6fd0ace2bbe363,
  built11.52s. Known sourcemap/import/chunk-size warnings remain. Earlier
  builds57accf54,2156f2b6 and54377f85 are not final build evidence.
- The affected adjacent59-check run originally passed57 and failed2 historical
  delayed-signature assertions. Their isolated consumer imports no player and
  expected response-time redating, contradicting the already shipped D-358.
  Updated them to the request-start lifetime; focused2/2 pass and an in-memory
  response-clock mutation fails at the exact48-minute renewal assertion. Final
  affected suite59/59, zero skips. Its URL/volume/source contracts are unchanged
  by the later positional-intent consolidation; they are reused, not rerun.

## Independent Review Fix Pass

Final frozen review of5828284e..05d4cd7e found exactly one P2: an inline pending
seek9 followed by detach still transferred native0, losing the pending intent.
The added real-native case reproduced0 rather than9; reverse-order seek/detach
coverage had not exercised it. The position record now keeps controller, exact
message/chat, source, element and desired time, and detach moves that verified
intent rather than reading an unloaded native position. Native positive9,
retirement-before-C0 and omission controls pass in the final90/90. The earlier
review verdict is not relabelled clean; its one finding is resolved by this
coordinator RED-to-GREEN fix pass. No second review or unchanged suite replay.

All media are generated fixtures; requests remain isolated, with
KUB_QA_ALLOW_MUTATIONS=0. No personal captures, DB changes, global network changes,
installed client replacement or new native publication were performed.
