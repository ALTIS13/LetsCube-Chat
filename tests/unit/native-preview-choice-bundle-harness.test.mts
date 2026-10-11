import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script, createContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { calibrationSource, createAssetHandler, createBuildOptions, decodeBaselineHook,
  replaceSelectorBody, requireChoiceBuildPermission, requireChoiceOutput } from "../../scripts/qa-native-preview-choice-bundle.mts";

const selectorPath = new URL("../../artifacts/kub/src/lib/platform/nativeVoiceCalls.ts", import.meta.url);
const selectorSource = await readFile(selectorPath, "utf8");
test("selector substitution executes only the actual unprivileged selector body", () => {
  const source = replaceSelectorBody(selectorSource);
  const ast = ts.createSourceFile("selector.ts", source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "nativeMessagePreviewBindingSnapshot");
  assert.ok(fn && ts.isFunctionDeclaration(fn) && fn.body);
  const context = createContext({ controller: null, globalThis: { __qaChoiceFictionalPort: { selector: () => "fictional selector" } } });
  const code = ts.transpileModule(fn.getText(ast).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  new Script(code).runInContext(context);
  assert.equal(new Script("nativeMessagePreviewBindingSnapshot()").runInContext(context), "fictional selector");
  const original = ts.createSourceFile("original.ts", selectorSource, ts.ScriptTarget.Latest, true);
  const before = original.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "nativeMessagePreviewBindingSnapshot");
  assert.ok(before && ts.isFunctionDeclaration(before) && before.body);
  assert.equal(source.slice(0, fn.body.getStart(ast)), selectorSource.slice(0, before.body.getStart(original)));
  assert.equal(source.slice(fn.body.getEnd()), selectorSource.slice(before.body.getEnd()));
});
test("finite build options exclude both env files and inherited VITE config", () => {
  const options = createBuildOptions("D:/CodexProjects/LetsCube-Chat/.ops-private/fictional-unit-output/current-true", true);
  assert.equal(options.configFile, false);
  assert.equal(options.envDir, false);
  assert.deepEqual(options.envPrefix, []);
  assert.equal(options.mode, "production");
  assert.equal(options.base, "/");
  assert.equal(options.build.emptyOutDir, false);
  assert.equal(options.build.sourcemap, false);
  assert.equal(options.build.write, true);
  assert.equal(options.build.rollupOptions.preserveEntrySignatures, "strict");
  assert.equal(options.build.rollupOptions.input.calibration, "qa-choice-calibration");
  assert.deepEqual(options.resolve.dedupe, ["react", "react-dom"]);
  assert.equal("server" in options, false);
  assert.equal("preview" in options, false);
  const env = JSON.parse(options.define["import.meta.env"]);
  assert.deepEqual(env, { BASE_URL: "/", MODE: "production", DEV: false, PROD: true, SSR: false,
    VITE_SUPABASE_URL: "http://127.0.0.1:54321", VITE_SUPABASE_ANON_KEY: "playwright-public-fixture",
    VITE_SUPABASE_PUBLISHABLE_KEY: "playwright-public-fixture", VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE: "true" });
  assert.equal(options.define["import.meta.env.VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE"], '"true"');
  const webFalse = createBuildOptions("fictional-unit-output", false);
  assert.equal(JSON.parse(webFalse.define["import.meta.env"]).VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE, "false");
  assert.equal(webFalse.define["import.meta.env.VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE"], '"false"');
});
function routePort(url: string, method = "GET", redirected = false) {
  const fulfilled: any[] = [], aborted: string[] = [];
  return { fulfilled, aborted,
    request: () => ({ url: () => url, method: () => method, redirectedFrom: () => redirected ? {} : null }),
    fulfill: async (value: unknown) => { fulfilled.push(value); },
    abort: async (reason: string) => { aborted.push(reason); },
    fetch: () => { throw Error("NETWORK_FETCH_FORBIDDEN"); },
    continue: () => { throw Error("NETWORK_CONTINUE_FORBIDDEN"); },
  };
}
test("asset transport fulfills snapshotted bytes without a listening server", async () => {
  const body = Buffer.from("fictional compiled bytes");
  const assets = new Map([["/index.html", { body, contentType: "text/html" }]]);
  const handler = createAssetHandler(assets);
  body.fill(0); assets.clear();
  const route = routePort("http://127.0.0.1:54319/");
  await handler(route as any);
  assert.equal(route.aborted.length, 0);
  assert.equal(route.fulfilled[0].body.toString(), "fictional compiled bytes");
  assert.equal(route.fulfilled[0].status, 200);
  route.fulfilled[0].body.fill(0);
  const second = routePort("http://127.0.0.1:54319/index.html"); await handler(second as any);
  assert.equal(second.fulfilled[0].body.toString(), "fictional compiled bytes");
});
for (const [label, url, method, redirected] of [
  ["unknown", "http://127.0.0.1:54319/missing.js", "GET", false],
  ["foreign", "https://foreign.invalid/", "GET", false],
  ["unmatched localhost", "http://127.0.0.1:59999/", "GET", false],
  ["credential URL", "http://fictional:fictional@127.0.0.1:54319/", "GET", false],
  ["asset write", "http://127.0.0.1:54319/", "POST", false],
  ["redirect", "http://127.0.0.1:54319/", "GET", true],
  ["query", "http://127.0.0.1:54319/?retry=1", "GET", false],
  ["hash", "http://127.0.0.1:54319/#fragment", "GET", false],
  ["websocket", "ws://127.0.0.1:54319/", "GET", false],
  ["HEAD", "http://127.0.0.1:54319/", "HEAD", false],
  ["malformed", "not a URL", "GET", false],
  ["traversal normalization", "http://127.0.0.1:54319/assets/../", "GET", false],
] as const) test(`asset transport aborts ${label}`, async () => {
  const handler = createAssetHandler(new Map([["/index.html", { body: Buffer.from("fictional"), contentType: "text/html" }]]));
  const route = routePort(url, method, redirected); await handler(route as any);
  assert.deepEqual(route.aborted, ["blockedbyclient"]); assert.equal(route.fulfilled.length, 0);
});

