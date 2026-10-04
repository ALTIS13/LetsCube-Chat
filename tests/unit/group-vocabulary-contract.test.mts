import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const vocabularyFile = new URL("../../artifacts/kub/src/lib/chatVocabulary.ts", import.meta.url);
const displayFile = new URL("../../artifacts/kub/src/lib/chatDisplay.ts", import.meta.url);
const source = (url: URL) => readFileSync(url, "utf8");
function compiled(url: URL, text = source(url)): Record<string, any> {
  const js = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(`(function(require, exports, module) { ${js}\n })`)(createRequire(url), module.exports, module);
  return module.exports;
}
function compiledDefinition(url: URL, name: string): Record<string, any> {
  const tree = ts.createSourceFile(url.pathname, source(url), ts.ScriptTarget.Latest, true);
  const nodes = tree.statements.filter(node => ts.isFunctionDeclaration(node)
    ? node.name?.text === name
    : ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(tree) === name));
  assert.equal(nodes.length, 1, "one actual declaration, without unrelated browser imports");
  return compiled(url, nodes[0].getText(tree));
}
const heavy = { id: "fixture-group", name: null, type: "group", description: null, created_by: "owner", members: [], other_user: null };
function checkWords(subject: Record<string, any>) {
  const words = subject.chatVocabulary("group");
  assert.equal(words.subject, "Группа");
  assert.equal(words.leaveLabel, "Покинуть группу");
  assert.equal(words.at, "в группе");
  assert.equal(words.into, "в группу");
}
function checkDisplay(subject: Record<string, any>) {
  assert.equal(subject.getChatDisplayInfo(heavy, "owner").typeLabel, "Группа");
}
test("the actual compiled vocabulary preserves the four Russian cases", () => checkWords(compiled(vocabularyFile)));
test("the compiled display distinguishes heavy groups, group chats and channels", () => {
  const subject = compiled(displayFile);
  checkDisplay(subject);
  assert.equal(subject.getChatDisplayInfo(heavy, "owner").title, "Группа без названия");
  assert.equal(subject.getChatDisplayInfo({ ...heavy, type: "dm_group" }, "owner").typeLabel, "Групповой чат");
  assert.equal(subject.getChatDisplayInfo({ ...heavy, type: "channel" }, "owner").typeLabel, "Канал");
});
test("group copy agrees in gender without renaming infrastructure servers", () => {
  const roles = compiledDefinition(new URL("../../artifacts/kub/src/lib/rolePermissions.ts", import.meta.url), "ROLE_SCOPE_DESCRIPTION");
  assert.equal(roles.ROLE_SCOPE_DESCRIPTION.chat, "Роль в чате действует только внутри конкретной группы.");
  const settings = source(new URL("../../artifacts/kub/src/components/bots/BotSettingsPanel.tsx", import.meta.url));
  assert.ok(settings.includes("Для каждой группы доступ к новым сообщениям переключает её администратор"));
  const gateway = compiledDefinition(new URL("../../artifacts/kub/src/lib/voiceGateway.ts", import.meta.url), "voiceGatewayRefusalText");
  assert.equal(gateway.voiceGatewayRefusalText("target_is_owner"), "Владельца группы нельзя заглушить или отключить.");
  assert.equal(gateway.voiceGatewayRefusalText("network"), "Нет связи с сервером, проверьте подключение.");
});
for (const [name, from, to, file, oracle] of [
  ["old heavy subject", 'const subject = channel ? "Канал" : "Группа";', 'const subject = channel ? "Канал" : "Сервер";', vocabularyFile, checkWords],
  ["nominative in the leave command", 'const object = channel ? "канал" : "группу";', 'const object = channel ? "канал" : "группа";', vocabularyFile, checkWords],
  ["old location", 'const at = channel ? "в канале" : "в группе";', 'const at = channel ? "в канале" : "на сервере";', vocabularyFile, checkWords],
  ["wrong invitation case", 'const into = channel ? "в канал" : "в группу";', 'const into = channel ? "в канал" : "в группы";', vocabularyFile, checkWords],
  ["group-chat label on a heavy group", 'typeLabel: "Группа",', 'typeLabel: "Групповой чат",', displayFile, checkDisplay],
] as const) test(`literal oracle rejects actual compiled mutation: ${name}`, () => {
  const original = source(file);
  assert.equal(original.split(from).length, 2, "one actual subject mutation");
  const subject = compiled(file, original.replace(from, to));
  assert.throws(() => oracle(subject), error => error instanceof assert.AssertionError);
});
