import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';

const file = path.resolve(import.meta.dirname, '../../android/app/src/androidTest/java/com/kub/messenger/NativeMessagePreviewUserChoiceTest.java');
const source = readFileSync(file, 'utf8');
const method = (text, name) => {
  const body = text.match(new RegExp(`^    (?:private )?static [^\\n]+ ${name}\\([^]*?^    \\}`, 'm'))?.[0];
  assert.ok(body, 'EXTRACTED_METHOD_' + name);
  return body;
};
function probe(text, assertions) {
  const inner = text.match(/\n                \} catch \(Exception \| AssertionError ignored\) \{\s*([^]*?)\n                \} finally \{/)?.[1];
  const outer = text.match(/\n        \} catch \(Exception \| AssertionError ignored\) \{\s*([^]*?)\n        \} finally \{/)?.[1];
  assert.ok(inner && outer, 'REAL_PHASE_AND_OUTER_CATCH_REQUIRED');
  const diagnostic = text.match(/^    static final class ArmDiagnostics \{[^]*?^    \}/m)?.[0] ?? '';
  const geometry = text.match(/^    static final class InputGeometry \{[^]*?^    \}/m)?.[0];
  assert.ok(geometry, 'REAL_DEADLINE_HELPER_REQUIRED');
  const java = `import java.util.concurrent.atomic.*;
import java.util.function.Consumer;
public final class ChoiceDiagnosticProbe {
${text.match(/    private static final long CHOICE_WINDOW_MS = [0-9_]+;/)?.[0]}
${diagnostic}
${geometry}
${method(text, 'append')}
${method(text, 'requestOnce')}
static final String HOSTILE="arbitrary-private-text://fictional.invalid/value";
static class Lifecycle { enum State { DESTROYED, INITIALIZED, CREATED, STARTED, RESUMED } }
static class MainActivity { Object getBridge(){return this;} Object getApplication(){return this;} }
static class ActivityScenario<T> {
  Lifecycle.State state=Lifecycle.State.RESUMED; boolean stateThrows, dispatchThrows, afterThrows, skip;
  T screen; ActivityScenario(T screen){this.screen=screen;}
  Lifecycle.State getState(){if(stateThrows)throw new IllegalStateException(HOSTILE);return state;}
  void onActivity(Consumer<T> action){if(dispatchThrows)throw new IllegalStateException(HOSTILE);if(!skip)action.accept(screen);if(afterThrows)throw new IllegalStateException(HOSTILE);}
}
static class SystemClock { static long elapsedRealtime(){return 1000;} }
static class MessagePreviewQaUserChoice {
  static boolean onMain(){return main;} static boolean local(Object bridge){return local;}
  static boolean ownActivity(Object application,Object bridge){return own;}
}
static class MessagePreviewsPlugin {
  boolean hasVerifiedBinding(String recipient){return verified;}
  boolean requestQaUserChoice(String recipient){calls++;if(nativeThrows)throw new IllegalStateException(HOSTILE);return accepted;}
}
static boolean main, local, own, web, verified, accepted, nativeThrows; static int calls;
static MessagePreviewsPlugin owner, observed; static ActivityScenario<MainActivity> activity;
static Object localWebView(MainActivity screen){return web?screen:null;}
static MessagePreviewsPlugin readMessagePreviewsPlugin(MainActivity screen){return observed;}
static void assertTrue(String code,boolean value){if(!value)throw new AssertionError(code);}
static void reset(){main=local=own=web=accepted=true;verified=nativeThrows=false;calls=0;
  owner=new MessagePreviewsPlugin();observed=owner;activity=new ActivityScenario<>(new MainActivity());}
static void equal(Object got,Object want,String code){if(!java.util.Objects.equals(got,want))throw new AssertionError(code);}
static void arm(String code,int count){
  try { requestOnce(activity,owner,"00000000-0000-0000-0000-000000000001");throw new AssertionError("TEST_ARM_UNEXPECTED_SUCCESS"); }
  catch(AssertionError error){equal(error.getMessage(),code,"TEST_ARM_FIXED_CODE");}
  equal(calls,count,"TEST_ARM_REQUEST_COUNT");
}
static AssertionError phase(String phase,Throwable ignored){AssertionError failure=null;${inner}\nreturn failure;}
static AssertionError report(String phase,AssertionError retained,Throwable ignored){try {${outer}\n} catch(AssertionError result){return result;}}
public static void main(String[] args){${assertions}\nSystem.out.println("PASS DIAGNOSTICS_ONLY");}
}`;
  const prefix = 'nmpv-choice-diagnostics-';
  const out = mkdtempSync(path.join(tmpdir(), prefix));
  try {
    const input = path.join(out, 'ChoiceDiagnosticProbe.java');
    writeFileSync(input, java);
    const bin = process.env.LETSCUBE_TEST_JAVA_BIN ?? 'C:/Program Files/Android/Android Studio/jbr/bin';
    const executable = name => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
    assert.ok(existsSync(executable('javac')), 'EXISTING_JVM_REQUIRED_NO_INSTALL_OR_PATH_CHANGE');
    const compiled = spawnSync(executable('javac'), ['-encoding', 'UTF-8', '-g:none', '-d', out, input], {encoding:'utf8', timeout:15_000});
    assert.equal(compiled.status, 0, 'JAVA_COMPILE_FAILURE_IS_NOT_BEHAVIORAL_RED');
    const result = spawnSync(executable('java'), ['-cp', out, 'ChoiceDiagnosticProbe'], {encoding:'utf8', timeout:5_000});
    assert.equal(result.error, undefined, 'JVM_EXECUTION_REQUIRED');
    return {status:result.status, stdout:result.stdout.trim(), failure:result.stderr.match(/AssertionError: (TEST_[A-Z_]+)/)?.[1] ?? 'NO_FIXED_ASSERTION'};
  } finally {
    const actual = realpathSync(out);
    assert.equal(path.dirname(actual), realpathSync(tmpdir()));
    assert.ok(path.basename(actual).startsWith(prefix));
    assert.equal(actual, path.resolve(out));
    rmSync(actual, {recursive:true});
  }
}
const armCases = `
reset(); accepted=false; arm("NMPUC_ARM_NATIVE_FALSE_FAILED",1);
reset(); accepted=false; activity.afterThrows=true; arm("NMPUC_ARM_NATIVE_FALSE_FAILED",1);
reset(); nativeThrows=true; arm("NMPUC_ARM_RUNTIME_EXCEPTION_FAILED",1);
reset(); activity.dispatchThrows=true; arm("NMPUC_ARM_CALLBACK_RUNTIME_EXCEPTION_FAILED",0);
reset(); activity.skip=true; arm("NMPUC_ARM_CALLBACK_NOT_RUN_FAILED",0);
reset(); web=false; arm("NMPUC_ARM_LOCAL_WEBVIEW_FAILED",0);
reset(); observed=new MessagePreviewsPlugin(); arm("NMPUC_ARM_PLUGIN_INCARNATION_FAILED",0);
reset(); main=false; arm("NMPUC_ARM_NOT_MAIN_FAILED",0);
reset(); local=false; arm("NMPUC_ARM_NATIVE_LOCAL_FAILED",0);
reset(); own=false; arm("NMPUC_ARM_OWN_ACTIVITY_FAILED",0);
reset(); verified=true; arm("NMPUC_ARM_ALREADY_VERIFIED_FAILED",0);
reset(); activity.state=Lifecycle.State.CREATED; arm("NMPUC_ARM_STATE_CREATED_FAILED",0);
reset(); activity.state=Lifecycle.State.STARTED; arm("NMPUC_ARM_STATE_STARTED_FAILED",0);
reset(); activity.state=Lifecycle.State.DESTROYED; arm("NMPUC_ARM_STATE_DESTROYED_FAILED",0);
reset(); activity.state=Lifecycle.State.INITIALIZED; arm("NMPUC_ARM_STATE_INITIALIZED_FAILED",0);
reset(); activity.state=null; arm("NMPUC_ARM_STATE_UNKNOWN_FAILED",0);
reset(); activity.stateThrows=true; arm("NMPUC_ARM_STATE_RUNTIME_EXCEPTION_FAILED",0);
reset(); equal(requestOnce(activity,owner,"00000000-0000-0000-0000-000000000001"),121000L,"TEST_FIXED_WINDOW");
equal(calls,1,"TEST_SUCCESS_REQUEST_COUNT");`;
const catchCases = `
AssertionError first=phase("ARM",new AssertionError("NMPUC_ARM_NATIVE_FALSE_FAILED"));
equal(first.getMessage(),"NMPUC_ARM_NATIVE_FALSE_FAILED","TEST_PHASE_PRESERVES_FIRST");
append(first,"NMPUC_FINAL_NONE_UNCONFIRMED_FAILED");append(first,"NMPUC_NATIVE_RETIREMENT_UNKNOWN");
first.addSuppressed(new IllegalStateException(HOSTILE));
first.addSuppressed(new AssertionError("NMPUC_ARM_RUNTIME_EXCEPTION_FAILED"));
first.addSuppressed(new AssertionError("NMPUC_RENDERED_LOGOUT_UNKNOWN_SUFFIX"));
AssertionError finalReport=report("ARM",first,new IllegalStateException(HOSTILE));
equal(finalReport.getMessage(),"NMPUC_ARM_NATIVE_FALSE_FAILED","TEST_OUTER_PRESERVES_FIRST");
equal(finalReport.getSuppressed().length,2,"TEST_SUPPRESSED_WHITELIST");
equal(finalReport.getSuppressed()[0].getMessage(),"NMPUC_FINAL_NONE_UNCONFIRMED_FAILED","TEST_SUPPRESSED_ORDER");
equal(finalReport.getSuppressed()[1].getMessage(),"NMPUC_NATIVE_RETIREMENT_UNKNOWN","TEST_SUPPRESSED_ORDER");
equal(finalReport.getCause(),null,"TEST_NO_RAW_CAUSE");
equal(phase("ARM",new IllegalStateException(HOSTILE)).getMessage(),"NMPUC_ARM_FAILED","TEST_HOSTILE_FALLBACK");
equal(phase("ARM",new IllegalStateException("NMPUC_ARM_NATIVE_FALSE_FAILED")).getMessage(),"NMPUC_ARM_FAILED","TEST_HOSTILE_FALLBACK");
equal(phase("ARM",new AssertionError("NMPUC_ARM_NATIVE_FALSE_FAILED\\n"+HOSTILE)).getMessage(),"NMPUC_ARM_FAILED","TEST_HOSTILE_FALLBACK");
equal(phase("LOGIN",new AssertionError("NMPUC_ARM_NATIVE_FALSE_FAILED")).getMessage(),"NMPUC_LOGIN_FAILED","TEST_PHASE_BOUNDARY");
equal(report("ARM",null,new AssertionError("NMPUC_ARM_OWN_ACTIVITY_FAILED")).getMessage(),"NMPUC_ARM_OWN_ACTIVITY_FAILED","TEST_OUTER_WITHOUT_RETAINED");
equal(report("ARM",new AssertionError(HOSTILE),new AssertionError(HOSTILE)).getMessage(),"NMPUC_ARM_FAILED","TEST_HOSTILE_OUTER_FALLBACK");
equal(report("SAVE_NONE",new AssertionError("NMPUC_NATIVE_RETIREMENT_UNKNOWN"),null).getMessage(),"NMPUC_NATIVE_RETIREMENT_UNKNOWN","TEST_FIRST_CLEANUP_FAILURE");
AssertionError spoof=new AssertionError("NMPUC_ARM_NATIVE_FALSE_FAILED");
spoof.addSuppressed(new IllegalStateException("NMPUC_NATIVE_RETIREMENT_UNKNOWN"));
equal(report("ARM",spoof,null).getSuppressed().length,0,"TEST_SUPPRESSED_TYPE");`;
function green(text, assertions) {
  const result = probe(text, assertions);
  assert.equal(result.status, 0, result.failure);
  assert.equal(result.stdout, 'PASS DIAGNOSTICS_ONLY');
}
test('actual requestOnce identifies ARM boundaries and performs at most one native request', () => green(source, armCases));
test('actual phase and outer catch preserve first fixed ARM code and only whitelist suppression', () => green(source, catchCases));

