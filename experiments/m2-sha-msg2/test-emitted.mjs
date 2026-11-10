// Execute the exact bytes written by the C emitter in shared memory64/32.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [bodyPath,casesPath,width,wasmPath]=process.argv.slice(2),memory64=width==='64';
assert.ok(['32','64'].includes(width));
const body=await readFile(bodyPath),cases=await readFile(casesPath);
const unsigned=n=>{const out=[];do{let b=n&127;n=Math.floor(n/128);out.push(b|(n?128:0));}while(n);return out;};
const signed=n=>{n=BigInt(n);const out=[];for(;;){let b=Number(n&127n);n>>=7n;const done=(n===0n&&!(b&64))||(n===-1n&&(b&64));out.push(b|(done?0:128));if(done)return out;}};
const section=(id,data)=>[id,...unsigned(data.length),...data];
const name=text=>[text.length,...Buffer.from(text)];
const code=[2,1,0x7f,19,0x7e]; // local1=i32, local2..20=i64; exact backend indices.
for(let reg=0;reg<16;reg++)code.push(0x42,...signed(0x12340000+reg),0x21,4+reg);
code.push(0x20,0,0x21,19); // R15 is the call-stack pointer.
code.push(...body);
for(let reg=1;reg<16;reg++)code.push(memory64?0x42:0x41,...signed(8192+reg*8),0x20,4+reg,0x37,0,0);
code.push(0x0b);
const wasm=Uint8Array.from([0,97,115,109,1,0,0,0,
  ...section(1,[1,0x60,1,0x7e,0]),...section(3,[1,0]),
  ...section(5,[1,memory64?7:3,2,2]),
  ...section(7,[2,...name('run'),0,0,...name('memory'),2,0]),
  ...section(10,[1,...unsigned(code.length),...code])]);
assert.ok(WebAssembly.validate(wasm));await writeFile(wasmPath,wasm,{flag:'wx'});
const {instance}=await WebAssembly.instantiate(wasm),memory=new Uint8Array(instance.exports.memory.buffer);
assert.ok(memory.buffer instanceof SharedArrayBuffer);
const view=new DataView(memory.buffer),mask=0xffffffffn;
const sigma=x=>{x=BigInt(x);const rotate=n=>((x>>n)|(x<<(32n-n)))&mask;return rotate(17n)^rotate(19n)^(x>>10n);};
function oracle(bytes,d,a,b){const copy=Buffer.from(bytes),data=new DataView(copy.buffer,copy.byteOffset,copy.byteLength);
  for(let word=0;word<4;word++){const input=word<2?b+(word+2)*4:d+(word-2)*4;data.setUint32(d+word*4,Number((BigInt(data.getUint32(a+word*4,true))+sigma(data.getUint32(input,true)))&mask),true);}return copy;}
function run(initial,d,a,b,expected){
  memory.fill(0xa5);memory.set(initial);view.setBigUint64(4096,BigInt(d),true);view.setBigUint64(4104,BigInt(a),true);view.setBigUint64(4112,BigInt(b),true);
  const before=Buffer.from(memory);instance.exports.run(4096n);
  assert.deepEqual(Buffer.from(memory.subarray(0,512)),expected);
  assert.deepEqual(Buffer.from(memory.subarray(512,8192)),before.subarray(512,8192));
  assert.deepEqual(Buffer.from(memory.subarray(8320)),before.subarray(8320));
  for(let reg=1;reg<16;reg++)assert.equal(view.getBigUint64(8192+reg*8,true),reg===15?4096n:BigInt(0x12340000+reg),'Preserved TCG local changed');
}
const stride=12+512*2;assert.equal(cases.length%stride,0);
for(let offset=0;offset<cases.length;offset+=stride){
  const d=cases.readUInt32LE(offset),a=cases.readUInt32LE(offset+4),b=cases.readUInt32LE(offset+8);
  const initial=cases.subarray(offset+12,offset+524),expected=cases.subarray(offset+524,offset+1036);
  assert.deepEqual(oracle(initial,d,a,b),expected,'Independent BigInt oracle disagrees with original QEMU helper');run(initial,d,a,b,expected);
}
// Unaligned private-buffer offsets additionally test emitted load/store hints.
let extra=0;
for(let shift=1;shift<16;shift++)for(const [d,a,b] of [[64+shift,96,128],[64,96+shift,128],[64,96,128+shift],[64+shift,64,64+shift]]){
  const initial=Buffer.from(Array.from({length:512},(_,i)=>(i*41+shift*17)&255));run(initial,d,a,b,oracle(initial,d,a,b));extra++;
}
console.log(JSON.stringify({status:'passed',memoryWidth:width,shared:true,originalHelperCases:cases.length/stride,
  unalignedBigIntCases:extra,guardBytesAndPreservedLocals:true,bodyBytes:body.length,wasmBytes:wasm.length,
  wasmSha256:createHash('sha256').update(wasm).digest('hex')}));
