import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Script, createContext } from "node:vm";
import { inspect } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { expect } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const paths = {
  helper: "tests/e2e/helpers/nativeMessagePreviewUserChoiceFixture.ts",
  shared: "tests/e2e/helpers/messageActionsFixture.ts",
  settings: "tests/e2e/helpers/settingsColumnFixture.ts",
  baseline: "tests/e2e/helpers/nativeMessagePreviewUserChoiceBaseline.ts",
  config: "artifacts/kub/src/lib/supabase/config.ts",
  client: "artifacts/kub/src/lib/supabase/client.ts",
};
const sources = Object.fromEntries(Object.entries(paths).map(([name, path]) =>
  [name, readFileSync(resolve(root, path), "utf8")]));
const origin = "http://127.0.0.1:5187";
const fixtureEnv = {
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_ANON_KEY: "playwright-public-fixture",
  VITE_SUPABASE_PUBLISHABLE_KEY: "playwright-public-fixture",
};

function transpile(source, filename, module = ts.ModuleKind.CommonJS, transformers) {
  const result = ts.transpileModule(source, {
    fileName: filename, reportDiagnostics: true, transformers,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module, esModuleInterop: true },
  });
  assert.equal(result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length,
    0, "TRANSPILE_SETUP_MUST_SUCCEED");
  return result.outputText;
}

function harness(helperSource = sources.helper, flags = {}) {
  const cache = new Map();
  const dependencies = {
    "./messageActionsFixture": "shared", "./settingsColumnFixture": "settings",
    "./nativeMessagePreviewUserChoiceBaseline": "baseline",
    "../../../artifacts/kub/src/lib/supabase/config": "config",
  };
  const env = { KUB_QA_ALLOW_MUTATIONS: "0", KUB_QA_CHOICE_HOOK: "current", ...flags };
  function load(name) {
    if (cache.has(name)) return cache.get(name).exports;
    const module = { exports: {} };
    cache.set(name, module);
    // Test-private access to the actual initializer; never written into the frozen helper.
    const source = name === "helper"
      ? helperSource + "\nexport { fictionalNativePorts as __guardNativePorts };\n" : sources[name];
    const context = createContext({
      exports: module.exports, module, URL, Buffer, process: { env },
      require(id) {
        if (id === "typescript") return ts;
        if (id === "@playwright/test") return { expect };
        if (id === "node:crypto") return { createHash };
        if (dependencies[id]) return load(dependencies[id]);
        throw Error("UNOWNED_RUNTIME_IMPORT_REFUSED");
      },
    });
    new Script(transpile(source, paths[name]), { filename: paths[name] }).runInContext(context);
    return module.exports;
  }
  return { helper: load("helper"), config: load("config") };
}

function servedClient(env = fixtureEnv) {
  const rewriteConfigImport = context => {
    const visit = node => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
        && node.moduleSpecifier.text === "./config") {
        return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause,
          ts.factory.createStringLiteral("/src/lib/supabase/config.ts"), node.attributes);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return source => ts.visitEachChild(source, visit, context);
  };
  const code = transpile(sources.client, paths.client, ts.ModuleKind.ESNext,
    { before: [rewriteConfigImport] });
  // Model Vite's env injection only; all client statements come from actual source.
  return `import.meta.env = ${JSON.stringify(env)};\n${code}\n`
    + "// Decoy literals: http://127.0.0.1:54321 playwright-public-fixture\n";
}

function response(url, status, body = "") {
  return { url: () => url, status: () => status, text: async () => body };
}

function requestPort(code, redirectAt = 0) {
  const calls = [], foreign = [];
  return {
    calls, foreign,
    async get(url, options) {
      calls.push({ url, maxRedirects: options?.maxRedirects });
      if (calls.length === redirectAt) {
        if (options?.maxRedirects === 0) return response(url, 302);
        foreign.push("https://foreign.invalid/redirected-client");
        return response("https://foreign.invalid/redirected-client", 200, code);
      }
      return response(url, 200, code);
    },
  };
}

