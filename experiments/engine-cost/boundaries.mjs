// Controlled call-boundary probe. No VM, memory64, SIMD, or end-to-end claim.
const u=n=>{const r=[];do{const b=n&127;n>>>=7;r.push(b|(n?128:0));}while(n);return r;};
const s=n=>{const r=[];while(true){const b=n&127;n>>=7;const end=(n===0&&!(b&64))||(n===-1&&(b&64));r.push(b|(end?0:128));if(end)return r;}};
const str=x=>[...u(x.length),...Array.from(x,c=>c.charCodeAt(0))];
const section=(id,b)=>[id,...u(b.length),...b];
const header=[0,97,115,109,1,0,0,0];
const types=section(1,[1,0x60,1,0x7f,1,0x7f]);
const body=b=>[...u(b.length),...b];
const helper=[0,0x20,0,0x41,...s(1664525),0x6c,0x41,...s(1013904223),0x6a,0x0b];
const loop=[1,2,0x7f,0x41,...s(123),0x21,1,0x02,0x40,0x03,0x40,
 0x20,2,0x20,0,0x4f,0x0d,1,0x20,1,0x10,0,0x21,1,
 0x20,2,0x41,1,0x6a,0x21,2,0x0c,0,0x0b,0x0b,0x20,1,0x0b];
export const helperBytes=Uint8Array.from([...header,...types,...section(3,[1,0]),...section(7,[1,...str('f'),0,0]),...section(10,[1,...body(helper)])]);
export const sameBytes=Uint8Array.from([...header,...types,...section(3,[2,0,0]),...section(7,[1,...str('run'),0,1]),...section(10,[2,...body(helper),...body(loop)])]);
export const importedBytes=Uint8Array.from([...header,...types,...section(2,[1,...str('i'),...str('f'),0,0]),...section(3,[1,0]),...section(7,[1,...str('run'),0,1]),...section(10,[1,...body(loop)])]);
const oracle=n=>{let x=123;for(let i=0;i<n;i++)x=(Math.imul(x,1664525)+1013904223)|0;return x;};
export async function probe(){
 const native=new WebAssembly.Instance(new WebAssembly.Module(helperBytes)).exports.f;
 const imported=new WebAssembly.Module(importedBytes);
 const functions={sameInstance:new WebAssembly.Instance(new WebAssembly.Module(sameBytes)).exports.run,
  nativeCrossInstance:new WebAssembly.Instance(imported,{i:{f:native}}).exports.run,
  javascriptImport:new WebAssembly.Instance(imported,{i:{f:x=>(Math.imul(x,1664525)+1013904223)|0}}).exports.run};
 const n=1000000,expected=oracle(n),trials=[];
 for(const [name,fn]of Object.entries(functions))for(const count of [0,1,2,7,1024,n])if(fn(count)!==oracle(count))throw Error('Oracle '+name+' '+count);
 for(let i=0;i<32;i++){for(const fn of Object.values(functions))if(fn(n)!==expected)throw Error('Warmup oracle');await new Promise(r=>setTimeout(r,0));}
 for(let block=0;block<8;block++){
  const order=Object.keys(functions);if(block%2)order.reverse();
  for(const name of order){const fn=functions[name],start=performance.now();let value;for(let i=0;i<5;i++)value=fn(n);const ms=performance.now()-start;if(value!==expected)throw Error('Measured oracle');trials.push({block,name,ms,calls:5,iterationsPerCall:n,value});}
 }
 return {status:'passed',scope:'Default-engine controlled i32 call boundaries; no guest/VM speedup or observed-tier attribution',warmupsPerVariant:32,expected,trials};
}
