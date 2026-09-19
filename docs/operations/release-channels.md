# Release Channels: Stable, Test, And What The Windows Switch Actually Switches

Written 2026-09-19, after tracing the whole path rather than reading the option
list. This document is the rule for using the Windows Stable/Test update
switch.

Read the first section before planning anything around a test branch. The
switch does not do what its name suggests, and the difference decides what a
test branch can and cannot deliver.

## 0. Current live state, measured 2026-09-19

The Test channel is **not** empty, which is the first thing most people get
wrong about it. Read off the live catalog:

| Manifest | Version | Published | Artifact SHA-256 |
| --- | --- | --- | --- |
| `/releases/updater/v1/windows/test.json` | `0.2.14` | 2026-09-06T18:51:30Z | `51cafe43…f1f4a92` |
| `/releases/updater/v1/windows/stable.json` | `0.2.14` | 2026-09-06T18:51:35Z | `51cafe43…f1f4a92` |
| `/releases/v1/windows/stable.json` (download) | `0.2.14` build 18 | — | `51cafe43…f1f4a92` |

Both updater channels point at the **same immutable file**,
`releases/updater/files/windows/0.2.14/letscube-0.2.14-setup.exe`, 2367306
bytes. The five seconds between the two timestamps are a publish to Test
followed by a promotion to Stable — the flow in section 6, already exercised in
production.

So the channels are currently in lockstep at `0.2.14`, which is the correct
resting state: a tester can switch either way and land on a build that exists.
The first Test-ahead release would be `0.2.15`.

Do not trust this table without re-reading it; it is a measurement, not a
contract. The commands are in section 8.

## 1. The switch changes the shell, not the messenger

`windows-tauri/src-tauri/src/lib.rs` pins the origin as a compile-time constant:

    const PRODUCTION_ORIGIN: &str = "https://app.letscube.ru";
    const PRODUCTION_URL: &str = "https://app.letscube.ru/";

The bundled `frontendDist` (`windows-tauri/ui`) contains only the startup
screen — `startup.html`, its CSS and JS, and the logo. The messenger itself is
loaded over the network from `app.letscube.ru`, and `require_production_main`
refuses every update command unless the window is at exactly that origin, so
the constant is a security boundary and not a default.

**Consequence.** A Windows build on the Test channel runs the same messenger as
a Windows build on Stable, because both fetch it from `letscube-web`, which is
deployed from `main`. The update channel carries only the native half: the Rust
shell, the startup screen, the window chrome, the updater, the notification
bridge, storage and tray behaviour.

So a `test` branch is a **native-shell** pre-release line. It cannot be used to
put a web change in front of testers; a web change reaches every Windows user
the moment `main` deploys, on both channels.

If a channelled web preview is ever wanted, it needs its own design — a second
web deployment on its own host plus a shell built against it — and it would
have to move `PRODUCTION_ORIGIN` off a constant, which is a security change, not
a configuration one. Do not approach it as a small edit.

## 2. Two manifest systems, one of which is not the updater

These are constantly confused because both live on `api.letscube.ru` under
`/releases/`. They have different paths, different schemas and different
readers.

| | Download catalog | Windows updater |
| --- | --- | --- |
| Path | `/releases/v1/{platform}/{channel}.json` | `/releases/updater/v1/windows/{channel}.json` |
| Schema | `schemaVersion`, `platform`, `channel`, `available`, `build`, `highlights`, `artifact` | `version`, `notes`, `pub_date`, `platforms["windows-x86_64"]` |
| Read by | the **web bundle** — `artifacts/kub/src/lib/releaseCatalog.ts` | the **Rust shell** — `windows-tauri/src-tauri/src/updater.rs` |
| Surfaces | public home `/download`, in-app Settings distribution card, Android in-app update check | the Windows in-place update |
| Signed | no — SHA-256 only | yes — minisign, verified against the pubkey baked into `tauri.conf.json` |
| Channels published | `stable` only | `stable` and `test` |

The Stable/Test switch drives the **right-hand column only**. Nothing in the
left-hand column has ever had a channel other than `stable`, and the public
download surface asks for `stable` explicitly.

## 3. The path, file by file

