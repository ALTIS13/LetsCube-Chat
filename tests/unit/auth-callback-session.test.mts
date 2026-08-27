import assert from "node:assert/strict";
import test from "node:test";

import { establishAuthCallbackSession } from "../../artifacts/kub/src/lib/authCallback.ts";

const session = {
  access_token: "callback-access-token",
  refresh_token: "callback-refresh-token",
  expires_in: 3600,
  expires_at: 4_000_000_000,
  token_type: "bearer",
  user: { id: "callback-user" },
};

function createAuth({ exchangeEvent = "SIGNED_IN" } = {}) {
  const listeners = new Set<(event: string) => void>();
  const calls: Array<{ method: string; value?: unknown }> = [];

  return {
    calls,
    auth: {
      onAuthStateChange(listener: (event: string) => void) {
        listeners.add(listener);
        return {
          data: {
            subscription: {
              unsubscribe() {
                listeners.delete(listener);
              },
            },
          },
        };
      },
      async exchangeCodeForSession(code: string) {
        calls.push({ method: "exchangeCodeForSession", value: code });
        for (const listener of listeners) listener(exchangeEvent);
        return { data: { user: session.user, session }, error: null };
      },
      async setSession(tokens: { access_token: string; refresh_token: string }) {
        calls.push({ method: "setSession", value: tokens });
        return { data: { user: session.user, session }, error: null };
      },
    },
  };
}

test("auth callback rejects a recovery claim without callback credentials even when another session exists", async () => {
  const fixture = createAuth();

  const result = await establishAuthCallbackSession(
    fixture.auth,
    new URL("https://app.letscube.ru/auth/callback?type=recovery"),
  );

  assert.deepEqual(result, { kind: "invalid" });
  assert.deepEqual(fixture.calls, []);
});

test("auth callback establishes an implicit recovery session from its own token pair", async () => {
  const fixture = createAuth();

  const result = await establishAuthCallbackSession(
    fixture.auth,
    new URL(
      "https://app.letscube.ru/auth/callback#access_token=callback-access-token&refresh_token=callback-refresh-token&type=recovery",
    ),
  );

  assert.equal(result.kind, "recovery");
  assert.equal(result.session, session);
  assert.deepEqual(fixture.calls, [{
    method: "setSession",
    value: {
      access_token: "callback-access-token",
      refresh_token: "callback-refresh-token",
    },
  }]);
});

test("auth callback rejects an incomplete implicit token pair", async () => {
  const fixture = createAuth();

  const result = await establishAuthCallbackSession(
    fixture.auth,
    new URL("https://app.letscube.ru/auth/callback#access_token=callback-access-token&type=recovery"),
  );

  assert.deepEqual(result, { kind: "invalid" });
  assert.deepEqual(fixture.calls, []);
});

test("auth callback binds PKCE recovery mode to the exchange recovery event", async () => {
  const fixture = createAuth({ exchangeEvent: "PASSWORD_RECOVERY" });

  const result = await establishAuthCallbackSession(
    fixture.auth,
    new URL("https://app.letscube.ru/auth/callback?code=pkce-code"),
  );

  assert.equal(result.kind, "recovery");
  assert.equal(result.session, session);
  assert.deepEqual(fixture.calls, [{ method: "exchangeCodeForSession", value: "pkce-code" }]);
});

test("auth callback treats a non-recovery PKCE exchange as a normal session", async () => {
  const fixture = createAuth({ exchangeEvent: "SIGNED_IN" });

  const result = await establishAuthCallbackSession(
    fixture.auth,
    new URL("https://app.letscube.ru/auth/callback?code=confirmation-code"),
  );

  assert.equal(result.kind, "session");
  assert.equal(result.session, session);
});
