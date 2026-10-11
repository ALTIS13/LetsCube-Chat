# D-222: Storage heading

Verified 2026-10-12. Owner: bounded Storage heading worker. Stage: source and
offline rendered regression ready. Next: coordinator narrow integration and
old/new served-bundle verification; no deployment or native acceptance here.

## Observed Cause And Change

The actual `StorageSection` heading placed anonymous text and `InfoHint` in a
wrapping flex row. At a 260px Settings measure, the hint wrapped onto its own
line. The original source was rendered before the production edit and failed
`NO_ORPHAN_HINT` at both 1440px and 390px in dark mode. Normal-width controls
passed. The initial light fixture did not apply the product's `.light` class;
that calibration error was corrected, with literal theme-token assertions.

The retained before-fix RED was geometric, not a compiled-consumer mismatch:
at 1440px the heading height was 72px, hint top 40px and text line tops 1/21px;
at 390px the heading height was 64px and hint top 20px. The orphan row is also
visible in the retained before crops below.

The final calibration then compiled the byte-identical original component and
confirmed the orphan hint in all four viewport/theme combinations. Restoring
only the two edited heading lines reconstructs the original SHA-256 exactly:

- Before: `18801d0e7e88bfbec69112f44ef35c53cb0b8cbccb553aaac88e215b6f3a4d93`
- After: `40dd2d69576543af7737f710ef391ea3f1f9e1b1744d424274f0c9db0339ce19`

Only `StorageSection.tsx:133-134` changed: remove `flex-wrap` and put the literal
title in a `min-w-0` span. Existing `items-center`, title, typography, hint,
tooltip text, card layout, actions and storage logic remain unchanged. The text
can wrap inside its own flex item instead of moving the hint to an orphan row.
No hide, truncation, forced blur, smaller hint or layout redesign was added.

## Focused Evidence

The fixture compiles the real component and its real React/UI dependencies with
installed esbuild, plus the actual application CSS with installed Tailwind. It
uses the existing Settings measure port and a fictional snake_case desktop
storage bridge. Native mutation methods throw. Requests are intercepted on
`https://storage-heading.invalid/`; the context is offline, undeclared requests
are refused, and local Inter fonts are used. No server or production page is
opened. `KUB_QA_ALLOW_MUTATIONS=0` is required.

The final run returned exit 0, no stderr, no skips:

- Marker unit: **3/3 PASS**, 194.3204ms.
- Chromium rendered tests: **12/12 PASS**, 15.7s, one worker.
- Narrow and normal controls at 1440/390 in real dark/light themes: complete
  title, actual glyph beside a text line, visible non-shrunk hint, no clipping
  or overflow; the normal control opens the real tooltip.
- Three in-memory changes to the actual component were rejected in every
  viewport/theme combination: original wrapping heading, hidden hint, clipped
  title. These are 12 calibrated mutant renders within four test cases.
- Before, after-narrow and normal-card pixels were inspected for all four
  viewport/theme combinations. Wide controls were retained.

Commands from `D:\CodexProjects\LetsCube-Chat`, with the environment variable
set in the child process only:

```cmd
set "KUB_QA_ALLOW_MUTATIONS=0"
node --test tests/unit/storage-heading-marker.test.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/storage-heading.spec.ts --project=chromium-desktop-1440 --project=chromium-mobile-390 --reporter=line --workers=1
```

Early fixture-loader and repeated-init-script failures were harness failures,
not product RED. They were corrected before the final run. The final fixture
asserts the literal light/dark text tokens and uses the actual glyph rectangle,
not merely the button rectangle, for the no-orphan check.

### Reviewer Assertion-Order Amendment

The later marker addition was initially placed before narrow geometry. It has
now been moved after all behavioral assertions, including `NO_ORPHAN_HINT`.
The original-wrap calibration likewise checks geometry before its old-consumer
marker. This prevents a future old-source regression run from failing on the
new consumer shape before measuring the actual defect.

Only the affected desktop-dark narrow and calibration cases were rerun:
**2/2 PASS**, 4.0s, exit 0, empty stderr, no skips. The unchanged marker unit,
wide controls and remaining viewport/theme cases retain the preceding evidence;
the original geometric RED was not replayed as a new baseline attempt.

```cmd
set "KUB_QA_ALLOW_MUTATIONS=0"
node node_modules/@playwright/test/cli.js test tests/e2e/storage-heading.spec.ts --project=chromium-desktop-1440 --grep "storage heading (narrow keeps explanation beside visible text|assertions reject wrap hide and clip) dark$" --reporter=line --workers=1
```

## Compiled Consumer Marker

