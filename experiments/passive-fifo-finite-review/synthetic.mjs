// Synthetic file fixtures only: no browser, guest, build, or live acceptance.
import {readFile,writeFile,mkdir,mkdtemp,copyFile} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {packRecord,snapshotKey} from '../../packaging/bun-app/snapshots.mjs';
import {syntheticReport} from '../../benchmarks/harness/passive-fifo-resource-v1/fixture.mjs';
import {horizonRule,bootstrapRule} from '../../benchmarks/harness/passive-fifo-finite-v1/horizon.mjs';
import {planningRule} from '../../benchmarks/harness/passive-fifo-finite-v1/planning.mjs';
import {protocol,guestProtocol,parameters,orders,warmupOrders} from '../../benchmarks/harness/passive-fifo-finite-v1/protocol.mjs';
import {pairedSteps} from '../../benchmarks/harness/passive-fifo-finite-v1/plan.mjs';
import {analyze} from '../../benchmarks/harness/passive-fifo-finite-v1/analyze.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),sha=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>JSON.parse(await readFile(p)),write=async(p,v)=>{await mkdir(dirname(p),{recursive:true});await writeFile(p,JSON.stringify(v,null,2)+'\n');};
const scratch=await mkdtemp(resolve(root,'tmp/fifo-finite-review-'));
const fixture=spawnSync(process.execPath,['experiments/passive-fifo-validation-review/synthetic-resource.mjs'],{cwd:root,encoding:'utf8'});if(fixture.status!==0)throw Error(fixture.stderr);
const resource=JSON.parse(fixture.stdout),resourceRaw=await read(resource.control),resourcePlan=await read(resolve(root,resourceRaw.resourcePlan.path));
const packages=resourcePlan.packages,proof=await read(resolve(root,packages.control.path,'runtime-provenance.json'));
const sources=await read(resolve(root,'artifacts/passive-fifo-finite-v1-source-01/manifest.json'));
const baseInputs=[...Object.keys(proof.inputs),'artifacts/passive-fifo-finite-v1-source-01/manifest.json','artifacts/passive-fifo-finite-v1-source-review-01/review.json'];
const iso=n=>new Date(Date.UTC(2026,10,7,0,0,n)).toISOString();
async function campaign(kind,selection=null){
 const output=resolve(scratch,kind),pairs=selection?selection.confirmationPlanning.requiredPairs:4;
 await mkdir(resolve(output,'attempts'),{recursive:true});
 const plan={schema:1,id:'synthetic-passive-fifo-'+kind,synthetic:true,experiment:'passive-fifo-v1',kind,createdUtc:iso(0),packages,pairs,
  steps:pairedSteps(packages.control.path,packages.candidate.path,pairs),inputs:[...baseInputs,...(selection?[selection.path]:[])],selection,protocol,guestProtocol,horizonRule,bootstrapRule,parameters,orders,warmupOrders,planningRule,
  hostCondition:resourcePlan.hostCondition,primary:'fullHorizon',secondary:['phaseSum','integer','json','sha256','http'],service:['emptyGateP95','resultStopMaxMs'],primaryUpperRatio:.95,secondaryUpperRatio:1.1,readyUpperRatio:1.1,memoryUpperRatio:1.1,serviceUpperRatio:1.5,driftRatioLimit:1.1,runtimeArtifactByteRatio:1,generatedCodeByteRatio:1.1,confidence:.99,bootstrapDraws:50000,bootstrapSeed:20261107};
 const original=resolve(scratch,kind+'-plan.json');await write(original,plan);const bytes=await readFile(original);await writeFile(resolve(output,'plan.json'),bytes);
 const fileNames=new Set([...plan.inputs,relative(root,original),...sources.files.map(r=>r.path),...Object.keys(sources.dependencies),'manifests/runtime-baseline.json']);
 for(const p of Object.values(packages)){fileNames.add(p.path+'/app.json');fileNames.add(p.path+'/runtime-provenance.json');for(const name of Object.keys(p.manifest.artifacts))fileNames.add(p.path+'/'+p.manifest.generation+'/'+name);}
 for(const p of Object.keys(resourceRaw.inputHashes))if(!p.startsWith('tmp/'))fileNames.add(p);
 const files={};for(const name of fileNames){const b=await readFile(resolve(root,name));files[name]={sha256:sha(b),bytes:b.length};}
 const executable=await readFile(process.execPath),identity={sha256:sha(executable),bytes:executable.length};
 const frozen={schema:1,planSha256:sha(bytes),plan,environment:{node:process.execPath,nodeVersion:process.version,nodeIdentity:identity,chrome:process.execPath,chromeIdentity:identity,nodeOptions:null},files};
 await write(resolve(output,'frozen.json'),frozen);const freezeSha=sha(await readFile(resolve(output,'frozen.json')));
 for(const [index,step] of plan.steps.entries()){
  const attempt=resolve(output,'attempts',step.id),run=resolve(attempt,'run');await mkdir(run,{recursive:true});const manifest=packages[step.enabled?'candidate':'control'].manifest;
  const f=await syntheticReport(manifest),r=f.report,b=r.browserResult;for(const scope of [r,b]){delete scope.observation;delete scope.timingEligible;scope.protocol=protocol;}
  const ratio=step.enabled?[.89,.90,.91,.90][(step.pair-1)%4]:1;
  const timeFields=['hostMs','signalHostMs','pairedHostMs','stopRequestHostMs','stoppedHostMs','readCompleteHostMs','ackHostMs','contReplyHostMs'];
  for(const e of b.events)for(const name of timeFields)if(name in e)e[name]*=ratio;
  const bySeq=new Map(b.events.filter(e=>e.seq).map(e=>[e.seq,e]));
  for(const row of [...b.warmups,...b.results]){const start=bySeq.get(row.startSeq),end=bySeq.get(row.endSeq);row.startAckHostMs=start.ackHostMs;row.resultHostMs=end.hostMs;row.hostMs=end.hostMs-start.ackHostMs;row.resultToStopMs=end.stoppedHostMs-end.hostMs;}
  for(const row of b.calibration){row.hostMs=bySeq.get(3+2*row.index).hostMs-bySeq.get(2+2*row.index).ackHostMs;}
  for(const s of b.signals)s.hostMs*=ratio;for(const key of Object.keys(b.startup))b.startup[key]*=ratio;
  const marker={schema:1,id:randomUUID(),state:'browser-entry-armed',utc:iso(100+index*100+3)};await write(resolve(run,'execution-start.json'),marker);
  b.horizon={startId:marker.id,t0HostMs:0,t1HostMs:b.events.at(-1).readCompleteHostMs};
  r.executionBoundary={started:true,id:marker.id,recordSha256:sha(await readFile(resolve(run,'execution-start.json')))};
  Object.assign(r,{synthetic:true,createdUtc:iso(100+index*100+2),experiment:manifest.experiment,timeoutMs:600000,package:step.package,cache:relative(root,resolve(run,'snapshots')),browser:'synthetic-validator-only',host:{platform:'synthetic',arch:'synthetic',release:'synthetic',logicalCPUs:1,totalMemoryBytes:1}});
  b.experiment=r.experiment;b.fifo={abi:1,enabled:step.enabled,diagnostic:false,status:step.enabled?7:6,state:step.enabled?3:0,rejections:0,effective:step.enabled};
  const status={...plan.hostCondition.expected,errors:[]};const observation=n=>({startedUtc:iso(n),completedUtc:iso(n+1),stdout:JSON.stringify(status),stderr:'',status});r.hostCondition={configuration:plan.hostCondition,before:observation(100+index*100+3),after:observation(100+index*100+60)};
  r.inputHashes={};for(const [name,info] of Object.entries(files))r.inputHashes[name]=info.sha256;
  r.servedHashes=Object.fromEntries(['benchmarks/harness/passive-fifo-finite-v1/browser.mjs','benchmarks/harness/passive-fifo-finite-v1/vm-adapter.mjs','experiments/passive-fifo/reader.mjs'].map(name=>[name,files[name].sha256]));
  for(const name of ['serial.log','initialized.maps','maps.maps'])await copyFile(resolve(f.dir,name),resolve(run,name));
  const data=Buffer.from('SYNTHETIC-NON-EVIDENCE-SNAPSHOT'),compressed=gzipSync(data),snapshot=Buffer.from(packRecord({metadata:{schema:1,encoding:'gzip',appSha256:manifest.appSha256,compatibilitySha256:manifest.compatibilitySha256,bytes:data.length,sha256:sha(data),compressedBytes:compressed.length,compressedSha256:sha(compressed)},data:compressed}));
  const snapshotPath=resolve(root,r.cache,snapshotKey(manifest)+'.snapshot');await mkdir(dirname(snapshotPath),{recursive:true});await writeFile(snapshotPath,snapshot);r.snapshot={sha256:sha(snapshot),bytes:snapshot.length};await write(resolve(run,'report.json'),r);
  const command=[process.execPath,resolve(root,'benchmarks/harness/passive-fifo-finite-v1/run.mjs'),'--plan',relative(root,original),'--package',step.package,'--output',relative(root,run),'--mode','baseline','--snapshot','capture','--sample-period','257','--timeout','600000'];
  const request={schema:1,stepId:step.id,freezeSha256:freezeSha,utc:iso(100+index*100),command,cache:r.cache};await write(resolve(attempt,'request.json'),request);await write(resolve(attempt,'spawned.json'),{pid:1234,utc:iso(100+index*100+1)});await write(resolve(attempt,'exit.json'),{code:0,signal:null,error:null,utc:iso(100+index*100+70)});
  await write(resolve(attempt,'accepted.json'),{reportSha256:sha(await readFile(resolve(run,'report.json'))),requestSha256:sha(await readFile(resolve(attempt,'request.json'))),recovered:false,utc:iso(100+index*100+71)});
 }
 const analysis=await analyze(relative(root,output));analysis.synthetic=true;const analysisPath=resolve(scratch,kind+'-analysis.json');await write(analysisPath,analysis);
 return {directory:relative(root,output),analysis:relative(root,analysisPath),record:analysis};
}
const exploration=await campaign('exploration');const selected=exploration.record;
const confirmation=await campaign('confirmation',{path:exploration.analysis,sha256:sha(await readFile(resolve(root,exploration.analysis))),captureNonces:selected.captureNonces,confirmationPlanning:selected.confirmationPlanning});
console.log(JSON.stringify({scope:'Synthetic validator-only files; no guest execution or passive performance evidence',scratch,exploration:{directory:exploration.directory,analysis:exploration.analysis},confirmation:{directory:confirmation.directory,analysis:confirmation.analysis}}));
