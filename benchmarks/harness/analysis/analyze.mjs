#!/usr/bin/env node
// Diagnostic summaries only: nested batches are never independent replicates.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,basename,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {parseMaps,classifyAddress,syscallNames} from './maps.mjs';
import {Protocol,parameters,orders,names,expected,gatePlan} from '../m1/protocol.mjs';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const modes=['baseline','profile-off','profile-on'];
const hashPattern=/^[a-f0-9]{64}$/;
const exact=n=>n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):String(n);
const uint=(value,label)=>{
  assert.ok((typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)||
    (typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)),`Invalid exact count: ${label}`);
  const n=BigInt(value);assert.ok(n<=0xffffffffffffffffn,`Counter exceeds uint64: ${label}`);return n;
};
const finite=(n,label)=>assert.ok(Number.isFinite(n)&&n>=0,`Invalid elapsed time: ${label}`);
const pathLabel=path=>path.startsWith(root+sep)?relative(root,path):path;
const median=values=>{const a=values.slice().sort((x,y)=>x-y),i=a.length>>1;return a.length%2?a[i]:(a[i-1]+a[i])/2;};
export function distribution(values) {
  assert.ok(values.length,'Missing observations');values.forEach((n,i)=>finite(n,String(i)));
  return {n:values.length,min:Math.min(...values),median:median(values),max:Math.max(...values),
    mean:values.reduce((x,y)=>x+y,0)/values.length};
}
const ratio=(a,b,label)=>{assert.ok(b>0,`Zero denominator: ${label}`);return a/b;};
const orderedObject=value=>Array.isArray(value)?value.map(orderedObject):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,orderedObject(value[key])])):value;
const equal=(a,b,label)=>assert.deepEqual(orderedObject(a),orderedObject(b),label);

export function validateProfile(profile,period) {
  assert.equal(profile?.abi,1,'Missing M1 profile ABI');assert.equal(profile.enabled,true,'Expected enabled phase');
  assert.equal(profile.period,period,'Sampling period changed');assert.equal(profile.saturated,false,'Saturated profile');
  assert.equal(profile.rejectedWorkerObservations,0,'Unsupported multiple-worker profile');
  assert.equal(profile.storageBytes,217552,'Changed profile storage ABI');
  assert.ok([0,1].includes(profile.pcAddressingRevision??0),'Unknown PC-addressing revision');
  equal(profile.tableCapacity,{pcs:1024,edges:2048},'Changed profile table capacity');
  const counters=profile.counters;
  assert.ok(counters&&Array.isArray(profile.pcs)&&Array.isArray(profile.edges)&&Array.isArray(profile.syscalls));
  for(const [key,value] of Object.entries(counters))uint(value,key);
  const count=name=>uint(counters[name],name);
  const key=k=>{
    for(const field of ['pc','context','flags','cflags']){
      assert.match(k[field],/^0x[0-9a-f]+$/i);assert.ok(BigInt(k[field])<=0xffffffffffffffffn);
    }
    assert.ok(['compiled','interpreted'].includes(k.tier));
    assert.ok(['unknown','kernel','user','other-ring','real-mode','vm86'].includes(k.privilege));
    return JSON.stringify([k.pc,k.context,k.flags,k.cflags,k.tier,k.privilege]);
  };
  for(const [table,capacity,sampleCounter] of [['pcs',1024,'pcSamples'],['edges',2048,'edgeSamples']]){
    assert.ok(profile[table].length<=capacity,`Unbounded ${table}`);
    const seen=new Set();let mass=0n;
    for(const row of profile[table]){
      const identity=table==='pcs'?key(row):JSON.stringify([key(row.from),key(row.to)]);
      assert.ok(!seen.has(identity),`Duplicate ${table} key`);seen.add(identity);
      const estimate=uint(row.samplesEstimate,'estimate'),error=uint(row.samplesError,'error');
      assert.ok(estimate>0n&&error<=estimate,'Invalid sampling error bound');
      assert.equal(uint(row.samplesLowerBound,'lower bound'),estimate-error);
      mass+=estimate;
    }
    assert.equal(mass,count(sampleCounter),`${table} estimate mass does not match sampled events`);
  }
  for(const tier of ['compiled','interpreted']){
    const total=['Unknown','Kernel','User','OtherRing','Real','Vm86'].reduce((n,p)=>n+count(tier+p),0n);
    assert.equal(total,count(tier+'Entries'),`${tier} privilege partition mismatch`);
  }
  assert.equal(count('admissionReady')+count('admissionCold')+count('admissionHeld'),count('admissionCalls'));
  assert.ok(count('edgeSamples')<=count('pcSamples'));
  const entries=count('compiledEntries')+count('interpretedEntries');
  assert.ok(count('unknownPcEntries')<=entries,'Unknown PCs exceed entries');
  const unknown=count('unknownPcEntries'),known=entries-unknown,ticks=entries/BigInt(period);
  // The sampler advances for every entry, including unknown PCs. Only an
  // unknown entry at a sampling tick can omit a PC sample. With all PCs known,
  // the exact count is therefore floor(entries / period), not just an upper bound.
  assert.ok(count('pcSamples')<=ticks,'Too many sampled PC events');
  assert.ok(count('pcSamples')<=known,'More PC samples than known entries');
  assert.ok(count('pcSamples')>=(ticks>unknown?ticks-unknown:0n),'Missing deterministic PC samples');
  assert.ok(known===0n?count('observedEdges')===0n:count('observedEdges')<known,'More edges than adjacent known entries');
  assert.ok(count('edgeSamples')<=count('observedEdges'),'More sampled edges than observed edges');
  let syscallCount=0n;const numbers=new Set();
  for(const row of profile.syscalls){
    assert.ok(Number.isInteger(row.number)&&row.number>=0&&row.number<512&&!numbers.has(row.number));
    numbers.add(row.number);syscallCount+=uint(row.entryAttempts,'syscall entries');
  }
  assert.equal(syscallCount+count('syscallNumberOverflow'),count('syscall64UserEntryAttempts'));
  assert.equal(count('counterSaturations'),0n,'Saturation counter is nonzero');
  return true;
}

