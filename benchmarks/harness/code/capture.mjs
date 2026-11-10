// Stopped diagnostic reads only; no guest memory writes or page accessed-bit updates.
// Paging rules follow target/i386/tcg/system/excp_helper.c in the retained QEMU tree.
const LOW_RAM = 0x100000n, RAM_BYTES = 512 * 1024 * 1024;
const U64 = (1n << 64n) - 1n, ADDRESS = 0x000ffffffffff000n;
const NX = 1n << 63n, PRESENT = 1n, USER = 4n, LARGE = 128n;
const hex = value => '0x' + value.toString(16);
const bytesHex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
class CaptureError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new CaptureError(code, message); };
function integer(value, name) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) fail('invalid-integer', name + ' is not an exact integer');
  if (!['number', 'bigint', 'string'].includes(typeof value) ||
      typeof value === 'string' && !/^(0x[0-9a-f]+|[0-9]+)$/i.test(value)) fail('invalid-integer', name + ' is malformed');
  const result = BigInt(value);
  if (result < 0n || result > U64) fail('invalid-integer', name + ' is outside uint64');
  return result;
}
const errorRecord = error => ({code:error.code ?? 'read-failed', message:String(error.message ?? error)});
const canonical = address => address < (1n << 47n) || address >= U64 - (1n << 47n) + 1n;

export function parsePagingRegisters(registers) {
  if (typeof registers !== 'string' || registers.length > 65536) fail('invalid-registers', 'Expected bounded HMP info registers text');
  const parsed = {};
  for (const name of ['CR0', 'CR3', 'CR4', 'EFER']) {
    const matches = [...registers.matchAll(new RegExp('(?:^|\\s)' + name + '=([0-9a-fA-F]+)(?=\\s|$)', 'g'))];
    if (matches.length !== 1) fail('invalid-registers', 'Missing or duplicate ' + name);
    parsed[name] = integer('0x' + matches[0][1], name);
  }
  if (!(parsed.CR0 & 1n) || !(parsed.CR0 & (1n << 31n))) fail('unsupported-mode', 'Protected-mode paging is required');
  if (!(parsed.CR4 & (1n << 5n))) fail('unsupported-mode', 'PAE is required');
  if (parsed.CR4 & (1n << 12n)) fail('unsupported-mode', 'LA57 is unsupported');
  if ((parsed.EFER & 0x500n) !== 0x500n) fail('unsupported-mode', 'Active long-mode paging is required');
  return parsed;
}

export function selectCodeCandidates(profile, maxEntries = 8) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 16) fail('invalid-bounds', 'maxEntries must be 1..16');
  if (profile?.abi !== 1 || profile.pcAddressingRevision !== 1 || profile.saturated !== false ||
      profile.rejectedWorkerObservations !== 0 || !Array.isArray(profile.pcs) || !Array.isArray(profile.edges) ||
      profile.pcs.length > 1024 || profile.edges.length > 2048) fail('invalid-profile', 'Expected an unsaturated single-worker revision1 M1 profile');
  const eligible = key => key?.tier === 'compiled' && key.privilege === 'user';
  const compare = (a, b) => {
    const x = integer(a.samplesEstimate, 'sample estimate'), y = integer(b.samplesEstimate, 'sample estimate');
    return x === y ? 0 : x > y ? -1 : 1;
  };
  const pcs = profile.pcs.filter(eligible).slice().sort(compare);
  const edges = profile.edges.filter(edge => eligible(edge.from) && eligible(edge.to)).slice().sort(compare);
  const result = [], seen = new Map();
  function add(key, reason) {
    const pc = hex(integer(key.pc, 'PC')), context = hex(integer(key.context, 'CR3')), identity = pc + '/' + context;
    if (seen.has(identity)) {
      const row = seen.get(identity);
      if (row.selection.length < 8) row.selection.push(reason);
      return;
    }
    if (result.length >= maxEntries) return;
    const row = {pc, context, tier:'compiled', privilege:'user', flags:key.flags ?? null, cflags:key.cflags ?? null, selection:[reason]};
    result.push(row); seen.set(identity, row);
  }
  // Include the top PC first, then both endpoints of the top compiled-user edge.
  // Alternate ranked PC and edge rows afterward; scores select reads, not time shares.
  for (let rank = 0; rank < Math.max(pcs.length, edges.length) && result.length < maxEntries; rank++) {
    if (pcs[rank]) add(pcs[rank], {kind:'pc', rank, samplesEstimate:pcs[rank].samplesEstimate});
    if (edges[rank]) {
      add(edges[rank].from, {kind:'edge-from', rank, samplesEstimate:edges[rank].samplesEstimate});
      add(edges[rank].to, {kind:'edge-to', rank, samplesEstimate:edges[rank].samplesEstimate});
    }
  }
  return result;
}

async function digest(bytes) {
  return bytesHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
}

