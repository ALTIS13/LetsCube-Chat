import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";
import test from "node:test";
import { chromium, expect, type Page } from "@playwright/test";
import ts from "typescript";

const source = await readFile(new URL("../../scripts/qa-native-preview-choice-browser.mts", import.meta.url), "utf8");
const ast = ts.createSourceFile("actual-runner.mts", source, ts.ScriptTarget.Latest, true);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "closeSettings");
assert.equal(functions.length, 1);
const compiled = ts.transpileModule(functions[0].getText(ast).replace(/^export /, ""), {
  reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
});
assert.equal(compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
const sandbox = createContext({ expect });
new Script(compiled.outputText).runInContext(sandbox);
const closeSettings = new Script("closeSettings").runInContext(sandbox) as (page: Page) => Promise<void>;

test("actual close helper closes phone settings despite the second header close control", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<section data-testid="settings-profile-tab">
      <header><button aria-label="Закрыть" onclick="document.body.dataset.closed='header'">X</button></header>
      <div data-testid="settings-actions"><button onclick="document.body.dataset.closed='footer'">Закрыть</button></div>
    </section>`);
    await expect(page.getByRole("button", { name: "Закрыть", exact: true })).toHaveCount(2);
    await closeSettings(page);
    assert.equal(await page.locator("body").getAttribute("data-closed"), "footer");
  } finally { await browser.close(); }
});

test("actual close helper closes desktop settings through the unique header control", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<section><button data-testid="settings-close" aria-label="Закрыть"
      onclick="document.body.dataset.closed='desktop'">X</button><div data-testid="settings-actions">
      <button>Сохранить</button></div></section>`);
    await closeSettings(page);
    assert.equal(await page.locator("body").getAttribute("data-closed"), "desktop");
  } finally { await browser.close(); }
});
