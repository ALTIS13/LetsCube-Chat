# Send acknowledgement cue and reviewed web promotion

Owner: Codex coordinator. Stage: web production deployed and runtime verified.

## Intake and cause

Authorized read-only incremental tester intake selected4 new text rows,0 voices,
without reaching its100-row limit. Raw bodies/identifiers/contact details remain
private. One request reports missing outgoing sound; notification-delivery
follow-up is deduplicated under item76/D-335. An acknowledgement and one
unclassified short row are not invented new defects. Keyword classification is
not a complete semantic review of that last row.

Outgoing durable delivery had no sound handler: `appOutbox.onSent` only replaced
the pending bubble and chat summary. Before the patch12 literal unit cases and
1 actual application/outbox browser case went RED: the row landed, no outgoing
sound was requested.

## Change and evidence

The true outbox ACK, including a confirmed reread after a lost response, requests
a quiet synthesized120ms cue. No queued/refused/Realtime-echo sound. Settings/DND,
current account/chat/topic, visibility, calls and recording gate it; readings are
repeated after `AudioContext.resume`. ACKs less than100ms apart coalesce. No
reference-client asset or code copied.

- Initial policy/spec plus adjacent call sound/sample renderer coverage55/55.
  Final send-sound18/18 includes six compiled implementation mutations refused
  by literal assertions. A mutation selector initially missed the same-line
  enabled expression; corrected to touch actual source, final run0 failures.
- Actual application ACK/outbox boundary10/10 and frontend typecheck pass.
- Five Chromium browser cases pass: lost-response ACK once, settings off,
  recording and navigation before ACK, withdrawn scheduling after delayed
  context resume. Additional real-hook timing case passes at99ms/100ms.
  Post-release refused-send case also passes with no sound request (seven
  focused browser cases in total, not a replay of the unchanged suite).
- Independent read-only review: no actionable high/medium issues. Real device
  audibility/autoplay, full hook account/DND/topic change during suspended resume
  and installed capture lifecycle are not claimed.
- Production-config Vite build exit0: `sw.js build 999f349dd48bb662`,
  `built in45.76s`. Existing sourcemap/chunk warnings remain. No native build,
  signing or sync was run.

## Release scope and safety

Owner's2026-10-05 direct authority supersedes permission-only deploy HOLDs, not
technical recovery/data-safety vetoes. Pending history inspected separately:
of20 earlier commits only `5dd5924d` changes runtime (D-341 Group/Group chat UI);
others are docs/tests/unconnected prototypes. No worker/Gateway/migration delta.
Reuse unchanged122-unit/92-browser/review evidence. Previous broad unit result
4948pass/1AndroidGradle timeout/13skip remains **not GREEN**; unrelated
full/Gradle/PG17 checks deliberately not repeated.

Production preflight: healthy web image revision
`951eaa4246b79de1d63ede1767c8788cdea305ba`, exact local rollback image retained.
Backup `automated/20261005-035146`:15/15 checksums pass, custom archive lists,
age under48h. Database17.6 read-only identity verified;64.8GB free on host.
No production SQL applied.

Push gate: fresh main ancestry, every pending commit's own-tree `@/` imports,
exact reviewed HEAD, diff checks and completed guard exit0. Deployment proof:
healthy exact running image, public asset new/old markers and public routes;
webhook/queue alone do not count. Rollback: retained prior web image.

## Outcome / next

Reviewed `5dfc4dcb70a2268a0419c16821e0a1c683dfa0c4` pushed atomically to
candidate/main after the guard completed exit0:21 commits,82 own-tree files,
272 resolved aliases. Coolify deployment `kz5afqwjstd8h9gjln6fvmzj` finished.
Actual SSH readback: exactly one running healthy web image at that revision,
image ID `sha256:67e2a8bf0c267ce613e5b30372d9dc4dd075ccb033dc1498388dfde3d7e8163f`.
Public JS changed from `/assets/index-CS8eG8Nz.js` to `/assets/index-Df-JMe-q.js`;
`name:"messageSent"` and heavy Group fallback absent before/present after, old
heavy Server fallback present before/absent after. Public `/privacy`,`/support`,
`/login` return200 and same new entry. Public SW hash changed too. Fresh anonymous
Chromium renders `/` and `/login`, actual login action visible, zero page errors;
no session, screenshots, trace, video or messages/provider mutations.
The previous public entry is still HTTP200 with its exact pre-deploy SHA256,
not an HTML fallback. This checks retained assets for already-open clients,
without interpreting it as a native old-version upgrade test.
During rolling overlap, two replicas and different entry assets were observed;
acceptance waited for retirement, not a softened single-replica assertion.
Private observer query initially refused text-vs-bigint comparison and was
corrected without a DB mutation; runtime truth came from SSH/public assets.

D-343/item83 web implementation deployed; D-335 stays open for notification
delivery/context. D-341 web implementation deployed, native acceptance remains
open. Android embeds its bundle, so web deploy is not a new APK. Next feasible
user boundary: contacts failure/retry,item36/D-316; see
[the separate candidate record](2026-10-05-profile-contact-retry.md).
D-338/D-342 stay open; no full restore, media reclamation, package identity/store
action in this web slice.
