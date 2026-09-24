# Push latency and message UX follow-up, 2026-09-24

Owner: Codex. The owner reports that signed Android 0.1.8/build 9 receives
push on a physical official-GMS handset in another location. This is owner
evidence, not a device observation from this workstation. Android 0.1.8 embeds
its web bundle; source changes below do not update an installed APK.

## Production push dispatch

Read-only baseline: `kub-send-push-notifications` was active on a one-minute
schedule. In a six-hour sample its 360 cron invocations succeeded. The native
outbox's pending unread count was zero; the 54 unsent native rows were linked to
read notifications. The minute schedule alone could add 0-60 seconds before a
provider request. FCM acceptance is still not proof of device display.

The native dispatcher previously selected unclaimed rows. Sub-minute scheduling
would have allowed overlapping invocations to send duplicates. The additive
`20260924100000_native_push_claim.sql` migration adds a five-minute lease and a
service-role-only `native_push_outbox_claim` RPC. It selects only unread,
unsent rows below the retry limit, using `FOR UPDATE SKIP LOCKED`. The Edge
entrypoint now claims native rows and makes acknowledgements conditional on its
claim token; an acknowledgement that updates no row fails rather than being
reported as sent. Web Push retains its existing atomic claim. No payload,
credential, device token or message text appears in this report.

Before applying, a full PostgreSQL custom-format dump was made at
`/srv/letscube/backups/native-push-20260924/postgres-before-claim.dump` with
root-only permissions. It is 6,661,279 bytes and `pg_restore -l` parsed it.
The migration was rehearsal-tested in PGlite, copied byte-identically to
`supabase/migrations/` and `.migration-backup/supabase/migrations/`, applied
once in a transaction, and its grants were verified (`service_role=true`,
`anon=false`). RLS on the native outbox remains enabled.

The previous mounted Edge entrypoint is preserved at
`/srv/letscube/backups/native-push-20260924/index-before.ts`; the deployed
source was hash-matched to the reviewed local file and the Edge container
returned healthy. A normal minute-cron response after restart was HTTP 200
with native `idle`. The existing cron job's command hash and active flag were
unchanged when its schedule was changed to `10 seconds`, after a transaction
rehearsal that rolled back to one minute. A subsequent ten-minute sample had
53 successful cron runs, 53 HTTP 200 native-`idle` responses, no live native
leases and no unread native rows pending. This is dispatch health, not a
measured end-to-end push latency improvement on a handset.

Rollback if needed: first restore the job's schedule to `* * * * *` using
`cron.alter_job` for job `kub-send-push-notifications` (job ID 2 at the time of
this change). Restore `index-before.ts` to the mounted entrypoint and restart
only `supabase-edge-functions`, verifying health. The migration's header has
the SQL rollback for its new function and columns, but leave those additive
objects in place unless restoring the old dispatcher has been verified; do not
drop them while the new entrypoint is live.

## iPhone PWA notification and read-sync follow-up

The production audit found no queued backlog and no present read contradiction:
pending unread Web Push rows, pending already-read rows and active claims were
all zero, and no unread message notification sat at or behind its recipient's
chat read watermark. The broader read/delivery scheduler tests also remain
green. That ruled out a current database backlog but did not explain the
tester's report that a notification could arrive after the chat had already
been opened and read.

The remaining race was between the two external operations. `push_outbox_claim`
checked unread and foreground state, then the Edge Function later called the
Web Push provider. A user could open the PWA, establish a foreground lease or
mark the message read after claim but before that provider call. The already
claimed payload would still leave the server. The service worker cannot safely
hide such a push on iOS: WebKit requires a Web Push event to result in a visible
notification. See the WebKit Web Push contract at
<https://webkit.org/blog/12945/meet-web-push/>.

Commit `e1641d74` adds service-role-only
`push_outbox_delivery_recheck(uuid, uuid)`. It locks the exact token-bound
outbox row immediately before delivery and returns one of five states. A read
notification is suppressed as `read`; a missing/inactive subscription is
suppressed as `subscription_inactive`; an active global foreground lease
releases the claim without suppressing the unread notification, so the normal
claim loop can deliver it after the user leaves; a lost claim sends nothing;
only `deliver` reaches the provider. An RPC/network/unknown response also fails
closed and leaves the lease to expire. Android/FCM, Windows/WNS and voice paths
were not changed.

