// SPDX-License-Identifier: GPL-2.0-or-later
// Read only with all vCPUs stopped: 64-bit counters are two single-writer words.
const COUNTERS = [
  'dispatchIterations', 'compiledEntries', 'interpretedEntries', 'interpretedChains',
  'observedEdges', 'rootEntries', 'dispatchReturns', 'retierReturns', 'admissionCalls',
  'admissionReady', 'admissionCold', 'admissionHeld', 'staleInstanceMisses',
  'instanceInstalls', 'instanceBudgetRejects', 'pcReplacements', 'edgeReplacements',
  'counterSaturations', 'unknownPcEntries', 'unsupportedContextEntries',
  'syscall64UserEntryAttempts', 'syscallNumberOverflow', 'syscallOtherMode',
  'tciToDispatcher', 'contextTransitions', 'tierTransitions', 'pcHashCollisions',
  'edgeHashCollisions', 'pcSamples', 'edgeSamples',
  'compiledUnknown', 'compiledKernel', 'compiledUser', 'compiledOtherRing',
  'compiledReal', 'compiledVm86', 'interpretedUnknown', 'interpretedKernel',
  'interpretedUser', 'interpretedOtherRing', 'interpretedReal', 'interpretedVm86',
];
const PRIVILEGE = ['unknown', 'kernel', 'user', 'other-ring', 'real-mode', 'vm86'];
const TIERS = ['interpreted', 'compiled'];
const MAGIC = 0x4d315046;
const big = (words, at) => BigInt(words[at]) | (BigInt(words[at + 1]) << 32n);
const exact = n => n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n.toString();
const hex = n => `0x${n.toString(16)}`;

function abi(mod) {
  // Emscripten KEEPALIVE exports are available on the Module object.
  if (typeof mod._defuss_m1_abi !== 'function' || mod._defuss_m1_abi() !== 1) {
    throw new Error('M1 profile ABI 1 is not available in this runtime');
  }
}

export function resetM1Profile(mod, enabled, period = 64) {
  abi(mod);
  if (typeof enabled !== 'boolean' || !Number.isInteger(period) || period < 1 || period > 65536) {
    throw new RangeError('M1 reset needs a boolean and sampling period 1..65536');
  }
  if (mod._defuss_m1_reset(enabled ? 1 : 0, period) !== 0) {
    throw new Error('M1 reset rejected');
  }
}

