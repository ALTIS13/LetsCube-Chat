import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script, createContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { BASELINE_HOOK_BASE64, BASELINE_HOOK_BYTES, BASELINE_HOOK_SHA256 } from "../e2e/helpers/nativeMessagePreviewUserChoiceBaseline.ts";

const source = await readFile(new URL("../../scripts/qa-native-preview-choice-bundle.mts", import.meta.url), "utf8");
const root = fileURLToPath(new URL("../../", import.meta.url));
const dependencies = { assert, ts, Buffer, URL, resolve, isAbsolute, root,
  app: resolve(root, "artifacts/kub"), bundleRoot: resolve(root, ".ops-private/task2-choice-bundle-20261010"),
  CHOICE_BUNDLE_ORIGIN: "http://127.0.0.1:54319", contentTypes: { ".html": "text/html" },
  BASELINE_HOOK_BASE64, BASELINE_HOOK_BYTES, BASELINE_HOOK_SHA256,
  sha256: (value: Buffer) => createHash("sha256").update(value).digest("hex") };
function declaration(name: string) {
  const ast = ts.createSourceFile("actual-builder.mts", source, ts.ScriptTarget.Latest, true);
  const nodes = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(nodes.length, 1); return nodes[0].getText(ast).replace(/^export /, "");
}
function load(name: string, text = declaration(name), helpers: string[] = []) {
  const compiled = ts.transpileModule([...helpers.map(declaration), text].join("\n"), {
    reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  });
  assert.equal(compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  const context = createContext(dependencies);
  new Script(compiled.outputText).runInContext(context);
  return new Script(name).runInContext(context);
}
function omitGuard(name: string, marker: string) {
  const original = declaration(name), ast = ts.createSourceFile("function.ts", original, ts.ScriptTarget.Latest, true);
  const guards: ts.IfStatement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) && node.getText(ast).includes(marker)) guards.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.equal(guards.length, 1, "one actual guard must be found before mutation");
  const condition = guards[0].expression;
  return original.slice(0, condition.getStart(ast)) + "false" + original.slice(condition.getEnd());
}
function requireKilledThrowGuard(action: () => unknown, pattern: RegExp) {
  assert.doesNotThrow(action);
  assert.throws(() => assert.throws(action, pattern), {
    code: "ERR_ASSERTION", operator: "throws", message: "Missing expected exception.",
  });
}
test("guard-omission oracle refuses unexpected faults instead of counting them as killed", () => {
  requireKilledThrowGuard(() => undefined, /EXPECTED_GUARD/);
  assert.throws(() => requireKilledThrowGuard(() => { throw Error("UNEXPECTED_RUNTIME_FAULT"); }, /EXPECTED_GUARD/),
    /Got unwanted exception/);
});
test("omitted env-file exclusion is killed by literal false oracle", () => {
  const fn = declaration("createBuildOptions"), needle = "envDir: false as const";
  assert.equal(fn.split(needle).length, 2);
  assert.equal(load("createBuildOptions")("fictional-output", true).envDir, false);
  const mutant = load("createBuildOptions", fn.replace(needle, "envDir: undefined"));
  const observed = mutant("fictional-output", true);
  assert.throws(() => assert.equal(observed.envDir, false), { code: "ERR_ASSERTION" });
});
test("omitted baseline byte authority is killed by coherent replacement bytes", () => {
  const control = load("decodeBaselineHook");
  assert.equal(control().length, 9117);
  const changed = Buffer.from(control()); changed[0] ^= 1;
  const hash = createHash("sha256").update(changed).digest("hex");
  assert.throws(() => control(changed.toString("base64"), 9117, hash), /CHOICE_BASELINE_PIN_REFUSED/);
  const mutant = load("decodeBaselineHook", omitGuard("decodeBaselineHook", "CHOICE_BASELINE_PIN_REFUSED"));
  requireKilledThrowGuard(() => mutant(changed.toString("base64"), 9117, hash), /CHOICE_BASELINE_PIN_REFUSED/);
});
test("omitted selector cardinality guard is killed by two actual declarations", () => {
  const one = "export function nativeMessagePreviewBindingSnapshot() {}", two = one + "\n" + one;
  const control = load("replaceSelectorBody");
  assert.ok(control(one).includes("__qaChoiceFictionalPort.selector"));
  assert.throws(() => control(two), /CHOICE_SELECTOR_SHAPE_REFUSED/);
  const mutant = load("replaceSelectorBody", omitGuard("replaceSelectorBody", "CHOICE_SELECTOR_SHAPE_REFUSED"));
  requireKilledThrowGuard(() => mutant(two), /CHOICE_SELECTOR_SHAPE_REFUSED/);
});
test("omitted output confinement is killed by application dist target", () => {
  const control = load("requireChoiceOutput", declaration("requireChoiceOutput"), ["requireVariant"]);
  const own = resolve(root, ".ops-private/task2-choice-bundle-20261010/current-true"), foreign = resolve(root, "artifacts/kub/dist/public");
  assert.equal(control(own, "current-true"), own);
  assert.throws(() => control(foreign, "current-true"), /CHOICE_OUTPUT_REFUSED/);
  const mutant = load("requireChoiceOutput", omitGuard("requireChoiceOutput", "CHOICE_OUTPUT_REFUSED"), ["requireVariant"]);
  requireKilledThrowGuard(() => mutant(foreign, "current-true"), /CHOICE_OUTPUT_REFUSED/);
});
test("omitted mutation-flag refusal is killed by literal one", () => {
  const control = load("requireChoiceBuildPermission"); control("0");
  assert.throws(() => control("1"), /CHOICE_MUTATION_FLAG_REFUSED/);
  const mutant = load("requireChoiceBuildPermission", omitGuard("requireChoiceBuildPermission", "CHOICE_MUTATION_FLAG_REFUSED"));
  requireKilledThrowGuard(() => mutant("1"), /CHOICE_MUTATION_FLAG_REFUSED/);
});
test("omitted request fence is killed by foreign-origin asset request", async () => {
  const original = declaration("createAssetHandler"), ast = ts.createSourceFile("transport.ts", original, ts.ScriptTarget.Latest, true);
  const guards: ts.IfStatement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) && node.expression.getText(ast).includes("request.method()")) guards.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.equal(guards.length, 1);
  const expr = guards[0].expression;
  const changed = original.slice(0, expr.getStart(ast)) + "false" + original.slice(expr.getEnd());
  const assets = new Map([["/index.html", { body: Buffer.from("fictional"), contentType: "text/html" }]]);
  async function observe(factory: any, url: string) {
    let aborts = 0, fulfills = 0;
    await factory(assets)({ request: () => ({ method: () => "GET", url: () => url, redirectedFrom: () => null }),
      abort: async () => { aborts++; }, fulfill: async () => { fulfills++; },
      fetch: () => { throw Error("NO_FETCH"); }, continue: () => { throw Error("NO_CONTINUE"); } });
    return { aborts, fulfills };
  }
  const control = load("createAssetHandler", original, ["requireAssetPath"]);
  assert.deepEqual(await observe(control, "http://127.0.0.1:54319/"), { aborts: 0, fulfills: 1 });
  assert.deepEqual(await observe(control, "https://foreign.invalid/"), { aborts: 1, fulfills: 0 });
  const mutant = load("createAssetHandler", changed, ["requireAssetPath"]);
  const observed = await observe(mutant, "https://foreign.invalid/");
  assert.throws(() => assert.deepEqual(observed, { aborts: 1, fulfills: 0 }), { code: "ERR_ASSERTION" });
});
