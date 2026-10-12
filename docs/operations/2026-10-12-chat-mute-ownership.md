# Chat Mute Ownership

Owner: coordinator. Stage: narrow main/runtime `c2e1397e` accepted at01:48 UTC.
This closes demonstrated chat-mute races, not tracker item77's channel/topic
override feature. No SQL, permissions, delivery provider or layout change.

## Cause And Repair

The shared read latch identified only the account ID. An old request could
block another account's read or publish after same-account session replacement.
Optimistic writes could roll back to another unconfirmed draft, and a stale
server read could replace an acknowledged choice. A pending draft could also
enter the persistent cache when a different chat's write completed.

Reads now capture account ID, account epoch and per-chat revisions. Retired
replies/finalizers cannot modify replacement ownership. Changed/pending chats
retain their local projection; unrelated fresh rows still merge. Writes for
the same account/chat serialize in this JS document and rollback only to the
last confirmed choice. The cache is written only without pending drafts.
Account retirement clears the displayed projection synchronously. Logs retain
fixed labels rather than raw backend error details.

Independent review exposed two more entrances: retained menu callbacks could
write as the new account, and an old queued effect could erase its pending
draft before reaching the late read guard. The hook and ChatList now check
captured ID/epoch before dispatch; the effect does so before sync/cache work,
including a captured null account. ChatList rechecks before post-await feedback.
No JSX, CSS, control dimensions or user-visible wording changed.

## Focused Evidence

- Initial actual compiled hook/store regression: 2 PASS/10 FAIL.
- First repaired affected gate:20/20, including seven compiled omissions.
- Independent review: actual fictional hook/store callbacks and deferred
  effects reproduce two P2 findings. The first React-port setup failure was
  not product RED: useCallback must return its function, not execute it.
- Corrected existing port plus actual ChatList applyMute selected from its
  TSX AST: seven new literal regressions fail before the follow-up.
- Final affected file:29/29, zero skips. New compiled omissions cover both
  owner fields, effect admission and ChatList pre/post-await admission.
- Adjacent existing chat-mute and auth/session ownership contracts:82/82.
  These precede the retained-callback follow-up and are reused only for their
  unchanged boundaries, not its new regressions.

The harness compiles the full actual hook/store and uses installed Zustand.
External lifecycle/storage/Supabase ports are fictional; no real account,
network mutation, mounted-device or remote cancellation proof is claimed.
Already-issued requests may finish remotely. Ordering is per JS document,
not a cross-device transaction or cancellation guarantee.

Final source hashes:

```text
useChatMute.ts e90732d0774b75484f301b63eec98b14c6aec787929c195d9d2780c63f32005a
ChatList.tsx 7ae3c62bba4b8db03a57fd9621c69b431a124e71dfabc5c8429daba926ac4eaf
app.store.ts 8d61357e1429fcd486dac2b1761479392499b9edd8621defae4e69eea86ee80d
chat-mute-ownership.test.mjs 2dfa1c56a5f7ebebf853dd4dcc4d2a092e610498f1216528ae3727af326bb207
```

Private author/review reports remain ignored. Narrow main integration must
preserve the unrelated sidebar/search work and private Android version overlay.
Android's existing private build20 predates this fix; it is not native bundle
parity for it. Windows loads the deployed web application, but its native
notification/device acceptance is not implied by this frontend repair.

## Actual Integration And Rollout

Feature `25aafbf5` is cherry-picked as main `c2e1397e99c6ae514fec06a7013ad6ee5dd16858`.
Exactly five paths enter main. All four source/test hashes match the reviewed
inputs;47 aliases resolve in their own commit tree. Main keeps only its existing
private Android version overlay dirty; unowned sidebar/search paths are excluded.
Typecheck `624b37`/`7f2016` exits0. Actual Vite `e6e8c6`/`0f41fa` exits0 with
`sw.js build cfc7ed93ace400a7` and25.49s. Existing sourcemap, mixed-import and
large-chunk warnings remain; no build-warning repair is claimed.

One bounded compiled marker checks the exact read-owner helper/getter and the
per-chat revision Map consumer, not every mute callback or remote ordering.
Its first source-only calibration passes4/4 but the actual bundle refuses
`2d76b5`: minifier frequency allocation changes local identifier names. The
equivalence repair uses lexical AST binding ordinals, keeping literal fields,
free globals and resolved helper/getter exact. Actual affected calibration1/1,
exact omission and revision-to-draft controls pass; compiled `0f0ffb` accepts.
Original refusal is retained, not a product failure or an earlier actual PASS.

Runtime before `27af1f` at01:30 UTC matches accepted `d252b4a5`. Push `e6bdb6`
starts Coolify deployment `obqfyr46ws84hx1yyropevx5`; its queue status is not the
acceptance proof. Actual after `21ed44`,01:48:01 UTC, accepts the sole healthy
`c2e1397e` image, read-owner marker old1/new0 -> old0/new1, and all five prior
hidden-history/notification/send-epoch/voice/Storage consumers unchanged0/1.
Public/container JS and SW digests match. Previous entry and image are retained.

```text
entry /assets/index-CX3KnNFa.js
JS SHA256 d25a1b7d292a1adcedcdecbb47d955860a6fd37edc67e3b96e1589f284587b7c
SW SHA256 b63b84f47ef29041e2c600a9139511e526e04072e19cdffe995f98170541843c
image sha256:7abacc1ab1dfd9adbf110eaf3994168ad495707a65e20423bac531cd08e3c6bf
```

Anonymous smoke `6b817b`,01:48:23 UTC, mounts `/` and follows the actual login
link using that entry:0 page errors/0 mutation requests. No personal session,
screenshots, trace, video or download. This is boot/routing proof, not a live
account mute write or independently mounted ownership-race test. Local and
production bundle hashes differ by their existing configuration domains.

No DB or native release changed. Item77 still needs persisted topic overrides,
canonical trusted enqueue/pre-send eligibility and cross-device alignment.
