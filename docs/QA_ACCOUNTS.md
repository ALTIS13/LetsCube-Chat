# QA Accounts

KUB multi-account QA uses local-only credentials from `C:\Users\maksi\.kub-messenger-qa.env`
or from process environment variables. Do not commit this file and do not copy real values into
docs, screenshots, traces, or test output.

## Local Env Format

Keep the existing single-account fallback when only one QA account is available:

```env
KUB_QA_EMAIL=tech-admin@example.test
KUB_QA_PASSWORD=<local password only>
```

For role-specific QA, add any accounts that are available:

```env
KUB_QA_OWNER_EMAIL=owner@example.test
KUB_QA_OWNER_PASSWORD=<local password only>

KUB_QA_TECH_ADMIN_EMAIL=tech-admin@example.test
KUB_QA_TECH_ADMIN_PASSWORD=<local password only>

KUB_QA_LOCATION_ADMIN_EMAIL=location-admin@example.test
KUB_QA_LOCATION_ADMIN_PASSWORD=<local password only>

KUB_QA_LOCATION_STAFF_EMAIL=staff@example.test
KUB_QA_LOCATION_STAFF_PASSWORD=<local password only>

KUB_QA_CLIENT_EMAIL=client@example.test
KUB_QA_CLIENT_PASSWORD=<local password only>

KUB_QA_BASE_URL=http://127.0.0.1:5173
KUB_QA_TEST_LOCATION_ID=00000000-0000-0000-0000-000000000000
KUB_QA_TEST_LOCATION_NAME=<exact local QA location name>
KUB_QA_TEST_GROUP_ID=00000000-0000-0000-0000-000000000000
KUB_QA_TEST_CHAT_ID=00000000-0000-0000-0000-000000000000
```

`KUB_QA_ALLOW_MUTATIONS=1` is reserved for future fixture-backed tests that intentionally
create/update QA data. Current RLS smoke probes use fake IDs by default and do not require it.

## Recommended Fixtures

- `owner`: global owner role; can see global admin, roles, locations, task cleanup.
- `tech_admin`: global tech admin role; same production support surface as owner where intended.
- `location_admin`: location membership with admin/manager rights for one test location.
- `location_staff`: baseline global user/client plus active `location_staff` membership.
- `client`: baseline client/user without task or location management permissions.
- Optional regular user: no location membership, useful for chat-only regression checks.

For `location_staff` and `location_admin`, assign both accounts to the same stable test location.
Set `KUB_QA_TEST_LOCATION_ID` to that location id so RLS smoke can verify
`has_location_permission(..., 'tasks.view')`. If the id is inconvenient to copy locally, set
`KUB_QA_TEST_LOCATION_NAME` to an exact location name instead. The smoke script resolves the name
through normal authenticated API access. For compatibility, a non-UUID value in
`KUB_QA_TEST_LOCATION_ID` is also treated as an exact location name.

## Auth States

Generate local Playwright storage states:

```powershell
pnpm.cmd e2e:auth-states
```

The command writes only ignored local artifacts:

- `output/e2e-auth-state.json`
- `output/playwright-auth/owner.json`
- `output/playwright-auth/tech_admin.json`
- `output/playwright-auth/location_admin.json`
- `output/playwright-auth/location_staff.json`
- `output/playwright-auth/client.json`

Missing accounts are skipped. Tests can also log in directly from env when a storage state is absent.