export function profileCoverage(profile) {
  const entries=uint(profile.counters.compiledEntries,'compiled')+uint(profile.counters.interpretedEntries,'interpreted');
  const unknown=uint(profile.counters.unknownPcEntries,'unknown');
  assert.ok(unknown<=entries);
  const pcNonempty=profile.pcs.length>0,edgeNonempty=profile.edges.length>0;
  return {pcAddressingRevision:profile.pcAddressingRevision??0,observedEntries:exact(entries),
    knownPcEntries:exact(entries-unknown),unknownPcEntries:exact(unknown),
    unknownPcFraction:entries?Number(unknown)/Number(entries):null,
    pcTablesNonempty:pcNonempty,edgeTablesNonempty:edgeNonempty,
    pcTableRows:profile.pcs.length,edgeTableRows:profile.edges.length,
    status:!entries?'no-entry-exposure':!pcNonempty?'no-pc-samples':!edgeNonempty?'pc-samples-without-edges':
      unknown?'pc-and-edge-samples-with-unknown-entries':'pc-and-edge-samples-available',
    limit:'Observed entry coverage only; sampled tables omit some keys and every internal same-TB iteration. Workload success is not attribution coverage.'};
}

export async function loadReport(argument,wantedMode) {
  const path=resolve(argument),bytes=await readFile(path),report=JSON.parse(bytes);
  assert.equal(report.schema,1);assert.equal(report.status,'passed',`Run failed: ${path}`);
  assert.equal(report.protocol,'defuss-m1-v1');assert.equal(report.mode,wantedMode);
  assert.ok(['capture','restore'].includes(report.snapshotMode));
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
  const protocolPath='benchmarks/harness/m1/protocol.mjs';
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
  assert.ok(maps.initialized&&maps.maps,'Missing process-map gates');
  const results=report.browserResult.results;
  assert.equal(results.length,parameters.samples*names.length);
  equal(results.map(({name,sample,iterations})=>({name,sample,iterations})),
    orders.flatMap((order,sample)=>order.map(name=>({name,sample,iterations:parameters.batchRepetitions}))),'Changed batch order');
  let lastEpoch=-1;
  for(const row of [report.browserResult.warmup,...results]){
    assert.ok(row,'Missing warmup');finite(row.hostMs,'phase host time');finite(row.resultToStopMs,'stop tail');
    const start=events.find(event=>event.seq===row.startSeq),end=events.find(event=>event.seq===row.endSeq);
    assert.ok(start&&end&&['start','warmup-start'].includes(start.event)&&['result','warmup-complete'].includes(end.event));
    assert.equal(row.startAckHostMs,start.ackHostMs);assert.equal(row.resultHostMs,end.hostMs);
    assert.equal(row.hostMs,end.hostMs-start.ackHostMs);assert.equal(row.resultToStopMs,end.stoppedHostMs-end.hostMs);
    if(row.name!=='warmup'){
      assert.equal(row.name,start.name);assert.equal(row.name,end.name);assert.equal(row.sample,start.sample);
      assert.equal(row.sample,end.sample);assert.equal(row.guestMs,end.guestMs);
    }
    if(wantedMode==='profile-on'){
      validateProfile(row.counters?.profile,report.samplePeriod);
      assert.ok(row.counters.profile.epoch>lastEpoch,'Profiler epoch did not advance');lastEpoch=row.counters.profile.epoch;
    }else assert.equal(row.counters,null,'Disabled control contains enabled counters');
  }
  assert.equal(report.browserResult.calibration.length,parameters.gatePairs);
  for(const [i,row] of report.browserResult.calibration.entries()){
    assert.equal(row.index,i);finite(row.hostMs,'calibration');finite(row.guestMs,'calibration guest');
    const start=events.find(e=>e.event==='gate-start'&&e.index===i),end=events.find(e=>e.event==='gate-result'&&e.index===i);
    assert.equal(row.hostMs,end.hostMs-start.ackHostMs);assert.equal(row.guestMs,end.guestMs);
  }
  finite(report.browserResult.startup.readyHostMs,'ready');finite(report.browserResult.ready.readyMs,'VM ready');
  assert.equal(report.browserResult.ready.appSha256,report.manifest.appSha256);
  assert.equal(report.browserResult.ready.compatibilitySha256,report.manifest.compatibilitySha256);
  assert.match(report.snapshot.sha256,hashPattern);
  return {path,report,maps,events,artifacts};
}

