import {helperNames} from './helper-names.mjs';
// Diagnostics only. No guest code, operands, addresses or memory are exported.
export const helperSlots=16384,helperStride=3,helperHeader=4;
export function createHelperProfile(){
  const memory=new WebAssembly.Memory({initial:4,maximum:4,shared:true});
  return {memory,buffer:memory.buffer,slots:helperSlots,names:{}};
}
const staticBytes=words=>new Uint8Array(words.buffer,words.byteOffset,Math.min(words.byteLength,32*1048576));
function cstring(bytes,p){
  
  if(!Number.isSafeInteger(p)||p<=0||p>=bytes.length)return '';
  const window=bytes.subarray(p,Math.min(bytes.length,p+97)),end=window.indexOf(0);
  if(end<0)return '';
  return new TextDecoder().decode(window.slice(0,end));
}
// The shipped wasm64 ABI stores static TCGHelperInfo records as
// func:u64, thunk:u64, name:u64, cif:u64, typemask:u32, flags:u8,
// nr_in/nr_out/out_kind:u8 and 14 zero-initialized argument locations.
// Read only before QEMU main, so guest data cannot enter this dictionary.
// Unknown slots stay numeric; never infer a name from guest contents.
export function discoverHelperNames(words){
  const bytes=staticBytes(words);
  const w=new Uint32Array(bytes.buffer,bytes.byteOffset,Math.floor(bytes.length/4)),names={};
  for(let i=0;i+24<=w.length;i+=2){
    const slot=w[i],thunk=w[i+2],name=w[i+4];
    if(!slot||slot>=helperSlots||!thunk||thunk>=helperSlots||w[i+1]||w[i+3]||w[i+5]||w[i+6]||w[i+7]||!w[i+8]||w[i+9]>255)continue;
    let zero=true;for(let j=10;j<24;j++)if(w[i+j]){zero=false;break;}if(!zero)continue;
    const label=cstring(bytes,name);
    if(!helperNames.has(label))continue;
    if(names[slot]&&names[slot]!==label)names[slot]=null;else if(names[slot]!==null)names[slot]=label;
  }
  return Object.fromEntries(Object.entries(names).filter(([,v])=>v));
}
const top=(counts,make,limit=40)=>Array.from(counts,(n,i)=>n?[i,n]:null).filter(Boolean)
  .sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,limit).map(([i,n])=>make(i,n));
class DeltaArray {
  constructor(n){this.previous=new Uint32Array(n);this.total=new Float64Array(n);}
  read(words,start,baseline=false){
    for(let i=0;i<this.previous.length;i++){
      const v=Atomics.load(words,start+i)>>>0;
      if(!baseline)this.total[i]+=(v-this.previous[i])>>>0;
      this.previous[i]=v;
    }
  }
}
export class HotspotReader {
  constructor(mod,helperBus){
    this.mod=mod;this.helperBus=helperBus;
    this.profile=Number(mod._defuss_profile(-1))/4;
    this.pairs=Number(mod._defuss_stage_stats(1))/4;
    this.op=new DeltaArray(256);this.pair=new DeltaArray(65536);
    this.helpers=helperBus?new DeltaArray(helperSlots*helperStride):null;
    this.unknown=helperBus?new DeltaArray(1):null;
    const bytes=staticBytes(mod.pcProfileWords());
    this.names=Array.from({length:256},(_,i)=>cstring(bytes,Number(mod._defuss_profile(i)))||'opcode_'+i);
    this.update(true);
  }
  update(baseline=false){
    const w=this.mod.pcProfileWords();this.op.read(w,this.profile+4,baseline);this.pair.read(w,this.pairs,baseline);
    if(this.helpers){const h=new Uint32Array(this.helperBus.buffer);this.helpers.read(h,helperHeader,baseline);this.unknown.read(h,1,baseline);}
  }
  read(){
    this.update();
    const bytes=staticBytes(this.mod.pcProfileWords());
    this.names=this.names.map((name,i)=>name.startsWith('opcode_')?(cstring(bytes,Number(this.mod._defuss_profile(i)))||name):name);
    const sum=a=>a.reduce((x,y)=>x+y,0);
    const result={scope:'since this trace started, including any evicted time windows',
      interpreter:{dispatchSamplePeriod:257,maxBytecodesPerDispatch:64,
        opcodeSamples:sum(this.op.total),pairSamples:sum(this.pair.total),
        opcodes:top(this.op.total,(i,samples)=>({opcode:this.names[i],samples})),
        pairs:top(this.pair.total,(i,samples)=>({sequence:[this.names[i>>>8],this.names[i&255]],samples}))},
      helpers:{enabled:Boolean(this.helperBus)}};
    if(this.helpers){
      const a=this.helpers.total,entries=[];let calls=0,samples=0,us=0;
      for(let i=0;i<helperSlots;i++)if(a[i*3]){
        calls+=a[i*3];samples+=a[i*3+2];us+=a[i*3+1];
        entries.push({slot:i,name:this.helperBus.names[i]??null,calls:a[i*3],sampledUs:a[i*3+1],timingSamples:a[i*3+2]});
      }
      const ranked=entries.sort((a,b)=>b.calls-a.calls||a.slot-b.slot);
      result.helpers={enabled:true,scope:'compiled TB helper imports only; interpreted helpers have aggregate timing',
        adapter:'typed Wasm when supported; explicit JS fallback',
        nativeAdapters:Atomics.load(new Uint32Array(this.helperBus.buffer),2),
        jsFallbackAdapters:Atomics.load(new Uint32Array(this.helperBus.buffer),3),
        timingScope:'sampled calls that return; profiler bookkeeping excluded',
        timingProbability:1/1024,calls,timingSamples:samples,sampledUs:us,
        unknownSlotCalls:this.unknown.total[0],
        byCalls:ranked.slice(0,40),bySampledTime:entries.slice().sort((a,b)=>b.sampledUs-a.sampledUs||a.slot-b.slot).slice(0,40)};
    }
    return result;
  }
}
