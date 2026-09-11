import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveSupabaseConfig } from "../../artifacts/kub/src/lib/supabase/config.ts";
import {
  bundleSupabaseConfig,
  inspectLocalFrontendBundle,
} from "../../scripts/windows-tauri-frontend-bundle.mjs";

/**
 * The Windows QA gate's check on its own input.
 *
 * `artifacts/kub/dist/public` kept being rebuilt without the public
 * configuration, and the gate would run for minutes before failing on a login
 * form that was never drawn. These pin the refusal — for each way the bundle
 * can be unusable — and that it never repeats a value the bundle carries.
 */

const URL_VALUE = "https://backend.example.test";
const KEY_VALUE = "eyJhbGciOiJIUzI1NiJ9.fixture-payload-for-a-unit-test.fixture-signature-value";

function bundle({ env = {}, sourcesNewer = false, build = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "tauri-frontend-bundle-"));
  const source = path.join(root, "artifacts", "kub", "src", "main.tsx");
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(source, "export {};\n");
  const earlier = new Date(Date.now() - 120_000);
  const later = new Date(Date.now() - 1_000);
  utimesSync(source, sourcesNewer ? later : earlier, sourcesNewer ? later : earlier);
  if (build) {
    const publicRoot = path.join(root, "artifacts", "kub", "dist", "public");
    mkdirSync(path.join(publicRoot, "assets"), { recursive: true });
    const pairs = Object.entries(env).map(([name, value]) => `,${name}:${JSON.stringify(value)}`).join("");
    writeFileSync(
      path.join(publicRoot, "assets", "index-Fixture1.js"),
      `const e={BASE_URL:"/",DEV:!1,MODE:"production",PROD:!0,SSR:!1${pairs}};export{e as t};\n`,
    );
    const index = path.join(publicRoot, "index.html");
    writeFileSync(index, "<!doctype html><script type=module src=/assets/index-Fixture1.js></script>\n");
    utimesSync(index, sourcesNewer ? earlier : later, sourcesNewer ? earlier : later);
  }
  return root;
}

function inspect(options) {
  const root = bundle(options);
  try {
    return inspectLocalFrontendBundle(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertNothingEchoed(result) {
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /backend\.example\.test/, "the address must not be repeated");
  assert.doesNotMatch(text, /fixture-payload/, "the key must not be repeated");
}

test("a configured, current bundle is accepted", () => {
  assert.deepEqual(
    inspect({ env: { VITE_SUPABASE_URL: URL_VALUE, VITE_SUPABASE_ANON_KEY: KEY_VALUE } }),
    { ok: true },
  );
  assert.deepEqual(
    inspect({ env: { VITE_SUPABASE_URL: URL_VALUE, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture" } }),
    { ok: true },
    "the publishable key name is as good as the legacy one",
  );
});

test("a bundle that was never built is refused, and says so", () => {
  const result = inspect({ build: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing");
  assert.match(result.message, /has not been built/);
});

test("a bundle built without the configuration is refused, naming what is missing", () => {
  const none = inspect({ env: {} });
  assert.equal(none.reason, "unconfigured");
  assert.match(none.message, /VITE_SUPABASE_URL and a key/);
  assert.match(none.message, /Подключение к серверу не настроено/);

  const urlOnly = inspect({ env: { VITE_SUPABASE_URL: URL_VALUE } });
  assert.equal(urlOnly.reason, "unconfigured");
  assert.match(urlOnly.message, /without a key/);
  assertNothingEchoed(urlOnly);

  const keyOnly = inspect({ env: { VITE_SUPABASE_ANON_KEY: KEY_VALUE } });
  assert.equal(keyOnly.reason, "unconfigured");
  assert.match(keyOnly.message, /without VITE_SUPABASE_URL\b/);
  assertNothingEchoed(keyOnly);

  const empty = inspect({ env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" } });
  assert.equal(empty.reason, "unconfigured", "empty strings are how a deployment actually fails");
});

test("a bundle built against the loopback fixture is not a backend", () => {
  for (const address of ["http://127.0.0.1:54321", "https://localhost:54321", "http://backend.example.test", "not a url"]) {
    const result = inspect({ env: { VITE_SUPABASE_URL: address, VITE_SUPABASE_ANON_KEY: "playwright-public-fixture" } });
    assert.equal(result.reason, "not-a-backend", address);
    assertNothingEchoed(result);
  }
});

test("a bundle older than its sources is refused, naming the newer source", () => {
  const result = inspect({
    env: { VITE_SUPABASE_URL: URL_VALUE, VITE_SUPABASE_ANON_KEY: KEY_VALUE },
    sourcesNewer: true,
  });
  assert.equal(result.reason, "stale");
  assert.match(result.message, /older than artifacts\/kub\/src\/main\.tsx/);
  assertNothingEchoed(result);
});

test("the gate and the application agree on what configured means", () => {
  const cases = [
    {},
    { VITE_SUPABASE_URL: URL_VALUE },
    { VITE_SUPABASE_ANON_KEY: KEY_VALUE },
    { VITE_SUPABASE_PUBLISHABLE_KEY: KEY_VALUE },
    { VITE_SUPABASE_URL: URL_VALUE, VITE_SUPABASE_ANON_KEY: KEY_VALUE },
    { VITE_SUPABASE_URL: URL_VALUE, VITE_SUPABASE_PUBLISHABLE_KEY: KEY_VALUE },
    { VITE_SUPABASE_URL: URL_VALUE, VITE_SUPABASE_PUBLISHABLE_KEY: "", VITE_SUPABASE_ANON_KEY: KEY_VALUE },
    { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: KEY_VALUE },
    { VITE_SUPABASE_URL: URL_VALUE, VITE_SUPABASE_ANON_KEY: "" },
  ];
  for (const env of cases) {
    assert.deepEqual(bundleSupabaseConfig(env), resolveSupabaseConfig(env), JSON.stringify(Object.keys(env)));
  }
});
