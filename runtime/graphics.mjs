// Aggregate selected Cirrus operations without JS calls or clocks per blit.
// This separate shared memory32 bus is also cloned into QEMU pthread modules.
import {readNativeCounters} from './native-counters.mjs';
export const graphicsKinds=Object.freeze(['copyForward','copyBackward','fill8','fill16','fill24','fill32']);
export const graphicsNativeCounterNames=Object.freeze([
  'copyBulkCalls','copyBulkRows','copyBulkBytes','copyFallbackCalls',
  'fillBulkCalls','fillBulkRows','fillBulkBytes','fillFallbackCalls',
  'commands','uploadCommands','downloadCommands','solidFillCommands','patternCommands',
  'colorExpandCommands','transparentCommands','backwardCommands',
  ...Array.from({length:16},(_,i)=>'rop'+i),
  ...['linear','bitblt','banked'].flatMap(region=>['Read1','Read2','Read4','Write1','Write2','Write4'].map(kind=>region+kind))
]);
export const graphicsNativeScope='Cirrus native bulk outcomes, attempted commands and MMIO callbacks while enabled; cumulative across devices. Bulk and scalar fallback calls can overlap; command-family flags overlap; no guest graphics API attribution.';
export const readNativeGraphicsStats=abi=>readNativeCounters(abi,{names:graphicsNativeCounterNames,scope:graphicsNativeScope});
const counterBase=64,stride=16,modules=new Map(),connected=new WeakMap();
export function createGraphicsBus(){
  const memory=new WebAssembly.Memory({initial:1,maximum:1,shared:true});
  return {memory,buffer:memory.buffer};
}
const u=n=>{const bytes=[];do{const b=n&127;n>>>=7;bytes.push(b|(n?128:0));}while(n);return bytes;};
const str=s=>[...u(s.length),...Array.from(s,c=>c.charCodeAt(0))];
const section=(id,bytes)=>[id,...u(bytes.length),...bytes];
function adapterModule(kind){
  if(modules.has(kind))return modules.get(kind);
  const copy=kind<2,params=[0x7e,...Array(copy?6:4).fill(0x7f)],width=copy?5:3,height=width+1;
  const invoke=params.flatMap((_,i)=>[0x20,...u(i)]).concat(0x10,0);
  const add=(offset,value)=>[0x41,0,...value,0xfe,0x1f,3,...u(offset),0x1a]; // i64.atomic.rmw.add
  const body=[0,...invoke,
    ...add(counterBase+kind*stride,[0x42,1]),
    // Width is already bytes per scanline. Negative/empty rectangles preserve
    // native behavior and count as completed calls, but add no requested bytes.
    0x20,width,0x41,0,0x4a,0x20,height,0x41,0,0x4a,0x71,0x04,0x40,
    ...add(counterBase+kind*stride+8,[0x20,width,0xad,0x20,height,0xad,0x7e]),
    0x0b,0x0b];
  const bytes=Uint8Array.from([0,97,115,109,1,0,0,0,
    ...section(1,[1,0x60,...u(params.length),...params,0]),
    ...section(2,[2,...str('g'),...str('fn'),0,0,...str('g'),...str('memory'),2,3,1,1]),
    ...section(3,[1,0]),...section(7,[1,...str('call'),0,1]),
    ...section(10,[1,...u(body.length),...body])]);
  const module=new WebAssembly.Module(bytes);modules.set(kind,module);return module;
}
export function readGraphicsStats(bus){
  const mask=Atomics.load(new Uint32Array(bus.buffer),0),words=new BigUint64Array(bus.buffer);
  let counterPrecisionExceeded=false;
  const number=index=>{
    const value=Atomics.load(words,index);
    if(value>BigInt(Number.MAX_SAFE_INTEGER)){counterPrecisionExceeded=true;return null;}
    return Number(value);
  };
  const coveredFunctions=graphicsKinds.filter((_,i)=>mask&(1<<i));
  const operations=Object.fromEntries(graphicsKinds.flatMap((name,i)=>mask&(1<<i)?[[name,{
    completedCalls:number((counterBase+i*stride)/8),requestedBytes:number((counterBase+i*stride+8)/8)
  }]]:[]));
  return {supported:coveredFunctions.length>0,adapter:coveredFunctions.length?'typed-wasm':null,
    scope:'selected Cirrus SRCCOPY copy/fill function-table calls; cumulative since VM start',
    byteScope:'positive requested width in bytes × height; not actual changed bytes',
    coveredFunctions,operations,counterPrecisionExceeded};
}
export function connectGraphicsCounters(mod,bus){
  const prior=connected.get(mod);
  if(prior){if(prior!==bus.memory)throw Error('Graphics counters already use another bus');return mod.pcGraphicsStats();}
  mod.pcGraphicsStats=()=>readGraphicsStats(bus);
  const abi=mod.pcGraphicsABI?.();
  if(typeof abi?.slot!=='function')return mod.pcGraphicsStats(); // Older runtime, including A/B baselines.
  if(typeof abi.get!=='function'||typeof abi.set!=='function')throw Error('Incomplete Cirrus graphics counter ABI');
  const prepared=[],slots=new Set();
  for(let kind=0;kind<graphicsKinds.length;kind++){
    const slot=abi.slot(kind);if(slot===0)continue;
    if(!Number.isSafeInteger(slot)||slot<0||slots.has(slot))throw Error('Invalid Cirrus graphics counter slot');
    slots.add(slot);
    const original=abi.get(slot);
    const wrapped=new WebAssembly.Instance(adapterModule(kind),{g:{fn:original,memory:bus.memory}}).exports.call;
    prepared.push({kind,slot,original,wrapped});
  }
  // Prepare every typed adapter before changing any entry. A bad signature
  // must leave the original native table intact.
  const applied=[];
  try{for(const item of prepared){abi.set(item.slot,item.wrapped);applied.push(item);}}
  catch(error){for(const item of applied.reverse())abi.set(item.slot,item.original);throw error;}
  const mask=prepared.reduce((bits,item)=>bits|(1<<item.kind),0);
  Atomics.or(new Uint32Array(bus.buffer),0,mask);connected.set(mod,bus.memory);
  return mod.pcGraphicsStats();
}
