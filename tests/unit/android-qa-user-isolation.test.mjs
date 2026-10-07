import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";

const source = readFileSync(new URL("../../android/app/src/androidTest/java/com/kub/messenger/QaUserIsolation.java", import.meta.url), "utf8");
const jbr = "C:/Program Files/Android/Android Studio/jbr/bin";
const probe = `package com.kub.messenger;
public class QaUserIsolationProbe {
  static void check(boolean ok,String oracle){if(!ok)throw new AssertionError(oracle);}
  public static void main(String[] args){
    check(QaUserIsolation.matches("11",1110123),"CURRENT_QA_CONTROL");
    check(QaUserIsolation.matches("10",1010123),"PREVIOUS_QA_CONTROL");
    check(!QaUserIsolation.matches("0",10123),"PRIMARY_REFUSED");
    check(!QaUserIsolation.matches("11",10123),"PRIMARY_MISMATCH_REFUSED");
    check(!QaUserIsolation.matches("10",1110123),"EXACT_PROFILE_REFUSED");
    for(String value:new String[]{null,"","-1","11x","11.0"," 11 ","+11","011","2147483648"})
      check(!QaUserIsolation.matches(value,1110123),"INVALID_ARGUMENT_REFUSED");
    System.out.println("PASS isolated QA guard");
  }
}`;
function run(text = source) {
  const directory = mkdtempSync(join(tmpdir(), "letscube-qa-isolation-"));
  try {
    const guard = join(directory, "QaUserIsolation.java"), check = join(directory, "QaUserIsolationProbe.java");
    writeFileSync(guard, text); writeFileSync(check, probe);
    const built = spawnSync(join(jbr, "javac.exe"), ["-encoding", "UTF-8", "-d", directory, guard, check], { encoding: "utf8", timeout: 10000 });
    assert.equal(built.error, undefined); assert.equal(built.status, 0, built.stderr);
    const result = spawnSync(join(jbr, "java.exe"), ["-cp", directory, "com.kub.messenger.QaUserIsolationProbe"], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined); return result;
  } finally {
    const actual = realpathSync(directory);
    assert.ok(actual.startsWith(realpathSync(tmpdir()) + sep) && actual === resolve(directory)); rmSync(actual, { recursive: true });
  }
}
test("compiled QA guard accepts exact ephemeral profile and refuses primary/malformed/mismatch", () => {
  const result = run(); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), "PASS isolated QA guard");
});
for (const [before, after, oracle] of [
  ["user == uid / 100000", "user == 10 && uid / 100000 == 10", "CURRENT_QA_CONTROL"],
  ['"[1-9][0-9]*"', '"[0-9]+"', "INVALID_ARGUMENT_REFUSED"],
  ["user == uid / 100000", "true", "PRIMARY_MISMATCH_REFUSED"],
]) {
  test(`compiled QA guard mutation: ${oracle}`, () => {
    assert.equal(source.split(before).length - 1, 1); const result = run(source.replace(before, after));
    assert.equal(result.status, 1); assert.equal(result.stdout, "");
    assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
  });
}
test("compiled QA guard mutation: accepting primary user is refused", () => {
  const changed = source.replace('"[1-9][0-9]*"', '"[0-9]+"').replace("user > 0 && ", "");
  assert.notEqual(changed, source); const result = run(changed);
  assert.equal(result.status, 1); assert.equal(result.stderr.split(/\r?\n/)[0], 'Exception in thread "main" java.lang.AssertionError: PRIMARY_REFUSED');
});
