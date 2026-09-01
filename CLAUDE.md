# LETSCUBE Project Handoff For Claude

Last updated: 2026-09-01 (Europe/Moscow)

This file is the current operational handoff for Claude. Read it before changing
code, infrastructure, database objects, release metadata, or product copy.

## 1. Current Stop Point

The user explicitly paused implementation so the current context could be written
down. Do not silently skip ahead or repeat already completed work.

Current unfinished task: finish **Task 2** of the approved public home/downloads/
changelog plan by closing a small mounted-routing test gap. Production routing is
already implemented and no production defect is currently known.

Required remaining test changes:

1. Mount the real app with Supabase public configuration intentionally absent and
   assert that `/` renders `RuntimeConfigurationScreen`.
2. In that same unconfigured matrix, prove that exact public routes `/download`,
   `/privacy`, `/support`, and `/bots/docs` remain reachable before the runtime
   configuration gate.
3. In the configured matrix, prove that near matches `/download/preview` and
   `/bots/docs/nested` are protected and redirect a guest to `/login`.
4. The test must be deterministic, use a dedicated alternate port, have no
   optional-environment skip, and contain no secret values.

After the patch, run the mounted Playwright test, routing unit tests, typecheck,
production build, and `git diff --check`. Then perform a scoped review before
marking Task 2 complete.

## 2. Authoritative Checkout And Git State

- Main repository: `D:\CodexProjects\LetsCube-Chat`
- Current isolated worktree: `D:\CodexProjects\LetsCube-Chat\.worktrees\bot-platform`
- Current branch: `codex/bot-platform`
- Remote: `https://github.com/ALTIS13/LetsCube-Chat.git`
- Implementation baseline before this handoff commit:
  `aeaaace9efd0c5dfed5542d2ffca8a3a681e0152`
- Working tree before creating this handoff: clean
- Branch before this handoff commit: 7 commits ahead of
  `origin/codex/bot-platform`

The task environment may still display the removed/stale desktop path
`C:\Users\maksi\Desktop\kub-messenger-clean`. Do not use it as the authoritative
checkout. Always verify `git rev-parse --show-toplevel`, branch, status, and remote
before editing.

All local implementation and handoff commits remain intentionally unpushed at this
stop point. Do not push or deploy them until Task 2 is fixed, reviewed, and
validated. Never push directly to `main` without complete validation.

Latest local commits:

- `aeaaace test(public): cover mounted root routing`
- `fdd8933 feat(public): route guests to LETSCUBE home`
- `c035431 docs(plan): close release highlights task`
- `f6f9233 fix(release): resolve jq executable from path`
- `1af9091 test(release): exercise production jq highlights parity`
- `22df764 feat(release): add compact Stable changelog metadata`
- `c405f8a docs(plan): harden public home rollout contracts`

## 3. Sources Of Truth

Read these files before continuing:

1. `docs/PRODUCTION_PRIORITY_TRACKER.md`
2. `docs/superpowers/specs/2026-08-30-registration-lifecycle-bot-platform-public-home-design.md`
3. `docs/superpowers/plans/2026-08-30-public-home-downloads-changelog.md`
4. `docs/superpowers/plans/2026-08-30-bot-platform.md`
5. `docs/QA_RESULTS.md`
6. `docs/operations/bot-gateway.md`

The ignored SDD workspace also contains useful evidence and review reports:

