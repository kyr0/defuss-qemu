import {ElasticReader,S,ring,quantum} from './pcm.mjs';
// (module (import "env" "pcm" (func $f (param i64 i64 i64) (result i64)))
//         (export "pcm" (func $f))) gives JS callbacks a typed funcref.
let thunk;
const signature=Uint8Array.of(0,97,115,109,1,0,0,0,1,8,1,96,3,126,126,126,1,126,
  2,11,1,3,101,110,118,3,112,99,109,0,0,7,7,1,3,112,99,109,0,0);
export function connectGuestPCM(mod,bus){
  thunk??=new WebAssembly.Module(signature);
  const abi=mod.pcAudioABI?.();
  if(typeof abi?.slot!=='function')throw Error('The JS and WASM runtime must both support the browser PCM ABI');
  const s=new Int32Array(bus.stats),output=ring(bus.play),input=ring(bus.mic);
  const reader=new ElasticReader(input,bus.target,s,'mic');
  const token=Atomics.add(s,S.instanceSeq,1)+1;
  let epoch=-1,graphEpoch=-1,lastCapture=-Infinity;
  for(const direction of [0,1]){
    const slot=abi.slot(direction),original=abi.get(slot),owner=direction?S.micOwner:S.playOwner;
    const pcm=(hw,p,size)=>{
      const bytes=original(hw,p,size); // QEMU paces this callback and initializes capture to silence.
      if(!bytes)return bytes;
      // A callback may be installed on multiple pthread instances, but each
      // SPSC endpoint has exactly one owner for the lifetime of this VM.
      const prior=Atomics.load(s,owner)||Atomics.compareExchange(s,owner,0,token);
      if(prior&&prior!==token){Atomics.add(s,S.ownerConflicts,1);return bytes;}
      const frames=Number(bytes)/4,offset=Number(p)/2,heap=abi.pcm();
      if(!direction){
        Atomics.add(s,S.playSource,frames);
        if(!(Atomics.load(s,S.playEpoch)&1)){Atomics.add(s,S.playSuspended,frames);return bytes;}
        const written=output.push(heap,frames*2,offset)>>>1;
        Atomics.add(s,S.playIn,written);Atomics.add(s,S.playDrop,frames-written);
      }else{
        Atomics.add(s,S.guestRequest,frames);
        const now=performance.now(),generation=Atomics.load(s,S.micEpoch),graph=Atomics.load(s,S.playEpoch);
        if(generation!==epoch||graphEpoch!==graph||now-lastCapture>150){
          reader.discard(input.availableRead()>>>1);epoch=generation;graphEpoch=graph;
        }
        lastCapture=now;
        if((generation&1)&&(graph&1)){
          Atomics.store(s,S.demandUntil,(Atomics.load(s,S.clock)+Math.ceil(bus.rate*.12))|0);
          for(let i=0;i<frames;i+=quantum){
            const n=Math.min(quantum,frames-i),got=reader.read(n);
            for(let j=0;j<n*2;j++)heap[offset+i*2+j]=reader.out[j];
            Atomics.add(s,S.guestIn,got);
          }
        }
      }
      return bytes;
    };
    abi.set(slot,new WebAssembly.Instance(thunk,{env:{pcm}}).exports.pcm);
  }
}
