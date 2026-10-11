import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Only the new helper runs on fictional geometry/JVM inputs. No APK, Auth or SDK graph.
const file = path.resolve(import.meta.dirname, '../../android/app/src/androidTest/java/com/kub/messenger/NativeMessagePreviewUserChoiceTest.java');
const source = readFileSync(file, 'utf8');
function javaString(name, text = source) {
  const body = text.match(new RegExp(`static final String ${name} =\\s*([\\s\\S]*?);\\r?\\n`))?.[1];
  assert.ok(body, `helper expression ${name} exists`);
  const strings = body.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
  assert.equal(body.replace(/"(?:[^"\\]|\\.)*"/g, '').replace(/[+\s]/g, ''), '');
  return strings.map(value => JSON.parse(value)).join('');
}
const common = javaString('DOM_HELPERS');
const target = javaString('TARGET_PROBE');
const saved = javaString('SAVED_PROBE');
const scrollUp = javaString('SCROLL_UP_PROBE');

function element(rect = { left: 20, top: 100, right: 36, bottom: 116 }, extra = {}) {
  const node = {
    parentElement: null, isConnected: true, disabled: false, checked: false, value: '',
    style: { display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto' },
    getClientRects: () => [rect], getBoundingClientRect: () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }),
    getAttribute: () => null, matches: () => node.disabled, contains: other => other === node,
    click: () => { throw Error('SYNTHETIC_INPUT_FORBIDDEN'); },
    dispatchEvent: () => { throw Error('SYNTHETIC_INPUT_FORBIDDEN'); },
    ...extra,
  };
  return node;
}
function dom(options = {}) {
  const radio = element(undefined, { value: 'sender', ...options.radio });
  const radios = options.radios ?? ['none', 'sender', 'message'].map(value => value === 'sender' ? radio : element(undefined, { value }));
  const row = element({ left: 8, top: 80, right: 382, bottom: 300 }, {
    querySelectorAll: selector => selector === 'input[type=radio]' ? radios : [],
  });
  const scroller = element({ left: 8, top: 60, right: 382, bottom: 700 });
  const nodes = {
    '[data-testid=native-message-preview-setting]': [row],
    '[data-testid=settings-scroll]': [scroller],
    ...options.nodes,
  };
  const context = vm.createContext({
    mode: options.mode ?? 'radio', choice: options.choice ?? 'sender',
    innerWidth: 390, innerHeight: 780,
    visualViewport: { width: 390, height: 780, scale: 1, offsetLeft: 0, offsetTop: 0, ...options.viewport },
    getComputedStyle: node => node.style,
    document: { querySelectorAll: selector => nodes[selector] ?? [], elementFromPoint: () => options.occluded ? element() : radio },
  });
  return { context, radio, radios, row, scroller };
}
function measure(options = {}, body = target) {
  const fixture = dom(options);
  return vm.runInContext(`(()=>{${common}${body}})()`, fixture.context);
}
function savedState(selected, options = {}, body = saved) {
  const fixture = dom({ ...options, choice: selected });
  for (const radio of fixture.radios) radio.checked = radio.value === selected;
  options.alter?.(fixture);
  return vm.runInContext(`(()=>{${common}${body}})()`, fixture.context);
}