`D:\CodexProjects\LetsCube-Chat\.worktrees\bot-platform\.superpowers\sdd\2026-08-30-public-home-downloads-changelog\`

`AGENTS.md` is partially stale. Its security rules remain useful, but its old KUB,
computer-club, temporary-domain, HomeNode, and deployment wording is not current.
Do not reintroduce those user-facing terms or old domains.

## 4. Approved Public Home Plan And Status

### Task 1: release manifest highlights - complete and approved

- Release manifest `schemaVersion` remains `1`.
- Optional `highlights` is backward compatible; absent values parse as `[]`.
- Parser accepts 0-6 highlights; publisher requires 1-6.
- Entries are trimmed and limited to 140 UTF-16 code units.
- `ReleasePlatform` may recognize future `macos`, `ios`, and `web`, but the current
  publisher remains Android/Windows only.
- Legacy release CLI behavior is preserved.
- Production jq/Python parity tests exist and passed with jq 1.7.1.
- `pnpm.cmd release:catalog:test` passed 33/33 with no skips when real jq was
  available. Do not modify global PATH; use a process-scoped path or `KUB_JQ_BIN`.

### Task 2: public routing foundation - production complete, test approval pending

Implemented:

- `artifacts/kub/src/lib/publicHomeRouting.ts`
- `artifacts/kub/src/lib/platform/desktop.ts`
- `artifacts/kub/src/lib/publicRoutes.ts`
- routing integration in `artifacts/kub/src/App.tsx`
- minimal `PublicHomePage.tsx` and `DownloadPage.tsx`
- mounted routing coverage in `tests/e2e/public-home-routing.spec.ts`

Current behavior contract:

- Browser guest `/` -> public home.
- Native desktop/mobile shell guest `/` -> `/login`.
- Authenticated user `/` -> messenger.
- Auth callback/error precedence is preserved.
- Exact public routes remain public.
- Protected guest deep links and public-route near matches go to `/login`.
- `isDesktopShell()` detects native shell generally; existing Windows-only
  `isDesktopApp()` and `getDesktopBridge()` semantics remain Windows-only.

Independent reviewer found no production defect. Remaining P2 is only the test gap
listed in section 1.

### Task 3: sanitized real-interface product assets - pending

- Use genuine LETSCUBE interface references with fictional, checked-in data.
- A DEV-only fixture/capture route is allowed.
- Never capture production chats, user data, phone numbers, emails, tokens, or
  private media.
- Produce bounded responsive WebP assets and verify them visually.

### Task 4: final public home UI - pending

- Build the real usable public home, not a generic marketing landing page.
- Theme-aware light/dark presentation; follow system preference.
- Windows and Android are active download platforms.
- macOS and iOS must be shown as `В разработке`; do not invent downloads, App
  Store availability, release dates, or certification claims.
- Include a compact Stable changelog from release metadata.
- Use restrained, polished motion and clear interaction feedback.
- Preserve accessibility, responsive behavior, and exact public-route contracts.

### Task 5: release validation and deploy - pending

- Run complete regression validation.
- Verify live release artifact bytes and SHA values, not only JSON metadata.
- Deploy only after review and validation.
- Perform production visual QA on desktop and mobile viewports.
- Record evidence in the tracker and QA documents.

## 5. Validation Commands For The Current Task

Use PowerShell 7 and `pnpm.cmd`, never `pnpm.ps1`.

For the configured mounted-routing matrix, start Vite explicitly on a dedicated
port with safe fixture values (these are not production credentials):

```powershell
$env:PORT = '5187'
$env:BASE_PATH = '/'
$env:VITE_SUPABASE_URL = 'http://127.0.0.1:54321'
$env:VITE_SUPABASE_ANON_KEY = 'playwright-public-fixture'
pnpm.cmd --filter @workspace/kub run dev
```

In another shell:

```powershell
$env:KUB_BASE_URL = 'http://127.0.0.1:5187'
pnpm.cmd exec playwright test tests/e2e/public-home-routing.spec.ts --project=chromium-desktop-1440 --workers=1
pnpm.cmd exec vitest run artifacts/kub/src/lib/publicHomeRouting.test.ts artifacts/kub/src/lib/platform/desktop.test.ts
pnpm.cmd --filter @workspace/kub run typecheck
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
git diff --check
```

The current configured mounted test previously passed 12/12. A run without a Vite
server produced connection-refused failures; that was test setup, not an app defect.
Stop the temporary server after the test.

Existing build warnings about Vite sourcemaps, mixed Supabase imports, and chunk
size are known warnings, not automatic permission to ignore new errors.

## 6. Completed Production Baseline Not To Rebuild

The project is a production-oriented LETSCUBE messenger with:

- self-hosted Supabase Auth/Postgres/RLS/Realtime/Storage;
- browser application and iPhone/iPad-only PWA policy;
- dedicated Windows Tauri EXE and Android APK delivery;
- notification center grouping/read sync and web/native delivery foundations;
- support ticket workflow and support mail;
- media preview/variant processing and optimized chat media behavior;
- invite-only controls, invitation roles/groups, anti-abuse controls;
- verified-phone search and administrator-restricted phone verification;
- bot platform v1 and production Bot Gateway canary;
- public privacy/support/bot documentation routes;
- Windows update UI, notification routing, and Android release catalog.

Bot Gateway canary is complete. Production app UUID/deployment IDs and exact canary
evidence are documented in `docs/operations/bot-gateway.md` and QA/tracker files.
Do not expose bot tokens, owner IDs, or service credentials in reports.

## 7. Product Ownership And Scope Boundaries

- Visible product name and application label: `LETSCUBE`.
- Remove user-facing `KUB`, `КУБ`, `компьютерный клуб`, `кибер-арена`, and other
  gaming-club positioning unless a specific business/legal context requires it.
- Internal `kub`/`KUB` code, environment, database, and Android identifiers may
  remain when changing them would break contracts.
- Android package ID remains `com.kub.messenger`.
- iPhone/iPad PWA and native iOS work are owned by another agent. Do not modify
  iOS/PWA-specific behavior in this track. Shared contracts and handoff docs are OK.
- This track owns backend/shared web, Windows, and Android work.
- Browser is the universal fallback. PWA install UI is for iPhone/iPad only.
- Do not restore Electron; Windows uses Tauri and EXE installer distribution.

## 8. Live Infrastructure Map

Use only the service subdomains; the apex `letscube.ru` belongs to another project
and must not be used for this application.

- Web application: `https://app.letscube.ru`
- Coolify: `https://deploy.letscube.ru`
- Public API/release catalog: `https://api.letscube.ru`
- Server SSH host: `ms.letscube.ru`, port `22`
- Server IPv4 previously used: `157.22.206.43` (verify live before use)
- Mail host: `mailserver.letscube.ru`
- Support address: `support@app.letscube.ru`
- Server application root: `/srv/letscube`
- Local SSH key: `C:\Users\maksi\.ssh\letscube_ed25519`

