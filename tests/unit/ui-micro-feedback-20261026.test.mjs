import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../artifacts/kub/src/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const source = read('components/chat/MessageInput.tsx');
const tree = ts.createSourceFile('MessageInput.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MessageInput');
assert.ok(component?.body);
const selected = new Set(['showRecorderModeFeedback', 'toggleRecorderMode', 'showShortPressHint', 'handleRecorderContextMenu']);
const callbacks = component.body.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => selected.has(declaration.name.getText(tree))));
assert.equal(callbacks.length, 4, 'Exercise the real consumer callbacks, not a copied reducer');
const shortDuration = tree.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => declaration.name.getText(tree) === 'SHORT_PRESS_HINT_MS'));
assert.ok(shortDuration);
let status;
function find(node) {
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
    && attribute.name.getText(tree) === 'data-testid'
    && attribute.initializer?.getText(tree).includes('composer-short-press-hint'))) status = node;
  ts.forEachChild(node, find);
}
find(component);
assert.ok(status, 'The rendered feedback must be the real status element');
let label, icon;
function feedbackExpressions(node) {
  if (ts.isJsxExpression(node) && node.expression?.getText(tree).startsWith('shortHint ??')) label = node.expression.getText(tree);
  if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'name' && ts.isJsxExpression(node.initializer)
    && node.initializer.expression?.getText(tree).includes('modeFeedback ?? recorderMode')) icon = node.initializer.expression.getText(tree);
  ts.forEachChild(node, feedbackExpressions);
}
feedbackExpressions(status);
assert.ok(label && icon);

function compile(text, globals = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(text, { reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.equal(result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, { module, exports: module.exports, ...globals });
  return module.exports;
}
const gesture = compile(read('lib/recordingGesture.ts'));
const motion = compile(read('lib/motion.ts'));

// As in voice-recording-intent.test.mjs, execute selected unchanged AST
// statements. Only React state/timers are synthetic; the callbacks and the
// displayed JSX expressions come from the shipping consumer.
function fixture(mutateModeCallback = text => text) {
  let clock = 0, id = 0;
  const timers = new Map();
  const globals = { ...gesture, ...motion,
    setTimeout(callback, ms) { timers.set(++id, { callback, at: clock + ms }); return id; },
    clearTimeout(timer) { timers.delete(timer); },
  };
  const { make } = compile(`export function make() {
    let recorderMode = 'voice', modeFeedback = null, shortHint = null;
    const setRecorderMode = value => { recorderMode = value; };
    const setModeFeedback = value => { modeFeedback = value; };
    const setShortHint = value => { shortHint = value; };
    const modeFeedbackTimerRef = {current:null}, shortHintTimerRef = {current:null};
    const voiceHoldActiveRef = {current:false}, videoHoldActiveRef = {current:false};
    const useCallback = callback => callback;
    ${shortDuration.getText(tree)}
    ${callbacks.map(node => node.declarationList.declarations.some(declaration => declaration.name.getText(tree) === 'showRecorderModeFeedback')
      ? mutateModeCallback(node.getText(tree)) : node.getText(tree)).join('\n')}
    return {
      short: () => showShortPressHint(recorderMode),
      context: () => handleRecorderContextMenu({preventDefault(){}, stopPropagation(){}}),
      snapshot: () => ({ mode:recorderMode, text:${label}, icon:${icon} }),
      shortTimerRef: () => shortHintTimerRef.current
    };
  }`, globals);
  const consumer = make();
  return { ...consumer, pendingTimers: () => timers.size, advance(ms) {
    clock += ms;
    for (const [timer, entry] of timers) if (entry.at <= clock) { timers.delete(timer); entry.callback(); }
  } };
}

test('control: an idle context switch names the selected video mode', () => {
  const ui = fixture();
  ui.context();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.snapshot())), { mode: 'video', text: 'Видеосообщение', icon: 'video' });
});

test('a new recorder mode supersedes a previous short-voice hint immediately', () => {
  const ui = fixture();
  ui.short();
  assert.equal(ui.snapshot().text, 'Удерживайте, чтобы записать голосовое');
  ui.context();
  assert.equal(ui.snapshot().mode, 'video');
  assert.equal(ui.snapshot().icon, 'video');
  assert.equal(ui.snapshot().text, 'Видеосообщение');
});

test('control: expiry of the old hint exposes the already selected mode', () => {
  const ui = fixture();
  ui.short();
  ui.advance(100);
  ui.context();
  ui.advance(2100);
  assert.equal(ui.snapshot().text, 'Видеосообщение');
});

function assertShortTimerRetired(ui) {
  ui.short();
  assert.equal(ui.pendingTimers(), 1);
  ui.context();
  assert.equal(ui.pendingTimers(), 1, 'Only the current mode-feedback timer remains');
  assert.equal(ui.shortTimerRef(), null, 'Retired short-hint timer ref must be null');
  assert.equal(ui.snapshot().text, 'Видеосообщение');
}

test('switching mode retires the short-hint timer and clears its ref', () => {
  assertShortTimerRetired(fixture());
});

test('omission controls: each reviewed short-hint retirement line is load-bearing', () => {
  for (const line of [
    'if (shortHintTimerRef.current) clearTimeout(shortHintTimerRef.current);',
    'shortHintTimerRef.current = null;',
    'setShortHint(null);',
  ]) {
    const ui = fixture(text => {
      assert.equal(text.split(line).length, 2, 'Mutate one real callback statement');
      return text.replace(line, '');
    });
    assert.throws(() => assertShortTimerRetired(ui), assert.AssertionError, line);
  }
});
