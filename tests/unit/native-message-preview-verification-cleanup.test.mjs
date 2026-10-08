import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../android/app/src/androidTest/java/com/kub/messenger/NativeMessagePreviewVerificationTest.java', import.meta.url), 'utf8');
const jbr = 'C:/Program Files/Android/Android Studio/jbr/bin';

function method(name) {
  const start = source.indexOf(`    private static ${name}`);
  assert.ok(start >= 0, 'The actual selected AndroidTest method must exist');
  let depth = 0, quoted = false, escaped = false;
  for (let i = source.indexOf('{', start); i < source.length; ++i) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') ++depth;
    else if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('The selected method must have balanced braces');
}

function constant(name, constants = {}) {
  const expression = source.match(new RegExp(`private static final String ${name}\\s*=\\s*([\\s\\S]*?);\\s*\\n`))?.[1];
  assert.ok(expression, 'The actual selected script must exist');
  const token = /\s*("(?:[^"\\]|\\.)*"|[A-Z_]+|\+)\s*/y;
  let result = '', position = 0, expectValue = true;
  while (position < expression.length) {
    token.lastIndex = position;
    const part = token.exec(expression);
    assert.ok(part, 'The selected script must remain a literal concatenation');
    const value = part[1];
    assert.equal(value === '+', !expectValue);
    if (expectValue) {
      assert.ok(value.startsWith('"') || Object.hasOwn(constants, value));
      result += value.startsWith('"') ? JSON.parse(value) : constants[value];
    }
    expectValue = !expectValue;
    position = token.lastIndex;
  }
  assert.equal(expectValue, false);
  return result;
}

