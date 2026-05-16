# Codex Workflow

## Command Rules

- Use `pnpm.cmd` on Windows. Do not invoke the PowerShell pnpm shim.
- Do not open editors, Notepad, or the user's browser manually.
- Keep QA credentials outside the repository. The local QA file is `~/.kub-messenger-qa.env`.
- Never print passwords, access tokens, refresh tokens, service-role keys, or cookies.
- Never put `SUPABASE_SERVICE_ROLE_KEY` into frontend code, Vite env vars, docs, tests, or screenshots.

## Verification Before Completion

Run the narrowest relevant checks, then the standard KUB checks before a commit:

```powershell
git diff --check
pnpm.cmd --filter @workspace/kub run typecheck
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
```

For UI-facing changes, run Playwright against the real UI. Required viewports for release-grade QA:

- `3840x2160`
- `1920x1080`
- `1440x900`
- `390x844`
- `412x915`

## Playwright QA

The root Playwright config reads `KUB_BASE_URL`, defaulting to `http://127.0.0.1:5173`.

```powershell
pnpm.cmd e2e:smoke
pnpm.cmd e2e
```

Authenticated tests read the QA email/password from env or `~/.kub-messenger-qa.env`.
Do not commit that file, copy its values into docs, or echo its values.

## Supabase Typegen

Generate types with a project ref supplied by environment:

```powershell
set SUPABASE_PROJECT_REF=<project-ref>
pnpm.cmd supabase:typegen
```

The generated output is `artifacts/kub/src/types/database.generated.ts`. The current
`artifacts/kub/src/types/database.ts` remains the compatibility type file until generated types
are wired through the app deliberately.

## Debugging Policy

- Reproduce first, then patch.
- For bugs, classify whether the failure is UI state, network/API, RLS/RPC, realtime, auth, or layout.
- Do not repeat the same investigation loop after a failed fix without new evidence.
- For DB/RLS/RPC work, write migration proposals and verification SQL; do not apply SQL automatically.

## Planning Policy

- Use a written plan for broad features, migrations, RLS changes, or cross-cutting UI flows.
- Execute small, scoped changes directly when the root cause is clear.
- Request code review or extra verification for risky migrations, permissions changes, auth flows, and data-deleting operations.

## Superpowers

The Superpowers skill pack is not available in this Codex runtime. Use this manual policy instead:

- Verification Before Completion for every task.
- Systematic Debugging for bugs.
- Writing Plans / Executing Plans for large features.
- Test-Driven Development for DB/RLS/RPC when safe fixtures exist.
- Requesting Code Review for risky migrations and permission changes.
