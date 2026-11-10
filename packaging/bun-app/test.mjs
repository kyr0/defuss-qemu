import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encodeSnapshot, decodeSnapshot, sha256, snapshotKey, packRecord, unpackRecord} from './snapshots.mjs';
import {fileSnapshotStore} from './file-store.mjs';
import {attachCom1} from './serial.mjs';
import {validateManifest} from './vm.mjs';

const manifest = {appSha256: 'a'.repeat(64), compatibilitySha256: 'b'.repeat(64)};

test('snapshot roundtrip verifies both checksums and the app/config identities', async () => {
  const raw = new TextEncoder().encode('VM RAM, CPU and devices\0'.repeat(500));
  const record = await encodeSnapshot(raw, manifest);
  assert.deepEqual(await decodeSnapshot(unpackRecord(packRecord(record)), manifest), raw);
  await assert.rejects(decodeSnapshot(record, {...manifest, appSha256: 'c'.repeat(64)}), /mismatch/);
  await assert.rejects(decodeSnapshot(record, {...manifest, compatibilitySha256: 'c'.repeat(64)}), /mismatch/);
  const corrupt = {...record, data: record.data.slice()}; corrupt.data[20] ^= 1;
  await assert.rejects(decodeSnapshot(corrupt, manifest), /mismatch/);
  await assert.rejects(decodeSnapshot({...record, metadata: {...record.metadata, sha256: '0'.repeat(64)}}, manifest), /mismatch/);
  await assert.rejects(decodeSnapshot({...record, metadata: {...record.metadata, bytes: 1}}, manifest), /exceeds/);
});

test('snapshot file framing rejects truncated or invalid headers', () => {
  assert.throws(() => unpackRecord(new Uint8Array(10)), /header/);
  const raw = packRecord({metadata: {schema: 1}, data: new Uint8Array([1])});
  new DataView(raw.buffer).setUint32(8, 100000, true);
  assert.throws(() => unpackRecord(raw), /header length/);
});

test('concurrent publishers preserve exactly one complete file and never overwrite it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bun-snapshots-'));
  try {
    const store = fileSnapshotStore(directory), key = snapshotKey(manifest);
    const records = await Promise.all(['first', 'second', 'third'].map(text => encodeSnapshot(new TextEncoder().encode(text), manifest)));
    const wins = await Promise.all(records.map(record => store.putIfAbsent(key, record)));
    assert.equal(wins.filter(Boolean).length, 1);
    const before = await readFile(join(directory, key + '.snapshot'));
    const beforeStat = await stat(join(directory, key + '.snapshot'));
    assert.equal(await store.putIfAbsent(key, records[0]), false);
    assert.deepEqual(await readFile(join(directory, key + '.snapshot')), before);
    assert.equal((await stat(join(directory, key + '.snapshot'))).mtimeMs, beforeStat.mtimeMs);
    assert.deepEqual(await decodeSnapshot(await store.get(key), manifest), await decodeSnapshot(records[wins.indexOf(true)], manifest));
    assert.equal(await store.get('c'.repeat(64) + '/' + manifest.compatibilitySha256), null);
    await store.delete(key); assert.equal(await store.get(key), null);
    await assert.rejects(store.get('../bad'), /key/);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('COM1 preserves byte order, signals poll waiters, copies shared output and never returns idle EOF', () => {
  let ops, output;
  const FS = {makedev: () => 1, registerDevice: (_, value) => ops = value, mkdev() {}, ErrnoError: class extends Error { constructor(errno) { super(); this.errno = errno; } }};
  const port = attachCom1({FS}, value => output = value);
  const stream = {flags: 0}, target = new Uint8Array(3);
  assert.throws(() => ops.read(stream, target, 0, 3), error => error.errno === 6);
  let notifications = 0;
  const notify = () => notifications++; notify.registerCleanupFunc = () => {};
  assert.equal(ops.poll(stream, 0, notify), 0);
  port.write('CP'); port.write(new Uint8Array([0]));
  assert.equal(notifications, 2);
  assert.equal(ops.poll(stream), 1);
  assert.equal(ops.read(stream, target, 0, 3), 3);
  assert.deepEqual([...target], [67, 80, 0]);
  const shared = new Uint8Array(new SharedArrayBuffer(3)); shared.set([49, 50, 51]);
  assert.equal(ops.write({}, shared, 0, 3), 3); shared.fill(0);
  assert.deepEqual([...output], [49, 50, 51]);
});

test('generated package manifest verifies and rejects changed application or VM configuration', async () => {
  const value = JSON.parse(await readFile(new URL('../../tests/fixtures/app-manifest.json', import.meta.url)));
  assert.equal(await validateManifest(value), value);
  await assert.rejects(validateManifest({...value, appSha256: '0'.repeat(64)}), /manifest/);
  await assert.rejects(validateManifest({...value, vm: {...value.vm, ramMiB: 256}}), /manifest/);
  await assert.rejects(validateManifest({...value, architecture: 'arm64'}), /manifest/);
  assert.notEqual(snapshotKey(value), snapshotKey({...value, appSha256: await sha256(new Uint8Array([1]))}));
});
