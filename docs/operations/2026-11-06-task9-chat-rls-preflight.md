# Task9: Temporary Group RLS Preflight

Owner: Codex, LETSCUBE stream 9. Stage: **do not admit the production fixture**.
Two quiet actors can be the only group members, but they are not the only
possible task readers. Ordinary deletion is not an exact inverse.

## Route And Effects

- [New Group](../../artifacts/kub/src/components/sidebar/NewGroupModal.tsx#L84)
  inserts one nonforum group with a client-generated ID and no selected
  invitees. Read it back separately, not with `INSERT ... RETURNING`.
  The creator trigger inserts the owner without a join message or alert.
- [Invite link](../../artifacts/kub/src/components/chat/ChatInviteLinksPanel.tsx#L76)
  uses `chat_invite_link_create`; the supported one-hour, one-use choice was
  rehearsed. [Join](../../artifacts/kub/src/pages/JoinPage.tsx#L84) uses
  `chat_invite_link_join` as Staff. The bearer link is not identity-bound:
  keep it out of notifications, logs and shared clipboard in any future run.
  The fixture accepted one use, treated the same member's rejoin as a no-op,
  and refused the outsider's later attempt with `invite_link_used_up`.
- Live triggers distinguish self-join from owner-add. The captured membership
  trigger wrote one senderless `system` message on Staff join; the live message
  notification routine skips `system` and the member-notify routine skips
  `auth.uid() = new.user_id`. The isolated sequence produced zero notification
  rows; a separate fictional owner-add control produced one `chat_added`.
  Join did produce an audit record and recipient-scoped feed invalidation.
  This is not an outbox/provider delivery or Realtime acceptance result.

## Blocking Evidence

Tech creates an unassigned `new` task with no location, route, recurrence or
coassignees. The [ordinary update RPC](../../artifacts/kub/src/pages/tasks/TaskFormModal.tsx#L367)
alternates `(private, NULL)` and `(chat, group-id)`. The actual RPC rejects
`(chat, NULL)` with `22023/chat_visibility_requires_chat`: unlinking alone is
not a valid revoke. Membership and fixture permissions stayed unchanged.

| Exact task SELECT under RLS | Tech | Staff member | Nonmember with global `tasks.view` | Nonmember without it |
| --- | --- | --- | --- | --- |
| Private, initial | 1 | 0 | 0 | 0 |
| Chat-linked grant | 1 | 1 | 1 | 0 |
| Private, detached | 1 | 0 | 0 | 0 |
| Chat-linked regrant | 1 | 1 | 1 | 0 |

The live predicate `_task_visible_to_current_user_v3` falls through to global
`tasks.view` for non-private tasks when `location_id IS NULL`. The outside
positive control saw the task and its events without joining the group. No
production outsider identity or population was inspected; this is a direct
authorization path, not a claim that a particular outsider read anything.

[Normal owner delete](../../artifacts/kub/src/components/chat/ChatInfoPanel.tsx#L1264)
with exact ID/owner/type filters and `RETURNING id` refused Staff and removed
one group as Tech. Membership, link and system-message counts became zero.
The live FK uses `ON DELETE SET NULL` for tasks: the unassigned task was
still live and both Staff and the global-view nonmember could still read it.
Privatizing and `task_soft_delete` retired ordinary readers, but left one
task tombstone, six task events and four audit rows (one add, two member
removals, one task delete). Exact hard deletes as authenticated Tech affected
zero rows in each of those three tables, despite positive read controls.
Feed invalidations remained for the two fictional actors only (two each in
the subset). Nothing in the ordinary group deletion reverses those records.

## Receipts And Next Gate

The ignored `.ops-private/task9-chat-rls-preflight-20261106/` holds the
read-only PostgreSQL 17.6 catalog and dependencies receipts, the harness and
`rehearsal-final.json`. The capture matched the pinned live target before and
after, under `BEGIN READ ONLY`; catalog SHA-256 prefix `3a5fe0a3dd3c` and
dependency prefix `d41f3362f329`. No row contents, identities or invite
tokens were captured from live. The local PGlite/PG18.3 in-memory rehearsal
used 35 captured routines, 17 triggers, 17 policies and five FKs with fictional
rows, modeled permission lookup and no delivery worker. It is a subset, not
a full-schema, PostgREST, notification delivery or installed-client test.
Three mutations failed at the expected assertions: missing global-view
fallback, missing self-join notification guard, and task FK changed to cascade.

Keep the fixture offline. A live proposal needs a route whose grant audience
is provably bounded and a separately accepted cleanup contract for tombstones,
audit and feed records. Neither a fresh group nor quiet endpoints solves the
global grant. No production writes, app Auth session, device activity, D356
pair changes, application edits or deployment took place.