function pagePort() {
  const routes = [], sockets = [], scripts = [];
  return {
    routes, sockets, scripts,
    async route(matcher, handler) { routes.push({ matcher, handler }); },
    async routeWebSocket(matcher, handler) { sockets.push({ matcher, handler }); },
    async addInitScript(fn, args) { scripts.push({ fn, args }); },
  };
}

function routePort(url, redirect = false) {
  const calls = [], foreign = [], aborted = [], fulfilled = [];
  return {
    calls, foreign, aborted, fulfilled,
    request: () => ({ url: () => url, redirectedFrom: () => null }),
    async fetch(options) {
      calls.push({ maxRedirects: options?.maxRedirects });
      if (!redirect) return response(url, 200, "fictional local asset");
      if (options?.maxRedirects === 0) return response(url, 302);
      foreign.push("https://foreign.invalid/redirected-asset");
      return response("https://foreign.invalid/redirected-asset", 200);
    },
    async abort(reason) { aborted.push(reason); },
    async fulfill(value) { fulfilled.push(value); },
  };
}

async function outcome(action) {
  try { await action(); return null; }
  catch (error) { return error; }
}

async function validControl(runtime, env = fixtureEnv) {
  const selected = runtime.config.resolveSupabaseConfig(env);
  assert.equal(selected.url === "http://127.0.0.1:54321"
    && selected.key === "playwright-public-fixture" && selected.configured, true,
  "ACTUAL_RESOLVER_VALID_FIXTURE_CALIBRATION");
  const page = pagePort(), request = requestPort(servedClient(env));
  await runtime.helper.requireLocalChoiceFixture(page, request, origin + "/");
  assert.equal(request.calls.length, 2, "ACTUAL_SHARED_AND_OWN_GETS_REACHED");
  assert.equal(request.calls.every(call => call.url === "http://127.0.0.1:5187/src/lib/supabase/client.ts"), true);
  assert.equal(page.routes.length, 1, "ACTUAL_BROWSER_FALLBACK_REGISTERED");
  assert.equal(page.sockets.length, 1);
  return { page, request };
}

async function chosenConfigOracle(runtime, env, oracle) {
  const page = pagePort(), request = requestPort(servedClient(env));
  const error = await outcome(() => runtime.helper.requireLocalChoiceFixture(page, request, origin + "/"));
  assert.equal(error?.message === "FIXTURE_SELECTED_PUBLIC_CONFIG_REFUSED", true, oracle);
  assert.equal(page.routes.length, 0, "CONFIG_REFUSAL_PRECEDES_NAVIGATION_PORTS");
  assert.equal(inspect(error).includes("FICTIONAL_KEY_SENTINEL"), false, "CONFIG_REFUSAL_DOES_NOT_PRINT_KEY");
}

async function getRedirectOracle(runtime, redirectAt) {
  const page = pagePort(), request = requestPort(servedClient(), redirectAt);
  const error = await outcome(() => runtime.helper.requireLocalChoiceFixture(page, request, origin + "/"));
  assert.equal(Boolean(error), true, "GET_REDIRECT_REFUSED");
  assert.equal(request.foreign.length, 0, "GET_NO_FOREIGN_REDIRECT_REQUEST");
  assert.equal(request.calls.length, redirectAt, "GET_REFUSAL_STOPS_NEXT_GET");
  assert.equal(request.calls.every(call => call.maxRedirects === 0), true, "GET_ALL_MAX_REDIRECTS_LITERAL_ZERO");
  assert.equal(page.routes.length, 0);
}

async function browserRedirectOracle(runtime) {
  const { page } = await validControl(runtime);
  const route = routePort("http://127.0.0.1:5187/index.html", true);
  const error = await outcome(() => page.routes[0].handler(route));
  assert.equal(error?.message === "FIXTURE_BROWSER_REDIRECT_REFUSED", true, "BROWSER_REDIRECT_REFUSED");
  assert.equal(route.foreign.length, 0, "BROWSER_NO_FOREIGN_REDIRECT_REQUEST");
  assert.equal(route.calls[0].maxRedirects, 0, "BROWSER_MAX_REDIRECTS_LITERAL_ZERO");
  assert.equal(route.fulfilled.length, 0);
}

