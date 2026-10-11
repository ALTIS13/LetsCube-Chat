# Notification Read: Delayed Realtime UPDATE

Owner: coordinator and bounded source author. Stage: WEB_RUNTIME_ACCEPTED;
independent review accepts; narrow main/runtime cc0f164d verified. This is a specific
state-consumer defect found while investigating item85/D-349, not proof of the
tester's unidentified OS notification symptom.

## Cause And Scope

The notifications UPDATE callback replaced a known row wholesale. An unread
UPDATE produced before the successful read RPC but delivered after its response
could erase the confirmed read_at value and raise the bell's unread count again.
The INSERT/refresh paths already preserve confirmed reads through the existing
mergeNotificationRows helper; the UPDATE path bypassed that rule.

Only the known-row replacement now calls mergeNotificationRows([n], [row], 1)[0].
The outer map and both current-owner checks remain unchanged. Unknown UPDATEs
cannot insert rows or truncate/reorder the current page. Newer metadata and
actual non-null server read timestamps still apply. No schema, read RPC, native
adapter, permission, desktop queue, policy or sidebar change is included.

## Focused Evidence

The new tests compile the actual markReadIds and UPDATE callbacks plus the
actual row helper. Controlled fictional RPC, state queue, clock and ownership
ports reproduce pending read, successful response and late unread UPDATE.

- Actual-source baseline: behavioral RED1/1, chunk6e590b; confirmed timestamp
  becomes null. An earlier VM redeclaration error is setup-only, not this RED.
- Final affected5/5 GREEN, chunkdd62f6: read response followed by stale UPDATE;
  newer/older metadata; unknown UPDATE and30-row order/size; retired callback
  and queued updater; compiled omission killed by the literal read oracle.
- Accepted unrelated suites were not replayed. These are controlled callback
  tests, not mounted React, production DB, authenticated browser or device QA.

Changed hook SHA: `95defaf26de5b92754c0920507c7bc2f4a86a6e4d0ce10043121d262c84eb1ab`.
Initial test SHA: `b3a88e98be640a05c9a209d70b9a288fdf1325f31b0c38466f2aa6924f9089eb`.

## Review And Compiled Consumer

Independent source review `ef2182ca` accepts with no P1/P2. Its P3 notes that
the metadata fixture used non-schema title. Coordinator replaces that field
with actual payload.preview; the changed fixture runs5/5, zero skips, chunk
`4db2fd`. Final test SHA: `7c659dcc7d6ed751b9d243c4aa0d9c50f1f1ff4a0e5075456c086a45f0fc2189`.
Product source and original behavioral RED remain unchanged.

The structural marker follows the actual unique public.notifications UPDATE
subscription and its known-row mapper, associating the merge with the same
channel's INSERT consumer. It rejects wrong event/schema/table, missing/wrong
merge arguments, unknown-row insertion, malformed or duplicate consumers.
Marker calibration RED1/1 then5/5 GREEN, zero skips; existing production JS
is old1/new0, actual full-hook transpile/minify is old0/new1. Coordinator has
read the marker/tests and independently checked the new real Vite bundle:
`44cee7`, old0/new1. These counts supplement, not replace, the behavioral tests.

Main-based narrow integration `3dce9c9a` preserves the only Android metadata
dirty path. Typecheck `dff809` passes; real Vite build `ca51e4` passes with
`sw.js build5a14948397c7daab`,27.67s. Known sourcemap/chunk warnings remain.
Later unrelated source changes require their own validation; this record is
not the production image or native bundle acceptance.

## Remaining Boundary

The in-app read-state race is separate from natural push delivery, system-card
history/removal, Android bundled parity and the reported tester client/build.
Those outcomes remain unmeasured; do not close all of D-349 from this repair.
## Actual Web Rollout

Final narrow tree cc0f164dfc589870ed5c16c766d92f2bf91c3755 contains three
reviewed commits, seven changed code/test files and24 resolved own-tree aliases;
Android metadata remains unchanged. Actual combined typecheck passes; Vite build
prints `sw.js build47dcfc10721892e2` and `built in12.02s`. Local compiled
notification and send-epoch consumers are both old0/new1; fixture bundle hashes
are not production expectations.

Before22:56:38 UTC, runtime0176253a has both consumers old1/new0. After22:59:56 UTC,
the sole healthy container7c43fa7ed429 uses exact image cc0f164d, immutable ID
de435cc76836768a26f4afc60757ab7743bcbb7700fb2c3e4f768fa411993732.
Public `/assets/index-BQrCIMoW.js` SHA
b277f17748b3076cc3323564d471c72a36de27c969587a837b3c6ad381decb8f and SW SHA
9cd2555cac567fbaf69e0cb747d34bb447e73ef9bdb683c18bd321f918acc5a9 match the
container files. Both consumers change to old0/new1; accepted Voice/Storage
consumers remain old0/new1. Previous017 entry bytes and image ID remain available.
Read-only receipt `.ops-private/notification-update-rollout-20261012/publication-after.json`
is retained privately. No DB mutation, native activation or Android publication.
Fresh anonymous Chromium smoke051383 at23:01:31 UTC mounts home and follows its
actual login link, using the accepted new entry, with0 page errors/0 mutation
requests. No personal session, screenshots, traces, video or downloads. This
does not execute authenticated notification/audio actions.