export function commonHashes(run) {
  return Object.fromEntries(Object.entries({...run.report.inputHashes,...run.report.servedHashes})
    .filter(([path])=>path.startsWith('benchmarks/harness/m1/')||path.startsWith('host/browser/')||
      path.startsWith('experiments/m1-profile/')||path==='benchmarks/workload/operations.ts'||path==='benchmarks/expected.json')
    .sort(([a],[b])=>a.localeCompare(b)));
}
export function requireTimingObservation(report) {
  const disabled=value=>value===undefined||value===false;
  const phases=[report.browserResult?.warmup,...(report.browserResult?.results??[])];
  assert.ok(disabled(report.captureCode)&&disabled(report.browserResult?.captureCode)&&
    phases.every(row=>row?.codeCapture===undefined),
    'Code-inspection runs cannot enter matched timing or sampling-sensitivity comparisons');
}
export function matchReports(runs) {
  const [base,off,on]=runs.map(run=>run.report);
  for(const run of runs)requireTimingObservation(run.report);
  for(const run of [off,on]){
    assert.equal(run.manifest.appSha256,base.manifest.appSha256,'Workload bundle differs');
    assert.equal(run.manifest.image,base.manifest.image);equal(run.manifest.vm,base.manifest.vm);
    assert.equal(run.snapshotMode,base.snapshotMode,'Do not mix capture and restore in this comparison');
    assert.equal(run.browser,base.browser,'Browser version differs');
    for(const field of ['platform','arch','release','logicalCPUs','totalMemoryBytes'])assert.equal(run.host[field],base.host[field],`Host ${field} differs`);
    for(const [name,identity] of Object.entries(base.manifest.artifacts))if(!name.startsWith('runtime/'))
      equal(run.manifest.artifacts[name],identity,`Guest/ROM input differs: ${name}`);
  }
  equal(off.manifest,on.manifest,'Enabled/disabled controls need the same exact candidate package');
  equal(commonHashes(runs[0]),commonHashes(runs[1]),'Harness/workload inputs changed between controls');
  equal(commonHashes(runs[0]),commonHashes(runs[2]),'Harness/workload inputs changed between controls');
  const nonce=run=>run.events.find(event=>event.event==='resumed').nonce;
  if(base.snapshotMode==='capture')assert.equal(new Set(runs.map(nonce)).size,3,'Fresh captures must have distinct guest identities');
  return true;
}

function phaseSummary(report) {
  return Object.fromEntries(names.map(name=>{
    const rows=report.browserResult.results.filter(row=>row.name===name);
    return [name,{launches:1,nestedBatches:rows.length,iterationsPerBatch:parameters.batchRepetitions,
      hostBatchMs:distribution(rows.map(row=>row.hostMs)),hostPerJobMs:distribution(rows.map(row=>row.hostMs/row.iterations)),
      guestBatchMs:distribution(rows.map(row=>row.guestMs)),resultToStopMs:distribution(rows.map(row=>row.resultToStopMs)),
      observations:rows.map(({sample,hostMs,guestMs,resultToStopMs,startAckHostMs,resultHostMs})=>({sample,hostMs,guestMs,resultToStopMs,startAckHostMs,resultHostMs}))}];
  }));
}
function profileRows(run,syscallMap,limit=20) {
  return [run.report.browserResult.warmup,...run.report.browserResult.results].map(row=>{
    const c=row.counters,p=c.profile,map=row.name==='warmup'?run.maps.initialized:run.maps.maps;
    const classify=k=>({...k,addressAttribution:classifyAddress(k.pc,map.mappings,k.privilege)});
    return {name:row.name,sample:row.sample,hostMs:row.hostMs,iterations:row.iterations,
      mapArtifact:map.artifact,mapGateSeq:map.eventSeq,profilePeriod:p.period,epoch:p.epoch,
      coverage:profileCoverage(p),
      profileCounters:p.counters,tableCapacity:p.tableCapacity,
      pcRows:p.pcs.slice(0,limit).map(classify),pcRowsAvailable:p.pcs.length,
      edgeRows:p.edges.slice(0,limit).map(edge=>({...edge,from:classify(edge.from),to:classify(edge.to)})),edgeRowsAvailable:p.edges.length,
      syscalls:p.syscalls.map(item=>({...item,name:syscallMap.get(item.number)??null})).sort((a,b)=>{
        const x=BigInt(a.entryAttempts),y=BigInt(b.entryAttempts);return x===y?a.number-b.number:x>y?-1:1;
      }),
      stageDelta:c.delta,pool:{before:c.before.jitPool??null,after:c.after.jitPool??null},
      helpers:c.after.hotspots?.helpers??null,interpreter:c.after.hotspots?.interpreter??null,
      inline:c.inline,memory:{before:c.before.memory,after:c.after.memory,delta:c.delta.memory??null,scope:c.memoryLimit},
      scope:c.scope,timing:c.timing,instructionLimit:c.instructionLimit,profileSemantics:p.semantics};
  });
}

