# LETSCUBE RLS Security Audit - 2026-06-22

Scope: read-only live audit of the self-hosted Supabase database after the auth/anti-abuse hardening pass.

No SQL was applied during this audit.

## Summary

- Public views: none found.
- Public tables: 29 tables found, all with RLS enabled.
- Public functions: no `anon` EXECUTE grants found in the inspected live schema.
- `SECURITY DEFINER` functions: no live public security-definer function without an explicit `search_path` was found.
- Storage: `storage.objects` has authenticated policies for scoped media access; storage system tables have RLS enabled.
- Direct external Supabase Auth bypass remains blocked for `/auth/v1/signup` and `/auth/v1/recover`.

## Important Interpretation

The metadata audit shows broad table grants for `anon` and `authenticated` roles. This is common in Supabase-style deployments because PostgREST still needs table grants before RLS can evaluate row policies.

Do not treat broad grants alone as row access. Confirm row access through PostgREST with the actual anon key and no user JWT.

## Live Checks

Read-only metadata checks:

- `public` tables with RLS enabled: 29 / 29.
- `public` views/materialized views: 0.
- `public` tables without policies: `notifications_push_outbox` only.
- `anon` function execute grants: none found.
- Security-definer functions without `search_path`: none found.

REST probe with anon key and no user JWT:

- `messages`: HTTP 200 with an empty response body array.
- `tasks`: HTTP 200 with an empty response body array.
- `notifications`: HTTP 200 with an empty response body array.
- `push_subscriptions`: HTTP 200 with an empty response body array.
- `chats`: HTTP 401.
- `profiles`: HTTP 401.

This did not confirm anonymous row leakage through the public REST API.

Repeatable probe:

```powershell
pnpm.cmd rls:anon-rest
```

The script reads `SUPABASE_URL` / anon-key style variables from the environment, `KUB_QA_ENV_FILE`, `.local/secrets/letscube-infra.env`, or `~/.kub-messenger-qa.env`. It uses `HEAD` requests with exact counts and does not print API keys or row contents.

Latest local run against self-hosted Supabase:

- `messages`: denied.
- `chats`: denied.
- `profiles`: denied.
- `tasks`: denied.
- `notifications`: denied.
- `push_subscriptions`: denied.
- `notification_preferences`: denied.
- Result: passed, no anonymous row visibility detected.

Authenticated boundary probe:

```powershell
pnpm.cmd rls:smoke
```

Latest local run against self-hosted Supabase used five QA roles and printed only statuses,
counts and leak counters:

- `notifications`, `push_subscriptions`, `notification_preferences` and
  `chat_notification_preferences`: no non-owned rows visible for tested roles.
- `profile_contacts`: owner/tech-admin can see broader contact rows by policy; location
  staff and client saw only their own row.
- `messages`: every sampled message referenced a chat visible to the same user.
- Storage: private `chat-media` root broad listing returned zero objects for tested roles.
- Storage: legacy public `media` bucket root listing is informational only because that bucket
  intentionally remains public for avatars and old media compatibility.
- Task recurrence run-due stayed forbidden for location-admin, location-staff and client roles.

Opt-in fixture mutation probe:

```powershell
$env:KUB_QA_ALLOW_MUTATIONS = '1'
pnpm.cmd rls:smoke
Remove-Item Env:\KUB_QA_ALLOW_MUTATIONS -ErrorAction SilentlyContinue
```

Latest local run:

- Created one inactive `push_subscriptions` fixture for a QA user through normal authenticated REST.
- Verified a second QA user could not insert a row for the first user.
- Verified the second QA user could not select, update or delete the fixture.
- Verified the owner could still update/read the fixture.
- Deleted the fixture before exit.
- Created one temporary `chat-media` object under a chat path where one QA user is a member and a
  second QA user is not.
- Verified the member could upload and sign the temporary object.
- Verified the non-member could not sign the object or upload into that chat path.
- Removed the temporary storage object through the operator cleanup key before exit.

Storage object-level probe:

- The normal non-mutating script still attempts signed-url checks for existing private
  `chat-media` objects.
- Latest local non-mutating run skipped that existing-object check because no suitable existing
  object/non-member fixture pair was available; the opt-in temporary-object fixture covered the
  same member/non-member access boundary.

## Notes

`notifications_push_outbox` has RLS enabled and no policies. That is acceptable if the table is intended to be server-side only and accessed by trusted backend/Edge Function code.

Several `block banned reads/writes` policies are restrictive policies. They must stay restrictive; if recreated as permissive policies, they can become accidental grants. Future migrations touching those policies must explicitly use `AS RESTRICTIVE`.

## Next Security Work

- Add fixture-backed mutation checks for task, chat and invite boundaries on an isolated target.
- Add stable permanent `chat-media` fixtures only if we want the normal non-mutating signed-url
  check to run without `KUB_QA_ALLOW_MUTATIONS=1`.
- Keep any SQL changes as proposals first unless an apply step is explicitly approved.
