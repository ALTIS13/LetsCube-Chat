# Foreground task access and album media: web release

2026-11-06. Shared web only. `c8ffc5a7` makes the task list recheck RLS on
foreground/network recovery; `a4b35a79` separates variant results by request
and signing generation, fixes path-only posters and restores horizontal album
swipes on video. No database, push, bucket, media mode or API policy change.

- [Tasks](2026-11-06-task9-list-foreground.md): reproduced missing reads;
  66/66 affected checks and compiled negative control passed.
- [Mixed media](2026-11-06-task3-mixed-album-viewer.md): mounted pointer and
  metadata cases passed; held/settled old-owner and old-batch results no
  longer request signatures. Chromium and Windows WebKit are browser
  coverage, not native mobile mixed-album acceptance.
- Exact local typecheck and production-mode Vite build passed (SW
  `07e788e3aafd2a53`, 19.48 seconds, fictional public config). Reviewed both
  outgoing commits and resolved 29 alias imports in their source trees,
  including the test's separately configured embedded esbuild alias.
- Baseline sole healthy `ffe94b68` / `e089577ff7c2b290` lacked all three
  markers. At `2026-11-06T00:56:31Z`, sole healthy release was
  `a4b35a79279abd86188b53d0e629455c41d86db4`, SW `fe8b16ae0f163042`.
  Public/container HTML, JS and SW hashes matched, all three markers were
  present and the previous image remained available for rollback.

[Android51](2026-11-06-android51-candidate.md) embeds this and the preceding
web deltas and is installed on Realme for testing. Not published. Android
Stable50 and installed iPhone role/card acceptance are separate.