export async function referenceReport(argument) {
  if(!argument)return null;
  const path=resolve(argument),bytes=await readFile(path),report=JSON.parse(bytes);
  assert.equal(report.status,'passed');assert.equal(report.validation?.status,'passed');assert.equal(report.benchmark?.status,'passed');
  assert.equal(report.validation.originalSha256,expected.sha256);
  assert.equal(report.benchmark.expected.integer,expected.integer);assert.equal(report.benchmark.expected.sha256,expected.sha256);
  equal(report.benchmark.originalParameters,{integerIterations:250000,integerSeed:123,multiplier:1664525,
    increment:1013904223,shaBytes:65536,shaRounds:16,shaPattern:'(i*17+23)&255'});
  const benchmark=report.benchmark,byEndpoint={};
  assert.ok(Number.isInteger(benchmark.protocol.samples)&&benchmark.protocol.samples>0);
  assert.ok(Number.isInteger(benchmark.protocol.callsPerSample)&&benchmark.protocol.callsPerSample>0);
  assert.equal(benchmark.observations.length,benchmark.endpoints.length*benchmark.protocol.samples);
  for(const endpoint of benchmark.endpoints){
    const rows=benchmark.observations.filter(row=>row.endpoint===endpoint.name);
    assert.equal(rows.length,benchmark.protocol.samples);
    assert.equal(new Set(rows.map(row=>row.sample)).size,rows.length);
    for(const row of rows){
      assert.ok(Number.isInteger(row.sample)&&row.sample>=0&&row.sample<benchmark.protocol.samples);
      assert.equal(row.calls,benchmark.protocol.callsPerSample);finite(row.elapsedMs,endpoint.name);
      assert.equal(row.elapsedMs,row.finishedMs-row.startedMs);assert.equal(row.perJobMs,row.elapsedMs/row.calls);
    }
    byEndpoint[endpoint.name]={...endpoint,perJobMs:distribution(rows.map(row=>row.perJobMs))};
  }
  return {artifact:{kind:'direct-wasm-reference',path:pathLabel(path),sha256:sha(bytes),bytes:bytes.length},
    host:report.host,browser:report.browser??null,runtime:report.runtime,build:report.build,validation:report.validation,
    protocol:benchmark.protocol,endpoints:byEndpoint,limitations:benchmark.limitations,
    scope:'Standalone component timings only; different memory/host interfaces, no transparent guest acceleration or achievable speedup claim'};
}

const unresolved=[
  'Exclusive wall-time accounting remains incomplete: compiled execution, helper work, suspension, scheduling and host I/O are not separated.',
  'Integer loop/JSC tier and exact SHA routine identity are unresolved without verified code bytes, symbols and execution-shape evidence.',
  'Anonymous executable maps establish address ranges, not JIT tier or semantics. CR3 is not a verified process identity; code generations are aggregated.',
  'HTTP syscall entry counts do not identify blocked time, scheduling delays or wakeups. This is guest loopback HTTP; no virtual-NIC conclusion follows.',
  'The SIMD/AVX/memory census is partial: compiled helper imports, selected inline counters and sampled generic MMU paths omit other lowering paths.',
  'Three nested batches from one launch per mode cannot establish confidence intervals, equivalence or a stable instrumentation-perturbation bound.',
  'Deterministic every-N PC/edge sampling may alias control flow; sample-period sensitivity and independent launches remain required.',
  'Cold/capture/restore elapsed markers are retained, but phase-specific PC/edge and exclusive startup-cost profiles are not collected by this harness.',
  'ARM64, x86-32, AOT/translation-plan replay and multiple vCPUs are outside this diagnostic campaign.',
  'No production optimization is promoted; choose a narrowly justified experiment only after resolving relevant attribution gaps.',
];