test("selector substitution refuses missing, ambiguous, or changed function contracts", () => {
  for (const source of ["export function different() {}", "export function nativeMessagePreviewBindingSnapshot();",
    "export function nativeMessagePreviewBindingSnapshot() {}\nfunction nativeMessagePreviewBindingSnapshot() {}",
    "export function nativeMessagePreviewBindingSnapshot(input: string) {}",
    "export function nativeMessagePreviewBindingSnapshot() { return ( }"]) {
    assert.throws(() => replaceSelectorBody(source), /CHOICE_SELECTOR_SHAPE_REFUSED/);
  }
});
test("baseline byte pins refuse metadata changes and coherent replacement bytes", () => {
  const bytes = decodeBaselineHook();
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(bytes.length, 9117);
  assert.equal(hash, "6c3fce41a5175b7a6e63f09f13143e7204beb5b4eebc41d1c89a3c0bfd9e11e2");
  const mutant = Buffer.from(bytes); mutant[0] ^= 1;
  assert.throws(() => decodeBaselineHook(bytes.toString("base64"), 9118, hash), /CHOICE_BASELINE_PIN_REFUSED/);
  assert.throws(() => decodeBaselineHook(mutant.toString("base64"), 9117,
    createHash("sha256").update(mutant).digest("hex")), /CHOICE_BASELINE_PIN_REFUSED/);
  assert.throws(() => decodeBaselineHook(bytes.toString("base64"), 9117, "0".repeat(64)), /CHOICE_BASELINE_PIN_REFUSED/);
});
test("only exclusive variant outputs in the owned private parent are accepted", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  for (const variant of ["current-true", "current-false", "baseline-true"] as const) {
    const output = resolve(root, ".ops-private/task2-choice-bundle-20261010", variant);
    assert.equal(requireChoiceOutput(output, variant), output);
    assert.throws(() => requireChoiceOutput(resolve(root, "artifacts/kub/dist/public"), variant), /CHOICE_OUTPUT_REFUSED/);
    assert.throws(() => requireChoiceOutput(resolve(root, ".ops-private/task2-choice-bundle-20261010/other"), variant), /CHOICE_OUTPUT_REFUSED/);
    assert.throws(() => requireChoiceOutput(variant, variant), /CHOICE_OUTPUT_REFUSED/);
  }
  assert.throws(() => requireChoiceOutput(root, "current-web" as any), /CHOICE_VARIANT_REFUSED/);
  requireChoiceBuildPermission("0");
  for (const flag of [undefined, "1", "false", "", "00"]) assert.throws(() => requireChoiceBuildPermission(flag), /CHOICE_MUTATION_FLAG_REFUSED/);
});
test("transport refuses path aliases, executable MIME changes, and non-byte inputs", () => {
  for (const path of ["index.html", "/", "/assets/../index.html", "/assets//entry.js", "/%69ndex.html"]) {
    assert.throws(() => createAssetHandler(new Map([[path, { body: Buffer.from("fictional"), contentType: "text/html" }]])), /CHOICE_ASSET_PATH_REFUSED/);
  }
  assert.throws(() => createAssetHandler(new Map([["/index.html", { body: "not bytes" as any, contentType: "text/html" }]])), /CHOICE_ASSET_SHAPE_REFUSED/);
  assert.throws(() => createAssetHandler(new Map([["/index.html", { body: Buffer.alloc(0), contentType: "text/html\r\nLocation: https://foreign.invalid" }]])), /CHOICE_ASSET_SHAPE_REFUSED/);
});