function compiled(body, main) {
  assert.ok(existsSync(join(jbr, 'javac.exe')) && existsSync(join(jbr, 'java.exe')), 'Existing JBR compiler required; no installation or skip');
  const directory = mkdtempSync(join(tmpdir(), 'kub-nmpv-cleanup-'));
  try {
    writeFileSync(join(directory, 'ProbeFixture.java'), `
public class ProbeFixture {
  interface NativeStateProbe { boolean verifiedForRecipient(MainActivity activity, String expectedRecipient); }
  static class Plugin {}
  static class MessagePreviewsPlugin extends Plugin {
    boolean verified = true;
    boolean hasVerifiedBinding(String recipient) { return verified && "fictional-recipient".equals(recipient); }
  }
  static class Handle { Plugin plugin; Handle(Plugin value) { plugin = value; } Plugin getInstance() { return plugin; } }
  static class Bridge {
    Plugin plugin;
    Bridge(Plugin value) { plugin = value; }
    Handle getPlugin(String name) { return "MessagePreviews".equals(name) ? new Handle(plugin) : null; }
  }
  static class MainActivity { Bridge bridge; MainActivity(Plugin value) { bridge = new Bridge(value); } Bridge getBridge() { return bridge; } }
  static class ActivityScenario<T> { MainActivity screen; ActivityScenario(MainActivity value) { screen = value; } }
  static class SystemClock { static long time; static long elapsedRealtime() { return time; } static void sleep(long delay) { time += delay; } }
  static final String OPEN_ACCOUNT_MENU = "menu", SELECT_SIGN_OUT = "row", CONFIRM_SIGN_OUT = "confirm", SIGNED_OUT_VIEW = "guest";
  static String events = "";
  static boolean keepBinding, showGuest = true, retireAtMenu, refuseMenu;
  static void assertTrue(String message, boolean result) { if (!result) throw new AssertionError(message); }
  static void requireClosedCapabilities(ActivityScenario<MainActivity> activity, long deadline) { events += "cap,"; }
  static boolean readVerified(ActivityScenario<MainActivity> activity, NativeStateProbe probe, String recipient) {
    return probe.verifiedForRecipient(activity.screen, recipient);
  }
  static boolean evaluateBoolean(ActivityScenario<MainActivity> activity, String script, long deadline) {
    events += script + ",";
    if ("menu".equals(script) && retireAtMenu) ((MessagePreviewsPlugin) activity.screen.bridge.plugin).verified = false;
    if ("menu".equals(script) && refuseMenu) return false;
    if ("confirm".equals(script) && !keepBinding) ((MessagePreviewsPlugin) activity.screen.bridge.plugin).verified = false;
    return !"guest".equals(script) || showGuest;
  }
  ${body}
  public static void main(String[] args) throws Exception { ${main} }
}`);
    const build = spawnSync(join(jbr, 'javac.exe'), ['-encoding', 'UTF-8', '-d', directory, join(directory, 'ProbeFixture.java')], { timeout: 15_000, windowsHide: true });
    assert.equal(build.status, 0, 'Extracted Java methods must compile against the fictional receiver boundary');
    return spawnSync(join(jbr, 'java.exe'), ['-cp', directory, 'ProbeFixture'], { timeout: 10_000, windowsHide: true }).status;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('compiled actual getter wiring uses the activity plugin and forwards the exact expected recipient', () => {
  const binding = method('NativeStateProbe requireNativeStateProbe()');
  const check = `
    NativeStateProbe probe = requireNativeStateProbe();
    MessagePreviewsPlugin actual = new MessagePreviewsPlugin();
    MainActivity activity = new MainActivity(actual);
    assertTrue("expected receiver", probe.verifiedForRecipient(activity, "fictional-recipient"));
    assertTrue("wrong recipient", !probe.verifiedForRecipient(activity, "different-recipient"));
    actual.verified = false;
    assertTrue("retired receiver", !probe.verifiedForRecipient(activity, "fictional-recipient"));
    assertTrue("wrong plugin", !probe.verifiedForRecipient(new MainActivity(new Plugin()), "fictional-recipient"));
  `;
  assert.equal(compiled(binding, check), 0);
  const omission = binding.replace('hasVerifiedBinding(expectedRecipient)', 'hasVerifiedBinding("fictional-recipient")');
  assert.notEqual(omission, binding);
  assert.notEqual(compiled(omission, check), 0, 'Compiled expected-recipient forwarding omission must fail');
});

test('compiled actual final flow requires UI logout plus guest and retired native state', () => {
  const finalFlow = source.match(/            assertTrue\("NMPV_VERIFICATION_NOT_OBSERVED", verified\);([\s\S]*?)\n        } finally/)?.[1];
  assert.ok(finalFlow);
  const body = [
    method('NativeStateProbe requireNativeStateProbe()'),
    method('void requireRenderedLogoutClick('),
    method('void logoutRenderedQaSession('),
    `static void finish(ActivityScenario<MainActivity> activity, NativeStateProbe nativeProbe, String expectedRecipient, long deadline) throws Exception { ${finalFlow} }`,
  ].join('\n');
  const check = `
    for (int mode = 0; mode < 5; ++mode) {
      SystemClock.time = 0; events = ""; keepBinding = mode == 1; showGuest = mode != 2;
      retireAtMenu = mode == 3; refuseMenu = mode == 4;
      MessagePreviewsPlugin plugin = new MessagePreviewsPlugin();
      ActivityScenario<MainActivity> activity = new ActivityScenario<>(new MainActivity(plugin));
      boolean refused = false;
      try { finish(activity, requireNativeStateProbe(), "fictional-recipient", 1000); }
      catch (AssertionError expected) { refused = true; }
      assertTrue("cleanup outcome", refused == (mode != 0));
      if (mode == 0) assertTrue("actual final flow", "cap,menu,row,confirm,guest,".equals(events));
      if (mode >= 3) assertTrue("no retired/missing-menu confirmation", !events.contains("confirm,"));
    }
  `;
  assert.equal(compiled(body, check), 0);
  for (const [literal, replacement] of [
    ['logoutRenderedQaSession(activity, nativeProbe, expectedRecipient, deadline);', ''],
    ['&& !readVerified(activity, probe, expectedRecipient)', ''],
    ['assertTrue("NMPV_LOGOUT_OWNER_REFUSED", readVerified(activity, probe, expectedRecipient));', ''],
  ]) {
    const omission = body.replace(literal, replacement);
    assert.notEqual(omission, body);
    assert.notEqual(compiled(omission, check), 0, 'Compiled cleanup omission must fail an actual final-flow control');
  }
});

const label = '\u0412\u044b\u0439\u0442\u0438';
const title = '\u0412\u044b\u0439\u0442\u0438 \u0438\u0437 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430?';

function dom(options = {}) {
  let clicks = 0;
  const element = (text = '') => ({
    textContent: text, disabled: options.disabled === true,
    getClientRects: () => options.hidden ? [] : [{}],
    getAttribute: name => name === 'aria-disabled' && options.ariaDisabled ? 'true' : name === 'aria-labelledby' ? 'fixed-title' : null,
    click: () => { ++clicks; },
  });
  const button = element(options.buttonText ?? label), heading = element(options.title ?? title);
  const list = value => Array.from({ length: options.count ?? 1 }, () => value);
  const container = { ...element(), querySelectorAll: () => list(button) };
  return {
    clicks: () => clicks,
    context: {
      document: {
        querySelectorAll: selector => selector === 'button[aria-label="\u041c\u0435\u043d\u044e"]' ? list(button)
          : selector === '[role=menu][data-kub-menu=true]' ? (options.missingContainer ? [] : [container])
            : selector === '[role=dialog][aria-modal=true]' ? (options.missingContainer ? [] : [container]) : [],
        getElementById: () => options.missingTitle ? null : heading,
      },
      getComputedStyle: () => ({ visibility: options.visibility ?? 'visible' }),
    },
  };
}

test('actual rendered logout scripts require unique visible enabled exact controls and confirmation title', () => {
  const helper = constant('LOGOUT_HELPERS');
  for (const name of ['OPEN_ACCOUNT_MENU', 'SELECT_SIGN_OUT', 'CONFIRM_SIGN_OUT']) {
    const script = constant(name, { LOGOUT_HELPERS: helper });
    const positive = dom();
    assert.equal(runInNewContext(script, positive.context), true);
    assert.equal(positive.clicks(), 1);
    const negatives = [{ count: 0 }, { count: 2 }, { hidden: true }, { visibility: 'hidden' }, { disabled: true }, { ariaDisabled: true }];
    if (name !== 'OPEN_ACCOUNT_MENU') negatives.push({ missingContainer: true }, { buttonText: `${label} extra` });
    if (name === 'CONFIRM_SIGN_OUT') negatives.push({ title: 'Different action?' }, { missingTitle: true });
    for (const options of negatives) {
      const negative = dom(options);
      assert.equal(runInNewContext(script, negative.context), false);
      assert.equal(negative.clicks(), 0);
    }
  }
});

test('executed logout selector omissions expose ambiguity and disabled confirmation', () => {
  const helper = constant('LOGOUT_HELPERS');
  const script = constant('CONFIRM_SIGN_OUT', { LOGOUT_HELPERS: helper });
  for (const [literal, replacement, options] of [
    ['buttons.length!==1', 'buttons.length===0', { count: 2 }],
    ['!e.disabled&&', '', { disabled: true }],
  ]) {
    const omission = script.replace(literal, replacement);
    assert.notEqual(omission, script);
    const negative = dom(options);
    assert.equal(runInNewContext(omission, negative.context), true);
    assert.equal(negative.clicks(), 1);
  }
});

test('actual signed-out selector requires the rendered login or unique guest home without an account menu/dialog', () => {
  const script = constant('SIGNED_OUT_VIEW', { LOGOUT_HELPERS: constant('LOGOUT_HELPERS') });
  function context(options = {}) {
    const element = { getClientRects: () => [{}] };
    const list = count => Array.from({ length: count }, () => element);
    const form = { ...element, querySelectorAll: selector => selector.startsWith('input[type=password]')
      ? list(options.passwordCount ?? 1) : [element] };
    const shell = { ...element, querySelectorAll: () => [form] };
    return {
      location: { pathname: options.path ?? '/login' },
      getComputedStyle: () => ({ visibility: 'visible' }),
      document: { querySelectorAll: selector => selector === 'button[aria-label="\u041c\u0435\u043d\u044e"]' ? list(options.menuCount ?? 0)
        : selector === '[role=dialog][aria-modal=true]' ? list(options.dialogCount ?? 0)
          : selector === '[data-testid=auth-form-shell]' ? (options.noForm ? [] : [shell])
            : selector === '#public-home-title' ? list(options.titleCount ?? 0)
              : selector === 'a[href="/login"]' ? list(options.linkCount ?? 0) : [] },
    };
  }
  assert.equal(runInNewContext(script, context()), true);
  assert.equal(runInNewContext(script, context({ path: '/', noForm: true, titleCount: 1, linkCount: 1 })), true);
  for (const options of [
    { noForm: true }, { passwordCount: 0 }, { passwordCount: 2 }, { path: '/register' },
    { menuCount: 1 }, { dialogCount: 1 }, { path: '/', titleCount: 1, linkCount: 2 },
    { path: '/', titleCount: 0, linkCount: 1 }, { path: '/', titleCount: 2, linkCount: 1 },
  ]) assert.equal(runInNewContext(script, context(options)), false);
});
