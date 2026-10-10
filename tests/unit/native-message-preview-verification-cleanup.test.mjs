import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../android/app/src/androidTest/java/com/kub/messenger/NativeMessagePreviewVerificationTest.java', import.meta.url), 'utf8');
const compositionSource = readFileSync(new URL('../../android/app/src/androidTest/java/com/kub/messenger/NativeMessagePreviewGenuineCompositionTest.java', import.meta.url), 'utf8');
const jbr = 'C:/Program Files/Android/Android Studio/jbr/bin';

function method(name, input = source) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = input.match(new RegExp(`^[ \\t]*(?:@Test )?(?:(?:private|public|protected) )?(?:static )?${escapedName}`, 'm'));
  assert.ok(match, 'The actual selected AndroidTest method must exist');
  const start = match.index;
  let depth = 0, quoted = false, escaped = false;
  for (let i = input.indexOf('{', start); i < input.length; ++i) {
    const char = input[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') ++depth;
    else if (char === '}' && --depth === 0) return input.slice(start, i + 1).replace('@Test ', '');
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

function compiled(body, main, failedOracle) {
  assert.ok(existsSync(join(jbr, 'javac.exe')) && existsSync(join(jbr, 'java.exe')), 'Existing JBR compiler required; no installation or skip');
  const directory = mkdtempSync(join(tmpdir(), 'kub-nmpv-cleanup-'));
  try {
    writeFileSync(join(directory, 'ProbeFixture.java'), `
import java.util.concurrent.atomic.AtomicBoolean;
public class ProbeFixture {
  interface NativeStateProbe { boolean verifiedForRecipient(MainActivity activity, String expectedRecipient); }
  static class Plugin {}
  static class MessagePreviewsPlugin extends Plugin {
    boolean verified = true;
    boolean requested, initialized, pending, committed, retired;
    boolean hasVerifiedBinding(String recipient) { return verified && ("fictional-recipient".equals(recipient) || RECIPIENT.equals(recipient)); }
    boolean requestQaComposition(String recipient) { requested = true; return RECIPIENT.equals(recipient); }
    boolean hasQaCompositionPhase(String phase) {
      switch (phase) {
        case "INITIALIZED": return initialized;
        case "PENDING": return pending;
        case "COMMITTED": return committed;
        case "RETIRED": return retired;
        default: return false;
      }
    }
  }
  static class PluginHandle { Plugin plugin; PluginHandle(Plugin value) { plugin = value; } Plugin getInstance() { return plugin; } }
  static class Bridge {
    Plugin plugin;
    Bridge(Plugin value) { plugin = value; }
    PluginHandle getPlugin(String name) { return new PluginHandle(plugin); }
  }
  static class MainActivity { Bridge bridge; MainActivity(Plugin value) { bridge = new Bridge(value); } Bridge getBridge() { return bridge; } }
  static class ActivityScenario<T> implements AutoCloseable {
    MainActivity screen;
    ActivityScenario(MainActivity value) { screen = value; }
    static ActivityScenario<MainActivity> launch(Class<MainActivity> type) {
      current = new MessagePreviewsPlugin(); current.verified = false;
      return new ActivityScenario<MainActivity>(new MainActivity(current));
    }
    void onActivity(java.util.function.Consumer<MainActivity> callback) { callback.accept(screen); }
    public void close() { closed = true; }
  }
  static class Looper { static final Object MAIN = new Object(); static Object myLooper() { return MAIN; } static Object getMainLooper() { return MAIN; } }
  static class Bundle {
    String getString(String key) {
      return "qa_recipient_id".equals(key) ? RECIPIENT : "qa_user".equals(key) ? "0" : "fictional-qa-value";
    }
    void remove(String key) {}
  }
  static class InstrumentationRegistry { static Bundle getArguments() { return new Bundle(); } }
  static class Process { static int myUid() { return 10001; } }
  static class QaUserIsolation { static boolean matches(String user, int uid) { return "0".equals(user) && uid == 10001; } }
  static class SystemClock { static long time; static long elapsedRealtime() { return time; } static void sleep(long delay) { time += delay; } }
  static final String RECIPIENT = "00000000-0000-4000-8000-000000000001";
  static final String OPEN_ACCOUNT_MENU = "menu", SELECT_SIGN_OUT = "row", CONFIRM_SIGN_OUT = "confirm", SIGNED_OUT_VIEW = "guest", LOGOUT_SURFACE_OPEN = "overlay";
  static String events = "";
  static boolean keepBinding, showGuest = true, retireAtMenu, refuseMenu, lostRetirement, closed, delayedGuest;
  static int screenState = 1, mode, confirmations, confirmationCalls, menuClicks, rowClicks;
  static long guestAt;
  static MessagePreviewsPlugin current;
  static void assertTrue(String message, boolean result) { if (!result) throw new AssertionError(message); }
  static void assertNotNull(String message, Object value) { assertTrue(message, value != null); }
  static void requireClosedCapabilities(ActivityScenario<MainActivity> activity, long deadline) { events += "cap,"; }
  static void requireQaBridge(ActivityScenario<MainActivity> activity) { events += "bridge,"; }
  // Fictional Android/browser/Auth ports only. The test methods and cleanup decisions below are actual source.
  static boolean loginRenderedQaSession(ActivityScenario<MainActivity> activity, NativeStateProbe probe, String recipient,
      String email, String password, long deadline) {
    events += "login,";
    current.initialized = current.pending = true;
    if (mode == 5) {
      current.initialized = current.pending = current.verified = false; screenState = 0;
      SystemClock.time = deadline + 1;
      throw new AssertionError("FORCED_LOGIN_FAILURE");
    }
    if (mode == 1 || mode == 2 || mode == 4) {
      current.verified = false; screenState = mode == 2 ? 4 : 1;
      SystemClock.time = deadline + 1;
      throw new AssertionError("FORCED_LOGIN_FAILURE");
    }
    current.verified = true; current.committed = mode != 3;
    return true;
  }
  static boolean readVerified(ActivityScenario<MainActivity> activity, NativeStateProbe probe, String recipient) {
    return probe.verifiedForRecipient(activity.screen, recipient);
  }
  static boolean evaluateBoolean(ActivityScenario<MainActivity> activity, String script, long deadline) {
    events += script + ",";
    if (mode == 4 && "guest".equals(script)) throw new IllegalStateException("FICTIONAL_PRIVATE_ERROR");
    if ("menu".equals(script) && retireAtMenu) ((MessagePreviewsPlugin) activity.screen.bridge.plugin).verified = false;
    if ("guest".equals(script)) {
      if (guestAt > 0 && SystemClock.time >= guestAt) screenState = 0;
      return screenState == 0 && showGuest;
    }
    if ("overlay".equals(script)) return screenState == 2 || screenState == 3;
    if ("menu".equals(script)) { if (refuseMenu || screenState != 1) return false; ++menuClicks; screenState = 2; return true; }
    if ("row".equals(script)) { if (screenState != 2) return false; ++rowClicks; screenState = 3; return true; }
    if ("confirm".equals(script)) {
      if (screenState != 3) return false;
      ++confirmationCalls;
      if (mode == 9 && confirmationCalls == 1) {
        SystemClock.time = deadline + 1;
        return false;
      }
      ++confirmations;
      MessagePreviewsPlugin plugin = (MessagePreviewsPlugin) activity.screen.bridge.plugin;
      if (!keepBinding) plugin.verified = false;
      if (plugin.requested && plugin.pending && !lostRetirement) plugin.retired = true;
      if (mode >= 6 && mode <= 8) {
        SystemClock.time = deadline + 1;
        if (mode != 8) guestAt = SystemClock.time + 1000;
        if (mode != 6) throw new AssertionError("FORCED_CONFIRM_CALLBACK_LOST");
      }
      else if (delayedGuest) guestAt = SystemClock.time + 1000;
      else screenState = 0;
      return true;
    }
    return true;
  }
  ${body}
  public static void main(String[] args) throws Exception { ${main} }
}`);
    const build = spawnSync(join(jbr, 'javac.exe'), ['-encoding', 'UTF-8', '-d', directory, join(directory, 'ProbeFixture.java')], { timeout: 15_000, windowsHide: true });
    assert.equal(build.error, undefined, 'Bounded JBR compile must finish');
    assert.equal(build.status, 0, `Extracted Java methods must compile against fictional ports\n${build.stderr}`);
    const result = spawnSync(join(jbr, 'java.exe'), ['-cp', directory, 'ProbeFixture'], { timeout: 10_000, windowsHide: true });
    assert.equal(result.error, undefined, 'Bounded JBR scenario must finish');
    if (failedOracle) {
      assert.equal(result.status, 1);
      assert.ok(result.stderr.toString().includes(`AssertionError: ${failedOracle}`), 'Mutation must reach its named behavioral assertion');
    } else assert.equal(result.status, 0, result.stderr.toString());
    return result.status;
  } finally {
    const actual = realpathSync(directory);
    assert.equal(dirname(actual), realpathSync(tmpdir()));
    assert.equal(actual, resolve(directory));
    assert.ok(basename(actual).startsWith('kub-nmpv-cleanup-'));
    rmSync(actual, { recursive: true, force: true });
  }
}

test('compiled actual getter wiring uses the activity plugin and forwards the exact expected recipient', () => {
  const binding = [method('NativeStateProbe requireNativeStateProbe()'), method('MessagePreviewsPlugin readMessagePreviewsPlugin(')].join('\n');
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
  assert.notEqual(compiled(omission, check, 'wrong recipient'), 0, 'Compiled expected-recipient forwarding omission must fail');
});

test('compiled actual final flow requires UI logout plus guest and retired native state', () => {
  const body = [
    method('final class LogoutAttempt'),
    method('NativeStateProbe requireNativeStateProbe()'),
    method('MessagePreviewsPlugin readMessagePreviewsPlugin('),
    method('void requireRenderedLogoutClick('),
    method('void logoutRenderedQaSession('),
    method('boolean confirmRenderedSignOut('),
    'static void finish(ActivityScenario<MainActivity> activity, NativeStateProbe nativeProbe, String expectedRecipient, long deadline) throws Exception { logoutRenderedQaSession(activity, nativeProbe, expectedRecipient, new LogoutAttempt(), deadline); }',
  ].join('\n');
  const check = `
    for (int mode = 0; mode < 5; ++mode) {
      SystemClock.time = 0; events = ""; screenState = 1; keepBinding = mode == 1; showGuest = mode != 2;
      retireAtMenu = mode == 3; refuseMenu = mode == 4;
      MessagePreviewsPlugin plugin = new MessagePreviewsPlugin();
      ActivityScenario<MainActivity> activity = new ActivityScenario<>(new MainActivity(plugin));
      boolean refused = false;
      try { finish(activity, requireNativeStateProbe(), "fictional-recipient", 1000); }
      catch (AssertionError expected) { refused = true; }
      assertTrue("cleanup outcome", refused == (mode != 0));
      if (mode == 0) assertTrue("actual final flow", "menu,row,confirm,guest,".equals(events));
      if (mode >= 3) assertTrue("no retired/missing-menu confirmation", !events.contains("confirm,"));
    }
  `;
  assert.equal(compiled(body, check), 0);
  for (const [literal, replacement, oracle] of [
    ['logoutRenderedQaSession(activity, nativeProbe, expectedRecipient, new LogoutAttempt(), deadline);', '', 'actual final flow'],
    ['&& !readVerified(activity, probe, expectedRecipient)', '', 'cleanup outcome'],
    ['assertTrue("NMPV_LOGOUT_OWNER_REFUSED", readVerified(activity, probe, expectedRecipient));', '', 'cleanup outcome'],
  ]) {
    const omission = body.replace(literal, replacement);
    assert.notEqual(omission, body);
    assert.notEqual(compiled(omission, check, oracle), 0, 'Compiled cleanup omission must fail an actual final-flow control');
  }
});

function actualFlow(composition = true) {
  const input = composition ? compositionSource : source;
  const name = composition ? 'void normalQaSessionCommitsAndLogoutRetiresGenuineComposition()'
    : 'void normalQaSessionVerifiesOwnNativeDeviceWithoutPreviewActivation()';
  const selected = [
    method(name, input), method('NativeStateProbe requireNativeStateProbe()'),
    method('MessagePreviewsPlugin readMessagePreviewsPlugin('), method('void requireRenderedLogoutClick('),
    method('void logoutRenderedQaSession('), method('final class LogoutAttempt'), method('boolean confirmRenderedSignOut('),
  ];
  if (composition) selected.push(method('void requireQaCompositionRequest(', input));
  for (const [signature, text] of [
    ['long freshCleanupDeadline()', source], ['void cleanupRenderedQaSession(', source],
    ['boolean logoutRenderedQaSessionForCleanup(', source], ['void cleanupGenuineComposition(', input],
  ]) {
    if (text.includes(signature)) selected.push(method(signature, text));
  }
  const budget = source.match(/(?:private )?static final long CLEANUP_TIMEOUT_MS = [^;]+;/)?.[0] ?? '';
  return `private static final long TEST_TIMEOUT_MS = 120_000;\nprivate static final String UUID = "[0-9a-f-]{36}";\n${budget}\n${selected.join('\n')}`;
}

function logoutContinuationCheck(composition, mode) {
  const primary = mode === 6 ? 'NMPV_LOGOUT_NOT_OBSERVED'
    : mode === 9 ? 'NMPV_LOGOUT_CONFIRM_REFUSED' : 'FORCED_CONFIRM_CALLBACK_LOST';
  const replayOracle = mode === 6 ? 'TIMEOUT_MAIN_FINALLY_CONFIRMATION_NOT_REPLAYED'
    : mode === 9 ? 'KNOWN_FALSE_MAIN_FINALLY_SINGLE_CONFIRMATION' : 'LOST_CALLBACK_MAIN_FINALLY_CONFIRMATION_NOT_REPLAYED';
  return `
    mode = ${mode};
    AssertionError failure = null;
    try { new ProbeFixture().${composition ? 'normalQaSessionCommitsAndLogoutRetiresGenuineComposition' : 'normalQaSessionVerifiesOwnNativeDeviceWithoutPreviewActivation'}(); }
    catch (AssertionError expected) { failure = expected; }
    assertTrue("MAIN_LOGOUT_PRIMARY_PRESERVED", failure != null && "${primary}".equals(failure.getMessage()));
    assertTrue("${replayOracle}", confirmations == 1 && confirmationCalls == ${mode === 9 ? 2 : 1});
    assertTrue("MAIN_FINALLY_CONTROLS_NOT_REPLAYED", menuClicks == 1 && rowClicks == 1);
    ${mode === 8 ? `
      assertTrue("MAIN_FINALLY_UNKNOWN_FIXED_LABEL", failure.getSuppressed().length == 1
        && "NMPV_QA_LOGOUT_CLEANUP_UNKNOWN".equals(failure.getSuppressed()[0].getMessage()));
      assertTrue("MAIN_FINALLY_UNKNOWN_FIXED_BUDGET", SystemClock.time == 140001 && screenState == 3);
    ` : `
      assertTrue("MAIN_FINALLY_RENDERED_LOGOUT_OBSERVED", screenState == 0 && !current.verified && failure.getSuppressed().length == 0);
      ${composition ? 'assertTrue("MAIN_FINALLY_EXACT_RETIREMENT", current.retired);' : ''}
    `}
    assertTrue("MAIN_FINALLY_LIFECYCLE_FALLBACK", closed);
  `;
}

for (const composition of [false, true]) {
  for (const [mode, name] of [
    [6, 'timeout after confirmed dispatch'], [7, 'lost confirm callback with eventual signed-out view'],
    [8, 'lost confirm callback with bounded UNKNOWN'], [9, 'known false permits a later single confirmation'],
  ]) {
    test(`compiled actual ${composition ? 'composition' : 'ordinary'} main logout to finally: ${name}`, () => {
      assert.equal(compiled(actualFlow(composition), logoutContinuationCheck(composition, mode)), 0);
    });
  }
}

test('compiled actual main logout to finally omission mutants reach the replay assertion', () => {
  for (const composition of [false, true]) {
    const body = actualFlow(composition);
    const literal = composition ? 'compositionRequested, logoutAttempt, freshCleanupDeadline());'
      : 'cleanupRenderedQaSession(activity, nativeProbe, expectedRecipient, logoutAttempt, freshCleanupDeadline());';
    const replacement = composition ? 'compositionRequested, new LogoutAttempt(), freshCleanupDeadline());'
      : 'cleanupRenderedQaSession(activity, nativeProbe, expectedRecipient, new LogoutAttempt(), freshCleanupDeadline());';
    const mutant = body.replace(literal, replacement);
    assert.notEqual(mutant, body, 'Shared invocation-local confirmation guard omission must apply');
    for (const [mode, name, oracle] of [
      [6, 'timeout', 'TIMEOUT_MAIN_FINALLY_CONFIRMATION_NOT_REPLAYED'],
      [7, 'lost confirm callback', 'LOST_CALLBACK_MAIN_FINALLY_CONFIRMATION_NOT_REPLAYED'],
    ]) {
      const check = logoutContinuationCheck(composition, mode);
      assert.equal(compiled(mutant, check, oracle), 1);
      console.log(`COMPILED_RED ${composition ? 'composition' : 'ordinary'} main/finally ${name}: ${oracle}`);
      assert.equal(compiled(body, check), 0);
      console.log(`COMPILED_GREEN ${composition ? 'composition' : 'ordinary'} main/finally ${name}`);
    }
  }
  for (const [name, literal, mode] of [
    ['pre-dispatch attempted omission', 'attempt.confirmationAttempted = true;', 7],
    ['known false release omission', 'if (!submitted) attempt.confirmationAttempted = false;', 9],
  ]) {
    const body = actualFlow();
    const mutant = body.replace(literal, '');
    assert.notEqual(mutant, body, `Actual selected mutation must apply: ${name}`);
    const oracle = mode === 9 ? 'KNOWN_FALSE_MAIN_FINALLY_SINGLE_CONFIRMATION' : 'LOST_CALLBACK_MAIN_FINALLY_CONFIRMATION_NOT_REPLAYED';
    assert.equal(compiled(mutant, logoutContinuationCheck(true, mode), oracle), 1);
    console.log(`COMPILED_MUTANT_KILLED ${name}`);
  }
});

const refusedFlowCheck = composition => `
  mode = 1;
  AssertionError failure = null;
  try { new ProbeFixture().${composition ? 'normalQaSessionCommitsAndLogoutRetiresGenuineComposition' : 'normalQaSessionVerifiesOwnNativeDeviceWithoutPreviewActivation'}(); }
  catch (AssertionError expected) { failure = expected; }
  assertTrue("PRIMARY_FAILURE_PRESERVED", failure != null && "FORCED_LOGIN_FAILURE".equals(failure.getMessage()));
  assertTrue("FAILURE_PATH_RENDERED_LOGOUT_REQUIRED", screenState == 0 && events.contains("confirm,"));
  assertTrue("FAILED_BINDING_CLEARED", !current.verified);
  ${composition ? 'assertTrue("EXACT_RETIREMENT_REQUIRED", current.retired);' : ''}
  assertTrue("CLEANUP_BEFORE_ACTIVITY_CLOSE", closed);
  assertTrue("KNOWN_CLEANUP_NOT_UNKNOWN", failure.getSuppressed().length == 0);
`;

test('compiled actual composition finally logs out a refused expired invocation with a fresh budget', () => {
  assert.equal(compiled(actualFlow(), refusedFlowCheck(true)), 0);
});

test('compiled actual ordinary verification finally logs out after its primary failure', () => {
  assert.equal(compiled(actualFlow(false), refusedFlowCheck(false)), 0);
});

test('compiled actual composition reports UNKNOWN cleanup for an unavailable rendered surface', () => {
  const check = `
    mode = 2;
    AssertionError failure = null;
    try { new ProbeFixture().normalQaSessionCommitsAndLogoutRetiresGenuineComposition(); }
    catch (AssertionError expected) { failure = expected; }
    assertTrue("PRIMARY_FAILURE_PRESERVED", failure != null && "FORCED_LOGIN_FAILURE".equals(failure.getMessage()));
    assertTrue("UNKNOWN_CLEANUP_REPORTED", failure.getSuppressed().length == 1
      && "NMPV_QA_LOGOUT_CLEANUP_UNKNOWN".equals(failure.getSuppressed()[0].getMessage()));
    assertTrue("FRESH_FIXED_CLEANUP_BUDGET", SystemClock.time == 140001);
    assertTrue("UNKNOWN_IS_NOT_RETIREMENT", !current.retired && confirmations == 0);
    assertTrue("REAL_LIFECYCLE_FALLBACK", closed);
  `;
  assert.equal(compiled(actualFlow(), check), 0);
});

const unavailableSurfaceCheck = `
  mode = 2;
  AssertionError failure = null;
  try { new ProbeFixture().normalQaSessionCommitsAndLogoutRetiresGenuineComposition(); }
  catch (AssertionError expected) { failure = expected; }
  assertTrue("PRIMARY_FAILURE_PRESERVED", failure != null && "FORCED_LOGIN_FAILURE".equals(failure.getMessage()));
  assertTrue("UNKNOWN_CLEANUP_REPORTED", failure.getSuppressed().length == 1
    && "NMPV_QA_LOGOUT_CLEANUP_UNKNOWN".equals(failure.getSuppressed()[0].getMessage()));
  assertTrue("FRESH_FIXED_CLEANUP_BUDGET", SystemClock.time == 140001);
`;

const lostRetirementCheck = `
  mode = 1; lostRetirement = true;
  AssertionError failure = null;
  try { new ProbeFixture().normalQaSessionCommitsAndLogoutRetiresGenuineComposition(); }
  catch (AssertionError expected) { failure = expected; }
  assertTrue("PRIMARY_FAILURE_PRESERVED", failure != null && "FORCED_LOGIN_FAILURE".equals(failure.getMessage()));
  assertTrue("ORDINARY_LOGOUT_BEFORE_UNKNOWN", screenState == 0 && confirmations == 1 && !current.verified);
  assertTrue("UNKNOWN_RETIREMENT_REPORTED", failure.getSuppressed().length == 1
    && "NMPV_QA_RETIREMENT_CLEANUP_UNKNOWN".equals(failure.getSuppressed()[0].getMessage()));
  assertTrue("RETIREMENT_WAIT_IS_BOUNDED", SystemClock.time == 140001 && !current.retired && closed);
`;

const delayedLogoutCheck = `
  current = new MessagePreviewsPlugin(); current.verified = false; delayedGuest = true;
  ActivityScenario<MainActivity> activity = new ActivityScenario<>(new MainActivity(current));
  boolean unknown = false;
  try { cleanupRenderedQaSession(activity, requireNativeStateProbe(), RECIPIENT, new LogoutAttempt(), freshCleanupDeadline()); }
  catch (AssertionError refusal) { unknown = true; }
  assertTrue("DELAYED_LOGOUT_COMPLETES", !unknown);
  assertTrue("CONFIRMATION_IS_NOT_REPLAYED", confirmations == 1 && menuClicks == 1 && rowClicks == 1);
`;

test('compiled actual composition retains COMMITTED success checks and distinguishes runtime clear from exact erasure', () => {
  const body = actualFlow();
  assert.equal(compiled(body, 'new ProbeFixture().normalQaSessionCommitsAndLogoutRetiresGenuineComposition(); assertTrue("SUCCESS_WITH_EXACT_RETIREMENT", current.retired && !current.verified && confirmations == 1 && closed);'), 0);
  assert.equal(compiled(body, lostRetirementCheck), 0);
  assert.equal(compiled(body, `
    mode = 3;
    AssertionError failure = null;
    try { new ProbeFixture().normalQaSessionCommitsAndLogoutRetiresGenuineComposition(); }
    catch (AssertionError expected) { failure = expected; }
    assertTrue("COMMITTED_SUCCESS_CONDITION_PRESERVED", failure != null
      && "NMPV_QA_COMPOSITION_COMMIT_NOT_OBSERVED".equals(failure.getMessage()));
    assertTrue("REFUSED_COMMIT_STILL_CLEANED", current.retired && confirmations == 1 && failure.getSuppressed().length == 0);
  `), 0);
});

test('compiled actual bounded cleanup resumes partial rendered logout without a verified precondition or confirmation replay', () => {
  const check = `
    for (int initial = 0; initial < 4; ++initial) {
      SystemClock.time = 0; screenState = initial; confirmations = menuClicks = rowClicks = 0;
      current = new MessagePreviewsPlugin(); current.verified = false;
      ActivityScenario<MainActivity> activity = new ActivityScenario<>(new MainActivity(current));
      cleanupRenderedQaSession(activity, requireNativeStateProbe(), RECIPIENT, new LogoutAttempt(), freshCleanupDeadline());
      assertTrue("PARTIAL_LOGOUT_COMPLETES", screenState == 0);
      assertTrue("PARTIAL_LOGOUT_SINGLE_CONFIRMATION", confirmations == (initial == 0 ? 0 : 1));
      assertTrue("PARTIAL_LOGOUT_NO_MENU_TOGGLE", menuClicks == (initial == 1 ? 1 : 0));
      assertTrue("PARTIAL_LOGOUT_NO_ROW_REPLAY", rowClicks == (initial == 1 || initial == 2 ? 1 : 0));
    }
  `;
  assert.equal(compiled(actualFlow(), check), 0);
  assert.equal(compiled(actualFlow(), delayedLogoutCheck), 0);
});

test('compiled actual cleanup does not expose raw browser/native exceptions', () => {
  const check = `
    mode = 4;
    AssertionError failure = null;
    try { new ProbeFixture().normalQaSessionCommitsAndLogoutRetiresGenuineComposition(); }
    catch (AssertionError expected) { failure = expected; }
    assertTrue("SANITIZED_CLEANUP_FAILURE", failure != null && failure.getSuppressed().length == 1
      && "NMPV_QA_LOGOUT_CLEANUP_UNKNOWN".equals(failure.getSuppressed()[0].getMessage())
      && failure.getSuppressed()[0].getCause() == null && failure.getSuppressed()[0].getSuppressed().length == 0);
    assertTrue("LIFECYCLE_AFTER_BROWSER_REFUSAL", closed);
  `;
  assert.equal(compiled(actualFlow(), check), 0);
});

test('compiled actual request without a vault attempt is not fabricated as RETIRED', () => {
  const check = `
    mode = 5;
    AssertionError failure = null;
    try { new ProbeFixture().normalQaSessionCommitsAndLogoutRetiresGenuineComposition(); }
    catch (AssertionError expected) { failure = expected; }
    assertTrue("NO_ATTEMPT_PRIMARY_FAILURE", failure != null && "FORCED_LOGIN_FAILURE".equals(failure.getMessage()));
    assertTrue("NO_ATTEMPT_IS_NOT_RETIREMENT", !current.initialized && !current.pending && !current.retired
      && confirmations == 0 && failure.getSuppressed().length == 1
      && "NMPV_QA_RETIREMENT_CLEANUP_UNKNOWN".equals(failure.getSuppressed()[0].getMessage()));
    assertTrue("NO_ATTEMPT_BOUNDED_LIFECYCLE", SystemClock.time == 140001 && closed);
  `;
  assert.equal(compiled(actualFlow(), check), 0);
});

test('compiled literal cleanup mutants reach named behavioral failures', () => {
  const body = actualFlow();
  for (const [name, literal, replacement, check, oracle] of [
    ['finally cleanup omission', 'cleanupGenuineComposition(activity, nativeProbe, retirementProbe, expectedRecipient,\n                            compositionRequested, logoutAttempt, freshCleanupDeadline());', '', refusedFlowCheck(true), 'FAILURE_PATH_RENDERED_LOGOUT_REQUIRED'],
    ['live verified cleanup precondition', 'if (logoutRenderedQaSessionForCleanup(activity, attempt, deadline)) {', 'if (readVerified(activity, probe, expectedRecipient) && logoutRenderedQaSessionForCleanup(activity, attempt, deadline)) {', refusedFlowCheck(true), 'FAILURE_PATH_RENDERED_LOGOUT_REQUIRED'],
    ['expired primary budget reuse', 'compositionRequested, logoutAttempt, freshCleanupDeadline());', 'compositionRequested, logoutAttempt, deadline);', refusedFlowCheck(true), 'FAILURE_PATH_RENDERED_LOGOUT_REQUIRED'],
    ['renewed cleanup budget', 'CLEANUP_TIMEOUT_MS = 20_000', 'CLEANUP_TIMEOUT_MS = 40_000', unavailableSurfaceCheck, 'FRESH_FIXED_CLEANUP_BUDGET'],
    ['runtime clear substituted for exact retirement', 'if (readVerified(activity, retirementProbe, expectedRecipient)) return;', 'if (!readVerified(activity, nativeProbe, expectedRecipient)) return;', lostRetirementCheck, 'UNKNOWN_RETIREMENT_REPORTED'],
    ['logout UNKNOWN omission', 'throw new AssertionError("NMPV_QA_LOGOUT_CLEANUP_UNKNOWN");', 'return;', unavailableSurfaceCheck, 'UNKNOWN_CLEANUP_REPORTED'],
    ['confirmation replay', 'attempt.confirmationAttempted = true;', 'attempt.confirmationAttempted = false;', delayedLogoutCheck, 'DELAYED_LOGOUT_COMPLETES'],
  ]) {
    const mutant = body.replace(literal, replacement);
    assert.notEqual(mutant, body, `Actual selected mutation must apply: ${name}`);
    assert.equal(compiled(body, check), 0, `Baseline must pass: ${name}`);
    assert.equal(compiled(mutant, check, oracle), 1);
    console.log(`COMPILED_MUTANT_KILLED ${name}: ${oracle}`);
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

test('actual cleanup scripts do not classify a failed-login screen without form or logout controls as logged out', () => {
  const helper = constant('LOGOUT_HELPERS');
  const context = {
    location: { pathname: '/login' },
    getComputedStyle: () => ({ visibility: 'visible' }),
    document: { querySelectorAll: () => [], getElementById: () => null },
  };
  for (const name of ['SIGNED_OUT_VIEW', 'OPEN_ACCOUNT_MENU', 'SELECT_SIGN_OUT', 'CONFIRM_SIGN_OUT', 'LOGOUT_SURFACE_OPEN']) {
    assert.equal(runInNewContext(constant(name, { LOGOUT_HELPERS: helper }), context), false, name);
  }
  const surface = constant('LOGOUT_SURFACE_OPEN', { LOGOUT_HELPERS: helper });
  let visible = true;
  const modal = { getClientRects: () => visible ? [{}] : [] };
  const unknownModal = {
    ...context,
    document: { querySelectorAll: selector => selector === '[role=menu][data-kub-menu=true],[role=dialog][aria-modal=true]' ? [modal] : [], getElementById: () => null },
  };
  assert.equal(runInNewContext(surface, unknownModal), true);
  assert.equal(runInNewContext(constant('CONFIRM_SIGN_OUT', { LOGOUT_HELPERS: helper }), unknownModal), false);
  visible = false;
  assert.equal(runInNewContext(surface, unknownModal), false);
});
