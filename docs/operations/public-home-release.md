# Public Home And Downloads Rollout

The public home at `https://app.letscube.ru/` and `/download` turn release
manifests into download links that anyone can click without an account. This
document is the operational contract for that surface: what must be true before
it goes out, how to prove it, and what to do when it is wrong.

It does not replace `docs/operations/bot-gateway.md` or the native updater
runbooks. Those services deploy independently and are unaffected by this one.

## What ships and where

| Piece | Where it lives | Deployed by |
| --- | --- | --- |
| Public home, `/download`, `/privacy`, `/support` | `artifacts/kub` | Coolify application `letscube-web` |
| Release manifests (`/releases/v1/<platform>/stable.json`) | `api.letscube.ru` | The release catalog, published separately |
| Release artifacts (`/releases/files/<platform>/<version>/…`) | `api.letscube.ru` | The release publisher, immutable per version |

The web application only reads the catalog. Publishing a release and deploying
the web application are separate acts, and either can happen without the other.

## The rule the surface must never break

A download is offered only when a parsed manifest says the release is available
**and** carries an artifact whose URL is on the catalog origin, inside that
platform's and version's own directory. Everything else — no manifest, a
manifest that says unavailable, a fetch that failed — renders as not released or
as a retry, never as a download.

Apple platforms have no published manifest. They are listed so people can see
they are planned, they carry no screenshot, no download control, no version and
no store claim. That is enforced by `tests/e2e/public-home.spec.ts`.

## Before deploying

Run from the worktree, in PowerShell 7 or with `MSYS2_ENV_CONV_EXCL=BASE_PATH`
under Git Bash. Git Bash otherwise rewrites `BASE_PATH=/` into the Git
installation path and every route answers `302`.

```powershell
git diff --check
pnpm.cmd typecheck
$env:KUB_JQ_BIN = 'C:\Users\maksi\.local\bin\jq-1.7.1\jq.exe'
pnpm.cmd release:catalog:test
node --test tests/unit/public-release-artifact-verification.test.mjs tests/unit/public-release-model.test.mts tests/unit/public-product-assets.test.mjs tests/unit/theme-token-contract.test.mjs tests/unit/theme-bootstrap-parity.test.mjs
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
```

Then start the fixture dev server and run the mounted suites:

```powershell
$env:PORT = '5187'; $env:BASE_PATH = '/'
$env:VITE_SUPABASE_URL = 'http://127.0.0.1:54321'
$env:VITE_SUPABASE_ANON_KEY = 'playwright-public-fixture'
pnpm.cmd --filter @workspace/kub run dev
```

```powershell
$env:KUB_BASE_URL = 'http://127.0.0.1:5187'
pnpm.cmd exec playwright test tests/e2e/public-home.spec.ts tests/e2e/public-home-routing.spec.ts `
  --project=chromium-desktop-1920 --project=chromium-desktop-1440 `
  --project=chromium-mobile-390 --project=chromium-mobile-412 --workers=1
```

Stop that server afterwards and confirm ports `5187`, `5188` and `5189` are free.
The unconfigured routing matrix owns `5188` and the preview capture owns `5189`;
both refuse to run against a port something else is already serving.

## Verifying the live artifacts

A manifest agreeing with itself proves nothing. Before the download surface is
announced, stream the real bytes:

```powershell
node scripts/verify-public-release-artifact.mjs windows android macos ios
```

The verifier refuses anything that is not on the exact catalog origin inside the
platform and version directory, refuses a query string, fragment or credentials
in the URL, bounds the stream, hashes what actually arrives and requires both the
byte count and the SHA-256 to equal the manifest. A platform with no manifest
reports `unpublished` and is not a failure. Exit code is non-zero on any
mismatch or error.

Record the exact output in `docs/QA_RESULTS.md`. Do not announce a download that
has not produced a `verified` line.

### 2026-09-01 verification

```
windows 0.2.10: verified 2321755 bytes, sha256 31ed5a8749a85802ce67581e92a9518f67b9c5930fb7463072ab7bcfd737d760
android 0.1.2: verified 6513250 bytes, sha256 d414fb7a818beb86a5bfbd06dc9cdc657e8aa82fa07acc32927b15ab2748af99
macos: unpublished, nothing to verify
ios: unpublished, nothing to verify
```

Note for whoever reads the tracker next: its Windows entry records a
`2,322,508` byte installer with SHA-256 `697f345b…`, which is **not** what the
live Stable manifest currently points at. The live manifest and its bytes agree
with each other, so the surface is safe; the tracker figure refers to an earlier
or different artifact and should not be treated as the current one.

## Which branch each application actually builds from

Verified on 2026-09-02 by checking whether each deployed commit is an ancestor
of `origin/main`:

| Application | Deployed commit on record | On `origin/main` | On `origin/codex/bot-platform` |
| --- | --- | --- | --- |
| `letscube-web` | `aff77ab` | yes | yes |
| `letscube-worker` | `8d20b89` | yes | yes |
| `letscube-bot-gateway` | `01d26a9` | **no** | yes |

So the Bot Gateway is deployed from the feature branch, while the web
application and the worker are deployed from `main`. `main` is therefore behind
production for the bot code, and a merge is what would bring them level.

That has a consequence the public home plan never scoped: merging
`codex/bot-platform` into `main` carries 18 `artifacts/api-server` files with
it, which is inside `letscube-worker`'s `watch_paths`, so the merge redeploys
the worker as well as the web application. The bot code itself is already
running in production through the gateway, so this aligns the worker with what
is already live rather than introducing anything new — but it is a second
service restart and must be planned as one, not discovered afterwards.

Pushing the branch alone is safe: the commits that carry this surface touch only
`artifacts/kub`, tests, scripts and documentation, none of which are in the
worker or gateway watch paths.

## Deploying

1. Push `codex/bot-platform` to its own remote branch first. Never straight to
   `main`.
2. Merge to `main` only after everything above has passed.
3. Pushing `main` fires the GitHub webhook for `letscube-web`. Verify the
   deployment reached the exact intended commit, passed its healthcheck and
   replaced the previous replica. Auto-deploy is checked, never assumed.
4. A change confined to this surface must not redeploy `letscube-worker`,
   `letscube-bot-gateway` or `letscube-support-mail`. The worker's `watch_paths`
   already exclude it; confirm rather than assume.

## Production checks after deploying

- Unauthenticated `/`, `/download`, `/privacy`, `/support` render without a
  login prompt.
- An authenticated session at `/` still lands in the messenger, and a guest deep
  link to a protected route still redirects to `/login`.
- The Windows and Android shells start straight into their own flow with no
  public-home flash and no redirect through it.
- Both themes render their own screenshots on desktop and mobile.
- A download begins from `api.letscube.ru` without a login.

## When something is wrong

The public surface is read-only over the catalog, so there is no data to roll
back. If a download is wrong, the fastest correct action is to make the manifest
say `available: false`, which turns the control into "В разработке" on the next
load without deploying anything. Fix the artifact, republish, re-run the
verifier, and only then set it available again.

If the page itself is broken, redeploy `letscube-web` at the previous known-good
commit. Nothing on this surface writes to the database.