export async function analyze({baseline,off,on,reference}) {
  const runs=[];
  for(const [argument,mode] of [[baseline,'baseline'],[off,'profile-off'],[on,'profile-on']])runs.push(await loadReport(argument,mode));
  matchReports(runs);
  const baselinePath=resolve(root,'manifests/runtime-baseline.json'),baselineBytes=await readFile(baselinePath),pin=JSON.parse(baselineBytes);
  assert.equal(runs[0].report.inputHashes['manifests/runtime-baseline.json'],sha(baselineBytes));
  for(const [name,identity] of Object.entries(pin.runtimes.x86_64.files))
    equal(runs[0].report.manifest.artifacts['runtime/'+basename(name)],identity,'Baseline is not retained RNDS2 runtime');
  const tablePath=resolve(root,'engine/qemu/linux-user/x86_64/syscall_64.tbl'),tableBytes=await readFile(tablePath),table=syscallNames(tableBytes.toString('utf8'));
  const summaries=Object.fromEntries(runs.map(run=>[run.report.mode,phaseSummary(run.report)]));
  const comparisons=Object.fromEntries(names.map(name=>{
    const b=summaries.baseline[name].hostBatchMs.median,f=summaries['profile-off'][name].hostBatchMs.median,n=summaries['profile-on'][name].hostBatchMs.median;
    return [name,{offOverBaseline:ratio(f,b,name),onOverOff:ratio(n,f,name),onOverBaseline:ratio(n,b,name),
      interpretation:'ratios of within-launch medians; >1 means slower; descriptive only, no inference'}];
  }));
  const ref=await referenceReport(reference);
  const diagnostics=profileRows(runs[2],table);
  const report={schema:1,status:'passed',scope:'Exploratory M1 attribution and diagnostic perturbation; no bootstrap, confidence interval or promotion',
    createdUtc:new Date().toISOString(),sampleUnit:{independentLaunchesPerMode:1,nestedWorkloadBatchesPerLaunch:3,
      captureSharing:runs[0].report.snapshotMode==='restore'?'Restores reuse the referenced capture; captures are not new independent samples':'Distinct fresh capture nonces validated',
      inference:'No independent replications per mode; nested batches do not increase launch-level N'},
    identities:{protocol:'defuss-m1-v1',snapshotMode:runs[0].report.snapshotMode,bundleSha256:runs[0].report.manifest.appSha256,
      image:runs[0].report.manifest.image,workloadSourceSha256:runs[0].report.inputHashes['benchmarks/workload/operations.ts'],
      browser:runs[0].report.browser,vm:runs[0].report.manifest.vm,parameters,orders,sharedInputHashes:commonHashes(runs[0]),
      runtimes:Object.fromEntries(runs.map(run=>[run.report.mode,Object.fromEntries(Object.entries(run.report.manifest.artifacts).filter(([name])=>name.startsWith('runtime/')))]))},
    artifacts:[...runs.flatMap(run=>run.artifacts),{kind:'baseline-pin',path:pathLabel(baselinePath),sha256:sha(baselineBytes),bytes:baselineBytes.length},
      {kind:'syscall-name-table',path:pathLabel(tablePath),sha256:sha(tableBytes),bytes:tableBytes.length},...(ref?[ref.artifact]:[])],
    analyzerInputs:await Object.fromEntries(await Promise.all(['analyze.mjs','maps.mjs'].map(async name=>[name,sha(await readFile(resolve(here,name)))]))),
    runs:Object.fromEntries(runs.map(run=>[run.report.mode,{host:run.report.host,createdUtc:run.report.createdUtc,
      startup:run.report.browserResult.startup,ready:run.report.browserResult.ready,lifecycle:run.report.browserResult.lifecycle,
      calibrationHostMs:distribution(run.report.browserResult.calibration.map(row=>row.hostMs)),
      calibrationGuestMs:distribution(run.report.browserResult.calibration.map(row=>row.guestMs)),
      warmupHostMs:run.report.browserResult.warmup.hostMs,phaseSummary:summaries[run.report.mode],
      clock:run.report.browserResult.clock,snapshot:run.report.snapshot,limits:run.report.browserResult.limits}])),
    comparisons,diagnostics,
    attributionCoverage:{status:diagnostics.every(row=>row.coverage.pcTablesNonempty&&row.coverage.edgeTablesNonempty)?
      'pc-and-edge-samples-available':'incomplete-pc-or-edge-samples',
      addressingRevisions:[...new Set(diagnostics.map(row=>row.coverage.pcAddressingRevision))],
      phasesWithPcTables:diagnostics.filter(row=>row.coverage.pcTablesNonempty).length,
      phasesWithEdgeTables:diagnostics.filter(row=>row.coverage.edgeTablesNonempty).length,totalPhases:diagnostics.length,
      limit:'Attribution coverage is separate from protocol correctness and the broader M1 exit gate; see every phase unknown fraction.'},
    reference:ref,unresolved,
    rankedFollowups:[
      {priority:1,action:'Inspect hottest observed user PC/edges and their verified code before proposing region fusion.',
        evidence:'Per-batch PC/edge lower bounds and address maps below; same-TB internal iterations are invisible.'},
      {priority:2,action:'Compare executed SHA/helper/inline exposure and full-hash reference bridge cost; establish a valid integration ABI before substitution.',
        evidence:'Per-batch helper, RNDS2 inline and syscall counters; optional generic compression/hash references.'},
      {priority:3,action:'Add suspension-aware scheduling/syscall timing and inline-memory exposure where the wall-time remainder is unexplained.',
        evidence:'Current stage/helper timers overlap and syscall counts do not measure waiting.'},
    ]};
  return report;
}

