# Native Preview User Choice Source

Owner: coordinator. Branch `codex/bot-inline-media-20261002`, base `c4fea60a`.
Stage: Task1 and Task2 source deltas independently reviewed; Task2 rendered
acceptance remains pending. [HANDOVER](../HANDOVER.md) is the live resume record.
No SDK/device/choice acceptance is inferred.

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

Task2 hook/save chain is source-accepted below; its actual rendered Settings
acceptance and Task3 real-input QA remain pending.
SOURCE_GREEN is not SDK/APK/device/person-consent, server-save, background/card,
FCM, OS privacy or release acceptance. Capabilities remain protocol0 and rich/
nativePositive flags false. Stable0.1.14/build15 and production are unchanged.
No schema/provider/manual SQL change; no package was installed for this stage.

[Approved contract and remaining sequence](2026-10-10-native-preview-user-choice-plan.md).
[Accepted genuine prerequisite](2026-10-10-native-preview-genuine-composition.md).

## Task2 Hook And Fixture Source

The tagged QA branch reuses the unchanged actual Settings radios and account-owner
write barrier. Current Auth owner/SID/accountEpoch and the native selector fence
the strict finite context; intent revisions remain module-global across remount.
Each selection requires checked native begin, fresh capability, exact own-row
upsert ACK, fresh post-read, checked native confirm and final ownership/context
recheck. QA effective choice is always literal none. Ordinary protocol0 remains
unavailable; no protocol1 fallback or display grant is manufactured.

Unknown ACKs can follow applied actions: preserve UNKNOWN, captured erasure
target and server residue without automatic replay or rollback. A strict negative
begin retains the prior erasure revision, not the refused request revision.
The error now says that saving could not be confirmed, rather than asserting that
nothing was saved. Saving retains the last confirmed radios and disables them.
Disposal, Auth/lifecycle changes and inline expiry retire the captured intent.

Initial actual-module feature-absence RED retained the ordinary protocol0
zero-RPC/zero-upsert control. Initial source run73/73 includes14 runtime mutants.
Independent review found three P2 issues: held load at session expiry skipped
inline retirement; duplicate INITIAL_SESSION during refresh lost its identity;
the negative begin fixture applied before returning false. All were named RED
before correction. Fixing the fixture also exposed the wrong native erasure
target, which was corrected in the hook. Fresh affected38/38 includes28 behavior
controls and ten runtime mutants;49 unchanged prior checks are reused. This is
not87 fresh PASS. Independent spec/quality delta review accepted; changed real
kub typecheck and protected-input readback passed. Earlier genuine/SDK/SQL/device
proof was not rerun or relabelled as consent.

The new local fixture uses actual Settings/hook/typed adapters, with explicitly
fictional native selector/wire and HTTP ports. Its baseline is the exact pre-Task2
hook:9117 bytes, SHA256
`6c3fce41a5175b7a6e63f09f13143e7204beb5b4eebc41d1c89a3c0bfd9e11e2`.
Eleven authored browser cases and16 invented-element capture slots are unexecuted,
not PASS results. Automatic screenshot/trace/video are off; mutations are zero.

Initial fixture source compilation refused new casts/transformer typing.
Independent review found redirect following, substring-only config selection and
incorrect expiry retirement. Repairs bind the actual selected fixture URL/key,
block redirects before every fetch, hide refused values, and retain one exact
expiry-retire ACK. Selected three-root types now add zero diagnostics versus the
independently compiled unchanged old helper's one existing diagnostic; this is
not a claim that every historical test helper typechecks. A new actual-source
guard suite passed24/24 including four omission mutants under fictional request/
page ports. Independent fixture and guard-unit reviews accepted. No actual
browser/network/native SDK result is inferred from these source controls.

Current reviewed hook/unit pins:
`ba7b8c19834efc7c00b1099d452080d55dde36572d1e0f0ee694b31308e7c150` /
`99b27d85fcbf7791f659d4dcb4782475fa208bf25d69b17ace37fb0be18ce6c5`.
Current fixture/guard-unit pins:
`9c76fccadc8661f9e7158bd976af997d074946374f0a89af8897a3fd20c012c6` /
`233a3317d9385fb9213933f9c5df010346c4b695248051bf6272ac630c529055`.

## Rendered Blocker And Next Action

The isolated Vite launch was rejected by the tool policy before execution.
No retry, alternate launcher, process reconfiguration or workaround followed.
No listener was found on5173/5185/5186/5187. Read-only inventory found older
project Vite processes on5391/5393 with fictional configuration and a false QA
marker. Hook requests there returned non-JavaScript200 without even the known
hook/preference controls, including a fresh binding query. They cannot prove this
slice's browser behavior; no spec was run against those unbound surfaces.

Next is the calibrated actual Settings baseline/current run and pixels at
1440/390, both themes, on a legitimate current-checkout fixture server. Then the
already approved isolated owned-QA input/lifecycle stage can proceed. Do not mark
Task2 complete, build a new actual QA artifact or promote from source checks.
Task3 remains unimplemented; production/rich/Stable are unchanged. No provider,
schema/manual SQL, Auth, device/rental or native-package operation ran in Task2.
