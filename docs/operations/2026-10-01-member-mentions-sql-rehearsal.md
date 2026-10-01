# D-331 SQL Rehearsal

Owner: bounded SQL/Edge worker. Stage: approved compatibility follow-up;
source, focused Edge gates and fresh isolated SQL rehearsal complete.
Evidence: 55/55 scoped unit tests, Deno check, 12 SQL groups/32 mutants,
exact rollback/reapply and cleanup. Blocker: none in this authorized slice.
Next action: coordinator contract clarification and independent rollout gates.
NOT a production apply or D-331 product acceptance.

Previous frozen read-only production refresh: NO_DRIFT across all 13 function owner/body
hash/security/config/ACL records and both trigger/policy aggregates. Focused
whitespace check passed for all nine new owned files; main HEAD remained bde5b8ed.
No new production catalog read was performed in this compatibility follow-up.

## Scope And Boundary

Initial SQL slice wrote only these new paths: member-mentions migration + rollback, exact
migration-backup copies, `tests/rehearsal/member-mentions/`, and this report.
The explicitly approved follow-up also owns
`supabase/functions/send-push-notifications/index.ts`,
`tests/unit/native-push-delivery-recheck.test.mjs`, and the new
`tests/unit/web-push-delivery-recheck.test.mjs`. Contract edits remain coordinator-owned.
Main source baseline: `bde5b8ed0052959267336f19309d00ee5a556ad9`.
Coordinator/client edits were preserved. No commit, push, agents, client/native
build, production SQL, production backup or production restore.

Reproducer from repository root:
`node tests/rehearsal/member-mentions/rehearse.mjs --mutations`.
The command checks both byte-identical backup copies, one top-level BEGIN first
and COMMIT last, built-in Unicode reference ranges, restores the approved full
backup into a fresh owned container, applies current phone SQL then mentions,
tests real SQL/RLS, mutations, exact rollback catalog parity and reapply, and
removes only its exact verified container. `--red` proves baseline regressions;
`--payload-only` runs just actual SQL payload compatibility; no argument runs
current behavior without mutations. The default is fresh backup stamp
`20261001-175542` with 164 expected tables; its exact custom-dump SHA-256 is
checked before restore. SSH key/host are fixed to
the user-authorized target. No live-write or arbitrary-container option exists.

## Implemented Boundaries

- Nonnull JSONB version/revision/items; label includes @, <=128 UTF-16 units,
  exact scalar-safe source slice; <=32 sorted nonoverlapping entities. Exact
  envelope/item keys, typed integral numbers and UUIDs. Current human/active
  installed bot admission; canonical returned UUID/ranges, not username lookup.
- Same pure-API code/fence/URL/email/command masks, explicit JS whitespace and
  Unicode case-fold boundary characters. Unicode 17.0 L/N and Z/M/Cf ranges
  generated from the built-in Node engine; an exhaustive scalar test verifies
  both literal tables. Label controls/invisible-only/trailing whitespace denied.
- Legacy content-only edit clears identities. Fresh revisions required for
  entity edits; scalar-aware contiguous diff preserves unaffected historical
  entities even when offsets shift after a member leaves. Replaced/new targets
  require current scope. Admission locks recipient membership against removal.
- Forward metadata drops; final deletion scrub also clears report-retained
  metadata and prevents resurrection. Existing sender/time/epoch/media/forward
  and final deletion triggers remain installed in their original order.
- Ordinary owner-scoped notification rows receive only their own boolean marker;
  existing unique index/read state and edit-no-reping behavior remain. Restrictive
  source read policy derives auth.uid; private recipient-taking helper is not
  caller-accessible. Task/system notifications are not routed through this helper.
- Current source eligibility includes membership epoch, source deletion, topic
  belongs to source chat, hidden/cleared/per-user-hidden, recipient ban and
  directional recipient block of a human author. Human group-history RLS is
  unchanged. Private delivery preferences do not affect canonical returned data.