async function selectorRedirectOracle(runtime) {
  const { page } = await validControl(runtime);
  await runtime.helper.__guardNativePorts(page, true);
  const url = new URL("http://127.0.0.1:5187/src/lib/platform/nativeVoiceCalls.ts");
  const registration = page.routes.find(item => typeof item.matcher === "function" && item.matcher(url));
  assert.equal(Boolean(registration), true, "ACTUAL_SELECTOR_ROUTE_SETUP");
  const route = routePort(url.href, true);
  const error = await outcome(() => registration.handler(route));
  assert.equal(error?.message === "FIXTURE_SELECTOR_RESPONSE_REFUSED", true, "SELECTOR_REDIRECT_REFUSED");
  assert.equal(route.foreign.length, 0, "SELECTOR_NO_FOREIGN_REDIRECT_REQUEST");
  assert.equal(route.calls[0].maxRedirects, 0, "SELECTOR_MAX_REDIRECTS_LITERAL_ZERO");
  assert.equal(route.fulfilled.length, 0);
}

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, "MUTATION_TARGET_EXACTLY_ONCE");
  return source.replace(before, after);
}

async function killedMutant(t, source, oracle, action) {
  const runtime = harness(source);
  // A successful transpile/module load and valid control are required before counting a kill.
  await validControl(runtime);
  await assert.rejects(() => action(runtime), error => error?.code === "ERR_ASSERTION"
    && error.message.includes(oracle), "MUTANT_MUST_FAIL_NAMED_RUNTIME_ORACLE_NOT_SETUP");
  t.diagnostic(`TRANSPILED_MUTANT_KILLED:${oracle}`);
}

test("control: actual served client accepts exact preferred fixture config", async () => {
  const { request } = await validControl(harness());
  assert.equal(request.calls.every(call => call.maxRedirects === 0), true);
});

test("control: actual resolver accepts fixture anon when publishable is absent", async () => {
  await validControl(harness(), {
    VITE_SUPABASE_URL: "http://127.0.0.1:54321", VITE_SUPABASE_ANON_KEY: "playwright-public-fixture",
  });
});

test("boundary: preferred publishable override refuses despite fixture substrings", async () => {
  await chosenConfigOracle(harness(), { ...fixtureEnv, VITE_SUPABASE_PUBLISHABLE_KEY: "FICTIONAL_KEY_SENTINEL" },
    "SELECTED_PUBLISHABLE_OVERRIDE_REFUSED");
});

test("boundary: selected wrong URL refuses despite fixture comment", async () => {
  await chosenConfigOracle(harness(), { ...fixtureEnv, VITE_SUPABASE_URL: "https://foreign.invalid" },
    "SELECTED_WRONG_URL_REFUSED");
});

for (const redirectAt of [1, 2]) {
  test(`boundary: GET ${redirectAt} refuses redirect without foreign request`, async () => {
    await getRedirectOracle(harness(), redirectAt);
  });
}

test("control: browser fallback fulfills local nonredirect response with literal zero redirects", async () => {
  const { page } = await validControl(harness());
  const route = routePort("http://127.0.0.1:5187/index.html");
  await page.routes[0].handler(route);
  assert.equal(route.calls[0].maxRedirects, 0);
  assert.equal(route.fulfilled.length, 1);
  assert.equal(route.aborted.length, 0);
});

test("boundary: browser fallback refuses redirect without foreign request", async () => {
  await browserRedirectOracle(harness());
});

for (const [name, url] of [
  ["foreign", "https://foreign.invalid/unmatched"],
  ["unmatched-backend", "http://127.0.0.1:54321/rest/v1/unmatched"],
]) {
  test(`boundary: browser fallback aborts ${name} before fetch`, async () => {
    const { page } = await validControl(harness());
    const route = routePort(url);
    await page.routes[0].handler(route);
    assert.equal(route.aborted.length, 1);
    assert.equal(route.aborted[0], "blockedbyclient");
    assert.equal(route.calls.length, 0, "REFUSED_ORIGIN_NEVER_FETCHED");
    assert.equal(route.fulfilled.length, 0);
  });
}