test('input target measures only numeric bounded CSS geometry without a synthetic click', () => {
  const result = measure();
  assert.notEqual(result, null, 'visible unoccluded radio must yield numeric geometry');
  assert.deepEqual(Array.from(result), [28, 108, 20, 100, 36, 116, 390, 780]);
});
test('input target refuses overlay hit, duplicate, disabled, hidden ancestor and zoomed viewport', () => {
  assert.equal(measure({ occluded: true }), null);
  assert.equal(measure({ radio: { disabled: true } }), null);
  assert.equal(measure({ radio: { parentElement: element(undefined, { style: { display: 'none', visibility: 'visible', opacity: '1', pointerEvents: 'auto' } }) } }), null);
  assert.equal(measure({ radios: [element(undefined, { value: 'sender' }), element(undefined, { value: 'sender' })] }), null);
  assert.equal(measure({ radio: { getBoundingClientRect: () => ({ left: -1, top: 100, right: 15, bottom: 116, width: 16, height: 16 }) } }), null);
  assert.equal(measure({ viewport: { scale: 2 } }), null);
  assert.equal(measure({ viewport: { offsetTop: 12 } }), null);
});
test('actual Settings menu, disclosure and scoped header close are measurable without calling their commands', () => {
  const menu = element();
  const settings = element(undefined, { textContent: '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438' });
  const disclosure = element();
  const close = element();
  const nodes = {
    'button[aria-label="\u041c\u0435\u043d\u044e"]': [menu],
    '[role=menu][data-kub-menu=true]': [element(undefined, { querySelectorAll: selector => selector === 'button' ? [settings] : [] })],
    '[data-testid=native-message-preview-setting]': [element(undefined, { querySelectorAll: selector => selector === '[data-testid=settings-open-message-preview]' ? [disclosure] : [] })],
    '[role=dialog][aria-modal=true]': [element(undefined, {
      querySelector: selector => selector === '[data-testid=settings-scroll]' ? element() : null,
      querySelectorAll: selector => selector === 'button[aria-label="\u0417\u0430\u043a\u0440\u044b\u0442\u044c"]' ? [close] : [],
    })],
  };
  for (const [mode, hit] of [['menu', menu], ['settings', settings], ['disclosure', disclosure], ['close', close]]) {
    const f = dom({ mode, nodes });
    f.context.document.elementFromPoint = () => hit;
    assert.deepEqual(Array.from(vm.runInContext(`(()=>{${common}${target}})()`, f.context)), [28, 108, 20, 100, 36, 116, 390, 780]);
  }
});
test('scroll geometry checks both real-input endpoints and rejects an obstructed path', () => {
  const f = dom({ mode: 'scroll' });
  f.context.document.elementFromPoint = () => f.scroller;
  assert.deepEqual(Array.from(vm.runInContext(`(()=>{${common}${target}})()`, f.context)), [366, 380, 8, 60, 382, 700, 390, 780]);
  f.context.document.elementFromPoint = (x, y) => y < 300 ? element() : f.scroller;
  assert.equal(vm.runInContext(`(()=>{${common}${target}})()`, f.context), null);
});
test('scroll hit-test also refuses an overlay at an intermediate move, not only center/endpoints', () => {
  const f = dom({ mode: 'scroll' });
  f.context.document.elementFromPoint = (x, y) => y > 430 && y < 440 ? element() : f.scroller;
  assert.equal(vm.runInContext(`(()=>{${common}${target}})()`, f.context), null);
});
test('reveal scroll reverses toward a clipped earlier none radio, not always further down', () => {
  const f = dom();
  assert.equal(vm.runInContext(`(()=>{${common}${scrollUp}})()`, f.context), false);
  f.radio.getBoundingClientRect = () => ({ left: 20, top: 40, right: 36, bottom: 56 });
  assert.equal(vm.runInContext(`(()=>{${common}${scrollUp}})()`, f.context), true);
});
test('checked consumer readback refuses saving fieldset, mixed selection and partial option set', () => {
  assert.equal(savedState('none'), true);
  assert.equal(savedState('sender'), true);
  assert.equal(savedState('message'), true);
  assert.equal(savedState('none', { alter: f => { f.radios[0].disabled = true; } }), false);
  assert.equal(savedState('sender', { alter: f => { f.radios[0].checked = true; } }), false);
  assert.equal(savedState('sender', { alter: f => { f.radios.pop(); } }), false);
  assert.equal(savedState('sender', { alter: f => { f.row.parentElement = element(undefined, { style: { display: 'block', visibility: 'hidden', opacity: '1', pointerEvents: 'auto' } }); } }), false);
});

