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

`KUB_QA_ALLOW_MUTATIONS=1` is reserved for future fixture-backed mutation tests. The current
smoke keeps mutation-like probes on fake UUIDs by default.

Current authenticated boundary coverage:

- notification, push subscription and notification preference rows remain owner-scoped;
- non-admin users cannot read other users' `profile_contacts`;
- visible messages must reference chats visible to the same user;
- private `chat-media` bucket root listing must not expose objects;
- legacy public `media` bucket root listing is reported as an informational count only.