const omit = code => [code, ''];
const mutants = [
  ['RESUMED requirement', 'if (state != Lifecycle.State.RESUMED)', 'if (false)', armCases, 'TEST_ARM_FIXED_CODE'],
  ...[
    ['main thread', '!MessagePreviewQaUserChoice.onMain()', 'NOT_MAIN'],
    ['local WebView', 'localWebView(screen) == null', 'LOCAL_WEBVIEW'],
    ['plugin incarnation', 'owner == null || readMessagePreviewsPlugin(screen) != owner', 'PLUGIN_INCARNATION'],
    ['native local', '!MessagePreviewQaUserChoice.local(screen.getBridge())', 'NATIVE_LOCAL'],
    ['activity owner', '!MessagePreviewQaUserChoice.ownActivity(screen.getApplication(), screen.getBridge())', 'OWN_ACTIVITY'],
    ['already verified', 'owner.hasVerifiedBinding(recipient)', 'ALREADY_VERIFIED'],
  ].map(([name, condition, code]) => [name,
    ...omit(`if (${condition}) { diagnostic.fail("NMPUC_ARM_${code}_FAILED"); return; }`), armCases, 'TEST_ARM_FIXED_CODE']),
  ['first refusal', 'first.compareAndSet(null, allowed(code) ? code : "NMPUC_ARM_FAILED");',
    'first.set(allowed(code) ? code : "NMPUC_ARM_FAILED");', armCases, 'TEST_ARM_FIXED_CODE'],
  ['native false before framework exception', ...omit('if (!accepted.get()) diagnostic.fail("NMPUC_ARM_NATIVE_FALSE_FAILED");'),
    armCases, 'TEST_ARM_FIXED_CODE', 2],
  ['single private request', 'accepted.set(owner.requestQaUserChoice(recipient));',
    'owner.requestQaUserChoice(recipient); accepted.set(owner.requestQaUserChoice(recipient));', armCases, 'TEST_ARM_REQUEST_COUNT'],
  ['phase preservation', 'failure = ArmDiagnostics.phaseFailure(phase, ignored);',
    'failure = new AssertionError("NMPUC_" + phase + "_FAILED");', catchCases, 'TEST_PHASE_PRESERVES_FIRST'],
  ['outer preservation', 'throw ArmDiagnostics.report(phase, retained);',
    'throw new AssertionError("NMPUC_" + phase + "_FAILED");', catchCases, 'TEST_OUTER_PRESERVES_FIRST'],
  ['hostile phase fallback', '"ARM".equals(phase) && allowed(code) ? code : fallback(phase)',
    '"ARM".equals(phase) && code != null ? code : fallback(phase)', catchCases, 'TEST_HOSTILE_FALLBACK'],
  ['hostile outer fallback', '|| fallback(phase).equals(code) ? code : fallback(phase)',
    '|| true ? code : fallback(phase)', catchCases, 'TEST_HOSTILE_OUTER_FALLBACK'],
  ['suppressed whitelist', 'suppressed instanceof AssertionError && cleanupCode(suppressed.getMessage())',
    'true', catchCases, 'TEST_SUPPRESSED_WHITELIST'],
];
for (const [name, before, after, assertions, failure, occurrences = 1] of mutants) {
  test('literal behavioral omission mutant killed: ' + name, () => {
    assert.equal(source.split(before).length - 1, occurrences, 'EXACT_MUTATION_TARGET');
    const result = probe(source.replace(before, after), assertions);
    assert.equal(result.status, 1, 'MUTANT_MUST_FAIL_BEHAVIOR_NOT_COMPILE');
    assert.equal(result.failure, failure);
  });
}
