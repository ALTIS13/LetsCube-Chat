import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function probe(change) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const home = process.env.CHAT_PUSH_TEST_JDK ?? process.env.JAVA_HOME
    ?? (process.platform === 'win32' ? 'C:/Program Files/Android/Android Studio/jbr' : null);
  const binary = name => home ? join(home, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
  if (home) assert.ok(existsSync(binary('javac')) && existsSync(binary('java')), 'reuse installed JDK only');
  const output = mkdtempSync(join(tmpdir(), 'android-update-native-'));
  try {
    const original = readFileSync(join(root, 'android/app/src/main/java/com/kub/messenger/AndroidUpdatePolicy.java'), 'utf8');
    const source = change ? change(original) : original;
    if (change) assert.notEqual(source, original, 'omission must change loaded policy');
    const policy = join(output, 'AndroidUpdatePolicy.java');
    writeFileSync(policy, source);
    const built = spawnSync(binary('javac'), ['-encoding', 'UTF-8', '-d', output,
      policy,
      join(root, 'tests/fixtures/android-update/AndroidUpdatePolicyProbe.java')], { encoding: 'utf8', timeout: 30000 });
    assert.equal(built.status, 0, built.stderr);
    return spawnSync(binary('java'), ['-cp', output, 'com.kub.messenger.AndroidUpdatePolicyProbe'],
      { encoding: 'utf8', timeout: 10000 });
  } finally {
    assert.ok(realpathSync(output).startsWith(realpathSync(tmpdir()) + sep));
    rmSync(output, { recursive: true, force: true });
  }
}
test('actual Java Android update policy enforces identity, bounded bytes, confinement and resume guards', () => {
  const result = probe();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^PASS_ANDROID_UPDATE_POLICY [3-9]\d\s*$/);
});
for (const [name, from, to, assertion] of [
  ['SHA', 'require(hex(digest.digest()).equals(release.sha256), "HASH");', '', 'POLICY_MUST_REFUSE'],
  ['signer', 'require(archive.signers.equals(installed.signers), "SIGNER");', '', 'POLICY_MUST_REFUSE'],
  ['same-version', 'if (release.build <= installed.build) return false;', '', 'POLICY_MUST_REFUSE'],
  ['finite-size', '100L * 1024 * 1024', '200L * 1024 * 1024', 'POLICY_MUST_REFUSE'],
  ['confinement', 'require(file.getParentFile().equals(root) && file.getName().equals(name), "PATH");', '', 'POLICY_MUST_REFUSE'],
  ['cancel', 'if (!current.getAsBoolean()) throw new IOException("CANCELLED");', '', 'RETIRED_COPY_ACCEPTED'],
]) test(`loaded omission of ${name} is rejected by a literal native outcome`, () => {
  const result = probe(source => source.replace(from, to));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`AssertionError: ${assertion}`));
});