function jvm(text, assertions) {
  const helper = text.match(/    static final class InputGeometry \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(helper, 'actual numeric helper is present');
  const budget = text.match(/    private static final long CHOICE_WINDOW_MS = [0-9_]+;/)?.[0];
  assert.ok(budget, 'actual fixed window declaration is present');
  const prefix = 'nmpv-user-choice-input-';
  const out = mkdtempSync(path.join(tmpdir(), prefix));
  try {
    const java = path.join(out, 'UserChoiceInputProbe.java');
    writeFileSync(java, `public final class UserChoiceInputProbe {\n${budget}\n${helper}\npublic static void main(String[] args) {\n${assertions}\n}\n}`);
    const bin = process.env.LETSCUBE_TEST_JAVA_BIN ?? 'C:/Program Files/Android/Android Studio/jbr/bin';
    const javac = path.join(bin, `javac${process.platform === 'win32' ? '.exe' : ''}`);
    assert.ok(existsSync(javac), 'existing JVM compiler required; never install or change PATH');
    const compiled = spawnSync(javac, ['-encoding', 'UTF-8', '-g:none', '-d', out, java], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(compiled.status, 0, 'HELPER_COMPILE_FAILURE_NOT_BEHAVIORAL_RED');
    const run = spawnSync(path.join(bin, `java${process.platform === 'win32' ? '.exe' : ''}`), ['-cp', out, 'UserChoiceInputProbe'], { encoding: 'utf8', timeout: 5_000 });
    assert.equal(run.error, undefined);
    return run;
  } finally {
    const actual = realpathSync(out);
    assert.equal(path.dirname(actual), realpathSync(tmpdir()));
    assert.ok(path.basename(actual).startsWith(prefix));
    assert.equal(actual, path.resolve(out));
    rmSync(actual, { recursive: true });
  }
}
const mappingAssertions = `
double[] css = {28,108,20,100,36,116,390,780};
double[] p = InputGeometry.map(css,3,1170,2340,0,84);
if (p == null || p[0] != 84 || p[1] != 408) throw new AssertionError("CSS_TO_NATIVE_MAPPING");
if (InputGeometry.map(css,2,1170,2340,0,84) != null) throw new AssertionError("WRONG_SCALE");
if (InputGeometry.map(css,3,1170,2000,0,84) != null) throw new AssertionError("WRONG_VIEWPORT");
if (InputGeometry.map(css,3,1170,2340,-1,84) != null) throw new AssertionError("NEGATIVE_ORIGIN");
css[0]=Double.NaN;
if (InputGeometry.map(css,3,1170,2340,0,84) != null) throw new AssertionError("NONFINITE");
css[0]=40;
if (InputGeometry.map(css,3,1170,2340,0,84) != null) throw new AssertionError("OUTSIDE_TARGET");
if (InputGeometry.map(new double[7],3,1170,2340,0,84) != null) throw new AssertionError("PARTIAL_GEOMETRY");
css[0]=28;
if (InputGeometry.map(css,3,1170,2340,20000,84) != null) throw new AssertionError("UNBOUNDED_NATIVE_ORIGIN");
css[2]=26;css[4]=29;
if (InputGeometry.map(css,3,1170,2340,0,84) != null) throw new AssertionError("TINY_TARGET");
System.out.println("PASS INPUT_GEOMETRY_ONLY");`;
test('actual Java helper maps CSS pixels with native offset and refuses invalid geometry', () => {
  const result = jvm(source, mappingAssertions);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'PASS INPUT_GEOMETRY_ONLY');
});

for (const [name, before, after, fixture] of [
  ['hit-test', 'if(!points.every(p=>hit(p[0],p[1])))return null;', '', { occluded: true }],
  ['disabled control', '!enabled(e)', '!visible(e)', { radio: { disabled: true } }],
  ['visual viewport', 'if(!viewport())return null;', '', { viewport: { scale: 2 } }],
]) test(`behavioral input mutant killed: ${name}`, () => {
  assert.deepEqual(Array.from(measure()), [28, 108, 20, 100, 36, 116, 390, 780]);
  const check = body => assert.equal(measure(fixture, body), null, `REFUSE_${name}`);
  check(target);
  const mutant = target.replace(before, after);
  assert.notEqual(mutant, target, 'mutation actually applied');
  assert.throws(() => check(mutant), { name: 'AssertionError', message: new RegExp(`REFUSE_${name}`) });
});
test('compiled CSS mapping mutant is killed by literal coordinates, not compilation failure', () => {
  const result = jvm(source.replace('left + css[0] * scale', 'left + css[0]'), mappingAssertions);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AssertionError: CSS_TO_NATIVE_MAPPING/);
});
const windowAssertions = `
long d = InputGeometry.deadline(1000);
if (d != 121000 || 120999 >= d || 121000 < d) throw new AssertionError("FIXED_120_SECOND_WINDOW");
if (InputGeometry.deadline(1000) != 121000) throw new AssertionError("SAME_ARM_NO_RENEWAL");
if (InputGeometry.deadline(-1) != -1 || InputGeometry.deadline(Long.MAX_VALUE) != -1) throw new AssertionError("CLOCK_BOUNDS");
System.out.println("PASS INPUT_WINDOW_ONLY");`;
test('one arm gives exactly 120 seconds with D-1/D boundary and overflow refusal', () => {
  const result = jvm(source, windowAssertions);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'PASS INPUT_WINDOW_ONLY');
});
test('compiled 120-second budget mutant is killed at literal D-1/D', () => {
  const result = jvm(source.replace('CHOICE_WINDOW_MS = 120_000', 'CHOICE_WINDOW_MS = 180_000'), windowAssertions);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AssertionError: FIXED_120_SECOND_WINDOW/);
});
test('ready/readback mutant cannot accept checked radios while saving disables a fieldset', () => {
  assert.equal(savedState('sender'), true);
  const fixture = { alter: f => { f.radios[0].disabled = true; } };
  const check = body => assert.equal(savedState('sender', fixture, body), false, 'SAVING_NOT_CONFIRMED');
  check(saved);
  const mutant = saved.replace('r.every(enabled)', 'true');
  assert.notEqual(mutant, saved);
  assert.throws(() => check(mutant), { name: 'AssertionError', message: /SAVING_NOT_CONFIRMED/ });
});
test('new AndroidTest source parses with the existing JDK without SDK compilation', () => {
  const result = jvm(source, `
javax.tools.JavaCompiler c = javax.tools.ToolProvider.getSystemJavaCompiler();
javax.tools.DiagnosticCollector<javax.tools.JavaFileObject> d = new javax.tools.DiagnosticCollector<>();
try (javax.tools.StandardJavaFileManager m = c.getStandardFileManager(d,null,java.nio.charset.StandardCharsets.UTF_8)) {
  com.sun.source.util.JavacTask task = (com.sun.source.util.JavacTask)c.getTask(null,m,d,java.util.List.of("-proc:none"),null,
    m.getJavaFileObjects(${JSON.stringify(file.replaceAll('\\', '/'))}));
  task.parse();
  if (d.getDiagnostics().stream().anyMatch(e -> e.getKind() == javax.tools.Diagnostic.Kind.ERROR))
    throw new AssertionError("ANDROIDTEST_SYNTAX_ONLY_FAILED");
} catch (java.io.IOException ignored) { throw new AssertionError("ANDROIDTEST_PARSE_UNAVAILABLE"); }
System.out.println("PASS SYNTAX_ONLY_NOT_SDK_COMPILE");`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'PASS SYNTAX_ONLY_NOT_SDK_COMPILE');
});