export function decodeM1Profile(words) {
  if (words.length < 32 || words[0] !== MAGIC || words[1] !== 1) {
    throw new Error('M1 profile is uninitialized or has a different ABI');
  }
  const [totalWords, pcSlots, pcStride, edgeSlots, edgeStride, counterOffset,
    counterCount, pcOffset, edgeOffset, syscallOffset, syscallSlots] = words.subarray(4, 15);
  if (totalWords !== words.length || pcSlots !== 1024 || pcStride !== 12 ||
      edgeSlots !== 2048 || edgeStride !== 20 || counterOffset !== 32 ||
      counterCount !== COUNTERS.length || pcOffset !== counterOffset + counterCount * 2 ||
      edgeOffset !== pcOffset + pcSlots * pcStride ||
      syscallOffset !== edgeOffset + edgeSlots * edgeStride ||
      syscallSlots !== 512 || totalWords !== syscallOffset + syscallSlots * 2 ||
      words[17] < 1 || words[17] > 65536 || words[18] > 1) {
    throw new Error('M1 profile layout does not match ABI 1 bounds');
  }
  function key(at) {
    if (words[at + 6] > 1 || words[at + 7] >= PRIVILEGE.length) {
      throw new Error('Invalid M1 key classification');
    }
    return { pc: hex(big(words, at)), context: hex(big(words, at + 2)),
      flags: hex(BigInt(words[at + 4])), cflags: hex(BigInt(words[at + 5])),
      tier: TIERS[words[at + 6]], privilege: PRIVILEGE[words[at + 7]] };
  }
  function bounds(at) {
    const count = big(words, at), error = big(words, at + 2);
    if (error > count) throw new Error('Invalid M1 estimate bounds');
    return { samplesEstimate: exact(count), samplesError: exact(error),
      samplesLowerBound: exact(count - error) };
  }
  const pcs = [], edges = [], syscalls = [];
  for (let i = 0; i < pcSlots; i++) {
    const at = pcOffset + i * pcStride;
    if (big(words, at + 8)) pcs.push({ ...key(at), ...bounds(at + 8) });
  }
  for (let i = 0; i < edgeSlots; i++) {
    const at = edgeOffset + i * edgeStride;
    if (big(words, at + 16)) edges.push({ from: key(at), to: key(at + 8), ...bounds(at + 16) });
  }
  for (let number = 0; number < syscallSlots; number++) {
    const count = big(words, syscallOffset + number * 2);
    if (count) syscalls.push({ number, entryAttempts: exact(count) });
  }
  const compare = (a, b) => {
    const x = BigInt(a.samplesEstimate), y = BigInt(b.samplesEstimate);
    return x === y ? 0 : x > y ? -1 : 1;
  };
  pcs.sort(compare); edges.sort(compare);
  return { abi: 1, pcAddressingRevision: words[18], enabled: Boolean(words[2]), epoch: words[3], period: words[17],
    storageBytes: totalWords * 4, tableCapacity: { pcs: pcSlots, edges: edgeSlots },
    saturated: Boolean(words[15]), rejectedWorkerObservations: words[16],
    counters: Object.fromEntries(COUNTERS.map((name, i) => [name, exact(big(words, counterOffset + i * 2))])),
    pcs, edges, syscalls,
    semantics: {
      counters: 'exact observed entry/dispatch events, except when saturated; not instructions or time',
      tables: 'deterministic every-N entry sampling; four-way bucket-local Space-Saving, count-error lower bounds',
      edges: 'adjacent observed TB entries within one tcg_qemu_tb_exec chain; internal same-TB iterations are invisible',
      identity: 'address/CR3/TB-flags exposure aggregated across code generations; CR3 is not a process identity',
      privilege: 'x86 translation flags, CPL0 kernel/CPL3 user in protected mode; other modes separately classified',
      syscalls: 'SYSCALL helper entry attempts after SCE check, before privilege transition, 64-bit CPL3 only; no completion or OS identity claim',
      timing: 'no timers added; existing helper timers nest inside interpreter/compiled work, translation includes emission; do not sum nested stages',
      pcAddressing: words[18] === 1 ?
        'x86 PC-relative TBs use synchronized entry EIP (legacy CS-base addition wraps to32bits), checked against translated page offset; other PC-relative targets, mismatches and AOT replay omitted' :
        'legacy diagnostic candidate: all PC-relative contexts omitted',
      limits: 'single vCPU; stop before reset/read; unsupported PC contexts omitted; deterministic sampling can alias; estimates invalid after saturation',
    },
  };
}

export function readM1Profile(mod) {
  abi(mod);
  const words = mod.pcProfileWords?.() ?? mod.HEAPU32;
  if (!(words instanceof Uint32Array)) throw new Error('Runtime did not expose Uint32 memory');
  const pointer = mod._defuss_m1_data();
  const byteOffset = Number(pointer);
  if (!Number.isSafeInteger(byteOffset) || byteOffset % 4 || byteOffset < 0 ||
      byteOffset + 32 * 4 > words.byteLength) throw new Error('Invalid M1 pointer');
  const at = byteOffset / 4, length = Atomics.load(words, at + 4);
  if (length < 32 || length > 100000 || at + length > words.length) {
    throw new Error('Invalid M1 buffer length');
  }
  // No atomic per-word loop is needed while stopped; copy isolates the report.
  return decodeM1Profile(words.slice(at, at + length));
}
