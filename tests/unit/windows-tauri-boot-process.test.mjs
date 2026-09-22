import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { readWindowsProcessIdentity, sameWindowsProcessIdentity, stopOwnedWindowsProcess } from '../../scripts/windows-tauri-boot-process.mjs';

test('native QA cleanup requires the original PID, executable and creation time', () => {
  const owned = { pid: 1842, path: 'C:\QA\letscube-windows-tauri.exe', created: '2026-09-23T00:00:00.0000000Z' };
  assert.equal(sameWindowsProcessIdentity(owned, { ...owned, path: 'c:\qa\LETSCUBE-WINDOWS-TAURI.EXE' }), true);
  assert.equal(sameWindowsProcessIdentity(owned, { ...owned, pid: 1843 }), false);
  assert.equal(sameWindowsProcessIdentity(owned, { ...owned, path: 'C:\Other\letscube-windows-tauri.exe' }), false);
  assert.equal(sameWindowsProcessIdentity(owned, { ...owned, created: '2026-09-23T00:00:01.0000000Z' }), false);
  assert.equal(sameWindowsProcessIdentity(owned, null), false);
});

test('a stale creation time cannot terminate a live owned fixture', { skip: process.platform !== 'win32' }, async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  try {
    const identity = readWindowsProcessIdentity(child.pid);
    assert(identity);
    assert.throws(() => stopOwnedWindowsProcess({ ...identity, created: '1900-01-01T00:00:00.0000000Z' }),
      /refusing to stop/);
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
});
