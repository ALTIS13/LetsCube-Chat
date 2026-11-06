# Task 5 / D-208: Android Candidate Build Environment

Owner: Codex, LETSCUBE stream 5. 2026-11-06 MSK. Checkout baseline
`1679cdc7` for the helper, `9eb97344` for the compiled web assets. Stage:
candidate environment and isolated bundle verified; no APK assembled.

## Contract

The [production debug](../../scripts/build-android-production.mjs#L213) and
[production release](../../scripts/build-android-release.mjs#L134) entry points
use the same public env collector and child allowlist. Neither forwards
`VITE_MEDIA_SIGNED_URLS` from the infra source or from the parent process.
The [previous artifact check](2026-11-06-task5-d208-signed-only-compatibility.md)
observed the absent flag resolving to `public` in APK candidate 49. This step
preserves those production inputs; it does not remeasure the current APK.

The new [candidate-only helper](../../scripts/build-android-production.mjs#L149)
is `createAndroidCandidateWebProcessEnv(baseEnv, publicEnv, mediaUrlMode)`.
It applies the existing child allowlist and adds exactly one output key,
`VITE_MEDIA_SIGNED_URLS`, from the explicit argument. Accepted values are
exactly `public`, `signed`, and `signed-only`. Missing, unknown, aliased,
non-string, or padded values throw a fixed error without echoing the input.
There is no ambient or infra-file fallback. The generic allowlist stays
unchanged, including when a caller injects the mode into the supplied public
map. The candidate helper does not restore any signing inputs or admit an
additional credential, arbitrary `VITE_*` setting, or proxy override.

Neither stock command calls the new helper. The production debug/release
entry points, release signing environment and tool pins are unchanged.
There is no new release flag, package metadata change, or persisted setting.

## Verification

[Focused tests](../../tests/unit/android-production-build.test.mjs#L113)
assert all three modes, exact error redaction, the ordinary debug/release/tool
environments, and absence of synthetic secrets from both input maps. RED:
three candidate cases failed before the helper existed, with the existing
default-environment control passing. GREEN: **16/16** helper and client-mode
checks, plus **2/2** existing release environment checks. Four in-memory
mutations each failed at the expected assertion: drop `signed-only`, accept
unknown values, widen the shared whitelist, and bypass the secret fence.
The two release checks selected by test name are pure environment checks;
no Gradle test was run.

## Isolated Compiled Candidate

The coordinator built the actual Vite web application from tracked-clean
`9eb97344bda3bf2a6e9488e4240608a42479c1d9` into a separate ignored directory.
The runner passed `signed-only` through the candidate helper to the Vite child,
used `envFile: false`, and asserted the exact resolved set of Vite environment
keys. The backend URL and publishable key were fictional. Synthetic values
supplied via the parent environment, public argument map and an otherwise
loadable `.env.production` file were absent from every emitted file. The
ordinary child environment rejected the mode; the candidate differed only by
that one key. No tool, sync or signing child received it.

The emitted entry `assets/index-Cg92Pzdc.js` was parsed to resolve the unique
mode call and execute its compiled resolver with the actual literal. It
returned `signed-only`. Worker `ba6b95b8bc670d1f` points at the same entry, SHA-256
`8b74188f61fc1fc7a5d7d62eed0de066f5b4cb519a5dcdb8a6ea7aede34e71d1`.
Receipt: `PASS_ISOLATED_COMPILED_ANDROID_SIGNED_ONLY`. This is not an APK,
authenticated Storage test or older-client compatibility proof.

Next: run a separate signed-only Android QA APK against an admitted account
and exact synthetic media. Check preview/save, renewal and access loss,
and retain the default-mode control. No infra env was read or changed, and
no APK signing, installation, publication, deployment or Storage change was
performed. Keep the production default and bucket as-is; D-208 is open.
