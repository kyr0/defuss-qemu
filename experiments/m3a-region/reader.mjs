// Cumulative diagnostics. Read only after all vCPUs are confirmed stopped.
const names = ['published','eligiblePublished','compiledAttempts','selectedEntries','fallbackEntries',
  'invalidRedispatches','staleInstanceMisses','instanceInstalls','instanceRetires','invalidations','flushes',
  'emittedWasmBytes','importBytes','descriptorBytes','invalidMetadata','generationExhaustions','extraWorkerRejects','watchPcMismatches',
  'injectedStaleInstances','injectedInvalidDescriptors','injectionRejects'];
const reasons = ['eligible','unsupportedTarget','multipleContexts','unsupportedMode','debugOrAccounting','temporaryTB','planOrAot','noWasm','missingMetadata'];
export function configureM3Region(mod, enabled) {
  if (typeof enabled !== 'boolean' || mod._defuss_m3_abi?.() !== 1 ||
      mod._defuss_m3_configure(enabled ? 1 : 0) !== 0) throw Error('M3 configuration rejected; configure once before vCPU startup');
}
export function watchM3Region(mod, slot, begin, end) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= 4) throw Error('M3 watch slot must be 0..3');
  if ([begin,end].some(value=>typeof value==='number'&&!Number.isSafeInteger(value))) throw Error('M3 watch addresses must be exact integers');
  const first=BigInt(begin), last=BigInt(end), max=(1n<<64n)-1n;
  if (first<0n || last>max || first>last || first===last&&first!==0n ||
      mod._defuss_m3_abi?.()!==1 || mod._defuss_m3_watch(slot,first,last)!==0) throw Error('M3 watch rejected; configure valid bounds with all vCPUs stopped');
}
export function injectM3Region(mod, action, slot, pc) {
  const code=action==='stale-instance'?1:action==='invalid-descriptor'?2:0;
  if (!code || !Number.isInteger(slot) || slot<0 || slot>=4 ||
      typeof pc==='number'&&!Number.isSafeInteger(pc)) throw Error('Invalid M3 test injection');
  const address=BigInt(pc);
  if (address<0x100000n || address>=0x100000000n || mod._defuss_m3_abi?.()!==1 ||
      mod._defuss_m3_test_abi?.()!==1 || mod._defuss_m3_test_inject(code,slot,address)!==1)
    throw Error('M3 test injection rejected; require an exact unique compiled watched static user PC and one stopped enabled vCPU');
  return {action,slot,pc:'0x'+address.toString(16),mutations:1};
}
export function readM3Region(mod) {
  if (mod._defuss_m3_abi?.() !== 1) throw Error('M3 ABI 1 is unavailable');
  const memory = mod.pcProfileWords?.() ?? mod.HEAPU32;
  if (!(memory instanceof Uint32Array)) throw Error('M3 uint32 memory unavailable');
  const pointer = Number(mod._defuss_m3_data());
  if (!Number.isSafeInteger(pointer) || pointer < 0 || pointer % 4 || pointer + 384 > memory.byteLength) throw Error('M3 data pointer invalid');
  const words = memory.slice(pointer / 4, pointer / 4 + 96);
  if (words[0] !== 0x4d335231 || words[1] !== 1 || words[2] > 1 || words[3] > 1 || words[4] > 1 ||
      words[5] < words[6] || words[5] > 4096 || words[6] === 0 || words[7] === 0 ||
      words[8]!==4 || words[9]!==64 || words[10]!==8 || words[54]>2) throw Error('M3 data layout invalid');
  const counters = Object.fromEntries(names.map((name,index) => [name,words[16+index]]));
  const fallbacks = Object.fromEntries(reasons.map((name,index) => [name,words[40+index]]));
  if (!words[4] && (counters.compiledAttempts !== counters.selectedEntries + counters.fallbackEntries + counters.invalidRedispatches ||
      counters.fallbackEntries !== Object.values(fallbacks).reduce((sum,value) => sum + value,0))) throw Error('M3 entry/fallback accounting inconsistent');
  const pair=at=>'0x'+(BigInt(words[at])|(BigInt(words[at+1])<<32n)).toString(16);
  const watches=Array.from({length:4},(_,slot)=>{const at=64+slot*8;
    if(words[at+7]>1)throw Error('M3 watch state invalid');
    return {slot,begin:pair(at),end:pair(at+2),selectedEntries:words[at+4],lastSelectedPC:pair(at+5),enabled:Boolean(words[at+7])};});
  return {abi:1, enabled:Boolean(words[2]), started:Boolean(words[3]), saturated:Boolean(words[4]),
    storageBytes:384, headerBytes:words[5], descriptorBytes:words[6], instanceRecordBytes:words[7], counters, fallbacks,
    watchEpoch:words[11],watches,
    testInjection:{action:words[54],lastPC:pair(50),lastGeneration:pair(52),
      diagnostic:true,scope:'Explicit stopped-only mutations; no pointers retained across resume'},
    semantics:'Cumulative saturating counters, read while stopped. Entries are compiled-function attempts, not retired instructions or time. Byte counters are cumulative emissions, not resident memory. Same-TB internal loops are not additional entries.',
    recovery:'Existing QEMU TCI instruction-search and Asyncify contract; same generated function, no fusion.',
    limits:'Experimental single-vCPU x86-64 long-mode dynamic full-system path; other contexts use the existing engine. No new architectural-state optimization or performance claim.'};
}
