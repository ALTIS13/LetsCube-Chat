import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extract, prepare, root, sha256 } from './prepare.mjs';

test('bundles the current controller bytes, not a maintained copy', () => {
  const receipt = prepare();
  const source = readFileSync(new URL('artifacts/kub/index.html', root), 'utf8');
  const fixture = readFileSync(new URL('output/native-boot-android/assets/boot.html', root), 'utf8');
  assert.equal(extract(fixture).controller, extract(source).controller);
  assert.equal(extract(fixture).fragment, extract(source).fragment);
  assert.equal(receipt.sourceSha256, sha256(source));
  assert.ok(!fixture.includes('/src/main.tsx'));
});
test('rejects missing or ambiguous source controllers before packaging', () => {
  assert.throws(() => extract('<html></html>'), /Exactly one/);
  const source = readFileSync(new URL('artifacts/kub/index.html', root), 'utf8');
  assert.throws(() => extract(source + source), /Exactly one/);
});
test('negative controls differ only in the named controller mutation', () => {
  prepare();
  const source = extract(readFileSync(new URL('artifacts/kub/index.html', root), 'utf8')).controller;
  for (const name of ['no-deadline', 'no-ready-guard', 'no-reload']) {
    const mutant = extract(readFileSync(new URL(`output/native-boot-android/assets/${name}.html`, root), 'utf8')).controller;
    assert.notEqual(mutant, source);
  }
});