const fmt=(n,d=3)=>Number(n).toFixed(d);
const cell=value=>String(value??'unknown').replaceAll('|','\\|').replaceAll('\n',' ');
export function markdown(report) {
  const lines=['# M1 diagnostic evidence','',
    'These are descriptive results from one launch per mode, with three nested batches per workload. They do not establish significance, equivalence, an instrumentation bound, or a production speedup. Ratios above 1 mean slower.','',
    'Off/baseline compares the rebuilt diagnostic image with the retained RNDS2 image. On/off compares that same diagnostic image with the whole diagnostic suite enabled; it does not isolate PC sampling overhead.','',
    `Protocol: \`${report.identities.protocol}\`; browser: ${report.identities.browser}; snapshot mode: ${report.identities.snapshotMode}.`,
    `Workload bundle: \`${report.identities.bundleSha256}\`.`,
    '',`PC/edge coverage: **${report.attributionCoverage.status}**; nonempty PC tables ${report.attributionCoverage.phasesWithPcTables}/${report.attributionCoverage.totalPhases}, edge tables ${report.attributionCoverage.phasesWithEdgeTables}/${report.attributionCoverage.totalPhases}; addressing revision ${report.attributionCoverage.addressingRevisions.join(', ')}. Successful workload validation alone does not establish PC attribution.`,
    '','| Workload | Baseline median ms / 100 calls | Diagnostic off | Diagnostic on | Off / baseline | On / off |',
    '|---|---:|---:|---:|---:|---:|'];
  for(const name of names){const c=report.comparisons[name];lines.push(`| ${name} | ${fmt(report.runs.baseline.phaseSummary[name].hostBatchMs.median)} | ${fmt(report.runs['profile-off'].phaseSummary[name].hostBatchMs.median)} | ${fmt(report.runs['profile-on'].phaseSummary[name].hostBatchMs.median)} | ${fmt(c.offOverBaseline)} | ${fmt(c.onOverOff)} |`);}
  lines.push('','Host intervals include ACK/cont delivery, guest work and serial result delivery. Stop/read/reset overhead is excluded from the main endpoint; the result-to-stop tail is included in counters. Empty-gate calibration is retained without subtraction.','',
    '| Mode | Ready host ms | Warmup ms | Empty gate median ms |', '|---|---:|---:|---:|');
  for(const mode of modes){const r=report.runs[mode];lines.push(`| ${mode} | ${fmt(r.startup.readyHostMs)} | ${fmt(r.warmupHostMs)} | ${fmt(r.calibrationHostMs.median)} |`);}
  lines.push('','Ready includes asset/runtime startup and the capture/restore protocol shown in analysis.json; it is not an exclusive guest boot timer.','',
    'The following PC and edge rows are the first batch (sample 0) of each workload, chosen before inspecting results. All batches have top-20 rows in analysis.json. Counts are deterministic sampled events with replacement-error bounds, not guest instructions or elapsed-time fractions.');
  for(const name of names){
    const row=report.diagnostics.find(row=>row.name===name&&row.sample===0),c=row.profileCounters;
    lines.push('',`## ${name} exposure`,'',
      `Observed compiled/interpreted entries: ${c.compiledEntries} / ${c.interpretedEntries}; kernel/user entries: ${exact(uint(c.compiledKernel,'k')+uint(c.interpretedKernel,'k'))} / ${exact(uint(c.compiledUser,'u')+uint(c.interpretedUser,'u'))}; PC sampling period: ${row.profilePeriod}.`,
      `PC/edge replacements: ${c.pcReplacements} / ${c.edgeReplacements}; unknown PCs: ${c.unknownPcEntries}.`,
      `Observed-entry unknown-PC fraction: ${row.coverage.unknownPcFraction===null?'unavailable':fmt(100*row.coverage.unknownPcFraction,3)+'%'}; ${row.coverage.status}.`,
      '','| PC | Tier / privilege | Sample lower–upper | Address-map classification |','|---|---|---:|---|');
    for(const pc of row.pcRows.slice(0,5))lines.push(`| \`${pc.pc}\` | ${pc.tier} / ${pc.privilege} | ${pc.samplesLowerBound}–${pc.samplesEstimate} | ${cell(pc.addressAttribution.category)} ${cell(pc.addressAttribution.path??'')} |`);
    lines.push('','| Observed edge | Sample lower–upper |','|---|---:|');
    for(const edge of row.edgeRows.slice(0,3))lines.push(`| \`${edge.from.pc}\` → \`${edge.to.pc}\` (${edge.from.tier} → ${edge.to.tier}) | ${edge.samplesLowerBound}–${edge.samplesEstimate} |`);
    lines.push('','| Compiled helper | Calls | Sampled returning-call μs |','|---|---:|---:|');
    for(const helper of row.helpers?.byCalls?.slice(0,5)??[])lines.push(`| ${cell(helper.name??'slot '+helper.slot)} | ${helper.calls} | ${helper.sampledUs} |`);
    lines.push('',`Top syscall entry attempts: ${row.syscalls.slice(0,8).map(s=>`${s.name??'number '+s.number}=${s.entryAttempts}`).join(', ')||'none recorded'}.`,
      'Helper sampled time is nested, excludes nonreturning calls and is not added to interpretation/translation/host wall time. Syscalls are entries, not completions or wait durations.');
  }
  if(report.reference){
    const ref=report.reference,engine=ref.browser?.version?'Chrome '+ref.browser.version:
      ref.host?.node?'Node '+ref.host.node:'see recorded runtime identity';
    lines.push('','## Standalone WASM components','',
      'These are direct/checked/copied component interfaces in standalone memory, not an integrated guest accelerator. Full hashing omits Bun crypto-object/hex-string costs; compression also omits padding.','',
      `Reference engine: ${engine}; ${ref.runtime.memoryModel}, ${ref.runtime.shared?'shared':'unshared'} memory. Warmup: ${ref.protocol.warmupJobsPerEndpoint} jobs per endpoint; ${ref.protocol.samples} nested batches of ${ref.protocol.callsPerSample} jobs.`,
      '',
      '| Endpoint | Median ms / original-sized job | Min–max |','|---|---:|---:|');
    for(const [name,row] of Object.entries(report.reference.endpoints))lines.push(`| ${name} | ${fmt(row.perJobMs.median,6)} | ${fmt(row.perJobMs.min,6)}–${fmt(row.perJobMs.max,6)} |`);
    lines.push('',`WASM bytes: ${ref.build.wasmBytes}; module compilation ${fmt(ref.runtime.compileMs,6)} ms; instantiation ${fmt(ref.runtime.instantiateMs,6)} ms. No guest/reference ratio is labeled an achievable speedup.`);
  }
  lines.push('','## Remaining M1 gates','',...report.unresolved.map(item=>'- '+item),'',
    'The exact raw reports, process maps, syscall-name table and baseline pin are SHA-256 identified in analysis.json. Unreported PCs remain unknown; raw reports retain full bounded tables. No optimization has been promoted.','');
  return lines.join('\n');
}

