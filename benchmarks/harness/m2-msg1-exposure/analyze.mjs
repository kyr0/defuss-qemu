#!/usr/bin/env node
// Diagnostic execution evidence only. No elapsed-time comparison is produced.
import assert from 'node:assert/strict';
import {readFile,mkdir,open} from 'node:fs/promises';
import {resolve,dirname,basename,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {Protocol,gatePlan,orders,parameters,names} from '../m1/protocol.mjs';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
import {snapshotKey} from '../../../packaging/bun-app/snapshots.mjs';
import {packageIdentity} from './identity.mjs';
import {validateRawSerial,validateProgress,validateServedIdentities} from './replay.mjs';
import {hostConditionIdentity,validateHostStatus} from '../m2-sustained-v2/host-condition.mjs';
import {exposureProtocol,bankFields,unchangedGuest,validateExposure,exposureDelta,validateSelectedExposure,requirePaused} from './exposure.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=data=>createHash('sha256').update(data).digest('hex');
const fixedVm={machine:'pc,acpi=off',cpu:'max',ramMiB:512,smp:1,tbMiB:128,hotLimit:1500,runtimeFlags:3};
const finite=n=>assert.ok(Number.isFinite(n)&&n>=0,'Invalid elapsed timestamp');
const inside=value=>{const path=resolve(root,value);assert.ok(path.startsWith(root+'/'),'Evidence must stay inside project');return path;};
const identity=async path=>{const bytes=await readFile(path);return {sha256:sha(bytes),bytes:bytes.length};};

export function phasePartition(browser,enabled){
  validateExposure(browser.exposureInitialized);let previous=browser.exposureInitialized;
  const zero={schema:1,...Object.fromEntries(bankFields.map(name=>[name,'0']))};
  const boot=exposureDelta(zero,previous);validateSelectedExposure(boot,enabled);
  const phases=[browser.warmup,...browser.results],gaps=[];assert.equal(phases.length,13);
  for(let i=0;i<phases.length;i++){
    const row=phases[i];assert.equal(row.counters,null);assert.equal(row.codeCapture,undefined);
    const {begin,end,delta}=row.exposure,gap=exposureDelta(previous,begin);
    validateSelectedExposure(gap,enabled);gaps.push({beforePhase:i,startSeq:i?phases[i-1].endSeq:null,endSeq:row.startSeq,...gap});
    assert.deepEqual(delta,exposureDelta(begin,end),'Phase MSG1 delta differs');
    validateSelectedExposure(delta,enabled,{requireCompiled:row.name==='sha256'});previous=end;
  }
  const tail=exposureDelta(previous,browser.exposureComplete),total=exposureDelta(zero,browser.exposureComplete);
  validateSelectedExposure(tail,enabled);validateSelectedExposure(total,enabled);
  for(const key of bankFields)assert.equal(BigInt(total[key]),BigInt(boot[key])+BigInt(tail[key])+gaps.reduce((sum,r)=>sum+BigInt(r[key]),0n)+phases.reduce((sum,r)=>sum+BigInt(r.exposure.delta[key]),0n),'Whole-run counter conservation: '+key);
  return {boot,gaps,tail,total,phases:phases.map(row=>({name:row.name,sample:row.sample,iterations:row.iterations,startSeq:row.startSeq,endSeq:row.endSeq,...row.exposure.delta})),scope:'Boot is zero→initialized; each gap is prior phase end→next phase start; tail is last phase end→complete. Inclusive stopped boundaries include guest control/stop-delivery. No execution or timing attribution beyond these observed intervals.'};
}
export function validatePhases(browser,enabled){return phasePartition(browser,enabled).phases;}

export async function readExposureReport(argument,enabled){
  const path=inside(argument),raw=await readFile(path),r=JSON.parse(raw),b=r.browserResult;
  assert.equal(r.protocol,exposureProtocol);assert.equal(r.status,'passed');assert.equal(b?.status,'passed');
  assert.equal(r.timingEligible,false);assert.equal(b.timingEligible,false);assert.equal(b.observation,exposureProtocol);
  for(const scope of [r,b]){assert.equal(scope.mode,'baseline');assert.equal(scope.snapshotMode,'capture');assert.equal(scope.captureCode,false);}
  assert.deepEqual(r.inputRecheck,[]);assert.deepEqual(r.pageErrors,[]);assert.deepEqual(r.serverErrors,[]);assert.ok(!r.deadlineExceeded);
  assert.equal(r.executionConfiguration.aotEnabled,false);assert.equal(r.executionConfiguration.planDisabled,true);
  assert.deepEqual(r.experiment,{name:'sha256msg1-v1',enabled});assert.deepEqual(b.experiment,r.experiment);
  assert.equal(b.msg1Status,0x10000|(enabled?4:3));
  assert.deepEqual(b.configuration,{before:0x10000,chosen:0x10000|(enabled?2:1),enabled,phase:'preRun-before-vCPU',diagnostic:true});
  assert.deepEqual(r.hostCondition?.configuration,await hostConditionIdentity());for(const edge of ['before','after']){const h=r.hostCondition[edge];assert.deepEqual(JSON.parse(h.stdout),h.status);validateHostStatus(h.status,r.hostCondition.configuration);}
  await validateManifest(r.manifest);assert.deepEqual(r.manifest.vm,fixedVm);assert.equal(r.manifest.snapshot.readyMode,'manual');
  assert.deepEqual(r.manifest.experiment,r.experiment);assert.equal(r.manifest.appSha256,unchangedGuest.appSha256);
  assert.equal(r.manifest.artifacts['initramfs.cpio.gz'].sha256,unchangedGuest.initramfsSha256);
  const manifestPath=inside(r.package+'/app.json'),manifestBytes=await readFile(manifestPath);
  assert.deepEqual(JSON.parse(manifestBytes),r.manifest);
  const proof=await packageIdentity(inside(r.package),r.manifest);assert.deepEqual(r.runtimeIdentity,proof.identity);assert.deepEqual(r.packageProvenance,proof.provenance);for(const [name,digest]of Object.entries(proof.inputHashes))assert.equal(r.inputHashes[name],digest);
  const mandatory=['benchmarks/harness/m1/protocol.mjs','benchmarks/harness/m2-msg1-exposure/run.mjs',
    'benchmarks/harness/m2-msg1-exposure/browser.mjs','benchmarks/harness/m2-msg1-exposure/vm-adapter.mjs',
    'benchmarks/harness/m2-msg1-exposure/exposure.mjs','benchmarks/harness/m2-msg1-exposure/identity.mjs','benchmarks/harness/m2-msg1-exposure/progress.mjs','benchmarks/harness/m2-msg1-exposure/replay.mjs','benchmarks/harness/m2-msg1-exposure/analyze.mjs','benchmarks/harness/m2-sustained-v2/host-condition.mjs',relative(root,manifestPath)];
  for(const [name,info] of Object.entries(r.manifest.artifacts)){
    const artifact=inside(r.package+'/'+r.manifest.generation+'/'+name);mandatory.push(relative(root,artifact));
    assert.deepEqual(await identity(artifact),info,'Package artifact changed');
  }
  for(const key of mandatory)assert.match(r.inputHashes[key],/^[a-f0-9]{64}$/,'Missing source/package hash: '+key);
  validateServedIdentities(r);
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
      requirePaused(event.stoppedStatus);validateExposure(event.msg1);
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
  const partition=phasePartition(b,enabled),phases=partition.phases;
  const gates=events.filter(e=>e.seq);let previous={schema:1,...Object.fromEntries(bankFields.map(k=>[k,'0']))};
  for(const event of gates){validateSelectedExposure(exposureDelta(previous,event.msg1),enabled);previous=event.msg1;}
  assert.deepEqual(b.exposureInitialized,gates.find(e=>e.event==='initialized').msg1);assert.deepEqual(b.exposureComplete,gates.find(e=>e.event==='complete').msg1);
  const phaseSequences=new Set();
  for(const row of [b.warmup,...b.results]){
    assert.ok(!phaseSequences.has(row.startSeq)&&!phaseSequences.has(row.endSeq)&&row.startSeq<row.endSeq,'Overlapping phase sequence');phaseSequences.add(row.startSeq);phaseSequences.add(row.endSeq);
    const start=events.find(e=>e.seq===row.startSeq),end=events.find(e=>e.seq===row.endSeq);assert.ok(start&&end);assert.deepEqual(row.exposure.begin,start.msg1);assert.deepEqual(row.exposure.end,end.msg1);
    assert.equal(start.event,row.name==='warmup'?'warmup-start':'start');assert.equal(end.event,row.name==='warmup'?'warmup-complete':'result');
    assert.equal(row.name,end.name??'warmup');assert.equal(row.name,start.name??'warmup');
    assert.equal(row.sample,end.sample??null);assert.equal(row.sample,start.sample??null);
    assert.equal(row.startAckHostMs,start.ackHostMs);assert.equal(row.resultHostMs,end.hostMs);
    assert.equal(row.hostMs,end.hostMs-start.ackHostMs);assert.equal(row.resultToStopMs,end.stoppedHostMs-end.hostMs);
    finite(row.hostMs);finite(row.resultToStopMs);
  }
  const progress=(await readFile(resolve(dirname(path),'progress.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  validateProgress(progress,r,gates);
  const serial=await readFile(resolve(dirname(path),'serial.log'),'utf8');assert.equal(sha(Buffer.from(serial)),r.serialSha256);
  validateRawSerial(serial,events);
  return {path,sha256:sha(raw),manifest:r.manifest,nonce:validator.resumed.nonce,browser:r.browser,host:r.host,
    initial:b.exposureInitialized,complete:b.exposureComplete,phases,partition,reportProtocol:r.protocol};
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
  return {schema:1,status:'passed',kind:'diagnostic-msg1-exposure',createdUtc:new Date().toISOString(),
    inputs:[control,candidate],summaries,timingEligible:false,productPromotionEligible:false,
    scope:['Exact cumulative uint64 counts; stopped begin/end phase deltas. Original helpers include compiled fallback; original+inline is the total.',
      'Every SHA phase must execute the selected compiled path under hotLimit1500/runtimeFlags3. Off requires compiled fallback; on requires compiled inline and no compiled fallback.',
      'JSON/HTTP/integer counts are observed, not assumed absent. Phase counts include guest control and stop-delivery tail; they do not attribute every instruction to a guest library.',
      'Boot, every between-phase gap and tail are explicitly retained; their sum plus all13 phase deltas exactly equals the complete cumulative bank. Non-SHA exposure is reported as observed, including zero.',
      'Instrumentation changes timing and potentially admission/scheduling. No timing or speedup conclusion is eligible from this report.']};
}

async function main(){
  const {values}=parseArgs({options:{control:{type:'string'},candidate:{type:'string'},output:{type:'string'}}});assert.ok(values.control&&values.candidate&&values.output);
  const destination=inside(values.output);assert.ok(destination.startsWith(resolve(root,'artifacts')+'/'));
  const result=await compareExposure(values.control,values.candidate);await mkdir(destination);
  const durable=async(path,text)=>{const h=await open(path,'wx');try{await h.writeFile(text);await h.sync();}finally{await h.close();}};
  await durable(resolve(values.output,'analysis.json'),JSON.stringify(result,null,2)+'\n');
  const lines=['# MSG1 diagnostic Bun exposure','',
    '| Workload | Off original / compiled fallback | On original / compiled inline |','|---|---:|---:|'];
  for(const [name,row] of Object.entries(result.summaries))lines.push(`| ${name} | ${row.control.originalHelperEntries} / ${row.control.compiledFallbackEntries} | ${row.candidate.originalHelperEntries} / ${row.candidate.compiledInlineExecutions} |`);
  lines.push('',...result.scope,'');await durable(resolve(values.output,'REPORT.md'),lines.join('\n'));
  for(const directory of [resolve(values.output),dirname(resolve(values.output))]){const h=await open(directory,'r');try{await h.sync();}finally{await h.close();}}
  console.log(JSON.stringify({status:result.status,timingEligible:false,output:values.output}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
