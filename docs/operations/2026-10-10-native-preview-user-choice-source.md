# Native Preview User Choice Source

Owner: coordinator. Branch `codex/bot-inline-media-20261002`, base `c4fea60a`.
Stage: Task1 SOURCE_ACCEPTED, independent spec/quality review accepted.
Next: Task2 existing Settings hook/save chain. [HANDOVER](../HANDOVER.md) is the
live resume record. No SDK/device/choice acceptance is inferred.

## Cause And Scope

Ordinary native capabilities are literal protocol0, so the ordinary Settings
binding parser correctly refuses them. Genuine foreground composition does not
constitute a user choice. The approved route is a separate QA-only consent context,
not a manufactured protocol1 capability or display lease.

Task1 adds one memory-only native owner, private main-thread arm and guarded
context/begin/confirm/exact-retire bridge methods. The plugin rechecks the original
runtime identity, current Activity/document/authority and fixed deadline on main
after worker completion. First failure consumes the request; no same-incarnation
rearm. Ordinary Gradle and web guards remain false/absent.

The new exact eight-field QA parser is separate from all unchanged ordinary
parsers. Typed wrappers copy their inputs, use a finite2000ms timeout and preserve
UNKNOWN as null, separately from a received negative ACK. No automatic replay,
credential handoff, vault/network/store operation or display authority is added.

## Verification

- Calibrated actual-plugin feature-absence RED retained ordinary binding/protocol0
  controls; actual TS RED retained the ordinary protocol1 positive control.
- Initial final focused run:72/72, zero skips;39 actual-graph native controls,
  nine TS controls, selected installed-types TS compile, old fixture closure,
  16 compiled native and six actual-source TS mutants.
- All native mutants compiled before their named runtime assertion failed.
  End readback matched22 selected Java sources;17 report input/protected pins
  matched independently. Exact wrapper-input mutation was RED then GREEN.
- Coordinator real `pnpm.cmd --filter @workspace/kub run typecheck` and
  `git diff --check` exited0. Earlier accepted SDK/genuine/SQL suites were not rerun.
- Independent spec/production review found no actionable production issue, but
  one P2 in the test oracle: wallDeadline-120000 derives arm wall from the value
  under test. The compiled +1ms wall extension survived, producing the named RED.
- Correction changes only the probe/test: actual-owner clock port with independent
  arm literals before request, followed by the unchanged plugin verification and
  publication chain. Fresh affected9/9: actual-plugin control, four deadline/
  rollback controls and four compiled mutants. The +1ms wall mutant now fails
  NONRENEWABLE_WALL_EXPIRY. No fresh whole73/73 claim; previous72 evidence reused.
- Independent delta review accepted;17 input/protected and22 actual Java hashes
  and both aggregates matched. Production was unchanged by the review correction.

Reviewed native owner SHA-256:
`5660b21519853bc9df1e908ccf38faa90592a2fed690955a9e4c63e8c2e24f3b`.
Reviewed plugin SHA-256:
`0a9fb3ef3ffff1fd7aa9b138f4cccf3265007270549f78dd3f9d510faa06a176`.
Corrected probe/test SHA-256:
`4838da96350487993154d823bd3f36c1679e5fac39e04903db20f871f4648e62` /
`e891f81ba29d8d36198ca9ce62e7a4cb9024943422eef9409c5a83334a0172c7`.

## Limits

Task2 hook/actual Settings consumer and Task3 real-input QA remain unimplemented.
SOURCE_GREEN is not SDK/APK/device/person-consent, server-save, background/card,
FCM, OS privacy or release acceptance. Capabilities remain protocol0 and rich/
nativePositive flags false. Stable0.1.14/build15 and production are unchanged.
No schema/provider/manual SQL change; no package was installed for this stage.

[Approved contract and remaining sequence](2026-10-10-native-preview-user-choice-plan.md).
[Accepted genuine prerequisite](2026-10-10-native-preview-genuine-composition.md).