function selfTest() {
  assert.equal(distribution([3,1,2]).median,2);assert.equal(distribution([4,1]).median,2.5);
  assert.throws(()=>distribution([]));assert.throws(()=>distribution([NaN]));
  const counters={compiledEntries:0,interpretedEntries:0,pcSamples:0,edgeSamples:0,observedEdges:0,
    admissionReady:0,admissionCold:0,admissionHeld:0,admissionCalls:0,syscallNumberOverflow:0,
    syscall64UserEntryAttempts:0,counterSaturations:0,unknownPcEntries:0};
  for(const tier of ['compiled','interpreted'])for(const kind of ['Unknown','Kernel','User','OtherRing','Real','Vm86'])counters[tier+kind]=0;
  const profile={abi:1,enabled:true,period:1,saturated:false,rejectedWorkerObservations:0,storageBytes:217552,
    tableCapacity:{pcs:1024,edges:2048},counters,pcs:[],edges:[],syscalls:[]};
  assert.equal(validateProfile(profile,1),true);
  const bad=change=>{const p=structuredClone(profile);change(p);assert.throws(()=>validateProfile(p,1));};
  bad(p=>p.saturated=true);bad(p=>p.rejectedWorkerObservations=1);bad(p=>p.counters.compiledEntries=1);
  bad(p=>p.counters.pcSamples=1);bad(p=>p.counters.syscall64UserEntryAttempts=1);bad(p=>p.counters.admissionCalls=1);
  bad(p=>p.counters.pcSamples=Number.MAX_SAFE_INTEGER+1);bad(p=>p.counters.counterSaturations=1);
  bad(p=>p.counters.observedEdges=1);bad(p=>p.counters.unknownPcEntries=1);
  const row={pc:'0x1000',context:'0x2000',flags:'0x83',cflags:'0x0',tier:'compiled',privilege:'user',
    samplesEstimate:2,samplesError:1,samplesLowerBound:1};
  const populated=structuredClone(profile);Object.assign(populated.counters,{compiledEntries:2,compiledUser:2,pcSamples:2});populated.pcs=[row];
  assert.equal(validateProfile(populated,1),true);
  assert.equal(profileCoverage(populated).status,'pc-samples-without-edges');
  const missing=structuredClone(populated);missing.counters.pcSamples=1;missing.pcs[0].samplesEstimate=1;missing.pcs[0].samplesLowerBound=0;
  assert.throws(()=>validateProfile(missing,1),/Missing deterministic PC samples/);
  const missingAll=structuredClone(populated);missingAll.counters.pcSamples=0;missingAll.pcs=[];
  assert.throws(()=>validateProfile(missingAll,1),/Missing deterministic PC samples/);
  const unobserved=structuredClone(populated);unobserved.counters.edgeSamples=1;
  unobserved.edges=[{from:row,to:row,samplesEstimate:1,samplesError:0,samplesLowerBound:1}];
  assert.throws(()=>validateProfile(unobserved,1),/More sampled edges than observed edges/);
  const partiallyKnown=structuredClone(profile);partiallyKnown.period=2;
  Object.assign(partiallyKnown.counters,{compiledEntries:4,compiledUser:4,unknownPcEntries:1,pcSamples:1});
  partiallyKnown.pcs=[{...row,samplesEstimate:1,samplesError:0,samplesLowerBound:1}];
  assert.equal(validateProfile(partiallyKnown,2),true); // One unknown can omit one of two ticks.
  partiallyKnown.counters.pcSamples=2;partiallyKnown.pcs[0].samplesEstimate=2;partiallyKnown.pcs[0].samplesLowerBound=2;
  assert.equal(validateProfile(partiallyKnown,2),true); // Or the unknown can fall between ticks.
  partiallyKnown.counters.unknownPcEntries=3;
  assert.throws(()=>validateProfile(partiallyKnown,2),/More PC samples than known entries/);
  const unknownEdges=structuredClone(profile);
  Object.assign(unknownEdges.counters,{compiledEntries:4,compiledUser:4,unknownPcEntries:4,observedEdges:1});
  assert.throws(()=>validateProfile(unknownEdges,1),/More edges than adjacent known entries/);
  const exactLarge=structuredClone(profile);exactLarge.period=65536;
  Object.assign(exactLarge.counters,{compiledEntries:'9007199254740993',compiledUser:'9007199254740993',pcSamples:137438953472});
  exactLarge.pcs=[{...row,samplesEstimate:137438953472,samplesError:0,samplesLowerBound:137438953472}];
  assert.equal(validateProfile(exactLarge,65536),true);
  const uncovered=structuredClone(profile);Object.assign(uncovered.counters,{compiledEntries:10,compiledUser:10,unknownPcEntries:10});
  assert.equal(validateProfile(uncovered,1),true);assert.equal(profileCoverage(uncovered).unknownPcFraction,1);
  assert.equal(profileCoverage(uncovered).status,'no-pc-samples');
  const corrupt=structuredClone(populated);corrupt.pcs[0].samplesLowerBound=2;assert.throws(()=>validateProfile(corrupt,1));
  const manifest={appSha256:'bundle',image:'image',vm:{smp:1},artifacts:{'app.mjs':{sha256:'app'},'runtime/qemu.js':{sha256:'different'}}};
  const runs=modes.map((mode,i)=>({events:[{event:'resumed',nonce:String(i)}],report:{mode,manifest:structuredClone(manifest),
    snapshotMode:'capture',browser:'fixture',host:{platform:'fixture',arch:'fixture',release:'fixture',logicalCPUs:1,totalMemoryBytes:1},
    inputHashes:{'benchmarks/workload/operations.ts':'source'},servedHashes:{}}}));
  assert.equal(matchReports(runs),true);
  for(const mutate of [r=>r[2].report.manifest.appSha256='changed',r=>r[1].report.manifest.artifacts['app.mjs'].sha256='changed',
    r=>r[2].report.manifest.artifacts['runtime/qemu.js'].sha256='changed',r=>r[1].report.browser='changed',
    r=>r[1].report.inputHashes['benchmarks/workload/operations.ts']='changed',r=>r[2].events[0].nonce='0']){
    const changed=structuredClone(runs);mutate(changed);assert.throws(()=>matchReports(changed));
  }
  for(const mutate of [r=>r.captureCode=true,r=>r.browserResult={captureCode:true},
    r=>r.browserResult={warmup:{codeCapture:{}}},r=>r.browserResult={results:[{codeCapture:{}}]}]){
    const changed=structuredClone(runs);mutate(changed[2].report);
    assert.throws(()=>matchReports(changed),/Code-inspection runs cannot enter/);
  }
  console.log('PASS: descriptive distributions, exact deterministic sampling bounds/mass, privilege/syscall partitions, saturation/worker rejection, matching workload/runtime/browser/source identities');
}

async function main() {
  const {values}=parseArgs({options:{baseline:{type:'string'},off:{type:'string'},on:{type:'string'},reference:{type:'string'},
    output:{type:'string'},'self-test':{type:'boolean',default:false}}});
  if(values['self-test']){selfTest();return;}
  for(const option of ['baseline','off','on','output'])assert.ok(values[option],`--${option} is required`);
  const report=await analyze(values),output=resolve(values.output);
  await mkdir(dirname(output),{recursive:true});await mkdir(output); // Refuse overwrite after validation.
  await writeFile(resolve(output,'analysis.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  await writeFile(resolve(output,'REPORT.md'),markdown(report),{flag:'wx'});
  console.log(JSON.stringify({status:'passed',analysis:resolve(output,'analysis.json'),report:resolve(output,'REPORT.md')}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
