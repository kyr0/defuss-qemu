#!/usr/bin/env node
// Diagnostic execution evidence only. No elapsed-time comparison is produced.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,basename,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {Protocol,gatePlan,orders,parameters,names} from '../m1/protocol.mjs';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
import {snapshotKey} from '../../../packaging/bun-app/snapshots.mjs';
import {exposureProtocol,bankFields,unchangedGuest,validateExposure,exposureDelta,validateSelectedExposure} from './exposure.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=data=>createHash('sha256').update(data).digest('hex');
const fixedVm={machine:'pc,acpi=off',cpu:'max',ramMiB:512,smp:1,tbMiB:128,hotLimit:1500,runtimeFlags:3};
const finite=n=>assert.ok(Number.isFinite(n)&&n>=0,'Invalid elapsed timestamp');
const inside=value=>{const path=resolve(root,value);assert.ok(path.startsWith(root+'/'),'Evidence must stay inside project');return path;};
const identity=async path=>{const bytes=await readFile(path);return {sha256:sha(bytes),bytes:bytes.length};};

export function validatePhases(browser,enabled){
  validateExposure(browser.exposureInitialized);let previous=browser.exposureInitialized;
  const zero={schema:1,...Object.fromEntries(bankFields.map(name=>[name,'0']))};
  validateSelectedExposure(exposureDelta(zero,browser.exposureInitialized),enabled);
  const phases=[browser.warmup,...browser.results];
  assert.equal(phases.length,13);
  for(const row of phases){
    assert.equal(row.counters,null);assert.equal(row.codeCapture,undefined);
    const {begin,end,delta}=row.exposure;
    validateSelectedExposure(exposureDelta(previous,begin),enabled);
    assert.deepEqual(delta,exposureDelta(begin,end),'Phase MSG2 delta differs');
    validateSelectedExposure(delta,enabled,{requireCompiled:row.name==='sha256'});
    previous=end;
  }
  validateExposure(browser.exposureComplete);
  validateSelectedExposure(exposureDelta(zero,browser.exposureComplete),enabled);
  validateSelectedExposure(exposureDelta(previous,browser.exposureComplete),enabled);
  return phases.map(row=>({name:row.name,sample:row.sample,iterations:row.iterations,...row.exposure.delta}));
}