- Web/native/album predispatch checks add current source/preferences, preserving
  existing target owner/activity/read/claim/foreground checks. Web recheck did
  NOT previously have an explicit lease-expiry/attempt gate; none is claimed.
  Existing web suppression-reason enum is unchanged: source ineligibility sets
  suppressed_at with NULL reason and returns not_eligible. Native/album retain
  their actual existing reason formats. Ordinary SQL payload retains the exact
  prestate sender/preview whitelist and aliases; no builder replacement remains.
  Existing external web/FCM/WNS neutralization is unchanged. Album remains generic.
  Task/system branches are unchanged.
- Restricted bot mode OR validated bot entity; own/private/full/raw-command/
  raw-mention/reply branches remain independent. Entity-only edits can enqueue
  existing edited_message updates. Deleted sources are excluded before every
  addressing branch, so existing poll/webhook visibility checks fail closed.
- New helpers are postgres-owned, locked search_path, default execution revoked;
  only own-recipient wrapper is granted to authenticated. Existing
  _notification_push_allowed becomes locked-path SECURITY DEFINER because
  service_role has no private-schema usage; its server-only ACL is retained.

## Actual Rehearsal Evidence

The initial approved backup was
`/srv/letscube/backups/automated/20261001-155443/db/supabase-postgres.custom`.
Coordinator supplied verified SHA256SUMS 15/15 and readable custom list with
161 table-data entries. Worker actually restored the FULL custom dump, not
schema-only: pg_restore --single-transaction --exit-on-error returned 0 and
163 base tables existed before phone reapply. Raw private restore diagnostics,
data rows, bodies, phones, tokens and secrets were not printed or saved.

Each run uses image
`sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00`,
new UUID name/label, exact ID inspection, network=none, no ports/bind/volume
mounts, no privilege, bounded memory/CPU/PIDs, and temporary PG17.6 cluster.
Cron launch is off; pg_net worker targets the original empty postgres DB,
not restored mentions_qa. No existing live/rehearsal container is altered.

Real RED evidence:
- Authenticated positive control: two ordinary rows. Recipient blocks sender:
  baseline still created one row, expected zero. Mention column absent.
- Empty label @ accepted; tilde-fenced entity remained active.
- Unaffected historical entity shifted by prefix edit after membership removal:
  canonical items zero, expected one.
- NBSP command mask false (expected true), NBSP URL mask true (expected false);
  integral JSON 1.0/5.0 refused (expected accepted). Read-only helper probes
  used the exact inspected owned container, never production.

Real GREEN evidence already obtained before final run:
- Initial 8-group behavior/rollback/reapply pass; then expanded actual web/native/
  album source/preference/account-rebind/read checks, bot full/private/own/reply,
  report-retained deletion/nonresurrection, service_role full polling and
  webhook prepare positive/negative controls.
- Two independent psql sessions plus observer: removal transaction held lock;
  authenticated INSERT backend showed wait_event_type=Lock and nonempty
  pg_blocking_pids. Commit removal, then canonical items=0, target notes=0.
  Controlled SQL/stdout barrier, not a string check or sleep-based guess.
- All 18 compiled functional mutations killed by actual SQL behavior tests,
  including 32/128/UTF16, masks, legacy/history/forward, block/epoch/ban/self,
  recipient marker/read state, preferences/source and full/deleted bot behavior.
- Three rollback mutants and eight catalog selfcheck mutants killed with
  transaction rollback. Missing unique index also aborted, initially via
  regclass lookup rather than named raising check; lookup changed to to_regclass
  so the final run tests the explicit incomplete-state raise.
- Final current-artifact command exited 0: 12 groups, 30/30 mutation kills,
  270 SQL calls, skips=0, plus exhaustive Unicode test 1/1. Integral-number,
  NBSP/BOM, historical offset, all three delivery paths, real simultaneous
  connections, poll/webhook, rollback parity and reapply passed together.

## Exact Live Prestate

