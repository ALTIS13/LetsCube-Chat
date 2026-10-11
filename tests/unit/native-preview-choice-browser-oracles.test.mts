import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../../scripts/qa-native-preview-choice-browser.mts", import.meta.url), "utf8");
function loadOracle(text: string) {
  const ast = ts.createSourceFile("actual-runner.mts", text, ts.ScriptTarget.Latest, true);
  const nodes = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "assertBaselineFeatureAbsence");
  assert.equal(nodes.length, 1);
  const fn = nodes[0]; assert.ok(ts.isFunctionDeclaration(fn));
  const compiled = ts.transpileModule(fn.getText(ast).replace(/^export /, ""), {
    reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  });
  assert.equal(compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  const context = createContext({ assert });
  new Script(compiled.outputText).runInContext(context);
  return (count: number) => new Script(`assertBaselineFeatureAbsence(${count})`).runInContext(context);
}
const oracle = loadOracle(source);
test("actual baseline absence control is zero", () => { oracle(0); });
for (const count of [1, 2, 3]) test(`baseline absence refuses literal cardinality ${count}`, () => {
  assert.throws(() => oracle(count), { code: "ERR_ASSERTION" });
});
test("omitting actual zero-cardinality guard is killed by literal two-controls oracle", () => {
  const needle = 'assert.equal(count, 0, "BASELINE_FEATURE_ABSENCE_REQUIRES_ZERO_CONTROLS");';
  assert.equal(source.split(needle).length, 2);
  const mutant = loadOracle(source.replace(needle, ";"));
  mutant(0);
  assert.throws(() => assert.throws(() => mutant(2), { code: "ERR_ASSERTION" }), { code: "ERR_ASSERTION" });
});
