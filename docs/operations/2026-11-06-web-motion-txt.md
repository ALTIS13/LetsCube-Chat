# Mobile search and TXT renewal: shared web release

2026-11-06 MSK. Scope: search tuck/untuck geometry and scroll anchor, plus
recovery of the open TXT preview when a new file URL succeeds. No database,
provider, storage mode, bucket, or Android catalog change.

- Source: `a494571c` search motion, `1679cdc7` TXT preview, `9eb97344` test-only
  mobile WebKit overflow fallback. The range also carries `15af3672`, the
  already-published Android Stable50 metadata. All four outgoing commits
  reviewed; 56 alias imports resolved in the trees that introduced them.
- Search: [physical Realme WebView](2026-11-06-task8-search-motion.md) measured
  the maximum geometry step 44 -> 14 px and exact final scroll 160 px. 45
  focused tests plus real Chromium 1440/390 and mobile WebKit 390 for reduced
  motion/focus/overflow passed. The initial mobile WebKit failure was the
  unsupported mouse-wheel API; its pass exercises DOM scrolling, not a gesture.
- TXT: [browser proof](2026-11-06-task5-d208-signed-only-compatibility.md)
  covers renewed URL after refusal, same-viewer recovery, retained filename and
  bytes, and late canceled success/error. Four targeted tests rerun on the
  exact delivery worktree; adjacent mode tests and three mutants pass as
  recorded there. This fix does not switch the client to signed-only mode.
- Exact scoped typecheck and production-mode compilation passed. Local build
  `b25873b02eabb151`, Vite 17.87s. Public previous image `2e1c3afc` lacked both
  code markers. At 23:04:12Z, sole healthy deployed image was exactly
  `9eb97344bda3bf2a6e9488e4240608a42479c1d9`, build `a1aa8b14f8770bc3`.
  Public/container HTML, entry JS and SW hashes matched, both markers were
  present and the previous image was retained.

Android Stable remains `0.1.49` / 50 with the earlier fixes. These new web
changes are not proof of an installed Android build, iPhone gesture parity,
or signed-only Storage cutover.