for (const [name, url, code] of [
  ["userinfo", "http://FICTIONAL_URL_SENTINEL:FICTIONAL_URL_SENTINEL@127.0.0.1:5187/", "FIXTURE_ORIGIN_REFUSED"],
  ["query", "http://127.0.0.1:5187/?FICTIONAL_URL_SENTINEL", "FIXTURE_ORIGIN_REFUSED"],
  ["hash", "http://127.0.0.1:5187/#FICTIONAL_URL_SENTINEL", "FIXTURE_ORIGIN_REFUSED"],
  ["invalid", "FICTIONAL_URL_SENTINEL", "FIXTURE_ORIGIN_PARSE_REFUSED"],
  ["non-http", "https://127.0.0.1:5187/", "FIXTURE_ORIGIN_REFUSED"],
  ["foreign-host", "http://foreign.invalid/", "FIXTURE_ORIGIN_REFUSED"],
  ["non-root", "http://127.0.0.1:5187/other", "FIXTURE_ORIGIN_REFUSED"],
]) {
  test(`boundary: initial ${name} URL fails fixed-code without sentinel diagnostics`, async () => {
    const runtime = harness(), page = pagePort(), request = requestPort(servedClient());
    const error = await outcome(() => runtime.helper.requireLocalChoiceFixture(page, request, url));
    assert.equal(error?.message === code, true, "INITIAL_URL_FIXED_REFUSAL_CODE");
    assert.equal(inspect(error).includes("FICTIONAL_URL_SENTINEL"), false, "URL_REFUSAL_DIAGNOSTICS_ARE_SECRET_FREE");
    assert.equal(request.calls.length, 0);
    assert.equal(page.routes.length, 0);
  });
}

test("boundary: mutation flag refusal emits no actual env value and performs no GET", async () => {
  const runtime = harness(sources.helper, { KUB_QA_ALLOW_MUTATIONS: "FICTIONAL_ENV_SENTINEL" });
  const request = requestPort(servedClient());
  const error = await outcome(() => runtime.helper.requireLocalChoiceFixture(pagePort(), request, origin + "/"));
  assert.equal(error?.message === "FIXTURE_MUTATION_FLAG_REFUSED", true);
  assert.equal(inspect(error).includes("FICTIONAL_ENV_SENTINEL"), false);
  assert.equal(request.calls.length, 0);
});

