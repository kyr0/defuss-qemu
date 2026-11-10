// Independent fixed guest/native oracle. Source draft, not live evidence.
import assert from 'node:assert/strict';
import {decodeComplete} from './reader.mjs';
export const protocol='defuss-m3b-boundary-fixture-v1';
export const settings=Object.freeze({hotLimit:1500,flags:2,instanceLimit:12000,m3aEnabled:true,profile:1,memoryMiB:512,tbSizeMiB:128,global:'apic.vapic=off',machine:'pc,acpi=off,hpet=off,usb=off',smp:'cpus=1,maxcpus=1'});
export const programs=Object.freeze([{name:'mbnd_add32',width:32},{name:'mbnd_add64',width:64}]);
export const probes=Object.freeze(programs.flatMap((p,program)=>[1,2].map(mode=>Object.freeze({request:program*2+mode,program,mode,count:mode===1?3:5}))));
const U64=(1n<<64n)-1n,U32=(1n<<32n)-1n,CC_MASK=0x8d5n,hex=x=>x.toString(16).padStart(16,'0'),parse=s=>{assert.match(s,/^[a-f0-9]{16}$/);return BigInt('0x'+s);};
const address=s=>{assert.match(s,/^0x[0-9a-f]+$/);const n=BigInt(s);assert.ok(n>=0x10000n&&n<(1n<<47n));return n;};
export function validateLayout(layout){
 assert.equal(layout.schema,1);const stack=address(layout.stackPointer);assert.equal(stack&15n,0n);assert.equal(layout.programs.length,2);const ranges=[];
 for(let i=0;i<2;i++){
  const p=layout.programs[i];assert.equal(p.name,programs[i].name);assert.equal(p.width,programs[i].width);
  const [a,b,back,side,end]=['a','b','back','side','end'].map(k=>address(p[k]));assert.ok(a<b&&b<back&&back<side&&side<end);assert.equal(Number(side-a),p.ownerBytes);assert.ok(p.ownerBytes<=128);assert.equal(a>>12n,(side-1n)>>12n);
  assert.match(p.codeHex,/^(?:[0-9a-f]{2})+$/);assert.equal(p.codeHex.length,2*p.ownerBytes);const raw=Buffer.from(p.codeHex,'hex'),j=Number(back-a);assert.equal(raw[j],0xeb);assert.equal(j+2,p.ownerBytes);assert.equal(p.ownerBytes+raw.readInt8(j+1),0);
  for(const [start,finish]of ranges)assert.ok(end<=start||a>=finish);ranges.push([a,end]);
 }
 return layout;
}
function fullResult(initial,width,count){
 const gpr=initial.gpr.map(parse);for(let n=0;n<count;n++){
  if(width===32)gpr[0]=(((gpr[0]&U32)+53n)^(gpr[3]&U32))&U32;
  else gpr[10]=((gpr[10]^gpr[13])+17n)&U64;
 }
 gpr[width===32?2:9]=0n;return {gpr:gpr.map(hex),rflags:hex(0x246n)};
}
export function reference(layout){
 validateLayout(layout);let seed=0x6c7e9241a5d038bfn,digest=0xcbf29ce484222325n,checks=3,calls=0,seq=0;
 const random=()=>{seed=(seed^(seed<<13n))&U64;seed^=seed>>7n;seed=(seed^(seed<<17n))&U64;return seed;};
 const mix=n=>{digest=((digest^n)*0x100000001b3n)&U64;};
 const prepare=(width,count)=>{const r=Array.from({length:16},random);r[7]=BigInt(layout.stackPointer);const flags=0x202n|(random()&CC_MASK);if(width===64)r[9]=BigInt(count);else r[2]=(random()&0xffffffff00000000n)|BigInt(count);return {gpr:r.map(hex),rflags:hex(flags)};};
 const execute=(initial,width,count)=>{const out=fullResult(initial,width,count);calls++;checks+=20;for(let i=0;i<16;i++)if(i!==7)mix(parse(out.gpr[i]));mix(parse(out.rflags));mix(BigInt(calls));return out;};
 const gates=[],inputs=[],results=[],order=[];const emit=(program,phase,request,mode,n,bodies)=>{const row={seq:seq++,program,phase,request,mode,calls:n,bodies,checks,digest:hex(digest)};gates.push(row);order.push({type:'gate',value:row});};
 emit(-1,'layout',0,0,0,0);
 for(let program=0;program<2;program++){
  const width=programs[program].width;for(let i=0;i<4096;i++)execute(prepare(width,4),width,4);emit(program,'warm',0,0,4096,16384);
  for(const probe of probes.filter(p=>p.program===program)){
   const initial=prepare(width,probe.count),input={...probe,priorBefore:calls,initial};inputs.push(input);order.push({type:'input',value:input});emit(program,'before',probe.request,probe.mode,0,0);
   const priorBefore=calls,observed=execute(initial,width,probe.count),result={request:probe.request,priorBefore,priorAfter:calls,observed};results.push(result);order.push({type:'result',value:result});emit(program,'after',probe.request,probe.mode,1,probe.count);
  }
 }
 const pass={schema:1,programs:2,probes:4,gates:11,calls,checks,digest:hex(digest)};order.push({type:'pass',value:pass});return {gates,inputs,results,pass,order};
}
function parity(value){let bits=Number(value&255n),odd=0;for(let i=0;i<8;i++){odd^=bits&1;bits>>>=1;}return odd?0n:4n;}
export function validateNativeProbe(raw,input,layout,{generation}){
 const expected=reference(layout).inputs[input.request-1];assert.deepEqual(input,expected,'Exact fixed probe/input stream');const p=layout.programs[input.program],width=p.width;
 const bank=decodeComplete(raw,{...input,a:p.a,b:p.b,ownerBytes:p.ownerBytes}),before=bank.before,after=bank.postCall;
 assert.equal(BigInt(bank.generation),BigInt(generation),'Captured generation agrees with independently stopped selected-range watch');
 assert.deepEqual(before.gpr,input.initial.gpr);assert.equal(BigInt(before.rflags),parse(input.initial.rflags));
 // The trampoline's POPFQ/indirect dispatch materializes EFLAGS. Raw unused
 // CC operands are retained but not assigned architectural significance.
 assert.equal(before.ccOp,0);assert.equal(parse(before.rawEflags),0x202n);assert.equal(parse(before.ccSrc),parse(input.initial.rflags)&CC_MASK);assert.equal(before.df,1);
 const expectedGpr=input.initial.gpr.map(parse),count=BigInt(input.count);
 if(input.mode===1){if(width===32){expectedGpr[0]=(((expectedGpr[0]&U32)+53n)^(expectedGpr[3]&U32))&U32;expectedGpr[2]=count-1n;}else{expectedGpr[10]=((expectedGpr[10]^expectedGpr[13])+17n)&U64;expectedGpr[9]=count-1n;}}
 assert.deepEqual(after.gpr,expectedGpr.map(hex));const result=input.mode===1?count-1n:count;
 // Normal x86 lowering loads the full target_ulong register even for
 // MO_32. Register writeback alone zero-extends; cpu_cc_dst keeps the full
 // T0 subtraction. SUBL flag computation consumes its low32 bits.
 const rawResult=(parse(input.initial.gpr[width===32?2:9])-(input.mode===1?1n:0n))&U64;
 assert.equal(BigInt(after.rflags),0x202n|parity(result));assert.equal(after.ccOp,width===32?18:19,'Actual SUBL/SUBQ lazy representation');assert.equal(parse(after.ccDst),rawResult,'Full-width lazy result before width-specific flag interpretation');assert.equal(parse(after.ccSrc),input.mode===1?1n:0n);
 for(const key of ['rawEflags','df','hflags','hflags2','csBase','fsBase','gsBase','cr0','cr4','efer'])assert.equal(after[key],before[key],'Register-only probe preserved '+key);
 assert.deepEqual(bank.postService.raw,after.raw);return {...bank,scope:'One actual compiled fused call and service-return preservation; forced request is diagnostic and no suspension is inferred.'};
}
export const openGates=Object.freeze(['No natural interrupt-arrival proof: mode2 is one private diagnostic B-request selector.','AsyncifyNormal plus equal post-service state does not establish an actual yield; separate emitted-WASM unwind/rewind and natural-pressure VM evidence remain required.','Snapshots cover integer/lazy flags and listed control fields, not complete FP/XSAVE/system state; final guest legacy FP/SSE preservation does not cover extended YMM.','Real reviewed graph/runtime/build/ELF identity, OFF/ON captures and independent replay remain unexecuted.']);
