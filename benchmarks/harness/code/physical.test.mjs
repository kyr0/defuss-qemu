import test from 'node:test';
import assert from 'node:assert/strict';
import {stoppedMemoryReader} from './physical.mjs';

function fixture({running = false, fail = false, short = false, occupied = false} = {}) {
  const files = new Map(), calls = [];
  if (occupied) files.set('/defuss-m1-code-1.bin', new Uint8Array([99]));
  const fs = {
    open(name, flags) { assert.equal(flags, 1 | 64 | 128, 'Emscripten exclusive create requires numeric C flags'); if (files.has(name)) throw Error('exists'); files.set(name, new Uint8Array()); return name; },
    close() {}, readFile(name) { return files.get(name); }, unlink(name) { files.delete(name); },
  };
  const qmp = {async send(command, args) {
    calls.push({command, args});
    if (command === 'query-status') return {running, status: running ? 'running' : 'paused'};
    if (command === 'human-monitor-command') return 'CR0=80050033 CR3=00100000 CR4=000006f0 EFER=00000d01';
    if (command === 'pmemsave') {
      assert.equal(args.val, 0x100000);
      if (fail) throw Error('injected QMP failure');
      files.set(args.filename, new Uint8Array(args.size - (short ? 1 : 0)).fill(42));
    }
  }};
  return {reader: stoppedMemoryReader({qmp, fs}), calls, files};
}

test('stopped QMP inspection returns owned bytes and removes only its temporary file', async () => {
  const {reader, files, calls} = fixture();
  assert.match(await reader.readRegisters(), /CR3=/);
  assert.deepEqual(await reader.readPhysical(0x100000, 8), new Uint8Array(8).fill(42));
  assert.equal(files.size, 0);
  assert.equal(calls.filter(x => x.command === 'pmemsave').length, 1);
});
test('running guest and MMIO/out-of-RAM/oversized requests never issue pmemsave', async () => {
  const live = fixture({running: true});
  await assert.rejects(live.reader.readPhysical(0x100000, 8), /paused/);
  await assert.rejects(live.reader.readRegisters(), /paused/);
  const safe = fixture();
  for (const [address, length] of [[0, 8], [0xfffff, 8], [0x20000000, 1], [0x1fffffff, 2], [0x100000, 4097], [0x100000, 0], [NaN, 8]])
    await assert.rejects(safe.reader.readPhysical(address, length), RangeError);
  assert.equal([...safe.calls, ...live.calls].filter(x => x.command === 'pmemsave').length, 0);
});
test('failed and short reads remove reserved files; preexisting files are preserved', async () => {
  for (const options of [{fail: true}, {short: true}]) {
    const {reader, files} = fixture(options);
    await assert.rejects(reader.readPhysical(0x100000, 8)); assert.equal(files.size, 0);
  }
  const {reader, files, calls} = fixture({occupied: true});
  await assert.rejects(reader.readPhysical(0x100000, 8), /exists/);
  assert.deepEqual(files.get('/defuss-m1-code-1.bin'), new Uint8Array([99]));
  assert.equal(calls.filter(x => x.command === 'pmemsave').length, 0);
});
test('concurrent physical inspection is refused', async () => {
  const {reader} = fixture(); const first = reader.readPhysical(0x100000, 8);
  await assert.rejects(reader.readPhysical(0x100000, 8), /serialized/); await first;
});