export async function captureStoppedCode({profile, readPhysical, registers,
    ramBytes = RAM_BYTES, maxEntries = 8, bytesPerEntry = 128}) {
  const report = {schema:1, status:'unresolved', stage:'stopped-phase-end', registers,
    bounds:{ramStart:hex(LOW_RAM), ramEnd:hex(BigInt(RAM_BYTES)), maxEntries, bytesPerEntry},
    selection:'Highest compiled-user PC, then top compiled-user edge endpoints; continue alternating ranked rows, deduplicated by PC/raw CR3.',
    scope:'Bytes and page-table entries observed while stopped after this phase, under the recorded raw CR3. This does not establish historical code generations, sampled instruction bytes, process identity, or JIT tier.',
    requirements:'Caller holds the single-vCPU PC guest stopped throughout all reads; fixed 512 MiB RAM layout; physical reader returns exact bytes and never resumes the guest.',
    physicalReads:0, physicalBytes:0, rows:[]};
  let mode, candidates;
  try {
    if (ramBytes !== RAM_BYTES || !Number.isInteger(bytesPerEntry) || bytesPerEntry < 1 || bytesPerEntry > 256 ||
        typeof readPhysical !== 'function') fail('invalid-bounds', 'Only fixed 512 MiB PC RAM and 1..256 bytes per row are supported');
    mode = parsePagingRegisters(registers);
    report.mode = Object.fromEntries(Object.entries(mode).map(([key, value]) => [key, hex(value)]));
    candidates = selectCodeCandidates(profile, maxEntries);
  } catch (error) { report.error = errorRecord(error); return report; }
  async function physical(address, count) {
    if (address < LOW_RAM || address + BigInt(count) > BigInt(ramBytes)) fail('outside-ram', 'Physical read outside verified PC RAM: ' + hex(address) + ' +' + count);
    report.physicalReads++; report.physicalBytes += count;
    const bytes = await readPhysical(Number(address), count);
    if (!(bytes instanceof Uint8Array) || bytes.length !== count) fail('short-read', 'Physical reader must return exactly ' + count + ' bytes');
    return new Uint8Array(bytes);
  }
  async function translate(cr3, address, walk) {
    if (!canonical(address)) fail('noncanonical', 'Virtual address is not canonical for four-level paging');
    if (cr3 & ~(ADDRESS | 0xfffn)) fail('invalid-cr3', 'CR3 has unsupported high bits');
    if (!(mode.CR4 & (1n << 17n)) && (cr3 & 0xfe7n)) fail('invalid-cr3', 'CR3 has reserved low bits without PCID');
    let table = cr3 & ADDRESS;
    for (const [level, shift] of [[4,39n], [3,30n], [2,21n], [1,12n]]) {
      const index = (address >> shift) & 511n, entryAddress = table + index * 8n;
      const raw = await physical(entryAddress, 8), value = new DataView(raw.buffer).getBigUint64(0, true);
      walk.entries.push({level, table:hex(table), index:Number(index), address:hex(entryAddress), value:hex(value), hex:bytesHex(raw)});
      if (!(value & PRESENT)) fail('not-present', 'Nonpresent page-table entry at level ' + level);
      if (!(value & USER)) fail('supervisor', 'Supervisor-only page-table entry at level ' + level);
      if (value & NX) fail(mode.EFER & (1n << 11n) ? 'nonexecutable' : 'reserved-nx', 'NX entry at level ' + level);
      if (level === 4 && value & LARGE) fail('reserved-page-size', 'PML4 page-size bit is reserved');
      if (level === 1 || value & LARGE) {
        const pageSize = 1n << shift, mask = pageSize - 1n;
        // Huge-page bit12 is PAT, not a physical-address alignment bit.
        if (level > 1 && value & mask & ADDRESS & ~0x1000n) fail('reserved-alignment', 'Misaligned huge-page physical base');
        const base = value & ADDRESS & ~mask, offset = address & mask;
        walk.pageSize = Number(pageSize); walk.physicalAddress = hex(base + offset);
        return {physicalAddress:base + offset, remaining:pageSize - offset};
      }
      table = value & ADDRESS;
    }
    fail('invalid-walk', 'Page walk did not produce a mapping');
  }
  for (const candidate of candidates) {
    const row = {...candidate, status:'unresolved', bytesRequested:bytesPerEntry, segments:[], walks:[],
      currentRawCr3Matches:integer(candidate.context, 'CR3') === mode.CR3};
    report.rows.push(row);
    try {
      let address = integer(row.pc, 'PC'), remaining = bytesPerEntry;
      if (address + BigInt(remaining) - 1n > U64) fail('address-overflow', 'Virtual read wraps uint64');
      const cr3 = integer(row.context, 'CR3'), bytes = new Uint8Array(remaining);
      while (remaining) {
        const walk = {virtualAddress:hex(address), entries:[]}; row.walks.push(walk);
        const mapping = await translate(cr3, address, walk), count = Math.min(remaining, Number(mapping.remaining));
        const part = await physical(mapping.physicalAddress, count);
        row.segments.push({virtualAddress:hex(address), physicalAddress:hex(mapping.physicalAddress), bytes:count, hex:bytesHex(part)});
        bytes.set(part, bytesPerEntry - remaining); remaining -= count; address += BigInt(count);
      }
      row.hex = bytesHex(bytes); row.sha256 = await digest(bytes); row.status = 'captured';
    } catch (error) { row.error = errorRecord(error); }
  }
  report.captured = report.rows.filter(row => row.status === 'captured').length;
  report.unresolved = report.rows.length - report.captured;
  report.status = report.rows.length === 0 ? 'no-candidates' : report.unresolved ? 'partial' : 'captured';
  return report;
}
