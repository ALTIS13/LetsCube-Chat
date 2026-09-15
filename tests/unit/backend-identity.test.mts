/**
 * Whether a signed-in spec may skip, decided from configuration rather than
 * from a failure.
 *
 * D-206 held two media specs as failures for two days because a fixture server
 * cannot sign a QA account in and the spec said so as «sign-in did not reach
 * the authenticated shell». The cure — skip where no account can exist — is one
 * mistake away from the worse fault: a suite that skips whenever signing in is
 * hard reports green having tested nothing. So both directions are pinned here,
 * and the third one that matters most: a probe that reads nothing means *run*.
 *
 * The preambles below are the real shape. Measured on 2026-09-15 against
 * `http://127.0.0.1:5211/src/lib/supabase/client.ts`, Vite v7.3.2 serves every
 * module with `import.meta.env = {…}` written in front of it, and that line is
 * the only place the configured URL appears literally — `client.ts` itself
 * merely reads `import.meta.env`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { readBackendIdentity, whyQaSignInIsImpossible } from "../e2e/helpers/backend-identity.ts";

/** What the dev server actually put in front of the module, with the URL swapped. */
const served = (env: Record<string, string>) =>
  `import.meta.env = ${JSON.stringify({ BASE_URL: "/", DEV: true, MODE: "development", PROD: false, SSR: false, ...env })};"use strict";\n` +
  'import { createClient as createSupabaseClient } from "/node_modules/.vite/deps/@supabase_supabase-js.js?v=46fa637f";\n' +
  'import { resolveSupabaseConfig } from "/src/lib/supabase/config.ts";\n';

const FIXTURE = served({ VITE_SUPABASE_ANON_KEY: "playwright-public-fixture", VITE_SUPABASE_URL: "http://127.0.0.1:54321" });
const REAL = served({ VITE_SUPABASE_ANON_KEY: "ey-not-a-key", VITE_SUPABASE_URL: "https://core.letscube.ru" });

test("a loopback backend is one no QA account exists in", () => {
  assert.deepEqual(readBackendIdentity(FIXTURE), { kind: "loopback", url: "http://127.0.0.1:54321" });
  const reason = whyQaSignInIsImpossible(readBackendIdentity(FIXTURE));
  assert.ok(reason?.includes("http://127.0.0.1:54321"), "the skip reason must name what it found");
  assert.ok(reason?.includes("KUB_BASE_URL"), "and what to do about it");

  // Every spelling of this machine, because the port is not the thing that
  // makes it a fixture and a second local stack would be no better.
  for (const url of ["http://localhost:54321", "http://127.0.0.1:8000", "http://[::1]:54321", "http://0.0.0.0:54321"]) {
    assert.equal(readBackendIdentity(served({ VITE_SUPABASE_URL: url })).kind, "loopback", url);
  }
});

test("a backend somewhere else is one to run against, so a failed sign-in stays a failure", () => {
  assert.deepEqual(readBackendIdentity(REAL), { kind: "remote", url: "https://core.letscube.ru" });
  assert.equal(whyQaSignInIsImpossible(readBackendIdentity(REAL)), null);

  // The mutation that would turn this helper into the fault it exists to
  // prevent: any non-loopback host runs, including one that will never answer.
  assert.equal(whyQaSignInIsImpossible(readBackendIdentity(served({ VITE_SUPABASE_URL: "https://supabase.invalid" }))), null);
});

test("a server configured against nothing cannot sign anyone in either", () => {
  for (const env of [{}, { VITE_SUPABASE_URL: "" }, { VITE_SUPABASE_URL: "   " }, { VITE_SUPABASE_URL: "not-a-url" }]) {
    const identity = readBackendIdentity(served(env));
    assert.equal(identity.kind, "unconfigured", JSON.stringify(env));
    assert.ok(whyQaSignInIsImpossible(identity)?.includes("configuration screen"));
  }
});

test("a body this cannot read means run, never skip", () => {
  // A production bundle, an SPA fallback answering every path with index.html,
  // an error page, an empty body from a refused request. None of them says the
  // backend is a fixture, and «I could not tell» must not become a licence to
  // skip — that is the failure mode the whole helper exists to avoid.
  for (const body of ["", "<!doctype html><html><body><div id=\"root\"></div></body></html>", "Cannot GET /src/lib/supabase/client.ts", "const x=1"]) {
    const identity = readBackendIdentity(body);
    assert.deepEqual(identity, { kind: "unknown" }, JSON.stringify(body.slice(0, 32)));
    assert.equal(whyQaSignInIsImpossible(identity), null, "an unreadable probe must run, not skip");
  }
});
