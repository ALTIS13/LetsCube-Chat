# Pre-Packaging Access Snapshot Implementation Plan

## Goal

Replace the 33 startup permission/role RPC calls with one authenticated access
snapshot while preserving dynamic global roles, location-scoped permissions,
legacy-role compatibility and a safe fallback for databases where the proposal
has not yet been applied.

## Tasks

1. Add a proposal-only `current_user_access_snapshot()` migration.
2. Add a shared client snapshot cache with one in-flight request per user.
3. Make role and permission hooks consume the snapshot first.
4. Keep the existing `has_permission`, `has_location_permission` and
   `has_global_role` lookups as compatibility fallback.
5. Make `clearRoleAccessCache()` invalidate the snapshot and notify mounted
   consumers so role changes reconcile without reload.
6. Add source-contract and RLS smoke coverage for the new RPC.
7. Run typecheck, build, smoke, RLS/type drift and measured browser QA.
8. Apply SQL only after explicit approval, then compare production request
   counts and update the tracker.

## Expected Result

- Normal startup: one `current_user_access_snapshot` REST call.
- Legacy database: existing permission RPC behavior with no UI regression.
- Role assignment or location-role update: cache invalidation and refetch.
- No additional authorization decision is moved into untrusted client code;
  server RLS/RPC checks remain authoritative for protected mutations.