test("boundary: actual fictional initializer permits exact retire once after literal expiry", async () => {
  const runtime = harness(), { page } = await validControl(runtime);
  await runtime.helper.__guardNativePorts(page, true);
  assert.equal(page.scripts.length, 1, "ACTUAL_INITIALIZER_SETUP");
  let now = 10_000;
  class FixtureDate extends Date { static now() { return now; } }
  class FictionalStorage { setItem() {} }
  const context = createContext({ window: {}, Date: FixtureDate, Storage: FictionalStorage,
    btoa: text => Buffer.from(text, "binary").toString("base64") });
  const { fn, args } = page.scripts[0];
  new Script(`(${fn.toString()})(${JSON.stringify(args)})`).runInContext(context);
  const invoke = (method, input) => context.window.Capacitor.nativePromise("MessagePreviews", method, input);
  assert.equal((await invoke("getCapabilities")).protocol, 0);
  const owner = { recipientId: "11111111-1111-4111-8111-000000000001",
    recipientSessionId: "22222222-2222-4222-8222-000000000001",
    deviceId: "33333333-3333-4333-8333-000000000001", accountEpoch: 7 };
  const admitted = await invoke("getQaUserChoiceContext", owner);
  assert.equal(admitted.qa_choice_v, 1);
  assert.equal(admitted.expiresAt, 130_000);
  const id = "44444444-4444-4444-8444-000000000001";
  assert.equal((await invoke("beginQaUserChoice", { contextId: id, revision: 1 })).applied, true);
  assert.equal((await invoke("confirmQaUserChoice", { contextId: id, revision: 1, choice: "sender" })).applied, true);
  now = 129_999;
  assert.equal((await invoke("getQaUserChoiceContext", owner)).qa_choice_v, 1);
  now = 130_000;
  assert.equal((await invoke("getQaUserChoiceContext", owner)).qa_choice_v, 0);
  assert.equal((await invoke("beginQaUserChoice", { contextId: id, revision: 2 })).applied, false);
  assert.equal((await invoke("confirmQaUserChoice", { contextId: id, revision: 1, choice: "message" })).applied, false);
  assert.equal((await invoke("retireQaUserChoice", { contextId: "55555555-5555-4555-8555-000000000001",
    expectedIntentRevision: 1, revision: 2 })).applied, false);
  assert.equal((await invoke("retireQaUserChoice", { contextId: id, expectedIntentRevision: 0, revision: 2 })).applied, false);
  assert.equal((await invoke("retireQaUserChoice", { contextId: id, expectedIntentRevision: 1, revision: 2 })).applied,
    true, "EXACT_RETIRE_ACK_AT_LITERAL_130000");
  assert.equal((await invoke("retireQaUserChoice", { contextId: id, expectedIntentRevision: 2, revision: 3 })).applied, false);
  const snapshot = context.window.__qaChoiceFictionalPort.snapshot();
  assert.equal(snapshot.retireAcks, 1, "EXACT_RETIRE_ACK_ONCE");
  assert.equal(snapshot.confirmed, "none");
  assert.equal(snapshot.pending, null);
});

test("boundary: selector interceptor refuses redirect without foreign request", async () => {
  await selectorRedirectOracle(harness());
});

test("mutant: omit selected-key check killed by preferred-override runtime oracle", async t => {
  const mutant = replaceOnce(sources.helper, ' || selected.key !== "playwright-public-fixture"', "");
  await killedMutant(t, mutant, "SELECTED_PUBLISHABLE_OVERRIDE_REFUSED", runtime => chosenConfigOracle(runtime,
    { ...fixtureEnv, VITE_SUPABASE_PUBLISHABLE_KEY: "FICTIONAL_KEY_SENTINEL" }, "SELECTED_PUBLISHABLE_OVERRIDE_REFUSED"));
});

test("mutant: omit GET maxRedirects killed by no-foreign runtime oracle", async t => {
  const mutant = replaceOnce(sources.helper, "{ ...options, maxRedirects: 0 }", "{ ...options }");
  await killedMutant(t, mutant, "GET_NO_FOREIGN_REDIRECT_REQUEST", runtime => getRedirectOracle(runtime, 1));
});

test("mutant: omit fallback maxRedirects killed by no-foreign runtime oracle", async t => {
  const mutant = replaceOnce(sources.helper,
    "route.fetch({ maxRedirects: 0 });\n    if ((response.status() >= 300",
    "route.fetch();\n    if ((response.status() >= 300");
  await killedMutant(t, mutant, "BROWSER_NO_FOREIGN_REDIRECT_REQUEST", browserRedirectOracle);
});

test("mutant: omit selector maxRedirects killed by no-foreign runtime oracle", async t => {
  const mutant = replaceOnce(sources.helper,
    "route.fetch({ maxRedirects: 0 });\n    if (response.status() !== 200",
    "route.fetch();\n    if (response.status() !== 200");
  await killedMutant(t, mutant, "SELECTOR_NO_FOREIGN_REDIRECT_REQUEST", selectorRedirectOracle);
});

test.after(() => {
  for (const [name, path] of Object.entries(paths)) {
    const current = readFileSync(resolve(root, path), "utf8");
    assert.equal(createHash("sha256").update(current).digest("hex"),
      createHash("sha256").update(sources[name]).digest("hex"), "READ_ONLY_SOURCE_PRESERVED");
  }
});
