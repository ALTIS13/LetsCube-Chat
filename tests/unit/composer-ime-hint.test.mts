import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { enterSends } from "../../artifacts/kub/src/lib/composerEnter.ts";

const fields = [
  "components/chat/MessageInput.tsx",
  "components/chat/attach/AttachSendBar.tsx",
];

// Read the actual textarea binding: a hardware Enter test cannot establish
// which action Android offers on its software keyboard.
function readSource(relative: string) {
  return readFileSync(new URL(`../../artifacts/kub/src/${relative}`, import.meta.url), "utf8");
}

function hint(relative: string, send: boolean, source = readSource(relative)) {
  const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let value: ts.JsxAttributeValue | undefined;
  let textareas = 0;
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "textarea") {
      textareas++;
      const attr = node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(tree) === "enterKeyHint");
      if (attr && ts.isJsxAttribute(attr)) value = attr.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.equal(textareas, 1, "probe must identify the real message/caption field uniquely");
  if (!value) return undefined;
  if (ts.isStringLiteral(value)) return value.text;
  assert.ok(ts.isJsxExpression(value) && value.expression);
  const expression = ts.transpileModule(`(${value.expression.getText(tree)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return runInNewContext(expression, { enterSendsHere: () => send });
}

function verify(relative: string, source?: string) {
  for (const userAgent of ["Mozilla/5.0 Android 15 Mobile", "Mozilla/5.0 iPhone", "Mozilla/5.0 iPad"]) {
    for (const phoneLayout of [true, false]) {
      const send = enterSends({ userAgent, maxTouchPoints: 5, phoneLayout, shortSide: 390 });
      assert.equal(hint(relative, send, source), "enter", "phone keyboard must explicitly offer a line break, in either orientation");
    }
  }
  for (const phoneLayout of [true, false]) {
    const send = enterSends({ userAgent: "Mozilla/5.0 Windows NT 10.0", maxTouchPoints: 0, phoneLayout });
    assert.equal(hint(relative, send, source), "send", "desktop action must match the Enter shortcut, even in a narrow window");
  }
  assert.equal(hint(relative, enterSends({ userAgent: "Android 15", maxTouchPoints: 5, phoneLayout: false, shortSide: 820 }), source), "send");
}

for (const relative of fields) {
  test(`${relative}: actual keyboard hint agrees with phone/tablet/desktop Enter behavior`, () => verify(relative));
  for (const mutation of ["remove", "send", "enter"] as const) {
    test(`${relative}: rejects ${mutation} hint regression`, () => {
      const source = readSource(relative);
      const binding = 'enterKeyHint={enterSendsHere() ? "send" : "enter"}';
      assert.equal(source.split(binding).length - 1, 1, "mutation must change the actual unique field binding");
      const mutated = source.replace(binding, mutation === "remove" ? "" : `enterKeyHint="${mutation}"`);
      assert.throws(() => verify(relative, mutated), { name: "AssertionError" });
    });
  }
}