The preceding SQL slice's read-only catalog refresh reconfirmed all 13 function body hashes,
owners, security mode, config and ACL against earlier live intake. No rows or
business functions were queried. Body SHA-256 is independent of ambient path.
Every migration prestate gate checks body hash + owner + definer + volatility +
config + ACL; replacement anchors are unique in the exact guarded source.

All owners: postgres. Full config/ACL/volatility evidence remains in
[the live prestate audit](2026-10-01-mentions-live-prestate.md); actual migration
literals are the deploy-time guards. Three untouched delivery dependencies are
also guarded rather than assumed unchanged.

| Function | Prestate body SHA-256 |
| --- | --- |
| `private.bot_can_receive_message` | `5b9783f4ac32b79bda916f00fdf36513d40de6e1e0926b71c35589b5aab6dd7b` |
| `private.bot_update_still_visible` | `7c36b872154bb7f219483b39e4d7fa44b51e937c2699382d7fe2d2927ed305f6` |
| `private.deleted_message_keeps_nothing` | `e976c4264c2487355e45e514236ec490e8ce68f077e56274aadcf3854ad468a9` |
| `private.enqueue_bot_message_updates_after_update` | `157a84e5e03d81eea34db30b34f2e6cba13ab06329ecfb08ed115cd29e4f9a4b` |
| `private.scrub_deleted_message_notifications` | `9f0fcc7406326f109039488cafccd0ea47d64a86a43824a1057c3ff7f09b659a` |
| `public._notification_push_allowed` | `53019ef87d58e4a1b0318e17dc621b72f72474a1df301932f81c8076eb247229` |
| `public._notification_push_payload` | `607ff23b1810e422b10728f512e7d3f8a8c69ecb56e2679a03a226e469dad26e` |
| `public.album_push_recheck` | `75303ec9a867c71aed3b1f4d20f61e5ac8beac708affceaa7cdace4b7997b10a` |
| `public.bot_delivery_prepare_internal` | `6da69e1ac4601cea77e88d11d5c41d6dfca38bd4982f38a950f2f0e66ff646e1` |
| `public.bot_updates_poll_internal` | `e8bf25e59bb8c5eaec2d4b1c9f3514a0011d86d6a98e29a27896de8cf22f5166` |
| `public.enqueue_message_notifications` | `e8e6e3d6a9e511c072b5b300502a338154336d472b2697a0d3bd61b05e82a48e` |
| `public.native_push_outbox_delivery_recheck` | `8432fe8214d6552b6c169e868d97085dcf33258c6a8050c5138e6501b539a017` |
| `public.push_outbox_delivery_recheck` | `0a445cad6bcf7790309ca9d6b5e62549646a875e01ce91759bb1e1fac1d65a81` |

Messages/notifications existing trigger aggregate SHA-256 (catalog search_path
pg_catalog, pg_temp):
`37d48a624600be133c588efb9960393dbb5c178515808cc78b37389ea59c9401`.
Notifications policy aggregate SHA-256:
`20af8387c3cee003482cc8939d4f0b343e367f95153f87e440176a4a48db2499`.
Both are enforced before forward changes. This is current metadata/source proof,
not provider or authenticated production acceptance.

| Narrow Replacement | Delta |
| --- | --- |
| `public.enqueue_message_notifications()` | 2 unique reviewed replacement anchors |
| `public._notification_push_allowed(uuid, text, jsonb)` | 1 unique reviewed replacement anchors |
| `public._notification_push_payload(text, jsonb)` | Unchanged; exact prestate body/metadata guarded |
| `public.push_outbox_delivery_recheck(uuid, uuid)` | 3 unique reviewed replacement anchors |
| `public.native_push_outbox_delivery_recheck(uuid, uuid)` | 4 unique reviewed replacement anchors |
| `public.album_push_recheck(uuid, uuid)` | 1 unique reviewed replacement anchors |
| `private.bot_can_receive_message(uuid, uuid)` | 2 unique reviewed replacement anchors |
| `private.enqueue_bot_message_updates_after_update()` | 2 unique reviewed replacement anchors |
| `private.deleted_message_keeps_nothing()` | 1 unique reviewed replacement anchors |
| `private.scrub_deleted_message_notifications(uuid[])` | 1 unique reviewed replacement anchors |

