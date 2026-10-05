import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function parseNar(nar, expectedSha256, path) {
  assert.ok(Buffer.isBuffer(nar) && nar.length <= 33554432, 'NAR byte budget');
  assert.match(expectedSha256, /^[a-f0-9]{64}$/);
  assert.equal(hash(nar), expectedSha256, 'input NAR mismatch');
  const pieces = path?.split('/'); const name = pieces?.pop(); const parent = pieces?.join('/');
  const manifest = [];
  let cursor = 0; let nodes = 0; let insertion;
  const raw = () => {
    assert.ok(cursor + 8 <= nar.length, 'NAR truncated length');
    const length = nar.readBigUInt64LE(cursor); cursor += 8;
    assert.ok(length <= BigInt(nar.length - cursor), 'NAR truncated body');
    const end = cursor + Number(length); const paddedEnd = end + (8 - Number(length) % 8) % 8;
    assert.ok(paddedEnd <= nar.length, 'NAR truncated padding');
    for (let i = end; i < paddedEnd; i++) assert.equal(nar[i], 0, 'NAR padding');
    const bytes = nar.subarray(cursor, end); cursor = paddedEnd; return bytes;
  };
  const text = () => {
    const bytes = raw(); assert.ok(bytes.length <= 4096, 'NAR token budget');
    assert.ok(bytes.every(byte => byte >= 32 && byte <= 126), 'NAR ASCII token');
    return bytes.toString('ascii');
  };
  const expect = literal => assert.equal(text(), literal, 'NAR token');
  const node = (current, depth) => {
    assert.ok(++nodes <= 100000 && depth <= 64, 'NAR tree budget');
    expect('('); expect('type'); const type = text();
    if (type === 'directory') {
      manifest.push({path: current, type});
      let previous;
      while (true) {
        const entryStart = cursor; const token = text();
        if (token === ')') {
          if (current === parent && insertion === undefined) insertion = entryStart;
          return;
        }
        assert.equal(token, 'entry', 'NAR directory entry'); expect('('); expect('name');
        const child = text();
        assert.ok(child.length > 0 && child !== '.' && child !== '..' && !child.includes('/'), 'NAR entry name');
        assert.ok(previous === undefined || Buffer.compare(Buffer.from(previous), Buffer.from(child)) < 0, 'NAR entry order');
        previous = child;
        if (current === parent) {
          assert.notEqual(child, name, 'entry already exists');
          if (insertion === undefined && Buffer.compare(Buffer.from(name), Buffer.from(child)) < 0) insertion = entryStart;
        }
        expect('node'); node(current ? current + '/' + child : child, depth + 1); expect(')');
      }
    } else if (type === 'regular') {
      let token = text(); let executable = false;
      if (token === 'executable') { executable = true; expect(''); token = text(); }
      assert.equal(token, 'contents', 'NAR regular contents'); const contents = raw(); expect(')');
      manifest.push({path: current, type, executable, bytes: contents.length, sha256: hash(contents)});
    } else if (type === 'symlink') {
      expect('target'); const target = text(); expect(')'); manifest.push({path: current, type, target});
    } else assert.fail('NAR node type');
  };
  expect('nix-archive-1'); node('', 0);
  assert.equal(cursor, nar.length, 'NAR trailing bytes');
  return {manifest, insertion, nodes};
}

export function narManifest(nar, expectedSha256) {
  return parseNar(nar, expectedSha256).manifest;
}

// Offline explanation only: preserve existing NAR bytes and insert one link entry.
export function explainNarSymlink(nar, {path, target, expectedSha256, installedSha256}) {
  assert.ok(typeof path === 'string' && /^(?:[A-Za-z0-9_-]+\/){0,15}[A-Za-z0-9_-]+$/.test(path)
    && typeof target === 'string' && /^\/[A-Za-z0-9_./-]{1,1023}$/.test(target)
    && !target.split('/').includes('..'), 'link specification');
  assert.match(installedSha256, /^[a-f0-9]{64}$/);
  const {insertion, nodes} = parseNar(nar, expectedSha256, path);
  const name = path.split('/').at(-1);
  assert.notEqual(insertion, undefined, 'parent directory absent');
  const encode = value => {
    const bytes = Buffer.from(value); const out = Buffer.alloc(8 + Math.ceil(bytes.length / 8) * 8);
    out.writeBigUInt64LE(BigInt(bytes.length)); bytes.copy(out, 8); return out;
  };
  const entry = Buffer.concat(['entry', '(', 'name', name, 'node', '(', 'type', 'symlink',
    'target', target, ')', ')'].map(encode));
  const transformed = Buffer.concat([nar.subarray(0, insertion), entry, nar.subarray(insertion)]);
  const transformedSha256 = hash(transformed);
  assert.equal(transformedSha256, installedSha256, 'transformed NAR mismatch');
  return {inputSha256: expectedSha256, transformedSha256, inputBytes: nar.length,
    transformedBytes: transformed.length, addedBytes: entry.length, inputNodes: nodes,
    insertedPath: path, insertedTarget: target, matchesInstalledHash: true,
    installedClosureAccepted: false, authenticatedBuildBinding: false,
    nativeHeaderDispatchApproved: false, fullRestoreApproved: false, productionApproved: false};
}
