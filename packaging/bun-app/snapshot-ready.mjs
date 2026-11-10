import {openSync, readSync, writeSync, closeSync} from 'node:fs';

// Shared with the boot wrapper even if this module is bundled into the app.
const state = Symbol.for('bun-wasm.snapshot-ready.v1');

/** Call after initialization, before accepting external work. Returns cold/restored. */
export function snapshotReady() {
  if (globalThis[state]) return globalThis[state];
  if (process.env.BUN_WASM_SNAPSHOT !== '1') return 'disabled';
  const fd = openSync('/dev/ttyS0', 'r+');
  try {
    writeSync(fd, Buffer.from('1'));
    const ack = Buffer.alloc(1);
    // The VM is captured while waiting here. Each fresh host sends its own ACK.
    if (readSync(fd, ack, 0, 1, null) !== 1 || ![67, 82].includes(ack[0])) {
      throw new Error('Invalid COM1 snapshot acknowledgement');
    }
    return globalThis[state] = ack[0] === 82 ? 'restored' : 'cold';
  } finally {
    closeSync(fd);
  }
}