The migration was proved in PGlite against read, foreground, deliver, inactive,
lost-claim and expired-session cases. Its self-check was mutation-tested by
turning `SECURITY DEFINER` into `SECURITY INVOKER`; the migration then aborted as
required. The two repository migration copies are byte-identical. Expanded
push, PWA lifecycle, receipt and native-provider validation passed 159/159;
the complete TypeScript check passed. The target PWA production build completed
as `sw.js build 24ec32fe1694d214`. The aggregate workspace build's separate
mockup-sandbox first refused to run without its mandatory `PORT`; that is a
runner configuration gate, not a compilation failure in the PWA target.

The production database was backed up before the change at
`/srv/letscube/backups/web-push-recheck-20260924T100625Z/postgres-before.dump`
(6,771,184 bytes, custom-format catalog parsed by `pg_restore`). The exact SQL
was rehearsed with `ROLLBACK`, then applied once as the owner of the four source
tables. The live function is a pinned-search-path definer, executable by
`service_role` and not by `anon` or `authenticated`; RLS stayed enabled. The
previous Edge entrypoint and reviewed replacement are in the same root-only
backup directory. The mounted source hash is the reviewed hash; no container
restart was needed. A POST without dispatcher authorization returned HTTP 401,
proving the module compiled, and the next six ten-second cron runs all succeeded
with six HTTP 200 responses and no filtered Edge boot/recheck errors. Afterward
the three outbox counts and the read-watermark contradiction count remained
zero.

WebKit simulation remains source evidence, not a phone claim: 22 installed-PWA
safe-area cases and 15 update/manifest/keyboard cases passed across the selected
mobile/light/dark fixtures. Two authenticated install-settings cases were not
valid on the public-preview fixture and therefore are not counted as product
proof. A physical iPhone is still required to verify Home Screen background
delivery, an already displayed card disappearing after resume, notification tap
routing, OS history behaviour and provider latency.

Rollback for this slice: restore `index-before.ts` from the backup directory to
the mounted function path and verify its old hash and an HTTP compile probe;
then drop `public.push_outbox_delivery_recheck(uuid, uuid)` using the migration
header. The function is additive, so leaving it unused is safer than dropping it
before the old entrypoint is restored.

## Message UI and sound

The read receipt already carried the correct server-derived state; the own
bubble's white accent override hid its distinction. Source now renders one
muted check for sent, two muted checks for delivered, and two mint checks for
read, while preserving the existing receipt model. The message-size setting
shows a marked 100% default and percent endpoints/current value; storage stays
in integer pixels. The in-app notification cue is a short original two-note
figure; call sounds remain unchanged.

Android's existing `messages` notification channel is immutable to the app
and may carry a user's mute or custom sound. The native sound change is
fresh-install-only: a new `messages_v2` channel receives an original short
PCM cue only if the legacy channel has never existed. Upgraded users remain
on `messages` and keep their settings. Legacy FCM notification payloads also
still target `messages`. No signed APK was cut for these source changes.

On the 390px chat list, a collapsed search header had shifted the visible
conversation list by 44px while scrolling. The layout now compensates the
scroll offset for that height change; the same fixture measured 0px drift in
both collapse directions and both themes. A successful sidebar membership
read seeds a short-lived, user/chat-scoped `cleared_at` cache, avoiding a
duplicate history-boundary request on entry. A failed boundary read now keeps
cached history covered and does not issue an unbounded message query. The
initial hidden-message lookup still happens before newly fetched messages are
rendered.

Source validation: 4,089 unit tests passed, one skipped; targeted mobile and
desktop Playwright checks across both themes passed (27 passed, five intended
skips). A production-configured debug Android APK was built with all six
Firebase resource names present. On a Google Play API 33 emulator, the
instrumentation notification smoke passed both an upgraded installation and a
fresh installation; the fresh installation had `messages_v2` and the named
sound URI, while the upgrade retained the legacy channel. This was an emulator
run with audio output disabled, not an audible handset proof. The owner's
Realme was not touched.

## Remaining proof

- Measure receive latency from a controlled sender to the physical official-GMS
  handset after this server change, including idle and reconnect cases.
- Verify audible native sound, read checks and font scale on physical Android
  hardware before a signed release; emulator channel selection passed, but
  its audio output was disabled. Existing installs deliberately retain their
  old OS-channel sound.
- Keep Web Push, WNS, voice calls and iPhone PWA regressions separate from this
  server-only dispatch measurement.
- The cached-history privacy gap described in the initial report was closed in
  `fdbb6d72`: warm reopen waits for hidden-ID verification, failed checks do
  not render unchecked history or sidebar previews, and stale responses cannot
  replace a newly opened chat. Focused desktop/mobile regressions passed; see
  the 0.1.9 release report for the published candidate and remaining limits.
- Measure scroll and long-session smoothness on physical Android hardware;
  the focused chat-list test does not prove every large-history transition.
