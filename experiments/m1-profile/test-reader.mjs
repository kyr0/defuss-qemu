// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeM1Profile, readM1Profile, resetM1Profile } from './reader.mjs';

const bytes = fs.readFileSync(process.argv[2]);
const words = new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const report = decodeM1Profile(words);
assert.equal(report.storageBytes, 217552);
assert.equal(report.pcAddressingRevision, 1);
assert.match(report.semantics.pcAddressing, /synchronized entry EIP/);
assert.equal(report.counters.dispatchIterations, '18446744073709551612');
assert.equal(report.counters.observedEdges, 1);
assert.equal(report.pcs.length, 2);
assert.equal(report.edges.length, 1);
assert.equal(report.pcs[0].pc, '0xffff800012345678');
assert.equal(report.edges[0].from.tier, 'compiled');
assert.equal(report.edges[0].to.tier, 'interpreted');
assert.deepEqual(report.syscalls, [{ number: 0, entryAttempts: 1 }, { number: 511, entryAttempts: 1 }]);
for (const [index, value] of [[0, 0], [1, 2], [4, 200000], [5, 0], [6, 13], [10, 0], [11, 0], [17, 0], [18, 2]]) {
  const bad = words.slice(); bad[index] = value;
  assert.throws(() => decodeM1Profile(bad));
}
const legacy=words.slice();legacy[18]=0;
assert.match(decodeM1Profile(legacy).semantics.pcAddressing,/all PC-relative contexts omitted/);
const shared = new Uint32Array(new SharedArrayBuffer(words.byteLength + 64));
shared.set(words, 16);
let resetArgs;
const mod = {
  _defuss_m1_abi: () => 1, _defuss_m1_data: () => 64n,
  _defuss_m1_reset: (...args) => { resetArgs = args; return 0; },
  pcProfileWords: () => shared,
};
assert.deepEqual(readM1Profile(mod), report);
resetM1Profile(mod, true); assert.deepEqual(resetArgs, [1, 64]);
resetM1Profile(mod, false, 1); assert.deepEqual(resetArgs, [0, 1]);
for (const period of [0, 65537, -1, 1.5, NaN]) assert.throws(() => resetM1Profile(mod, true, period));
assert.throws(() => resetM1Profile(mod, 1, 64));
assert.throws(() => readM1Profile({ ...mod, _defuss_m1_data: () => 65n }));
assert.throws(() => readM1Profile({ ...mod, _defuss_m1_data: () => 2n ** 63n }));
assert.throws(() => readM1Profile({ ...mod, _defuss_m1_abi: () => 2 }));
console.log('PASS: C/JS ABI roundtrip, exact large counts, pointer/layout guards, reset arguments');
