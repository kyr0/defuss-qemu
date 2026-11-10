#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,open} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {resolve,dirname} from 'node:path';
import {sha} from './derive.mjs';
import {validateMainOracle,validateSnapshot} from './contract.mjs';
import {replayPolicyReport} from './replay.mjs';
import {validateSerial} from './serial.mjs';
import {validateEvents} from './events.mjs';
import {hostConditionIdentity,validateHostStatus} from '../../benchmarks/harness/m2-sustained-v2/host-condition.mjs';
const {values}=parseArgs({options:{off:{type:'string'},on:{type:'string'},output:{type:'string'}}});
assert.ok(values.off&&values.on&&values.output);const root=process.cwd(),rows=[];
for(const [enabled,name]of [[false,values.off],[true,values.on]]){
 const path=resolve(name),bytes=await readFile(path),r=JSON.parse(bytes);assert.equal(r.status,'passed');assert.equal(r.enabled,enabled);assert.equal(r.timingEligible,false);
 assert.ok(['main','combined'].includes(r.fixture));assert.deepEqual(r.inputRecheck,[]);assert.deepEqual(r.pageErrors,[]);validateMainOracle({...r,gates:r.gates.filter(g=>g.fixturePhase==='main')});replayPolicyReport(r);
 assert.deepEqual(r.hostCondition?.configuration,await hostConditionIdentity(),'Host condition identity differs');
 for(const edge of ['before','after']){const observation=r.hostCondition[edge];assert.equal(typeof observation?.stdout,'string');assert.deepEqual(JSON.parse(observation.stdout),observation.status);validateHostStatus(observation.status,r.hostCondition.configuration);}
 const events=await readFile(resolve(dirname(path),'events.jsonl'));assert.equal(sha(events),r.diagnosticEvents.sha256);validateEvents(events,r.diagnosticEvents);
 const serial=await readFile(resolve(dirname(path),'serial.log'));assert.equal(sha(serial),r.serialSha256);validateSerial(r,serial.toString());
 const derived=await readFile(resolve(dirname(path),'derived-runtime.js')),derivation=JSON.parse(await readFile(resolve(dirname(path),'derivation.json'),'utf8'));
 assert.equal(sha(derived),r.provenance.derivation.derivedSha256);assert.deepEqual(derivation,r.provenance.derivation);
 const progress=(await readFile(resolve(dirname(path),'progress.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(progress.length,r.gates.length+1);
 for(let i=0;i<r.gates.length;i++){assert.equal(progress[i+1].sequence,i);const expected={...r.gates[i]};delete expected.jit;delete expected.ack;assert.deepEqual(progress[i+1].row,expected,'Durable raw row differs');}
 for(const [file,expected]of Object.entries(r.inputs))assert.equal(sha(await readFile(resolve(root,file))),expected,'Input changed: '+file);
 let prior;for(const row of r.gates){validateSnapshot(row.snapshot,enabled,prior);prior=row.snapshot;assert.equal(row.status.status,'paused');assert.equal(row.status.running,false);}
 validateSnapshot(r.final.snapshot,enabled,prior);rows.push({path,sha256:sha(bytes),report:r});
}
const [off,on]=rows.map(r=>r.report);assert.equal(off.fixture,on.fixture);assert.deepEqual(off.settings,on.settings);assert.deepEqual(off.arguments,on.arguments);
assert.deepEqual(off.provenance.binding,on.provenance.binding);assert.deepEqual(off.provenance.fixtureBuild,on.provenance.fixtureBuild);assert.deepEqual(off.provenance.derivation,on.provenance.derivation);
assert.deepEqual(off.results.slice(0,6),on.results.slice(0,6));
const result={schema:1,status:'passed',kind:'passive-fifo-main-differential',reports:rows.map(({path,sha256})=>({path,sha256})),scope:'Same retained guest image/runtime/observer; exact deterministic oracle with run-count-adjusted interrupt checks. Ordinary architectural correctness under off/on policy, not per-PC compiled exposure, suspended-instance eviction or timing acceptance.'};
const output=resolve(values.output),file=await open(output,'wx');try{await file.writeFile(JSON.stringify(result,null,2)+'\n');await file.sync();}finally{await file.close();}
const directory=await open(dirname(output),'r');try{await directory.sync();}finally{await directory.close();}console.log(JSON.stringify(result));
