# Notification Read: Delayed Realtime UPDATE

Owner: coordinator and bounded source author. Stage: SOURCE_READY; independent
review, main integration and actual web rollout pending. This is a specific
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
New test SHA: `b3a88e98be640a05c9a209d70b9a288fdf1325f31b0c38466f2aa6924f9089eb`.

## Remaining Boundary

The in-app read-state race is separate from natural push delivery, system-card
history/removal, Android bundled parity and the reported tester client/build.
Those outcomes remain unmeasured; do not close all of D-349 from this repair.
Next: independent review, own-tree imports, actual main typecheck/build and
healthy image/public-container markers before declaring web acceptance.
