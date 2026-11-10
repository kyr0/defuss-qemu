import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const dir='artifacts/rnds2-lanes-emitter-04';
const u=n=>{const r=[];do{const b=n&127;n>>>=7;r.push(b|(n?128:0));}while(n);return r;};
const section=(n,b)=>[n,...u(b.length),...b];
const str=s=>[...u(s.length),...Array.from(s,c=>c.charCodeAt(0))];
// Same initial local indexes as the actual TB: parameter 0, i32 1, i64 2..20.
const wrap=(body,lanes)=>{
 const locals=lanes?[3,1,0x7f,19,0x7e,8,0x7f]:[2,1,0x7f,19,0x7e];
 // Dirty scratch/TCG registers; call-stack base remains zero, as arranged below.
 const dirty=[];for(let i=1;i<=(lanes?28:20);i++)if(i!==19)dirty.push(i===1||i>=21?0x41:0x42,0x7f,0x21,i);
 const fn=[...locals,...dirty,...body,0x0b];
 return Uint8Array.from([0,97,115,109,1,0,0,0,
  ...section(1,[1,0x60,1,0x7e,0]),...section(3,[1,0]),
  ...section(5,[1,7,1,1]), // shared memory64, min=max=1 page
  ...section(7,[2,...str('run'),0,0,...str('memory'),2,0]),
  ...section(10,[1,...u(fn.length),...fn])]);
};
const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
function oracle(a,b,w){let s=[b[3],b[2],a[3],a[2],b[1],b[0],a[1],a[0]];for(let i=0;i<2;i++){
 const [A,B,C,D,E,F,G,H]=s;
 const t=(H+(rotr(E,6)^rotr(E,11)^rotr(E,25))+((E&F)|(~E&G))+w[i])>>>0;
 s=[(t+(rotr(A,2)^rotr(A,13)^rotr(A,22))+((A&B)|((A|B)&C)))>>>0,A,B,C,(D+t)>>>0,E,F,G];
 }return[s[5],s[4],s[1],s[0]];}
let seed=0x918672ab;const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
const instances={};for(const kind of ['original','candidate']){
 const bytes=wrap(await readFile(dir+'/'+kind+'.body'),kind==='candidate');assert.ok(WebAssembly.validate(bytes));
 await writeFile(dir+'/'+kind+'.wasm',bytes,{flag:'wx'});instances[kind]=new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
}
let checks=0;
// d,a,b equality partitions, unaligned private state, full-memory preservation.
for(const [di,ai,bi]of [[0,1,2],[0,0,1],[0,1,0],[0,1,1],[0,0,0]])for(let n=0;n<4096;n++){
 const initial=new Uint8Array(192);for(let j=0;j<initial.length;j++)initial[j]=rand()&255;
 const words=new DataView(initial.buffer),addresses=[65,97,129],d=addresses[di],a=addresses[ai],b=addresses[bi],wk=[rand(),rand()];
 const get=p=>Array.from({length:4},(_,i)=>words.getUint32(p+4*i,true));
 const expected=oracle(get(a),get(b),wk);
 words.setBigUint64(0,BigInt(d),true);words.setBigUint64(8,BigInt(a),true);words.setBigUint64(16,BigInt(b),true);
 words.setBigUint64(24,BigInt(wk[0]),true);words.setBigUint64(32,BigInt(wk[1]),true);
 const after=initial.slice(),view=new DataView(after.buffer);expected.forEach((v,i)=>view.setUint32(d+i*4,v,true));
 for(const [kind,x]of Object.entries(instances)){new Uint8Array(x.memory.buffer).set(initial);x.run(0n);assert.deepEqual(new Uint8Array(x.memory.buffer,0,192),after,kind+' '+[di,ai,bi,n]);checks++;}
}
const report={status:'passed',checks,perEmitter:checks/2,partitions:5,casesPerPartition:4096,scope:'Extracted actual emitter bytecode; independent two-round oracle and complete 192-byte memory comparison; memory64 shared, unaligned addresses, dirty locals; no timing or selector/whole-VM claim'};
await writeFile(dir+'/tests.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