| File | What it decides |
| --- | --- |
| `windows-tauri/src-tauri/tauri.conf.json` | `version` — the installed version the updater compares against. Bumping a release **is** editing this file on the branch. Also carries the minisign `pubkey`. |
| `windows-tauri/src-tauri/src/updater.rs` | The two endpoint constants; channel persistence (`updater-channel.json`, bounded to 256 bytes, unknown values fall back to Stable); `is_critical_stable` — only Stable may force a blocking update. |
| `windows-tauri/src-tauri/src/lib.rs` | `desktop_check_update` builds the updater with `update_endpoint(channel)`; `desktop_set_update_channel` persists the choice and resets state to Idle. |
| `scripts/windows-tauri-updater-build.ps1` | Builds and minisign-signs the bundle. Requires the private key under `.codex-local/windows-updater/` and refuses to run if the local signing identity does not match `scripts/windows-updater-public.key`. |
| `scripts/publish-native-release.sh` | Publishes both manifest kinds. `valid_updater_channel` accepts `stable` and `test`; `valid_download_channel` accepts `stable` only. Writes to `RELEASE_ROOT`, default `/srv/letscube/releases/public`. |
| `docs/deploy/release-catalog/nginx.conf` | Serves them. The updater manifests are matched by an exact `(stable|test)` regex; anything else under `/releases/updater/` returns 404. |
| `docs/deploy/release-catalog/docker-compose.yml` | Bind-mounts `/srv/letscube/releases/public` read-only. |
| `artifacts/kub/src/lib/platform/desktopUpdates.ts` | Parses the snapshot the shell reports; refuses `critical_update_required` on any channel but Stable; renders «Тестовый канал» for a current Test build. |
| `artifacts/kub/src/lib/releaseCatalog.ts` | The download catalog client. `RELEASE_CHANNELS` is `stable` and `test`; every caller still asks for `stable`. |

### `letscube-releases` does not follow a branch

Its Dockerfile copies two Nginx config files and nothing else. All manifest and
artifact content comes from the host directory `/srv/letscube/releases/public`,
written by `publish-native-release.sh` **on the server**. Redeploying the
application replaces the web server, never the releases. Conversely, publishing
a release needs no deploy at all.

This is the one asymmetry to keep in mind: the channel's *contents* are not
produced by any branch. A branch produces the installer; a person publishes it.

## 4. Branch to channel

| Branch | Produces | Channel |
| --- | --- | --- |
| `main` | the web application (auto-deploys to `letscube-web` on every push) and the Stable Windows shell | `stable` |
| `test` | the Windows shell only | `test` |

`test` should branch from `main` and be merged back into it, never the reverse
of a release. Nothing reads the branch name; the channel comes from the
`--channel` argument at publish time. The branch exists so the commit that
produced a signed binary can be found again.

Pushing a `test` branch should deploy nothing, for two independent reasons:
each Coolify application is configured to follow one branch, and the
`windows-tauri` tree is in no application's watch paths. Neither is recorded
anywhere in this repository, so check the live Coolify configuration before the
first push rather than trusting this paragraph — the project's rule is that
auto-deploy behaviour is verified, never assumed, and `letscube-web` in
particular has been observed rebuilding on pushes that changed nothing it
serves.

## 5. Version numbers

`publish-native-release.sh` requires strict three-part SemVer: major, minor and
patch, each either `0` or a digit string with no leading zero, and nothing else.

**A pre-release suffix is not publishable.** `0.2.15-test.1` is refused. The
Rust and TypeScript parsers would accept one, the publisher will not, so do not
design a scheme around it.

The rule that follows:

- A Test build carries the **next** stable version. Stable `0.2.14` gives Test
  `0.2.15`. When `0.2.15` is promoted it keeps that exact number.
- Do not renumber at promotion. The immutable artifact is stored under its
  version directory, and promotion reuses it (section 6).
- Testers tell the channels apart from the interface, not the number. A current
  Test build renders «Тестовый канал» in the Settings distribution card and
  keeps that card persistent; a current Stable build renders «LETSCUBE
  обновлён» and lets the card dismiss itself. `DesktopUpdatePill` suppresses its
  post-update confirmation on any channel but Stable.

## 6. Promotion is a republish, not a rebuild

`publish_signed_updater` is deliberately idempotent per version. Publishing a
version that already exists re-verifies rather than overwrites: it requires the
bytes to be identical to the stored artifact and the signature to verify again,
then writes the other channel's manifest pointing at the same immutable file.

**Promoting Test to Stable means running the publisher again with the same
installer, the same signature file and `--channel stable`.** Do not rebuild — a
fresh `tauri build` produces different bytes, the publisher refuses them under
the same version, and the only way past that is a new version number that
nobody has tested.

