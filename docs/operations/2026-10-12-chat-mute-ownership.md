# Chat Mute Ownership

Owner: coordinator. Stage: reviewed source repair; runtime integration pending.
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