const calibrationAst = ts.createSourceFile("calibration.ts", calibrationSource, ts.ScriptTarget.Latest, true);
test("readonly calibration entry imports the actual graph and no hook or writer", () => {
  const imports = calibrationAst.statements.filter(ts.isImportDeclaration).map(node => {
    assert.ok(ts.isStringLiteral(node.moduleSpecifier) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings));
    return [node.moduleSpecifier.text, node.importClause.namedBindings.elements.map(item => item.name.text)];
  });
  assert.deepEqual(imports, [
    ["@/lib/platform/nativeVoiceCalls", ["nativeMessagePreviewBindingSnapshot"]],
    ["@/lib/platform/nativeMessagePreviews", ["readNativeMessagePreviewCandidate", "nativeMessagePreviewQaChoiceBridge"]],
    ["@/store/app.store", ["useAppStore"]],
    ["@/lib/supabase/client", ["isSupabaseConfigured", "getSupabasePublicUrl", "getSupabasePublishableKey"]],
  ]);
  const calls: string[] = [];
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node)) calls.push(node.expression.getText(calibrationAst)); ts.forEachChild(node, visit); };
  visit(calibrationAst);
  assert.deepEqual(calls.sort(), ["Date.now", "Error", "Error", "getSupabasePublicUrl", "getSupabasePublishableKey", "isSupabaseConfigured",
    "nativeMessagePreviewBindingSnapshot", "nativeMessagePreviewQaChoiceBridge.getQaUserChoiceContext",
    "readNativeMessagePreviewCandidate", "useAppStore.getState"].sort());
  const exported = calibrationAst.statements.filter(ts.isFunctionDeclaration);
  assert.equal(exported.length, 1); assert.equal(exported[0].name?.text, "calibrate");
  assert.ok(exported[0].modifiers?.some(node => node.kind === ts.SyntaxKind.ExportKeyword));
});