That contract is pinned by `tests/unit/release-catalog-deploy.test.mjs`
("signed updater publication is atomic, channel-safe and reusable for
promotion", and the immutable-replacement rejection beside it).

## 7. What happens when Stable overtakes a tester

Tauri's updater only moves **forward**, and it only ever reads the manifest for
the channel the shell is set to. There is no downgrade.

| Situation | What the tester sees |
| --- | --- |
| Test `0.2.15` published, tester on `0.2.14` | update available, installs, now on Test `0.2.15`. |
| Tester on Test `0.2.15`, Test not advanced | the check returns nothing, so «Тестовый канал, установлена версия 0.2.15». Correct. |
| Tester on Test `0.2.15`, Stable advanced to `0.2.16`, Test still `0.2.15` | **Stranded.** The shell only reads the Test manifest. They see "up to date" and never receive `0.2.16` until Test is advanced or they switch back. |
| Stranded tester switches to Stable | `set_channel` resets to Idle, the next check reads the Stable manifest, `0.2.16` beats `0.2.15`, they update and rejoin. Recovers cleanly. |
| Tester on Test `0.2.15`, Stable still `0.2.14`, tester switches to Stable | the check finds nothing newer, so «LETSCUBE обновлён, установлена версия 0.2.15». They sit on an unreleased build **labelled as current Stable**, and stay there until Stable publishes `0.2.16`. No downgrade path exists. |

The last row is the real hazard, and it produces the operating rule:

> **Promote before you advance.** Never let Test run more than one unpublished
> version ahead of Stable, and promote the exact tested bytes rather than
> building a new Stable. A tester who switches back must land on a version that
> still exists on Stable.

When Test is retired or abandoned, promote its current version to Stable rather
than leaving it orphaned — otherwise every tester who switches back is carrying
a build that exists nowhere.

### A critical update still cannot rescue them, and that is deliberate

- `is_critical_stable` returns false for Test, and `parseDesktopUpdateSnapshot`
  rejects any snapshot claiming `critical_update_required` on a non-Stable
  channel. A blocking gate is a Stable-only mechanism, by design.
- The publisher **can** now express one, since 2026-09-19 (D-251): pass
  `--minimum-supported-version X.Y.Z` and the manifest carries `mandatory: true`
  together with that minimum. One flag sets both, because the shell's rule is
  `channel == Stable && mandatory && installed < minimum` and either field
  alone is inert — a flag that can be half-pulled is worse than none.

  It is refused on the Test channel, refused unless it is strict SemVer, and
  refused if it exceeds the version being published; all three fire before
  anything is signed, copied or locked. So it cannot be used to reach a
  stranded tester: they are on Test, and a critical update is Stable-only.

Do not hand-edit a manifest to force one. The next publish for that version
would regenerate it and the edit would vanish; and a hand-written manifest is
exactly the thing the immutability check cannot protect.

## 8. Commands

Everything in this section runs **on the server** unless stated. `RELEASE_ROOT`
defaults to `/srv/letscube/releases/public`; from Git Bash on the workstation
that path is rewritten to a local one and the script still prints «Published»,
so a workstation run silently publishes nothing.

Build and sign, on the workstation, on the branch that is being released:

    pnpm.cmd windows:tauri:build:updater

Publish to Test, on the server:

    scripts/publish-native-release.sh windows 0.2.15 \
      /path/LETSCUBE_0.2.15_x64-setup.exe \
      "Что изменилось" \
      --channel test \
      --updater-artifact /path/LETSCUBE_0.2.15_x64-setup.exe \
      --signature-file /path/LETSCUBE_0.2.15_x64-setup.exe.sig

The installer and the updater artifact are the same file; the script compares
them byte for byte and refuses if they differ.

Promote the identical bytes to Stable — byte for byte the same command with one
word changed:

    scripts/publish-native-release.sh windows 0.2.15 \
      /path/LETSCUBE_0.2.15_x64-setup.exe \
      "Что изменилось" \
      --channel stable \
      --updater-artifact /path/LETSCUBE_0.2.15_x64-setup.exe \
      --signature-file /path/LETSCUBE_0.2.15_x64-setup.exe.sig

Check what each channel currently advertises, from anywhere:

    curl -s https://api.letscube.ru/releases/updater/v1/windows/stable.json
    curl -s https://api.letscube.ru/releases/updater/v1/windows/test.json

Verify the **download** catalog's bytes — the other system, which has no test
channel published:

    node scripts/verify-public-release-artifact.mjs windows android macos ios

The verifier takes `--channel`, defaulting to `stable`. It becomes useful the
day a download-catalog test manifest exists; until one does it reports
`unpublished`, which is not a failure.

## 9. What is still missing, deliberately

- **No way to install a Test build from scratch.** The Windows updater upgrades
  an installed application; it cannot deliver a first install. The download
  catalog, which could, publishes Stable only — `valid_download_channel` in the
  publisher refuses `test`, and `tests/unit/release-catalog-deploy.test.mjs`
  pins that ("legacy download catalog publisher remains stable-only"). A new
  tester is therefore onboarded by installing Stable and switching the channel,
  or by being handed the installer directly.

- **The download catalogue still hard-codes `mandatory: false`.** That is the
  manifest the web downloads page and Android read, and the Tauri updater never
  does, so connecting it is a separate question about a different surface. Left
  as it is, and the D-251 test is scoped to the updater writer so the two do not
  get conflated.

  That restriction is worth keeping until someone needs otherwise: the download
  catalog is the **public, unauthenticated** surface, and a channel typo there
  would write a file the public home might serve. Failing loudly on `test` is
  the cheaper error.

- **No Android or web channel.** Android reads the download catalog, which is
  Stable-only. The web application has no channel at all.
