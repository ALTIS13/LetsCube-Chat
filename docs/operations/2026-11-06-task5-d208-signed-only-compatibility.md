# Task 5 / D-208: Signed-Only FILE Compatibility

Owner: Codex, LETSCUBE stream 5. 2026-11-06 MSK. Stage: bounded TXT recovery
fix verified locally against checkout baseline `2e1c3afc`; not deployed.
Next: coordinator reviews and rolls out the scoped web slice separately.

## Pre-Fix Artifact Modes

| Observed artifact | Effective mode | Metadata |
| --- | --- | --- |
| Deployed HTTPS web | `signed` (public fallback allowed) | `/assets/index-BZzoz04D.js`, SW `7004fda17e293691`, entry SHA-256 `77dee9b424395f6dab10ab9445cbe10d82e801600efe8f5ec658d35531fde064` |
| Retained Android candidate `0.1.48`/49 (`923d7cb1`) | `public` (no signing) | APK SHA-256 `bd5df2d7b311a3054f0b83948e2a5aa869c41fce268d0ab8dd647311ae2ad0a5`, `assets/public/assets/index-DJeQigoH.js`, SW `e3d28d68f8d995ab`, entry SHA-256 `37ca92c1684f97433086e1735cc3208e587401f9c6380dd45a8628c7f311915f` |

The web entry was read from the served HTML; the Android entry from the retained
APK without starting a device. In each compiled entry the probe resolved the
unique mode resolver call to its build environment object. Web passes the literal
`signed`; the APK's object has no flag, so the compiled resolver falls back to
`public`. A `signed-only` string in the resolver is not evidence that the build
uses that mode. The probe emitted only mode, asset identity and hashes, no
configuration dump, keys, signed URLs or account metadata. This is proof of the
served web and that APK's bytes, not an inventory of installed versions.

## TXT Recovery Fix

The [prior D-208 matrix](2026-10-01-signed-media-consumers.md) covers successful
FILE preview/save and signing refusal. This test opens a TXT file with the real
`MessageBubble`/`FileMessageRow` under `signed-only`, then renews its address
while the viewer remains open after a **GET refusal**, not a sign refusal.
Chromium uses the actual signing store, SDK request and viewer/save callbacks;
all Auth/Storage inputs are fictional and every network request is intercepted.
The durable byte cache has no partition, so this exercises the uncached HTTP
path, not an authenticated IndexedDB cache or production FILE consumer.

- Positive control: `200` on signature A and `200` on renewed B; the same viewer
  stays open, shows the text and saves the exact bytes and filename via B.
- Recovery case: A's GET returns `400` and the viewer displays the error. At the
  virtual 48-minute foreground check, B is signed and returns `200`. The same
  mounted viewer now replaces the error with the decoded text and downloads
  the exact bytes with the original filename.
- Stale read cases hold A after the browser decodes its body. B aborts A and
  renders new text. Releasing A with distinct old bytes or a rejection cannot
  replace B's text or restore the error. All four cases check no early re-sign
  at 47:59.999, zero public fallback, zero external network requests and zero
  unhandled browser errors.
- [The TXT viewer](../../artifacts/kub/src/components/chat/FileMessageRow.tsx#L210)
  now stores text or failure as mutually exclusive outcomes. Only the
  non-aborted read can publish either outcome. Renewal does not reset a prior
  view to a spinner while the replacement is pending. Other previews and the
  save callback are unchanged.

## Verification

[Browser regression](../../tests/unit/task5-d208-signed-only-file-renewal.test.mts):
`node --test tests/unit/task5-d208-signed-only-file-renewal.test.mts`, with
`KUB_QA_ALLOW_MUTATIONS=0`. Before the source patch: **2 pass / 2 fail**, on the
missing text after B and the actual stale-text overwrite after A settles.
After the patch: **4 pass / 0 fail / 0 skip**; recovery is unconditional. The old
diagnostic/positive-control toggles are removed. Each in-memory negative control
under `LETSCUBE_D208_FILE_MUTANT` (`sticky-error`, `late-success`, `late-error`)
was run against its named case and failed on the expected rendering assertion.

| Existing checks | Result |
| --- | --- |
| Document preview, mode, source, object references and signed URL store | 53/53 unit tests; workspace web typecheck passed |
| `public`: FILE TXT/PDF/archive and URL resolver, Chromium 1440/390 | 12/12 |
| `signed`: FILE TXT/PDF/archive, legacy URL and public fallback, Chromium 1440 | 5/5 |
| `signed-only`: mounted FILE refusals and unchanged-history control, both themes, Chromium 1440/390 | 16/16 |

The existing browser checks ran on loopback with Vite environment-file loading
disabled and a fictional backend. The pinned Windows esbuild binary was reused
from the pnpm cache with SHA-512 verification; temporary compiler, Vite and test
output were removed. No dependencies installed.

## Cutover Conditions

1. Local TXT gate passed without a control. The [separate web release](2026-11-06-web-motion-txt.md)
   verified the fix in the served bundle. It did not change the media mode,
   bucket or installed Android artifact.
2. Make the intended `signed-only` mode explicit in the approved web and Android
   builds, and verify the resolver call in each served/packaged artifact. Do not
   make the bucket private while a supported APK still uses `public` or the web
   still relies on the `signed` fallback. Define which older builds must upgrade
   or remain supported before the switch.
3. Before a separately authorized bucket change, finish real non-author FILE
   preview/save and chat-avatar coverage, signed renewal/seek on the deployed
   client, and installed Android upgrade compatibility. Reuse existing positive
   controls. Require a tested rollback restoring old-client reads and exact
   member/outsider checks on the intended private posture.

The [real Storage revoke evidence](2026-11-06-task5-source-storage-revoke.md)
already showed fresh signing denied while public bytes still read `200`.
That cohort was not repeated. No new device session, bucket/config change,
migration, push or deploy. D-208 remains open.