No old definition was replaced wholesale from a stale tracked migration. Existing
bodies are guarded first and changed only at the above bounded anchors. Rollback
reverses the same anchors, restores security/config and exact trigger columns,
drops only introduced policy/triggers/helpers, and raises unless all 13 original
bodies/metadata are restored. Catalog comparison also covers existing unique
index and policies/triggers. The nonnull JSONB column/default and stored historical
identities deliberately remain; disable entity producers before rollback.

## Previous Frozen Checkpoint

Migration SHA-256:
`367c3550812dd60b37337b095729ce15ef4de74f4be16ac612c1a3a1eef9fdb5`.
Rollback SHA-256:
`6660fb5eed0d4117f7adb12ee2938b3f78436a472601f0b569ded65c5dd2a92a`.
Backup copies are byte-identical. Final run/container:
`letscube-d331-601e0ddf-a921-45e9-a4c0-91ef3e0bccb3`.

Final run exit 0; exact ID/name/image/label/network verification before removal,
then docker ps label check returned zero containers for this run. No owned
rehearsal process remains. Every failed/intermediate owned container was also
removed by the same exact-target finally path. Node v24.15.0 / Unicode 17.0.

Previous focused source self-review: all ten original-body replacements uniquely
matched their guarded live source; old sender/bot/claim/read/preference gates
were retained. New helpers/grants/path/RLS/order and rollback dependencies were
checked; four SQL files satisfy byte parity and top-level transaction checks.
No remaining SQL/rehearsal blocker. Independent coordinator review and fresh
production backup/apply/deploy remain coordinator-only. Physical client, actual
push provider, HTTP/PostgREST JWT acceptance and production-account acceptance
are not proven by these authenticated-role SQL tests. D-331 stays open there.

## Approved Compatibility Follow-Up

The removed ordinary generic early return was a real SQL payload-contract change,
not preservation of the preview-bearing SQL prestate. The tracked web, FCM and
WNS builders already independently neutralize externally displayed content.
Keeping the original SQL whitelist does not loosen those external builders.
The coordinator will clarify this layered distinction in the contract.
Visible `@label` in ordinary message preview is text, not an entity UUID array.
Recipient `mentioned` stays inside its ordinary notification row; it is not an
external metadata field. No mention envelope/target list may be merged into push
payloads. Existing source/preferences/owner/read/foreground/claim gates remain.
The outbox stores snapshots rather than regenerating queued payloads; this change
does not claim provider recall, atomic DB/provider delivery or legacy-dispatcher
eligibility. The legacy bypass must remain disabled: api-server runtime flag
`PUSH_DISPATCHER_ENABLED` is passed to `shouldStartLegacyPushDispatcher` in
`artifacts/api-server/src/index.ts`; the predicate in
`artifacts/api-server/src/workers/pushDispatcherConfig.ts` starts
`startPushDispatcher()` only for the exact value `"1"`. The coordinator's targeted
live check needs only this one key; no live environment read was performed here.

Real RED before implementation:
- Actual offline `Deno.serve` handler: web/FCM/WNS `not_eligible` had pruned=0;
  the native omission replay reproduces failed=1/pending=1. Provider sends were 0.
- Fresh full restore `20261001-175542`, 164 tables, phone already installed:
  actual SQL payload title was `LETSCUBE`, expected literal `Fixture group`.
  RED container `letscube-d331-a4dc8180-bf2f-4495-bf86-394d58e83511` was removed
  through the exact verified-target finally path.

Current Edge GREEN:
- Focused dispatcher tests 28/28. Terminal source refusal: provider sends=0,
  pruned=1, failed=0; native pending=0. Positive controls still send/ack once.