// Unit logic only: these doubles do not claim a Vite/browser/native execution.
function calibrationUnitPort(reply: Record<string, unknown> | null, configured = true, protocol = 0) {
  const reads: string[] = [];
  const binding = { recipientId: "fictional-owner", recipientSessionId: "fictional-session", deviceId: "fictional-device" };
  const read = <T,>(name: string, value: T) => { reads.push(name); return value; };
  const adapters = { readNativeMessagePreviewCandidate: async () => read("candidate", { protocol }),
    nativeMessagePreviewQaChoiceBridge: { getQaUserChoiceContext: async (owner: unknown) => {
      assert.deepEqual(JSON.parse(JSON.stringify(owner)), { ...binding, accountEpoch: 4 }); return read("context", reply);
    } } };
  const modules: Record<string, unknown> = {
    "@/lib/platform/nativeVoiceCalls": { nativeMessagePreviewBindingSnapshot: () => read("selector", binding) },
    "@/lib/platform/nativeMessagePreviews": adapters,
    "@/store/app.store": { useAppStore: { getState: () => read("store", { accountEpoch: 4 }) } },
    "@/lib/supabase/client": { isSupabaseConfigured: () => configured,
      getSupabasePublicUrl: () => "http://127.0.0.1:54321", getSupabasePublishableKey: () => "playwright-public-fixture" },
  };
  const context = createContext({ exports: {}, Date: { now: () => 100 }, require: (id: string) => {
    assert.ok(Object.hasOwn(modules, id), "only known readonly unit ports"); return modules[id];
  } });
  const source = calibrationSource.replace("import.meta.env.VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE", '"true"');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Script(code).runInContext(context);
  return { reads, calibrate: () => new Script("exports.calibrate()").runInContext(context) };
}
const armed = { qa_choice_v: 1, purpose: "consent-only", recipientId: "fictional-owner",
  recipientSessionId: "fictional-session", deviceId: "fictional-device", accountEpoch: 4, expiresAt: 101 };
test("calibration unit logic classifies a matching protocol0 context without an action", async () => {
  const unit = calibrationUnitPort(armed), observed = await unit.calibrate();
  assert.deepEqual(JSON.parse(JSON.stringify(observed)), { protocol0: true, armedContext: true, fictionalConfig: true, webQa: true });
  assert.deepEqual(unit.reads, ["selector", "store", "candidate", "context"]);
});
test("calibration refuses nonfictional config before touching native/store ports", async () => {
  const unit = calibrationUnitPort(armed, false);
  await assert.rejects(unit.calibrate(), /CHOICE_FICTIONAL_CONFIG_REFUSED/);
  assert.deepEqual(unit.reads, []);
});
for (const [field, value] of [["qa_choice_v", 0], ["purpose", "display"], ["recipientId", "other-owner"],
  ["recipientSessionId", "other-session"], ["deviceId", "other-device"], ["accountEpoch", 5], ["expiresAt", 100]] as const) {
  test(`calibration refuses mismatched ${field}`, async () => {
    assert.equal((await calibrationUnitPort({ ...armed, [field]: value }).calibrate()).armedContext, false);
  });
}
test("calibration unit logic distinguishes ordinary closed context and protocol1", async () => {
  assert.equal((await calibrationUnitPort(null).calibrate()).armedContext, false);
  assert.equal((await calibrationUnitPort({ qa_choice_v: 0 }).calibrate()).armedContext, false);
  assert.equal((await calibrationUnitPort(armed, true, 1).calibrate()).protocol0, false);
});
test("module import remains inert; build is explicit and has no listener/browser orchestration", async () => {
  const source = await readFile(new URL("../../scripts/qa-native-preview-choice-bundle.mts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("harness.mts", source, ts.ScriptTarget.Latest, true);
  const imports = ast.statements.filter(ts.isImportDeclaration);
  assert.deepEqual(imports.filter(node => !(node.importClause?.isTypeOnly)).map(node => (node.moduleSpecifier as ts.StringLiteral).text), [
    "node:crypto", "node:fs/promises", "node:module", "node:path", "node:url", "typescript",
    "../tests/e2e/helpers/nativeMessagePreviewUserChoiceBaseline.ts",
  ]);
  assert.equal(ast.statements.filter(ts.isExpressionStatement).length, 0);
  assert.doesNotMatch(source, /createServer|\.listen\(|route\.fetch|route\.continue|route\.fallback|chromium|process\.argv|process\.env\.VITE_/);
  assert.match(source, /await mkdir\(outDir, \{ mode: 0o700 \}\)/);
  assert.doesNotMatch(source, /mkdir\([^\n]*recursive/);
});
