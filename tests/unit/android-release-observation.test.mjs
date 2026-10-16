import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {runReleaseCommand} from '../../scripts/build-android-release.mjs';
const nodeCommand=process.platform==='win32'?'node.exe':process.execPath;

test('release runner exposes actual successful build markers, not arbitrary child output', () => {
  const dir=mkdtempSync(join(tmpdir(),'letscube-release-output-'));
  const fixture=join(dir,'child.cjs');
  const output=[];
  const previous=console.log;
  try {
    writeFileSync(fixture,"console.log('private-test-fixture-no-forward');console.log('sw.js build 0123456789abcdef');console.log('\\x1b[32m✓ built in 3.21s\\x1b[0m');console.log('BUILD SUCCESSFUL in 9s');");
    console.log=(value)=>output.push(value);
    const result=runReleaseCommand(nodeCommand,[fixture],process.env,dir);
    assert.ok(result.includes('private-test-fixture-no-forward'),'caller still receives its original result');
    assert.deepEqual(output,['sw.js build 0123456789abcdef','built in 3.21s','BUILD SUCCESSFUL in 9s']);
  } finally {console.log=previous;rmSync(dir,{recursive:true,force:true});}
});

test('failed child cannot announce a successful release from printed markers', () => {
  const dir=mkdtempSync(join(tmpdir(),'letscube-release-refusal-'));
  const fixture=join(dir,'child.cjs');
  const output=[];
  const previous=console.log;
  try {
    writeFileSync(fixture,"console.log('sw.js build 0123456789abcdef');console.log('BUILD SUCCESSFUL in 9s');process.exit(7);");
    console.log=(value)=>output.push(value);
    assert.throws(()=>runReleaseCommand(nodeCommand,[fixture],process.env,dir),/exit code 7/);
    assert.deepEqual(output,[]);
  } finally {console.log=previous;rmSync(dir,{recursive:true,force:true});}
});

test('release observation accepts plugin stderr and multi-unit duration, rejects embedded data', () => {
  const dir=mkdtempSync(join(tmpdir(),'letscube-release-boundaries-'));
  const fixture=join(dir,'child.cjs');
  const output=[];
  const previous=console.log;
  try {
    writeFileSync(fixture,`console.error('[plugin kub-service-worker-build] sw.js build fedcba9876543210');
console.log('prefix sw.js build 0123456789abcdef');
console.log('sw.js build 0123456789abcdef suffix');
console.log('built in 2.5s private-test-fixture-no-forward');
console.log('BUILD SUCCESSFUL in 1m 7s');
console.log('BUILD SUCCESSFUL in 7private');`);
    console.log=(value)=>output.push(value);
    runReleaseCommand(nodeCommand,[fixture],process.env,dir);
    assert.deepEqual(output,['BUILD SUCCESSFUL in 1m 7s','sw.js build fedcba9876543210']);
  } finally {console.log=previous;rmSync(dir,{recursive:true,force:true});}
});

test('release runner supports an absolute executable path containing spaces', {skip:process.platform!=='win32'}, () => {
  const dir=mkdtempSync(join(tmpdir(),'letscube-release-executable-'));
  const fixture=join(dir,'child.cjs');
  try {
    writeFileSync(fixture,"console.log('executable-path-control');");
    assert.equal(runReleaseCommand(process.execPath,[fixture],process.env,dir),'executable-path-control');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
