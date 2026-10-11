import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../../scripts/qa-native-preview-choice-browser.mts", import.meta.url), "utf8");
const ast = ts.createSourceFile("actual-runner.mts", source, ts.ScriptTarget.Latest, true);
const run = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "runChoiceBrowser");
assert.ok(run && ts.isFunctionDeclaration(run) && run.body);
const statement = run.body.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === "results"));
assert.ok(statement);
const compiled = ts.transpileModule(statement.getText(ast), {
  reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
});
assert.equal(compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);

test("adding seventeen results does not rewrite the nine retained acceptance records", () => {
  const retained = { results: Array.from({ length: 9 }, (_, index) => ({ index, passed: true })) };
  const original = structuredClone(retained.results);
  const sandbox = createContext({ retained });
  new Script(compiled.outputText).runInContext(sandbox);
  new Script("for(let i=0;i<17;i++)results.push({index:9+i,passed:true})").runInContext(sandbox);
  assert.equal(new Script("results.length").runInContext(sandbox), 26);
  assert.equal(retained.results.length, 9);
  assert.deepEqual(retained.results, original);
});