The inert CLI parses retained compiled JavaScript with the installed TypeScript
AST parser. It associates the exact heading `div` class, literal title, and
the adjacent hint's term/explanation. The new consumer additionally requires
the `span` tag and exact `min-w-0` class. Minified JSX-runtime callee names do not
matter. Unrelated class strings or title strings do not count.

```cmd
node tests/e2e/helpers/storageHeadingMarker.cjs <retained-app-JS-file>
```

Expected previous consumer:

```json
{"schema":"storage-heading-consumer/v1","oldConsumerCount":1,"newConsumerCount":0}
```

Expected candidate consumer:

```json
{"schema":"storage-heading-consumer/v1","oldConsumerCount":0,"newConsumerCount":1}
```

Both literal results were verified on the actual minified esbuild component
fixture, including the byte-identical original variant. Missing, duplicate or
unparseable consumers refuse with fixed errors. This is not a generic CSS class
count. The coordinator must still run it on the retained actual previous and
candidate served application JS; those bundles were not fetched or built here.

## Files And Pins

| Changed/new path | SHA-256 |
| --- | --- |
| `artifacts/kub/src/components/settings/StorageSection.tsx` | `40dd2d69576543af7737f710ef391ea3f1f9e1b1744d424274f0c9db0339ce19` |
| `tests/e2e/storage-heading.spec.ts` | `c97d8ddb59b7e89be428a27179342aad8d2f2f4b3e7d1cefa7700188b0cac8e9` |
| `tests/e2e/helpers/storageHeadingFixture.ts` | `dd24089966c33e29f3ba8dadc7fa515335dbc9d45d9ad38640e3ed4304a3b6f7` |
| `tests/e2e/helpers/storageHeadingMarker.cjs` | `53e41aa6e9144d58dfff59f2fb1f712af956f1bf20789a93d31f043d14c8311e` |
| `tests/unit/storage-heading-marker.test.mjs` | `3843dca8579bee04bb9ec3d3cf0172bbd3deeb7ca110a52f5306d6f45f003081` |

Unowned files were not edited; before/after SHA-256 matched:

- `SidebarHeader.tsx`: `fdb0df206df48d5847519df74341fb947067fe1ec38c76f9e8582a9d4fb69c96`
- `sidebar-search-motion.spec.ts`: `c1aa29c76f2be142388962af542647766714e9cd0e7fc79ac30639ac2ba8b01d`
- `search-motion-fixture.spec.ts`: `919d3a7d612b5c3954c51f2b7ddc1c694a436af7bbd7e5f508e346b8e99b01ef`

## Fictional Screenshots

These are exact locator crops, not screenshots of personal or production data.
The mobile project's device scale factor affects pixel dimensions, not its
390px CSS viewport.

| Viewport/theme | Before heading | After narrow heading | Normal card |
| --- | --- | --- | --- |
| 1440 dark | [Before](C:/Users/maksi/AppData/Local/Temp/letscube-storage-heading-before-chromium-desktop-1440-dark.png) | [After](C:/Users/maksi/AppData/Local/Temp/letscube-storage-heading-narrow-chromium-desktop-1440-dark.png) | [Normal](C:/Users/maksi/AppData/Local/Temp/letscube-storage-heading-chromium-desktop-1440-dark.png) |
| 1440 light | [Before](C:/Users/maksi/AppData/Local/Temp/letscube-storage-heading-before-chromium-desktop-1440-light.png) | [After](C:/Users/maksi/AppData/Local/Temp/letscube-storage-heading-narrow-chromium-desktop-1440-light.png) | [Normal](C:/Users/maksi/AppData/Local/Temp/letscube-storage-heading-chromium-desktop-1440-light.png) |
| 390 dark | [Before](C:/Users/maksi/AppData/Local/Temp/letscube-storage-heading-before-chromium-mobile-390-dark.png) | [After](C:/Users/maksi/AppData/Local/Temp/letscube-storage-heading-narrow-chromium-mobile-390-dark.png) | [Normal](C:/Users/maksi/AppData/Local/Temp/letscube-storage-heading-chromium-mobile-390-dark.png) |
| 390 light | [Before](C:/Users/maksi/AppData/Local/Temp/letscube-storage-heading-before-chromium-mobile-390-light.png) | [After](C:/Users/maksi/AppData/Local/Temp/letscube-storage-heading-narrow-chromium-mobile-390-light.png) | [Normal](C:/Users/maksi/AppData/Local/Temp/letscube-storage-heading-chromium-mobile-390-light.png) |

## Limits

This is offline Chromium source/render evidence, not Windows WebView2, Android,
authenticated, production, deployment or general search acceptance. No Auth,
network, device, SDK, Git, signing or publication effects occurred. No broad
suite or unchanged historical tests were rerun. The coordinator owns integration,
actual application-bundle marker comparison and any release actions.
