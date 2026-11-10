// PC_HELPER_RUNTIME_BEGIN
// Injected by expose-profile.py. Ordinary boots keep direct native imports.
// Opt-in diagnostic VMs count/sample inside typed Wasm adapters: only sampled
// calls cross into JS for clocks. A stopped trace retains a native flag check.
var pcHelperWrappers,pcHelperModules;
function pcHelperSignatures(bytes){
  if(!Module.pcHelperBus)return null;
  // Parse this backend's scalar function types, not guest memory or operands.
  // Reject unrecognized encodings and use the explicit JS fallback below.
  try{
    let p=8,end=bytes.length;const types=[],helpers={};
    const byte=()=>{if(p>=end)throw Error('truncated helper ABI');return bytes[p++];};
    const u=()=>{let n=0,shift=0;for(let i=0;i<5;i++){const b=byte();n+=(b&127)*2**shift;if(!(b&128)){if(n>0xffffffff)throw Error('helper ABI overflow');return n;}shift+=7;}throw Error('helper ABI LEB');};
    const skip64=()=>{for(let i=0;i<10;i++)if(!(byte()&128))return;throw Error('helper ABI limits');};
    const str=()=>{const n=u();if(n>end-p)throw Error('helper ABI name');let s='';for(let i=0;i<n;i++)s+=String.fromCharCode(byte());return s;};
    const vec=()=>{const n=u(),out=[];if(n>end-p)throw Error('helper ABI vector');for(let i=0;i<n;i++){const t=byte();if(t<0x7c||t>0x7f)throw Error('helper ABI type');out.push(t);}return out;};
    if(bytes.length<8||bytes[0]!==0||bytes[1]!==97||bytes[2]!==115||bytes[3]!==109||bytes[4]!==1||bytes[5]||bytes[6]||bytes[7])throw Error('helper ABI magic');
    while(p<bytes.length){
      end=bytes.length;const id=byte(),size=u(),stop=p+size;if(stop>bytes.length)throw Error('helper ABI section');end=stop;
      if(id===1){const n=u();for(let i=0;i<n;i++){if(byte()!==0x60)throw Error('helper ABI function');const params=vec(),results=vec();if(results.length>1)throw Error('helper ABI multi-value');types.push({params,results});}}
      else if(id===2){
        const n=u();for(let i=0;i<n;i++){
          const module=str(),name=str(),kind=byte();
          if(kind===0){const type=types[u()];if(!type)throw Error('helper ABI index');if(module==='helper'&&/^\d+$/.test(name))helpers[name]=type;}
          else if(kind===2){const flags=u();if(flags&~7)throw Error('helper ABI memory');skip64();if(flags&1)skip64();}
          else throw Error('helper ABI import');
        }
        if(p!==end)throw Error('helper ABI trailing import');
        return helpers;
      }
      p=stop;
    }
    return null;
  }catch{return null;}
}
function pcHelperAdapterModule(signature){
  const {params,results}=signature,key=params.join(',')+'>'+results.join(',');
  pcHelperModules??=new Map();if(pcHelperModules.has(key))return pcHelperModules.get(key);
  if(params.some(t=>t<0x7c||t>0x7f)||results.length>1||results.some(t=>t<0x7c||t>0x7f))throw Error('unsupported helper signature');
  const u=n=>{const b=[];do{let v=n&127;n>>>=7;b.push(v|(n?128:0));}while(n);return b;};
  const str=s=>[...u(s.length),...Array.from(s,c=>c.charCodeAt(0))];
  const section=(id,b)=>[id,...u(b.length),...b];
  const type=(p,r)=>[0x60,...u(p.length),...p,...u(r.length),...r];
  const imports=[...str('p'),...str('fn'),0,0,...str('p'),...str('now'),0,1,
    ...str('p'),...str('memory'),2,3,4,4,
    ...str('p'),...str('at'),3,0x7f,0,...str('p'),...str('seed'),3,0x7f,0];
  // Globals: imported byte address=0, seed=1, mutable PRNG state=2.
  const getArgs=params.flatMap((_,i)=>[0x20,...u(i)]),invoke=[...getArgs,0x10,0];
  const start=params.length,result=start+1;
  const add=(offset,value)=>[0x23,0,...value,0xfe,0x1e,2,...u(offset),0x1a];
  const body=[1+results.length,1,0x7c,...(results.length?[1,results[0]]:[]),
    0x41,0,0xfe,0x10,2,0,0x45,0x04,0x40,...invoke,0x0f,0x0b,
    ...add(0,[0x41,1]),
    0x23,2,0x23,2,0x41,13,0x74,0x73,0x24,2,
    0x23,2,0x23,2,0x41,17,0x76,0x73,0x24,2,
    0x23,2,0x23,2,0x41,5,0x74,0x73,0x24,2,
    0x23,2,0x41,0xff,0x07,0x71,0x04,0x40,...invoke,0x0f,0x0b,
    0x10,1,0x21,...u(start),...invoke,...(results.length?[0x21,...u(result)]:[]),
    // Saturating rounded microseconds, preserving Uint32 counter wrap.
    ...add(4,[0x10,1,0x20,...u(start),0xa1,0x44,0,0,0,0,0,0x40,0x8f,0x40,0xa2,
      0x44,0,0,0,0,0,0,0xe0,0x3f,0xa0,0xfc,3]),
    ...add(8,[0x41,1]),...(results.length?[0x20,...u(result)]:[]),0x0b];
  const bytes=Uint8Array.from([0,97,115,109,1,0,0,0,
    ...section(1,[2,...type(params,results),...type([],[0x7c])]),
    ...section(2,[5,...imports]),...section(3,[1,0]),
    ...section(6,[1,0x7f,1,0x23,1,0x0b]),
    ...section(7,[1,...str('call'),0,2]),...section(10,[1,...u(body.length),...body])]);
  const module=new WebAssembly.Module(bytes);pcHelperModules.set(key,module);return module;
}
function pcProfileHelper(fn,slot,signature){
  const bus=Module.pcHelperBus;if(!bus)return fn;
  const key=slot+':'+(signature?signature.params.join(',')+'>'+signature.results.join(','):'js');
  pcHelperWrappers??=new Map();const cached=pcHelperWrappers.get(key);if(cached?.fn===fn)return cached.wrapped;
  const words=new Uint32Array(bus.buffer),at=4+slot*3;
  const seed=(Math.imul(slot+1,0x9e3779b1)^0x6d2b79f5)>>>0||1;
  let wrapped;
  if(bus.memory&&signature&&Number.isInteger(slot)&&slot>=0&&slot<bus.slots){
    try{
      wrapped=new WebAssembly.Instance(pcHelperAdapterModule(signature),{p:{fn,now:()=>performance.now(),memory:bus.memory,at:at*4,seed}}).exports.call;
      Atomics.add(words,2,1);
    }catch{/* Unsupported engine/ABI retains correctness through JS fallback. */}
  }
  if(!wrapped){
    Atomics.add(words,3,1);let random=seed;
    wrapped=(...args)=>{
      if(!Atomics.load(words,0))return fn(...args);
      if(!Number.isInteger(slot)||slot<0||slot>=bus.slots){Atomics.add(words,1,1);return fn(...args);}
      Atomics.add(words,at,1);random^=random<<13;random^=random>>>17;random^=random<<5;
      if((random&1023)!==0)return fn(...args);
      const start=performance.now(),result=fn(...args);
      Atomics.add(words,at+1,Math.min(0xffffffff,Math.max(0,Math.round((performance.now()-start)*1000))));
      Atomics.add(words,at+2,1);return result;
    };
  }
  pcHelperWrappers.set(key,{fn,wrapped});return wrapped;
}
// PC_HELPER_RUNTIME_END