export async function readExposureReport(argument,enabled){
  const path=inside(argument),raw=await readFile(path),r=JSON.parse(raw),b=r.browserResult;
  assert.equal(r.protocol,exposureProtocol);assert.equal(r.status,'passed');assert.equal(b?.status,'passed');
  assert.equal(r.timingEligible,false);assert.equal(b.timingEligible,false);assert.equal(b.observation,exposureProtocol);
  for(const scope of [r,b]){assert.equal(scope.mode,'baseline');assert.equal(scope.snapshotMode,'capture');assert.equal(scope.captureCode,false);}
  assert.deepEqual(r.pageErrors,[]);assert.deepEqual(r.serverErrors,[]);assert.ok(!r.deadlineExceeded);
  assert.equal(r.executionConfiguration.aotEnabled,false);assert.equal(r.executionConfiguration.planDisabled,true);
  assert.deepEqual(r.experiment,{name:'sha256msg2-v1',enabled});assert.deepEqual(b.experiment,r.experiment);
  assert.equal(b.msg2Status,0x10000|(enabled?4:3));
  await validateManifest(r.manifest);assert.deepEqual(r.manifest.vm,fixedVm);assert.equal(r.manifest.snapshot.readyMode,'manual');
  assert.deepEqual(r.manifest.experiment,r.experiment);assert.equal(r.manifest.appSha256,unchangedGuest.appSha256);
  assert.equal(r.manifest.artifacts['initramfs.cpio.gz'].sha256,unchangedGuest.initramfsSha256);
  const manifestPath=inside(r.package+'/app.json'),manifestBytes=await readFile(manifestPath);
  assert.deepEqual(JSON.parse(manifestBytes),r.manifest);
  const mandatory=['benchmarks/harness/m1/protocol.mjs','benchmarks/harness/m2-exposure/run.mjs',
    'benchmarks/harness/m2-exposure/browser.mjs','benchmarks/harness/m2-exposure/vm-adapter.mjs',
    'benchmarks/harness/m2-exposure/exposure.mjs','benchmarks/harness/m2-exposure/analyze.mjs',relative(root,manifestPath)];
  for(const [name,info] of Object.entries(r.manifest.artifacts)){
    const artifact=inside(r.package+'/'+r.manifest.generation+'/'+name);mandatory.push(relative(root,artifact));
    assert.deepEqual(await identity(artifact),info,'Package artifact changed');
  }
  for(const key of mandatory)assert.match(r.inputHashes[key],/^[a-f0-9]{64}$/,'Missing source/package hash: '+key);
  for(const category of ['inputHashes','servedHashes']){
    assert.ok(r[category]&&Object.keys(r[category]).length);
    for(const [name,digest] of Object.entries(r[category]))assert.equal((await identity(inside(name))).sha256,digest,'Changed input: '+name);
  }
  assert.deepEqual(await identity(inside(r.cache+'/'+snapshotKey(r.manifest)+'.snapshot')),
    {sha256:r.snapshot.sha256,bytes:r.snapshot.bytes},'Snapshot changed');
  assert.equal(r.transport.publications,1);assert.equal(b.ready.snapshotSaved,true);assert.equal(b.ready.mode,'cold');
  assert.equal(b.ready.appSha256,r.manifest.appSha256);assert.equal(b.ready.compatibilitySha256,r.manifest.compatibilitySha256);
  const validator=new Protocol('capture'),events=[];
  for(const original of b.events){
    const event={...original};
    if(['initialized','maps'].includes(event.event)){
      const info=event.mapsArtifact;assert.equal(basename(info.path),info.path);const data=await readFile(resolve(dirname(path),info.path));
      assert.equal(sha(data),info.sha256);assert.equal(data.length,info.bytes);
      assert.equal(info.sha256,event.mapsSha256);assert.equal(info.bytes,event.mapsBytes);event.maps=data.toString('utf8');
    }
    const kind=validator.accept(event);finite(event.hostMs);
    if(kind==='gate'){
      const sequence=['pairedHostMs','stopRequestHostMs','stoppedHostMs','readCompleteHostMs','ackHostMs','contReplyHostMs'].map(key=>event[key]);
      sequence.forEach(finite);finite(event.signalHostMs);
      assert.ok(event.hostMs<=sequence[0]&&event.signalHostMs<=sequence[0]&&sequence.every((n,i)=>!i||n>=sequence[i-1]),'Gate chronology');
    }
    events.push(event);
  }
  validator.finish();assert.equal(b.gateAcks,gatePlan().length);
  assert.equal(b.signals.length,gatePlan().length+1);assert.equal(b.signals[0].byte,49);
  for(const [i,event] of events.filter(e=>e.seq).entries())assert.deepEqual(b.signals[i+1],{byte:71,hostMs:event.signalHostMs});
  assert.deepEqual(b.results.map(({name,sample,iterations})=>({name,sample,iterations})),
    orders.flatMap((order,sample)=>order.map(name=>({name,sample,iterations:parameters.batchRepetitions}))));
  const phases=validatePhases(b,enabled);
  for(const row of [b.warmup,...b.results]){
    const start=events.find(e=>e.seq===row.startSeq),end=events.find(e=>e.seq===row.endSeq);assert.ok(start&&end);
    assert.equal(start.event,row.name==='warmup'?'warmup-start':'start');assert.equal(end.event,row.name==='warmup'?'warmup-complete':'result');
    assert.equal(row.name,end.name??'warmup');assert.equal(row.name,start.name??'warmup');
    assert.equal(row.sample,end.sample??null);assert.equal(row.sample,start.sample??null);
    assert.equal(row.startAckHostMs,start.ackHostMs);assert.equal(row.resultHostMs,end.hostMs);
    assert.equal(row.hostMs,end.hostMs-start.ackHostMs);assert.equal(row.resultToStopMs,end.stoppedHostMs-end.hostMs);
    finite(row.hostMs);finite(row.resultToStopMs);
  }
  const serial=await readFile(resolve(dirname(path),'serial.log'),'utf8');
  const rawEvents=serial.split(/\r?\n/).filter(line=>line.startsWith('DEFUSS_M1 ')).map(line=>JSON.parse(line.slice(10)));
  assert.equal(rawEvents.length,events.length);for(let i=0;i<events.length;i++)for(const [key,value] of Object.entries(rawEvents[i]))assert.deepEqual(events[i][key],value,'Serial/report event differs');
  return {path,sha256:sha(raw),manifest:r.manifest,nonce:validator.resumed.nonce,browser:r.browser,host:r.host,
    initial:b.exposureInitialized,complete:b.exposureComplete,phases,reportProtocol:r.protocol};
}

