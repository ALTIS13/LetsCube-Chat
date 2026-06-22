# RLS/RPC Smoke

`pnpm.cmd rls:smoke` runs authenticated API smoke against selected RPCs and REST surfaces with
QA user sessions.

The script signs in with any configured QA users from environment variables,
`.local/secrets/letscube-infra.env`, or `~/.kub-messenger-qa.env`. It can also reuse saved
Playwright auth states from `output/playwright-auth/*.json`. For self-host operator runs where the
public anon key is not accepted by the Auth token endpoint, `SELFHOST_SERVICE_ROLE_KEY` may be used
as the gateway `apikey` while the actual REST requests still carry the QA user's `Authorization:
Bearer <access_token>` session. Do not print or commit that key.

The smoke calls safe RPC probes with either the current user id or fake UUIDs. It does not create
fixtures and does not intentionally mutate production data.

Supported accounts:

- default `KUB_QA_EMAIL` / matching password variable
- `owner`
- `tech_admin`
- `location_admin`
- `location_staff`
- `client`

Set `KUB_QA_TEST_LOCATION_ID` to verify role-specific `has_location_permission` checks for
location staff/admin fixtures. `KUB_QA_TEST_LOCATION_NAME` is also supported for local QA; it is
resolved to an id through normal authenticated API access. For compatibility, a non-UUID value in
`KUB_QA_TEST_LOCATION_ID` is treated as an exact location name.

Use `RLS_SMOKE_STRICT=1` only when the target migrations are expected to be applied and missing
RPCs or role expectation mismatches should fail the run.

Without `KUB_QA_ALLOW_MUTATIONS=1`, mutation-like probes stay on fake UUIDs. With
`KUB_QA_ALLOW_MUTATIONS=1`, the smoke may create short-lived inactive QA fixtures and must clean
them up before exit. The current fixture-backed check creates an inactive `push_subscriptions`
record for one QA user, verifies another QA user cannot insert/select/update/delete it, verifies
the owner can still update/read it, and then deletes the fixture.

The opt-in run also creates temporary task, chat, group invite and `chat-media` fixtures:

- task fixture: verifies creator/assignee visibility, non-participant isolation and direct
  insert/update/delete blocking;
- chat fixture: verifies member visibility, non-member isolation and non-member update/delete
  blocking;
- group invite fixture: verifies inviter/invitee visibility and unrelated-user isolation;
- `chat-media` fixture: verifies the member can upload/sign the object, verifies the non-member
  cannot sign or upload into that chat path, and removes the temporary object with the operator
  cleanup key before exit.

As of 2026-06-22 the invite fixture is expected to be green after the manually applied
`.migration-backup/supabase/migrations/20260622_group_invite_nonmember_hardening.sql` hardening.
The smoke parser treats RPC error payloads as errors, not returned rows, so only successful returned
invite rows count as a failed isolation boundary.

Current authenticated boundary coverage:

- notification, push subscription and notification preference rows remain owner-scoped;
- non-admin users cannot read other users' `profile_contacts`;
- visible messages must reference chats visible to the same user;
- private `chat-media` bucket root listing must not expose objects;
- opt-in fixture mode validates task visibility/mutation boundaries and chat membership boundaries;
- opt-in fixture mode validates private `chat-media` upload/sign boundaries with a temporary object;
- normal non-mutating mode additionally checks existing `chat-media` objects when a stable
  object/non-member pair is available;
- legacy public `media` bucket root listing is reported as an informational count only.
