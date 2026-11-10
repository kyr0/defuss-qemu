import {summarizeHorizon} from './horizon.mjs';
import {validateStartedReport} from './attempt.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,basename,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseMaps} from '../analysis/maps.mjs';
import {Protocol,protocol,guestProtocol,prefix,parameters,orders,warmupOrders,names,gatePlan} from './protocol.mjs';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashPattern=/^[a-f0-9]{64}$/;
const finite=(n,label)=>assert.ok(Number.isFinite(n)&&n>=0,'Invalid elapsed time: '+label);
const pathLabel=path=>path.startsWith(root+sep)?relative(root,path):path;
const equal=(a,b,label)=>assert.deepEqual(a,b,label);
export function requireTimingObservation(report){
 assert.equal(report.mode,'baseline');assert.equal(report.observation,undefined);assert.equal(report.manifest?.observation,undefined);
 assert.equal(report.captureCode,false);assert.equal(report.browserResult?.captureCode,false);
 for(const row of [...(report.browserResult?.warmups??[]),...(report.browserResult?.results??[])])assert.equal(row.codeCapture,undefined);
}
export async function loadReport(argument,wantedMode) {
  const path=resolve(argument),bytes=await readFile(path),report=JSON.parse(bytes);
  assert.equal(report.schema,1);assert.equal(report.status,'passed',`Run failed: ${path}`);
  assert.equal(report.protocol,protocol);assert.equal(report.mode,wantedMode);
  assert.equal(report.snapshotMode,'capture','Sustained-v2 requires independent fresh captures');
  requireTimingObservation(report);
  assert.equal(report.manifest.benchmark?.protocol,guestProtocol);
  assert.equal(report.manifest.benchmark?.measurementProtocol,protocol);assert.equal(report.browserResult.protocol,protocol);
  assert.ok(Number.isInteger(report.samplePeriod)&&report.samplePeriod>=1&&report.samplePeriod<=65536);
  assert.equal(report.browserResult?.status,'passed');assert.equal(report.browserResult.mode,wantedMode);
  assert.equal(report.browserResult.snapshotMode,report.snapshotMode);
  equal(report.pageErrors,[],'Page errors');equal(report.serverErrors,[],'Server errors');
  assert.ok(!report.deadlineExceeded,'Deadline exceeded');
  await validateManifest(report.manifest);
  assert.equal(report.manifest.snapshot.readyMode,'manual');
  equal(report.manifest.vm,{machine:'pc,acpi=off',cpu:'max',ramMiB:512,smp:1,tbMiB:128,hotLimit:1500,runtimeFlags:3});
  assert.equal(report.executionConfiguration?.aotEnabled,false,'AOT unsupported');
  assert.equal(report.executionConfiguration?.planDisabled,true,'Translation plans unsupported');
  for(const hashes of [report.inputHashes,report.servedHashes]){
    assert.ok(hashes&&typeof hashes==='object');for(const digest of Object.values(hashes))assert.match(digest,hashPattern);
  }
  const protocolPath='benchmarks/harness/m2-sustained-v2/protocol.mjs';
  assert.equal(report.inputHashes[protocolPath],sha(await readFile(resolve(root,protocolPath))),
    'Protocol source changed: analyze with the recorded protocol implementation');
  const artifacts=[{kind:'raw-report',path:pathLabel(path),sha256:sha(bytes),bytes:bytes.length}],maps={};
  const events=[];
  for(const original of report.browserResult.events){
    const event={...original};
    if(['initialized','maps'].includes(event.event)){
      const info=event.mapsArtifact;assert.ok(info&&basename(info.path)===info.path,'Maps artifact must be a sibling file');
      const mapPath=resolve(dirname(path),info.path),mapBytes=await readFile(mapPath);
      assert.equal(mapBytes.length,info.bytes);assert.equal(sha(mapBytes),info.sha256);
      assert.equal(info.sha256,event.mapsSha256);assert.equal(info.bytes,event.mapsBytes);
      event.maps=mapBytes.toString('utf8');
      maps[event.event]={artifact:{kind:'process-maps',path:pathLabel(mapPath),sha256:sha(mapBytes),bytes:mapBytes.length},
        eventSeq:event.seq,mappings:parseMaps(event.maps)};
      artifacts.push(maps[event.event].artifact);
    }
    events.push(event);
  }
  let captureIdentity=null;
  if(report.snapshotMode==='restore'){
    assert.ok(report.captureReport&&hashPattern.test(report.captureReport.sha256));
    const capturePath=resolve(root,report.captureReport.path),captureBytes=await readFile(capturePath);
    assert.equal(sha(captureBytes),report.captureReport.sha256);
    const capture=JSON.parse(captureBytes);assert.equal(capture.status,'passed');assert.equal(capture.snapshotMode,'capture');
    equal(capture.manifest,report.manifest,'Restore/capture runtime and app identity differs');
    assert.equal(capture.snapshot.sha256,report.snapshot.sha256);
    captureIdentity=capture.browserResult.events.find(event=>event.event==='snapshot-prepared');assert.ok(captureIdentity);
    artifacts.push({kind:'capture-report',path:pathLabel(capturePath),sha256:sha(captureBytes),bytes:captureBytes.length});
  }
  const validator=new Protocol(report.snapshotMode,captureIdentity);
  for(const event of events){
    const kind=validator.accept(event);finite(event.hostMs,'event host timestamp');
    if(kind==='gate'){
      for(const field of ['signalHostMs','pairedHostMs','stopRequestHostMs','stoppedHostMs','readCompleteHostMs','ackHostMs','contReplyHostMs'])finite(event[field],field);
      assert.ok(event.hostMs<=event.pairedHostMs&&event.signalHostMs<=event.pairedHostMs&&
        event.pairedHostMs<=event.stopRequestHostMs&&event.stopRequestHostMs<=event.stoppedHostMs&&
        event.stoppedHostMs<=event.readCompleteHostMs&&event.readCompleteHostMs<=event.ackHostMs&&event.ackHostMs<=event.contReplyHostMs,
        'Invalid gate chronology');
    }
  }
  validator.finish();assert.equal(report.browserResult.gateAcks,gatePlan().length);
  const gates=events.filter(e=>e.seq);
  assert.ok(gates.every((event,i)=>!i||event.hostMs>=gates[i-1].ackHostMs),'Cross-gate chronology');
  const signals=report.browserResult.signals;
  assert.equal(signals.length,gatePlan().length+1);assert.equal(signals[0].byte,49);finite(signals[0].hostMs,'ready signal');
  for(const [i,event] of events.filter(e=>e.seq).entries())equal(signals[i+1],{byte:71,hostMs:event.signalHostMs},'COM1 gate signal differs');
  assert.ok(signals.every((signal,i)=>!i||signal.hostMs>=signals[i-1].hostMs),'COM1 signal order');
  const serial=await readFile(resolve(dirname(path),'serial.log'),'utf8');
  assert.ok(!serial.includes('Kernel panic')&&!serial.includes('BUN_APP_FAILURE:'),'Guest failure in raw serial');
  const rawEvents=serial.split(/\r?\n/).filter(line=>line.startsWith(prefix)).map(line=>JSON.parse(line.slice(prefix.length)));
  const hostFields=new Set(['hostMs','pairedHostMs','signalHostMs','stopRequestHostMs','stoppedHostMs','readCompleteHostMs','stoppedReadMs','ackHostMs','contReplyHostMs','mapsArtifact']);
  equal(events.map(event=>Object.fromEntries(Object.entries(event).filter(([key])=>!hostFields.has(key)))),rawEvents,'Raw serial/report event differs');
  assert.ok(maps.initialized&&maps.maps,'Missing process-map gates');
  const results=report.browserResult.results;
  assert.equal(results.length,parameters.samples*names.length);
  equal(results.map(({name,sample,iterations})=>({name,sample,iterations})),
    orders.flatMap((order,sample)=>order.map(name=>({name,sample,iterations:parameters.batchRepetitions}))),'Changed batch order');
  const warmups=report.browserResult.warmups;
  equal(warmups.map(({name,sample,iterations})=>({name,sample,iterations})),warmupOrders.flatMap((order,sample)=>order.map(name=>({name,sample,iterations:parameters.batchRepetitions}))),'Changed warmup order');
  const phaseSequences=new Set();
  for(const {row,warmup} of [...warmups.map(row=>({row,warmup:true})),...results.map(row=>({row,warmup:false}))]){
    assert.ok(row,'Missing phase');finite(row.hostMs,'phase host time');finite(row.resultToStopMs,'stop tail');
    const start=events.find(event=>event.seq===row.startSeq),end=events.find(event=>event.seq===row.endSeq);
    assert.ok(start&&end);assert.equal(start.event,warmup?'warmup-start':'start','Phase start type differs');assert.equal(end.event,warmup?'warmup-result':'result','Phase result type differs');
    assert.ok(!phaseSequences.has(row.startSeq)&&!phaseSequences.has(row.endSeq),'Phase sequence reused');phaseSequences.add(row.startSeq);phaseSequences.add(row.endSeq);
    assert.equal(row.startAckHostMs,start.ackHostMs);assert.equal(row.resultHostMs,end.hostMs);
    assert.equal(row.hostMs,end.hostMs-start.ackHostMs);assert.equal(row.resultToStopMs,end.stoppedHostMs-end.hostMs);
    if(row.name!=='warmup'){
      assert.equal(row.name,start.name);assert.equal(row.name,end.name);assert.equal(row.sample,start.sample);
      assert.equal(row.sample,end.sample);assert.equal(row.guestMs,end.guestMs);
    }
    assert.equal(row.counters,null,'Resource run contains extra profile counters');
    const pool=row.runtimeStats?.jitPool;
    assert.ok(pool&&pool.limit===12000&&Number.isSafeInteger(pool.charged)&&pool.charged>=0&&pool.charged<=12000&&Number.isSafeInteger(pool.linearMemoryBytes)&&pool.linearMemoryBytes>0,'Invalid JIT pool observation');
  }
  assert.equal(report.browserResult.calibration.length,parameters.gatePairs);
  for(const [i,row] of report.browserResult.calibration.entries()){
    assert.equal(row.index,i);finite(row.hostMs,'calibration');finite(row.guestMs,'calibration guest');
    const start=events.find(e=>e.event==='gate-start'&&e.index===i),end=events.find(e=>e.event==='gate-result'&&e.index===i);
    assert.equal(row.hostMs,end.hostMs-start.ackHostMs);assert.equal(row.guestMs,end.guestMs);
  }
  finite(report.browserResult.startup.readyHostMs,'ready');finite(report.browserResult.ready.readyMs,'VM ready');
  const startup=report.browserResult.startup;
  equal(startup.preparedHostMs,events.find(e=>e.event==='snapshot-prepared').hostMs,'Prepared clock differs');
  equal(startup.resumedHostMs,events.find(e=>e.event==='resumed').hostMs,'Resumed clock differs');
  assert.ok(startup.preparedHostMs<=signals[0].hostMs&&signals[0].hostMs<=startup.readyHostMs&&startup.readyHostMs<=startup.resumedHostMs,'Ready chronology');
  assert.equal(report.transport.publications,1);assert.equal(report.browserResult.ready.snapshotSaved,true);assert.equal(report.browserResult.ready.mode,'cold');
  assert.equal(report.browserResult.ready.appSha256,report.manifest.appSha256);
  assert.equal(report.browserResult.ready.compatibilitySha256,report.manifest.compatibilitySha256);
  assert.match(report.snapshot.sha256,hashPattern);
  await validateStartedReport(dirname(path),report);
  const horizon=summarizeHorizon(report.browserResult);
  return {path,report,maps,events,artifacts,horizon};
}