export async function compareExposure(controlPath,candidatePath){
  const control=await readExposureReport(controlPath,false),candidate=await readExposureReport(candidatePath,true);
  assert.notEqual(control.nonce,candidate.nonce,'Exposure modes must own fresh captures');
  const spec=({experiment,compatibilitySha256,generation,...rest})=>rest;
  assert.deepEqual(spec(control.manifest),spec(candidate.manifest),'Only selected mode may differ between diagnostic packages');
  assert.equal(control.browser,candidate.browser);
  for(const key of ['platform','arch','release','logicalCPUs','totalMemoryBytes'])assert.equal(control.host[key],candidate.host[key]);
  const summaries={};
  for(const name of names)summaries[name]=Object.fromEntries([['control',control],['candidate',candidate]].map(([side,run])=>{
    const rows=run.phases.filter(row=>row.name===name);
    return [side,{phases:rows.length,...Object.fromEntries([...bankFields,'interpretedHelperEntries','allExecutions'].map(key=>[key,String(rows.reduce((sum,row)=>sum+BigInt(row[key]),0n))]))}];
  }));
  return {schema:1,status:'passed',kind:'diagnostic-msg2-exposure',createdUtc:new Date().toISOString(),
    inputs:[control,candidate],summaries,timingEligible:false,productPromotionEligible:false,
    scope:['Exact cumulative uint64 counts; stopped begin/end phase deltas. Original helpers include compiled fallback; original+inline is the total.',
      'Every SHA phase must execute the selected compiled path under hotLimit1500/runtimeFlags3. Off requires compiled fallback; on requires compiled inline and no compiled fallback.',
      'JSON/HTTP/integer counts are observed, not assumed absent. Phase counts include guest control and stop-delivery tail; they do not attribute every instruction to a guest library.',
      'Warmup and complete cumulative counts retain boot and between-phase work; phase sums intentionally omit work outside those intervals.',
      'Instrumentation changes timing and potentially admission/scheduling. No timing or speedup conclusion is eligible from this report.']};
}

async function main(){
  const {values}=parseArgs({options:{control:{type:'string'},candidate:{type:'string'},output:{type:'string'}}});assert.ok(values.control&&values.candidate&&values.output);
  const result=await compareExposure(values.control,values.candidate);await mkdir(values.output);
  await writeFile(resolve(values.output,'analysis.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  const lines=['# MSG2 diagnostic Bun exposure','',
    '| Workload | Off original / compiled fallback | On original / compiled inline |','|---|---:|---:|'];
  for(const [name,row] of Object.entries(result.summaries))lines.push(`| ${name} | ${row.control.originalHelperEntries} / ${row.control.compiledFallbackEntries} | ${row.candidate.originalHelperEntries} / ${row.candidate.compiledInlineExecutions} |`);
  lines.push('',...result.scope,'');await writeFile(resolve(values.output,'REPORT.md'),lines.join('\n'),{flag:'wx'});
  console.log(JSON.stringify({status:result.status,timingEligible:false,output:values.output}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
