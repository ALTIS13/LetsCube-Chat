# Stale Download Recovery

Owner: Codex coordinator. Stage: SOURCE_READY; Stable44 remains the published
baseline until the reviewed next release. Native and physical release evidence
are separate from the controlled transition tests below.

## Cause

Runtime.prepareInstall rechecks the Stable catalog before installing a ready APK.
If the catalog changes, the shipped code returns`ready/STALE_RELEASE` while
retaining the old release. Its check/start methods explicitly refuse ready work.
Repeating Install repeats the same refusal; the user must discover Cancel and
restart manually. A withdrawn candidate is likewise left installable-looking.
The rejection is necessary; the trapped recovery state is not.

## Repair

After a valid changed catalog, the same app-owned worker rechecks its generation,
installed signer/version and canonical release identity. It retires only its own
obsolete download/ready files and durably publishes the actual newer release as
`available` with an explicit Download action. If no newer release remains, it
publishes`current` with no install action. It never downloads or opens the
installer automatically. A failed deletion refuses rather than claiming ready.

Unchanged catalogs still require complete hash/package/version/signer checks.
Network and untrusted catalog failures retain the known ready file for a later
retry. Cancellation and a successor generation cannot be overwritten or lose
their files. Package identity, signature pins, source restrictions, deadlines and
call/draft protection are unchanged.

The compact notice says «Скачайте новую версию»; Settings explains the replacement
more fully. Both buttons use the existing native download command, not a browser
APK link. No new modal, progress mechanism or layout abstraction is introduced.

## Verification

The regression compiles the actual Runtime, Policy and Request. HTTP/Android
metadata/time are controlled leaves; real local files and the already cached
org.json20250517 parser execute. The certificate fixture is public release data.
No network/Auth/device/production mutation is part of this JVM test.

After fixture compiler/clock calibration, baseline controls:5 PASS/3 behavioral
RED (stale ready, withdrawn release, obsolete-file deletion failure). Final10/10
includes8 scenarios and two loaded mutants: ignoring changed catalog installs the
old APK; omitting ownership destroys successor bytes. The first deletion mutant
hit a raw absent-file error; the corrected literal oracle checks file presence
before its size and retains the semantic failure assertion.

Affected combined native/JS batch105/105 passes. The final changed UI callback/
copy batch31/31 passes, including compact and Settings Download binding and zero
automatic start/install. This is composed evidence, not a fictitious single107
run. Typecheck and diff checks pass at this source checkpoint.

Actual synthetic full-app Chromium rendering at390/1440 in both themes passes4/4:
available replacement text is readable, Download is visible, obsolete Install is
absent, chrome/composer hit targets remain available and message-port geometry
does not shift. Browser plugin/skill is absent from this session; existing
Playwright is used. Final screenshots are primary ignored
`.ops-private/catalog-recovery45-20261028/pixels-final/`. They contain fictional
fixture data only, not production captures. This does not prove an OS installer,
native lifecycle fault injection or iPhone behavior.

## Remaining Acceptance

Next release should include independently reviewed notification/media slices,
then use the already installed44 on AE for a genuine higher-version ordinary
download/permission/installer flow. Do not reinstall44, manufacture a downgrade,
reuse the old manual bootstrap as self-update evidence or replay accepted cold
photo/cache suites. Source stage is not a publication or physical PASS.