Do not assume live state from this file. Verify DNS, TLS, git revision, Coolify
deployment, container health, disk space, database connectivity, and backups before
any production action. Do not print sensitive environment values while verifying.

Important infrastructure history: Docker's stock subnet conflicted with the
provider gateway. Docker/Coolify must keep the non-conflicting custom address pools
already established on the server; do not reset Docker networking to defaults.

## 9. Secrets And Private Data

Private local material is stored outside the worktree under:

`D:\CodexProjects\LetsCube-Chat\.ops-private\`

Relevant names include `p1sms.txt`, provider API PDFs/scripts, `smsRU.txt`, VAPID
material, Android signing material, migration backup material, and private task
folders. Read only the minimum required file. Never echo values to terminal output,
chat, docs, screenshots, commits, test reports, or client bundles.

Additional rules:

- Never put `service_role` or trusted backend credentials in frontend code.
- Never print or commit FCM registration tokens.
- `android/app/google-services.json` is local-only and ignored; never print or
  commit it.
- Never commit `.env*`, keystores, private keys, signing passwords, provider keys,
  raw push subscriptions, or production database dumps.
- Never log message bodies, phone numbers, emails, or personal media during QA.
- Trusted delivery credentials belong only in backend/Coolify environment storage.
- Do not change Java/JDK/JRE or global PATH.

## 10. Database And Deployment Safety

The user has previously authorized carefully reviewed SQL proposals, but that is not
permission for blind migration. Before any database change:

1. Confirm the exact target database and current schema.
2. Create and verify a fresh backup.
3. Review the migration for additive/idempotent behavior, locks, RLS, grants, and
   rollback implications.
4. Rehearse read-only or against a safe environment when feasible.
5. Apply once, validate data/RLS/application behavior, and record evidence.

Never disable RLS. Never expose `service_role` to frontend/mobile/desktop bundles.
Do not apply unrelated proposals while completing the public-home plan.

Coolify auto-deploy behavior must be verified rather than assumed. Deploy only the
intended revision after tests. Keep browser/PWA, Windows, Android, mail, Supabase,
and Bot Gateway services independently observable.

## 11. Critical Regression Contracts

Every relevant change must preserve:

- Chat entry: no unread -> bottom; unread -> first unread.
- Search and notification jumps land on the exact message.
- History prepend preserves the user's anchor.
- Fast upward scrolling must not snap to bottom or jump to oldest history.
- Notification-center grouping, read sync, and per-chat clearing.
- Browser/PWA push behavior and native notification routing.
- Message sender exclusion, mutes, preferences, and cross-device read sync.
- Android voice, video circle, regular video, camera/photo, and geolocation.
- Browser install CTA hidden inside Android APK.
- LETSCUBE auth branding, centered layout, responsive captcha, and no duplicate logo.
- Support workflows, privacy route, media previews, avatars, and upload progress.
- Windows updater, notification-card routing, grouped toast history, and tray behavior.

## 12. Phone Verification State

- Verification is currently restricted to administrators.
- Provider: P1SMS trusted backend integration.
- Current route: Telegram first; message-scoped digital fallback after `agg_error`,
  `not_delivered`, or a terminal provider error.
- Code length: 4 digits.
- Resend cooldown: 120 seconds.
- Do not mention Telegram in user-facing success copy unless product explicitly
  changes that decision.
- Do not alter provider account-wide templates/cascades or other LETSCUBE projects.
- Search by phone uses only verified normalized E.164 values, requires the proper
  permission, and must not return the phone number itself in search results.

## 13. Native And Packaging Open Items

Windows remaining gates include Authenticode/SmartScreen, killed-process WNS
delivery, Windows 10/11 device matrix, and long-session/offline QA. Existing MSIX/
PWA product identities must not be deleted or remapped casually. EXE installer is
the primary Windows distribution path; sparse identity remains an audited proposal,
not permission for an identity migration.

Android has a strong tested baseline, but broader vendor/device QA and external
release operations remain. Do not perform release signing/AAB publication, deep
links/app links, package-ID changes, or store submission unless explicitly tasked.

Current version numbers in the tracker may change. Read live catalog/manifest data
before claiming a Stable version or publishing an update.

## 14. Working Style For Claude

- Make small, reviewable patches; do not rewrite the project.
- Inspect existing patterns before introducing abstractions or dependencies.
- Use `rg` for targeted searches.
- Use PowerShell 7 and `pnpm.cmd` on Windows.
- Do not use mouse automation or open secrets in editors/screenshots.
- Do not modify unrelated files or revert concurrent user/agent changes.
- Before editing, state the observed root cause and intended scoped patch.
- Add tests proportional to the behavioral risk.
- Validate before committing; review before pushing; deploy only after validation.
- Keep reports in Russian for the user, but code/docs may follow the repository's
  existing language conventions.
- Check `git status` frequently because another Apple-focused agent may create
  external changes. Preserve and coordinate with those changes instead of reverting
  them.

## 15. Immediate Resume Checklist

```powershell
Set-Location 'D:\CodexProjects\LetsCube-Chat\.worktrees\bot-platform'
git rev-parse --show-toplevel
git status -sb
git remote -v
git log --oneline -12
git rev-list --left-right --count origin/codex/bot-platform...HEAD
```

Then:

1. Read the three current plan/spec/tracker files in section 3.
2. Inspect the latest Task 2 review report under `.superpowers\sdd`.
3. Add only the missing deterministic mounted-routing cases.
4. Run the validations in section 5.
5. Review the diff and commit the focused test completion.
6. Mark Task 2 complete only after the scoped review approves it.
7. Continue with Task 3 sanitized product assets, then Task 4 UI, then Task 5
   validation/deploy.

Do not start a different roadmap item until the current Task 2 gate is closed or
the user explicitly redirects the work.
