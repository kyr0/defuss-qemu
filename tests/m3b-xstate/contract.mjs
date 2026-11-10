// Source-only fixture contract. No runtime adapter or executed validation yet.
import assert from 'node:assert/strict';
export const protocol='defuss-m3b-xstate-fixture-v1';
export const settings=Object.freeze({hotLimit:1500,flags:2,instanceLimit:12000,m3aEnabled:true,profile:1,
 machine:'pc,acpi=off,hpet=off,usb=off',smp:'cpus=1,maxcpus=1',memoryMiB:512,tbSizeMiB:128});
export const programs=Object.freeze([
 ['m3b_add32','fused','add32'],['m3b_add64','fused','add64'],
 ['m3b_imul64','ir-retry','imul64'],['m3b_dynamic','ir-retry','dynamic'],
 ['m3b_memory','predecode-reject','memory'],['m3b_insns32','fused','add32'],
 ['m3b_insns33','predecode-reject','add32'],['m3b_bytes128','fused','add32-prefix'],
 ['m3b_bytes129','predecode-reject','add32-prefix'],['m3b_page_end','ir-retry','add32'],
 ['m3b_page_cross','predecode-reject','add32'],
].map(([name,expectation,model])=>Object.freeze({name,expectation,model})));
export const phases=Object.freeze(['warm','side','body','direct-b']);
const U64=(1n<<64n)-1n,U32=(1n<<32n)-1n;
const integer=(n,name)=>assert.ok(Number.isSafeInteger(n)&&n>=0,name);
const hex=n=>n.toString(16).padStart(16,'0');
const address=(s,name)=>{assert.match(s,/^0x[0-9a-f]+$/,name);const n=BigInt(s);assert.ok(n>=0x10000n&&n<(1n<<47n),name);return n;};
export function validateLayout(layout){
 assert.equal(layout.schema,1);assert.equal(layout.programs.length,programs.length);
 const occupied=[];
 for(let i=0;i<programs.length;i++){
  const p=layout.programs[i],spec=programs[i];assert.equal(p.name,spec.name);assert.equal(p.expectation,spec.expectation);
  const [a,b,back,side,end]=['a','b','back','side','end'].map(k=>address(p[k],k));
  assert.ok(a<b&&b<back&&back<side&&side<end);assert.equal(Number(side-a),p.ownerBytes);assert.ok(p.ownerBytes<=160);
  assert.match(p.codeHex,/^(?:[0-9a-f]{2})+$/);assert.equal(p.codeHex.length,p.ownerBytes*2);
  // Code hex and actual ELF disassembly must additionally be pinned by the future builder.
  const j=Number(back-a),raw=Buffer.from(p.codeHex,'hex');assert.ok(raw[j]===0xeb||raw[j]===0xe9);
  const displacement=raw[j]===0xeb?raw.readInt8(j+1):raw.readInt32LE(j+1);
  assert.equal(j+(raw[j]===0xeb?2:5),p.ownerBytes);assert.equal(p.ownerBytes+displacement,0);
  for(const [start,finish]of occupied)assert.ok(end<=start||a>=finish,'Distinct program ranges');occupied.push([a,end]);
  if(spec.name==='m3b_bytes128')assert.equal(p.ownerBytes,128);
  if(spec.name==='m3b_bytes129')assert.equal(p.ownerBytes,129);
  if(spec.name==='m3b_page_end')assert.equal(side&4095n,0n);
  if(spec.name==='m3b_page_cross')assert.notEqual(a>>12n,(side-1n)>>12n);
  else assert.equal(a>>12n,(side-1n)>>12n,'Owner bytes remain within one page');
 }
 return layout;
}
// Independent fixed-input oracle for the reproducible digest. Address fields
// and opaque FP state are compared by the guest but excluded from this digest.
export function referenceGates(){
 let seed=0x4a72db913c60e58fn,digest=0xcbf29ce484222325n,checks=4,seq=0;
 const random=()=>{seed=(seed^(seed<<13n))&U64;seed^=seed>>7n;seed=(seed^(seed<<17n))&U64;return seed;};
 const mix=x=>{digest=((digest^x)*0x100000001b3n)&U64;};
 const one=(p,count)=>{
  const r=Array.from({length:16},random);let flags=0x202n|(random()&0x8d5n),n=BigInt(count);
  if(p.model==='add64'||p.model==='imul64')r[9]=n;
  else r[2]=(random()&0xffffffff00000000n)|n;
  if(p.model==='dynamic')flags=(flags&~64n)|(count?0n:64n);
  let memory=random()&U32;
  for(let i=0;i<count;i++){
   if(p.model==='add64')r[10]=((r[10]^r[13])+17n)&U64;
   else if(p.model==='imul64')r[10]=(r[10]*0xfffffffffffffff9n+17n)&U64;
   else if(p.model==='memory')memory=(memory+7n)&U32;
   else r[0]=(((r[0]&U32)+53n)^(r[3]&U32))&U32;
  }
  if(count)r[p.model==='add64'||p.model==='imul64'?9:2]=0n;
  if(p.model==='add32-prefix')r[8]=0x7139ac4e0528b6dfn;
  if(p.model!=='dynamic'||count)flags=0x246n;
  for(let i=0;i<16;i++)if(i!==7&&!(p.model==='memory'&&i===4))mix(r[i]);mix(flags);mix(memory);checks+=20;
 };
 const rows=[],emit=(program,phase,calls,bodies)=>rows.push({seq:seq++,program,phase,calls,bodies,checks,digest:hex(digest)});
 emit(-1,'layout',0,0);
 for(let i=0;i<programs.length;i++){
  const p=programs[i];for(let n=0;n<2048;n++){one(p,4);one(p,4);}emit(i,'warm',4096,16384);
  for(let n=0;n<64;n++)one(p,0);emit(i,'side',64,0);
  for(const phase of ['body','direct-b']){let bodies=0;for(let n=0;n<64;n++){const count=1+n%17;one(p,count);bodies+=count;}emit(i,phase,64,bodies);}
 }
 return {gates:rows,pass:{schema:1,programs:programs.length,gates:rows.length,checks,digest:hex(digest)}};
}
const watchFields=['compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','predecodeAccepted','IRRejected','emittedOwners','entryRejects','cleanRetries','backedgeTciReturns'];
function watch(w){for(const k of watchFields)integer(w[k],k);assert.ok(w.BRequested<=w.BAttempts);assert.equal(w.servicePaid,w.BAttempts,'Every attempted B boundary pays exactly one service turn');assert.equal(w.entryRejects,0);}
// The future adapter must preserve raw banks and independently confirm stopped
// QMP state, non-saturation, active profile and exact A/B single-PC watch ranges.
// These normalized windows are reset at every gate, not cumulative subtraction.
export function validateSelectedWindow({enabled,program,phase,gate,m3aA,m3aB,fusedA,fusedB}){
 assert.equal(typeof enabled,'boolean');integer(program,'program');const p=programs[program];assert.ok(p);assert.ok(phases.includes(phase));
 assert.equal(gate.program,program);assert.equal(gate.phase,phase);assert.equal(gate.seq,1+program*4+phases.indexOf(phase));
 integer(gate.calls,'calls');integer(gate.bodies,'bodies');
 const expected={warm:[4096,16384],side:[64,0],body:[64,550],'direct-b':[64,550]}[phase];
 assert.deepEqual([gate.calls,gate.bodies],expected,'Gate work identity');
 watch(fusedA);watch(fusedB);integer(m3aA.selectedEntries,'M3a A');integer(m3aB.selectedEntries,'M3a B');
 assert.ok(m3aA.selectedEntries>0,'Actual ordinary/owning compiled A exposure is required');
 for(const k of watchFields)assert.equal(fusedB[k],0,'Direct B must remain a distinct ordinary owner: '+k);
 if(phase==='warm'||phase==='direct-b')assert.ok(m3aB.selectedEntries>0,'Actual compiled direct-B exposure is required');
 if(!enabled){for(const k of watchFields){assert.equal(fusedA[k],0);assert.equal(fusedB[k],0);}return;}
 if(p.expectation==='fused'){
  assert.ok(fusedA.compiledEntries>0,'Selected fused compiled path missing from this exact batch');
  if(phase==='warm'){assert.ok(fusedA.predecodeAccepted>0);assert.ok(fusedA.emittedOwners>0);}
  else {
   return {compiledAttempts:fusedA.compiledEntries,tciAttempts:fusedA.tciEntries,
    BAttempts:fusedA.BAttempts,BRequested:fusedA.BRequested,servicePaid:fusedA.servicePaid,
    scope:'Exact watched entry exposure and service equality; no retired-body partition without a trace.'};
  }
 }else{
  assert.equal(fusedA.compiledEntries,0);assert.equal(fusedA.tciEntries,0);assert.equal(fusedA.emittedOwners,0);
  assert.equal(fusedA.BAttempts,0);assert.equal(fusedA.servicePaid,0);
  if(phase==='warm'){
   if(p.expectation==='ir-retry'){assert.ok(fusedA.predecodeAccepted>0);assert.ok(fusedA.IRRejected>0);assert.ok(fusedA.cleanRetries>0);}
   else {assert.equal(fusedA.predecodeAccepted,0);assert.equal(fusedA.IRRejected,0);assert.equal(fusedA.cleanRetries,0);}
  }
 }
}
export const openGates=Object.freeze([
 'This fixture checks return-state preservation of every enabled user XSAVE component in the explicitly admitted XCR0=7 or519 profile; unknown components fail.',
 'It does not observe complete native state at every internal B/budget boundary, kernel/supervisor XSTATE, real Asyncify suspension, alias SMC or instruction faults.',
 'Watched entries are attempts, not retired bodies or time fractions. No instruction trace or exact F+R+D body partition is claimed.',
 'No timing or production promotion follows from a diagnostic pass.',
]);
