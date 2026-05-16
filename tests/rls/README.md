# RLS/RPC Smoke

`pnpm.cmd rls:smoke` runs a non-service-role authenticated API smoke against selected RPCs.

The script signs in with the QA user from environment variables or `~/.kub-messenger-qa.env`,
then calls safe RPC probes with either the current user id or fake UUIDs. It does not create
fixtures and does not intentionally mutate production data.

Use `RLS_SMOKE_STRICT=1` only when the target migrations are expected to be applied and missing
RPCs should fail the run.
