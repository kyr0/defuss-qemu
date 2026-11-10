#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,mkdir,open,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {decodeM3b} from '../../tests/m3b-fallthrough/reader.mjs';
import {readM3Region} from '../../experiments/m3a-region/reader.mjs';
import {referenceGates,validateLayout,validateSelectedWindow} from '../../tests/m3b-xstate-v2/contract.mjs';
import {state} from '../../tests/m3b-xstate-v2/xstate.mjs';
const {values}=parseArgs({options:{run:{type:'string'},output:{type:'string'}}}),root=process.cwd(),inputs={};
assert.ok(values.run?.startsWith('artifacts/')&&values.output?.startsWith('artifacts/'));await mkdir(values.output);
const hash=b=>({sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length});
const read=async(p,id)=>{const path=resolve(root,p);assert.ok(path.startsWith(root+'/'));assert.equal(await realpath(path),path);const b=await readFile(path),actual=hash(b);if(id)assert.deepEqual(actual,{sha256:id.sha256,bytes:id.bytes});if(inputs[p])assert.deepEqual(inputs[p],actual);inputs[p]=actual;return b;};
const json=async p=>JSON.parse(await read(p));
let result={schema:1,status:'failed',timingEligible:false,candidatePromotion:false,inputs};
try{
 const freeze=await json('artifacts/m3b-xstate-v2-source-01/manifest.json');assert.equal(freeze.status,'frozen');for(const f of freeze.files){await read(f.path,f);await read(f.archive,f);}for(const [p,id]of Object.entries(freeze.dependencies))await read(p,id);
 await read(freeze.hostTests.path,freeze.hostTests);assert.equal((await json(freeze.hostTests.path)).status,'passed');
 const r=await json(values.run+'/report.json');assert.equal(r.status,'passed');assert.equal(r.timingEligible,false);assert.deepEqual(r.inputRecheck,[]);for(const [p,id]of Object.entries(r.inputs))await read(p,id);for(const f of freeze.files)assert.deepEqual(r.inputs[f.path],{sha256:f.sha256,bytes:f.bytes});
 const rows=(await read(values.run+'/progress.jsonl',r.artifacts.progress)).toString('utf8').trimEnd().split('\n').map(JSON.parse);assert.equal(rows.length,138);const observations=rows.map((r,i)=>{assert.equal(r.record,i);return r.observation;});assert.deepEqual(observations[0].inputs,r.inputs);
 const serial=(await read(values.run+'/serial.log',r.artifacts.serial)).toString('utf8');assert.equal(observations.map(r=>r.serialChunk??'').join(''),serial);assert.ok(!/M3B_FAIL:|BUN_APP_FAILURE|Kernel panic/.test(serial));
 const reference=referenceGates(),layout=validateLayout(r.layout),gates=observations.filter(r=>r.event==='gate');assert.equal(gates.length,45);let previous;
 for(const row of observations){
  if(['header','ack'].includes(row.event))continue;
  assert.deepEqual(row.status,{running:false,status:row.event==='startup'?'prelaunch':'paused'});
  const raw=row.m3a.raw,words=Uint32Array.from(raw);assert.equal(raw.length,96);assert.deepEqual(row.m3a,{...readM3Region({_defuss_m3_abi:()=>1,_defuss_m3_data:()=>0,pcProfileWords:()=>words}),raw});assert.deepEqual(row.m3b,decodeM3b(row.m3b.raw,r.enabled));
  assert.equal(row.pool.limit,12000);assert.ok(row.pool.charged>=0&&row.pool.charged<=12000);
  if(previous)for(const f of ['m3a','m3b'])for(const [k,v]of Object.entries(previous[f].counters))assert.ok(row[f].counters[k]>=v);previous=row;
 }
 const states=[];let phase='startup',seq=0,epoch=0;
 for(const row of observations.slice(1)){
  assert.equal(row.event,phase);if(phase==='startup'){phase='gate';continue;}
  if(phase==='gate'){
   assert.deepEqual(row.gate,reference.gates[seq]);assert.deepEqual(row.xstateCaps,r.xstateCaps);assert.deepEqual(row.xstateFeatures,{xcr0Low:r.xstateCaps.mask,xcr0High:0});states.push(state(row.xstate,r.xstateCaps,row.gate));
   assert.equal(row.m3a.watchEpoch,epoch);assert.equal(row.m3b.watchEpoch,epoch);
   for(let slot=0;slot<4;slot++){const address=seq&&slot<2?layout.programs[row.gate.program][slot===0?'a':'b']:'0x0';for(const w of [row.m3a.watches[slot],row.m3b.watches[slot]]){assert.equal(w.begin,address);assert.equal(BigInt(w.end),BigInt(address)+(address==='0x0'?0n:1n));}}
   if(seq)validateSelectedWindow({enabled:r.enabled,program:row.gate.program,phase:row.gate.phase,gate:row.gate,m3aA:row.m3a.watches[0],m3aB:row.m3a.watches[1],fusedA:row.m3b.watches[0],fusedB:row.m3b.watches[1]});phase='configured';
  }else if(phase==='configured'){
   assert.equal(row.seq,seq);epoch+=4;assert.equal(row.m3a.watchEpoch,epoch);assert.equal(row.m3b.watchEpoch,epoch);for(const w of row.m3a.watches)assert.equal(w.selectedEntries,0);for(const w of row.m3b.watches)for(const [k,v]of Object.entries(w))if(typeof v==='number'&&k!=='slot')assert.equal(v,0);phase='ack';
  }else if(phase==='ack'){assert.equal(row.seq,seq);assert.deepEqual(row.watchEpoch,{m3a:epoch,m3b:epoch});phase=++seq===45?'complete':'gate';}
  else{assert.deepEqual(row.validation,reference.pass);phase='done';}
 }
 assert.equal(phase,'done');assert.deepEqual(states,r.xstateObservations);
 const records=serial.split(/\r?\n/).filter(x=>/^M3[BX]_/.test(x)).map(x=>{const i=x.indexOf(':');return [x.slice(0,i),JSON.parse(x.slice(i+1))];});
 const expected=[['M3X_FEATURES',{xcr0Low:r.xstateCaps.mask,xcr0High:0}],['M3X_CAPS',r.xstateCaps],['M3B_LAYOUT',layout]];for(const g of gates)expected.push(['M3X_STATE',g.xstate],['M3B_GATE',g.gate]);expected.push(['M3B_PASS',reference.pass]);assert.deepEqual(records,expected);
 result={...result,status:'passed',run:values.run,enabled:r.enabled,gates:45,invocations:47168,checks:reference.pass.checks,digest:reference.pass.digest,caps:r.xstateCaps,stateSamples:states.slice(1).length*2*2};
}catch(e){result.failure=String(e.stack??e);}
result.completedUtc=new Date().toISOString();const f=await open(values.output+'/review.json','wx');await f.writeFile(JSON.stringify(result,null,2)+'\n');await f.sync();await f.close();console.log(JSON.stringify({status:result.status,identities:Object.keys(inputs).length,failure:result.failure}));if(result.status!=='passed')process.exitCode=1;