- Three omission mutants killed: native parser (both FCM/WNS), web parser,
  web terminal branch. The latter actually sends in the isolated offline fixture
  when omitted, so this is a behavioral check, not just a type/string assertion.
- Adjacent Edge/neutral-display checks 55/55 across six files, including those
  28 focused tests. Existing generic web/FCM/WNS, album and voice paths pass.
- `pnpm.cmd dlx deno@2.5.2 check --no-lock --node-modules-dir=none
  supabase/functions/send-push-notifications/index.ts` exited 0 and printed Check.
  Cached dlx was used; no global runtime/PATH change. Node emits its existing
  module-type and experimental stripTypeScriptTypes warnings, not test failures.
- The existing web transport-exception path rejects the handler before send;
  native catches it as failure/pending. Tests preserve that pre-existing boundary,
  rather than changing unrelated transport handling.

Edge `index.ts` byte SHA-256, local only (not deployed Edge identity):
- Before: `cdd7c4f310550a3812d946a3386f66a0d77c42a78bdd2d6aeabb729223797494`.
- After: `0c8215f49c12bb1afc56b6e740d00caa10ce529f7673acd96fb1c0dcfd2f9cf8`.

Current migration SHA-256:
`fb08b5750f66f6103941d2d051f31f281fd864694fe45963b3240684f3ce7147`.
Current rollback SHA-256:
`1453fadb225a6ef149a84a0e02615f8438e5e0624ee8c732ce3d2ca626dc9b96`.
Both migration-backup copies are byte-identical. The original payload body SHA
`607ff23b1810e422b10728f512e7d3f8a8c69ecb56e2679a03a226e469dad26e`
matches the tracked predecessor and remains a prestate/rollback gate.

Fresh full dump SHA-256 verified before restore:
`fbf1884423d5d37990bb8665debaa64fe881fad9cd544fc20ececd8855cd3b24`.
Current GREEN container: `letscube-d331-6cc26ef8-16b3-4748-a268-3db334759010`.
Final current-input command exited 0: 12 groups, 281 SQL calls, skips=0, all
32 mutants killed (the existing 30 plus two narrow compiled payload-export
mutants). Exhaustive Unicode scalar check passed 1/1. Actual private/group
preview literals and the exact 18-key whitelist passed; target UUID arrays and
recipient marker exports were zero, including a real mentioned notification row.
Two real psql connections plus observer showed wait_event_type=Lock and
blocking_pids>0 during admission; removal committed, then items=0/notifications=0.
Rollback exact function/owner/security/config/ACL/trigger/policy/index catalog
parity passed; retained column remained NOT NULL; reapply passed.

This was a FULL restore of
`/srv/letscube/backups/automated/20261001-175542/db/supabase-postgres.custom`,
not schema-only. Restore exit=0, 164 base tables, released phone definition
hash matched and was already installed. Cron was off, pg_net targeted the empty
postgres database, network=none, no ports/bind/volume mounts. The GREEN and RED
containers were removed only after exact ID/name/image/label/network checks;
independent docker ps checks for both exact owner tokens returned zero.
No owned rehearsal process remains. No production mutation, deploy/apply,
backup creation, existing rehearsal modification, agents, commit or push.

Reproducible current gates from the repository root:

```powershell
node --test tests/unit/native-push-delivery-recheck.test.mjs tests/unit/web-push-delivery-recheck.test.mjs
pnpm.cmd dlx deno@2.5.2 check --no-lock --node-modules-dir=none supabase/functions/send-push-notifications/index.ts
node tests/rehearsal/member-mentions/rehearse.mjs --mutations
```

Focused whitespace checks cover all ten changed owned paths, including untracked
SQL/tests/report, rather than relying on git diff to include untracked files.
These are local-source/offline-handler and isolated authenticated-role SQL gates;
they do not prove a deployed Edge artifact, actual provider send or production
account acceptance. The project-wide suite was not repeated in this bounded follow-up.
