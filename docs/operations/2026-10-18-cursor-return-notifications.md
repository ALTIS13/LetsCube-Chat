# Cursor Return: Notification Release

Owner: Codex coordinator. Date: 2026-10-18. Stage: physical iPhone canary;
general preview flags remain OFF until acceptance. This record supersedes the
October 17 resource hold, not its historical evidence.

## Verified Baseline

- Canonical worktree: `C:/Users/maksi/.codex/worktrees/android-current-20261015/LetsCube-Chat`,
  branch `codex/topic-alerts-20261016`. The main checkout on D: was clean but
  stale at `c0b79cb0`; do not reset it or copy its source over the canonical tree.
- Cursor deployed the coordinated migration and the chat reopen/handshake fixes.
  Live web was `d61efd3a`, API `aed60557`; both notification runtimes were OFF.
  Cursor's fresh "wire" proves a SQL transaction/CAS, not a browser/Realtime
  transport or physical notification acceptance.
- The unpublished Android 0.1.22/build 23 candidate remains unpublished. Windows
  0.2.14 uses the remote renderer; its native package/signature is unchanged.

## Repairs And Evidence

- `7142e52f`: hidden joined reply previews and a changed clear boundary cannot
  use the warm first-frame shortcut. A held disconnect cannot reconnect after
  disposal; overlapping recovery is single-flight and rejections are handled.
  Five new failures and the clear-mark failure were reproduced before repair;
  coordinator's focused run passed 53 tests. Typecheck/build passed.
- `94d0ee8b`: subscription/admission/grant lock order, final admission expiry
  checks and safe rollback before/after the additive sidecar. DB suite 69/69;
  the actual upgrade is covered, not only the final proposal.
- Production PG17.6: fresh 6,631,321-byte custom backup, readable TOC and retained
  exact function metadata/rollback. New schema-only isolated PG17 container,
  network `none`, no production rows copied: migration COMMIT and exact narrow
  rollback both pass. Migration SHA-256
  `c64e4896379db891395a3a7c5c34f47f48276972af563bd425df2311c40bd745`
  was applied once; mirror matches, zero public tables without RLS, topic/Web
  flags remain false. Private operator records live under
  `.ops-private/web-preview-install-20261018/`; backup stays on the server.
- Physical rented iPhone 14 Pro Max/iOS 26.5: installed Home Screen PWA, owned QA
  account, system permission, one subscription admitted for 45 minutes. Initial
  preview confirmation fails despite a valid server grant. A true cold PWA
  restart makes confirmation succeed: the first SPA document has no controller.
  The fix uses only the exact registration's activated `/sw.js` fallback;
  Chromium/WebKit first-document regressions pass 22/22, adjacent checks 4/4.
- Background canary still showed the generic fallback and no new content-RPC
  call. The live Edge mounted sources match canonical and its start is after
  their write; stale runtime was not assumed or restarted speculatively.
- Current [Push API specification](https://www.w3.org/TR/push-api/#declarative-push-message)
  requires top-level `mutable: true` to dispatch a declarative push event, whose
  `data` is null and whose `notification.data` carries metadata. The old sender
  omitted mutable and the worker read only event.data. Both sides now preserve
  identifier-only routing/selection, never sender/body authority. The provider
  regression was RED, then GREEN; 63 worker/click/provider tests pass.
- Click handler now awaits focus, rechecks the exact live same-origin window,
  handles rejection/closure and serializes concurrent clicks without duplicate
  cold windows. These tests are not physical tap acceptance.

## Next / Release Gate

Compatibility follow-up: mutable delivery is gated on literal protocol `1`,
not on the existence of a preview grant. Only the new successful worker ACK
advertises this version; the page rechecks the exact browser descriptor and
persists it under owner/key filters. Old workers retain the original declarative
navigation/tag rather than swallowing a null-data event. New migration
`20261018021000_web_push_worker_protocol.sql` defaults all old subscriptions to
0 and resets on descriptor/owner/active changes. Its 20 DB tests pass; a fresh
6,637,546-byte backup and actual isolated PG17 apply/exact rollback precede its
production apply. Both general flags remain OFF. Client/worker/provider 111/111,
single/album dispatch 140/140 and first-document Chromium/WebKit 36/36 pass.
Final source typecheck passes; web build `a6232b5b92cc6b36`, built in 19.48s.

Review the final provider/worker pair, deploy verified web and then the exact
Edge helper with a retained previous file. On the rented Home Screen PWA verify
message/sender, exact tap, sender-only/none and logout; retire the finite
admission and release the phone. Record actual outcomes here before enabling
general Web previews. Topic overrides, real Realtime acceptance, Android
publication and the broader tracker remain separate unfinished stages.

No A063 access, personal captures, secret output, global Java/PATH changes or
legacy sender activation. Figma/Mobbin/Rive are available for visual work;
MobileNext and its existing cached CLI are available for paid physical iPhone
checks. Do not allocate another phone while this one is held.
