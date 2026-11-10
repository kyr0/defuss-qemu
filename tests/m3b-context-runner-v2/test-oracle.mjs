// Synthetic handshake/ABI integration; no guest execution or acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ForensicOracle} from './oracle.mjs';
import {programs} from '../m3b-fallthrough/contract.mjs';
import {verifyChunkFiles,verifyChunkIndex} from './inspect.mjs';
import {createHash} from 'node:crypto';
const binding={schema:1,kind:'m3b-differential-runtime-binding-v1',status:'passed',timingEligible:false,variant:'m3b-context-census-v2',diagnosticExtensions:['context-entry-census-v2','generation-specific-injection-v1'],censusAbi:{version:2,words:2400,slots:4}};
const layout=JSON.parse(await readFile(new URL('../../artifacts/m3b-fixture-01/layout.json',import.meta.url))).programs.map((p,i)=>({...p,expectation:programs[i].expectation}));
const proof={binding,graph:{text:'synthetic-graph\n'},objects:{text:'synthetic-objects\n'}};
const pair=(w,at,v)=>{v=BigInt(v);w[at]=Number(v&0xffffffffn);w[at+1]=Number(v>>32n);};
function raw(initial,enabled=true){
 const a=Array(96).fill(0),b=Array(128).fill(0),c=Array(2400).fill(0),boundary=Array(256).fill(0);
 Object.assign(a,{0:0x4d335231,1:1,2:1,3:initial?0:1,5:256,6:104,7:32,8:4,9:64,10:8,12:initial?1:3});
 Object.assign(b,{0:0x4d334231,1:1,2:enabled?63:62,5:1,6:32,7:128,8:12,9:32,10:20,12:4});
 Object.assign(c,{0:0x4d334343,1:2,2:initial?3:7,5:2400,6:4,7:32,8:592,9:112});
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
