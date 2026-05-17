# RLS/RPC Smoke

`pnpm.cmd rls:smoke` runs authenticated API smoke against selected RPCs with the publishable
client key and user sessions only.

The script signs in with any configured QA users from environment variables or
`~/.kub-messenger-qa.env`, then calls safe RPC probes with either the current user id or fake
UUIDs. It does not create fixtures and does not intentionally mutate production data.

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
