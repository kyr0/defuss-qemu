// Synthetic handshake/ABI integration; no guest execution or acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ForensicOracle} from './oracle.mjs';
import {programs} from '../m3b-fallthrough/contract.mjs';
import {verifyChunkFiles,verifyChunkIndex} from './inspect.mjs';
import {createHash} from 'node:crypto';
const binding={schema:1,kind:'m3b-differential-runtime-binding-v1',status:'passed',timingEligible:false,variant:'m3b-context-census-v1',diagnosticExtensions:['context-entry-census-v1','generation-specific-injection-v1'],censusAbi:{version:1,words:2400,slots:4}};
const layout=JSON.parse(await readFile(new URL('../../artifacts/m3b-fixture-01/layout.json',import.meta.url))).programs.map((p,i)=>({...p,expectation:programs[i].expectation}));
const proof={binding,graph:{text:'synthetic-graph\n'},objects:{text:'synthetic-objects\n'}};
const pair=(w,at,v)=>{v=BigInt(v);w[at]=Number(v&0xffffffffn);w[at+1]=Number(v>>32n);};
function raw(initial,enabled=true){
 const a=Array(96).fill(0),b=Array(128).fill(0),c=Array(2400).fill(0),boundary=Array(256).fill(0);
 Object.assign(a,{0:0x4d335231,1:1,2:1,3:initial?0:1,5:256,6:104,7:32,8:4,9:64,10:8,12:initial?1:3});
 Object.assign(b,{0:0x4d334231,1:1,2:enabled?63:62,5:1,6:32,7:128,8:12,9:32,10:20,12:4});
 Object.assign(c,{0:0x4d334343,1:1,2:initial?3:7,5:2400,6:4,7:32,8:592,9:112});
 Object.assign(boundary,{0:0x4d334253,1:1,6:256,7:64});
 return {status:{running:false,status:initial?'prelaunch':'paused'},captureErrors:[],m3aRaw:a,m3bRaw:b,boundaryRaw:boundary,nativeStatus:b[2],censusRaw:c,censusNativeStatus:c[2],pool:{limit:12000,charged:0,linearMemoryBytes:1048576}};
}
const start=(enabled=true)=>({...raw(true,enabled),event:'startup',startupCpus:[{'cpu-index':0}],startupFailure:null,hostMs:0,graphRaw:[...Buffer.from(proof.graph.text)],objectsRaw:[...Buffer.from(proof.objects.text)]});
function prepared(enabled=true){
 const oracle=new ForensicOracle({enabled,proof,layout});oracle.accept(start(enabled));
 oracle.accept({...raw(false,enabled),event:'gate',gate:oracle.reference.gates[0],layout:{schema:1,programs:layout},signalHostMs:1,readHostMs:2});
 const row={...raw(false,enabled),event:'configured',seq:0,program:0,hostMs:3};row.m3aRaw[11]=row.m3bRaw[11]=row.censusRaw[10]=4;row.censusRaw[13]=1;
 for(let slot=0;slot<4;slot++){
  const p=slot<2?BigInt(layout[0][slot?'b':'a']):0n;
  pair(row.m3aRaw,64+slot*8,p);pair(row.m3aRaw,66+slot*8,p?p+1n:0n);row.m3aRaw[71+slot*8]=p?1:0;
  pair(row.m3bRaw,32+slot*20,p);pair(row.m3bRaw,34+slot*20,p?p+1n:0n);
  const at=32+slot*592;row.censusRaw[at+4]=slot+1;if(slot===0){pair(row.censusRaw,at,p);row.censusRaw[at+2]=1;row.censusRaw[at+3]=enabled?1:0;}
 }
 return {oracle,row};
}
test('startup requires an empty chosen census and the reviewed new binding',()=>{
 for(const enabled of [false,true]){const oracle=new ForensicOracle({enabled,proof,layout});oracle.accept(start(enabled));assert.equal(oracle.phase,'gate');}
 for(const mutate of [r=>delete r.censusRaw,r=>r.censusNativeStatus=7,r=>r.censusRaw[3]=1,r=>r.censusRaw[12]=1,r=>r.censusRaw[32+4]=1]){const r=start();mutate(r);assert.throws(()=>new ForensicOracle({enabled:true,proof,layout}).accept(r));}
 assert.throws(()=>new ForensicOracle({enabled:true,proof:{...proof,binding:{...binding,variant:'old'}},layout}));
});
test('all four reset epochs are exact and census slot0 alone follows the A watch',()=>{
 for(const enabled of [false,true]){const {oracle,row}=prepared(enabled);oracle.accept(row);oracle.accept({event:'ack',seq:0,hostMs:4,watchEpoch:{m3a:4,m3b:4,census:4}});assert.equal(oracle.seq,1);}
 for(const mutate of [r=>r.censusRaw[10]=3,r=>r.censusRaw[32+4]=4,r=>r.censusRaw[32+592+4]=0,r=>r.censusRaw[32+3]=0,r=>r.censusNativeStatus=3,r=>r.censusRaw[11]=1,r=>r.censusRaw[19]=1,r=>r.censusRaw[12]=1]){const {oracle,row}=prepared();mutate(row);assert.throws(()=>oracle.accept(row));}
 const {oracle,row}=prepared();oracle.accept(row);assert.throws(()=>oracle.accept({event:'ack',seq:0,hostMs:4,watchEpoch:{m3a:4,m3b:4}}));
});
test('bounded chunk-file verification matches the original pure ledger and rejects short reads/tails',async()=>{
 const files={trace:Buffer.from([1,2,3,4]),serial:Buffer.from([7]),stderr:Buffer.alloc(0)},digest=b=>createHash('sha256').update(b).digest('hex');
 const rows=[{schema:1,seq:0,stream:'trace',offset:0,bytes:3,sha256:digest(files.trace.subarray(0,3))},{schema:1,seq:1,stream:'serial',offset:0,bytes:1,sha256:digest(files.serial)},{schema:1,seq:2,stream:'trace',offset:3,bytes:1,sha256:digest(files.trace.subarray(3))}];
 const sizes=Object.fromEntries(Object.entries(files).map(([n,b])=>[n,b.length])),readRange=async(n,a,b)=>files[n].subarray(a,b);
 assert.deepEqual(await verifyChunkFiles(rows,{readRange,sizes}),verifyChunkIndex(rows,files));
 await assert.rejects(()=>verifyChunkFiles(rows,{sizes,readRange:async(n,a,b)=>(await readRange(n,a,b)).subarray(1)}));
 await assert.rejects(()=>verifyChunkFiles(rows.slice(0,-1),{sizes,readRange}),/Unindexed/);
});
function warmForMutation(){
 const {oracle,row}=prepared();oracle.accept(row);oracle.accept({event:'ack',seq:0,hostMs:4,watchEpoch:{m3a:4,m3b:4,census:4}});
 const warm=structuredClone(row);delete warm.seq;delete warm.program;delete warm.hostMs;
 Object.assign(warm,{event:'gate',gate:oracle.reference.gates[1],signalHostMs:5,readHostMs:6});
 const a=warm.m3aRaw,b=warm.m3bRaw,c=warm.censusRaw,pc=BigInt(layout[0].a),bp=BigInt(layout[0].b);
 a[18]=a[19]=2;a[68]=a[76]=1;pair(a,69,pc);pair(a,77,bp);
 for(const [at,value]of [[16,1],[17,1],[20,1],[22,1],[24,1],[29,1],[36,1],[38,1],[40,1],[41,1],[43,1]])b[at]=value;
 pair(b,48,pc);pair(b,50,23n);c[12]=1;for(const at of [32+6,32+8,32+16,32+20])c[at]=1;
 const t=64;for(const [at,n]of [[0,pc],[2,0x100n],[4,23n],[6,0x200n],[8,pc],[10,0x3000n],[12,(1n<<64n)-1n]])pair(c,t+at,n);
 c[t+14]=c[t+17]=0x18c0c2b3;c[t+15]=0xff020000;c[t+16]=1;c[t+19]=0x200;
 oracle.accept(warm);assert.equal(oracle.phase,'injection-request');return {oracle,warm,pc:'0x'+pc.toString(16)};
}
function mutationRows(warm,pc){
 const request={event:'injection-request',seq:1,requestID:1,action:'stale-instance',slot:0,pc,generation:'0x17',before:structuredClone(warm),hostMs:7};
 const after=structuredClone(warm);delete after.event;delete after.gate;delete after.signalHostMs;delete after.readHostMs;
 const c=after.censusRaw;c[16]=c[17]=c[20]=c[21]=c[22]=1;pair(c,24,BigInt(pc));pair(c,26,23n);pair(c,28,23n);c[30]=0x18c0c2b3;c[31]=0xff020000;
 after.m3aRaw[34]=1;pair(after.m3aRaw,50,BigInt(pc));pair(after.m3aRaw,52,23n);after.m3aRaw[54]=1;
 const injection={event:'injection',seq:1,mutation:{requestID:1,action:'stale-instance',slot:0,pc,generation:'0x17',returnCode:1,nativeCalls:1},returnCode:1,nativeCalls:1,failure:null,statusFailure:null,before:structuredClone(warm),after,hostMs:8};
 return {request,injection};
}
test('typed mutation request and exact after evidence must precede any next watch reset or ACK',()=>{
 const {oracle,warm,pc}=warmForMutation(),{request,injection}=mutationRows(warm,pc);
 assert.throws(()=>oracle.accept({event:'ack',seq:1,hostMs:7,watchEpoch:{m3a:4,m3b:4,census:4}}));
 oracle.accept(request);assert.equal(oracle.phase,'injection');oracle.accept(injection);assert.equal(oracle.phase,'configured');assert.equal(oracle.recovery.injections.length,1);
});
test('wrong request target and native refusal remain protocol failures before configured/ACK',()=>{
 {const {oracle,warm,pc}=warmForMutation(),{request}=mutationRows(warm,pc);request.pc='0x999000';assert.throws(()=>oracle.accept(request));assert.equal(oracle.phase,'injection-request');}
 {const {oracle,warm,pc}=warmForMutation(),{request,injection}=mutationRows(warm,pc);oracle.accept(request);injection.returnCode=-2;assert.throws(()=>oracle.accept(injection));assert.equal(oracle.phase,'injection');assert.equal(oracle.recovery.injections.length,0);}
});
