import {beginAttempt} from './attempt.mjs';
import {summarizeHorizon} from './horizon.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {loadReport} from './report.mjs';
import {protocol,guestProtocol,prefix,Protocol,parameters,orders,warmupOrders,expected,gatePlan} from './protocol.mjs';
import {canonical} from '../../../packaging/bun-app/snapshots.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('full synthetic sustained report replays twenty warmups and thirty-two measured batches',async()=>{
 const root=resolve(new URL('../../..',import.meta.url).pathname);await mkdir(resolve(root,'tmp'),{recursive:true});const dir=await mkdtemp(resolve(root,'tmp/sv2-report-'));
 try{
  const manifest=JSON.parse(await readFile(resolve(root,'artifacts/m2-package-off-01/app.json')));
  manifest.experiment={name:'passive-fifo-v1',enabled:false};manifest.benchmark={protocol:guestProtocol,measurementProtocol:protocol};const {compatibilitySha256,generation,...spec}=manifest;
  manifest.compatibilitySha256=manifest.generation=sha(canonical(spec));
  const identity={protocol:guestProtocol,bun:'1.4.4',revision:'38afee6c84fcf48c0edb2466aa4b27d287a59c30',arch:'x64',pid:1,nonce:'00000000-0000-0000-0000-000000000000',heap:true,file:true,heapLength:4096,heapChecksum:17,ordinal:1,mode:'cold'};
  const prepared={...identity,event:'snapshot-prepared',ordinal:0,parameters,orders,warmupOrders,hostMs:1};
  const resumed={...identity,event:'resumed',parameters,orders,warmupOrders,hostMs:2};
  const maps=Buffer.from('00400000-00500000 r-xp 00000000 00:01 1 /usr/local/bin/bun\n');
  const events=[prepared,resumed],warmups=[],results=[],calibration=[];let start,gateStart;
  for(const [i,gate] of gatePlan().entries()){
   const hostMs=10+i*10,e={...identity,...gate,seq:i+1,hostMs,signalHostMs:hostMs,pairedHostMs:hostMs+1,stopRequestHostMs:hostMs+2,stoppedHostMs:hostMs+3,readCompleteHostMs:hostMs+4,ackHostMs:hostMs+5,contReplyHostMs:hostMs+6};
   if(['initialized','maps'].includes(e.event)){const name=e.event+'.maps';await writeFile(resolve(dir,name),maps);Object.assign(e,{mapsBytes:maps.length,mapsSha256:sha(maps),mapsArtifact:{path:name,bytes:maps.length,sha256:sha(maps)}});}
   if(['warmup-complete','complete'].includes(e.event))e.values=expected;
   if(['warmup-start','start'].includes(e.event))start=e;
   if(['warmup-result','result'].includes(e.event)){
    e.value=expected[e.name];e.guestMs=1;
    const row={name:e.name,sample:e.sample,iterations:e.iterations,startSeq:start.seq,endSeq:e.seq,startAckHostMs:start.ackHostMs,resultHostMs:e.hostMs,hostMs:e.hostMs-start.ackHostMs,guestMs:1,resultToStopMs:3,counters:null,runtimeStats:{jitPool:{charged:11400,limit:12000,linearMemoryBytes:2147483648}}};
    (e.event==='result'?results:warmups).push(row);
   }
   if(e.event==='gate-start')gateStart=e;
   if(e.event==='gate-result'){e.guestMs=0;calibration.push({index:e.index,hostMs:e.hostMs-gateStart.ackHostMs,guestMs:0});}
   events.push(e);
  }
  const marker=await beginAttempt(dir);
  const hostFields=new Set(['hostMs','pairedHostMs','signalHostMs','stopRequestHostMs','stoppedHostMs','readCompleteHostMs','stoppedReadMs','ackHostMs','contReplyHostMs','mapsArtifact']);
  const raw=events.map(event=>{const row=Object.fromEntries(Object.entries(event).filter(([key])=>!hostFields.has(key)));if(row.mapsSha256)row.maps=maps.toString();return row;});
  await writeFile(resolve(dir,'serial.log'),raw.map(e=>prefix+JSON.stringify(e)).join('\n')+'\n');
  const protocolPath='benchmarks/harness/m2-sustained-v2/protocol.mjs';
  const report={schema:1,status:'passed',protocol,executionBoundary:{started:true,id:marker.id,recordSha256:sha(await readFile(resolve(dir,'execution-start.json')))},transport:{publications:1},mode:'baseline',snapshotMode:'capture',samplePeriod:257,captureCode:false,manifest,
   executionConfiguration:{aotEnabled:false,planDisabled:true},inputHashes:{[protocolPath]:sha(await readFile(resolve(root,protocolPath)))},servedHashes:{},pageErrors:[],serverErrors:[],snapshot:{sha256:'a'.repeat(64)},
   browserResult:{status:'passed',protocol,horizon:{startId:marker.id,t0HostMs:0,t1HostMs:events.at(-1).readCompleteHostMs},signals:[{byte:49,hostMs:1.2},...events.filter(e=>e.seq).map(e=>({byte:71,hostMs:e.signalHostMs}))],mode:'baseline',snapshotMode:'capture',captureCode:false,events,warmups,results,calibration,gateAcks:148,startup:{preparedHostMs:1,resumedHostMs:2,readyHostMs:1.5},ready:{readyMs:1,mode:'cold',snapshotSaved:true,appSha256:manifest.appSha256,compatibilitySha256:manifest.compatibilitySha256}}};
  const path=resolve(dir,'report.json'),save=()=>writeFile(path,JSON.stringify(report));await save();const loaded=await loadReport(path,'baseline');assert.equal(loaded.report.browserResult.warmups.length,20);assert.equal(loaded.report.browserResult.results.length,32);
  report.browserResult.warmups[0].sample=99;await save();await assert.rejects(()=>loadReport(path,'baseline'),/warmup order/);report.browserResult.warmups[0].sample=0;
  const measured=report.browserResult.results[0];report.browserResult.results[0]={...report.browserResult.warmups[0]};await save();await assert.rejects(()=>loadReport(path,'baseline'),/Phase start type/);report.browserResult.results[0]=measured;
  const h=summarizeHorizon(report.browserResult);assert.equal(h.phaseSum,260);assert.equal(h.fullHorizon,1484);assert.equal(h.partition.gapMs.length,51);
  const before=report.browserResult.horizon.t1HostMs;report.browserResult.horizon.t1HostMs=before-1;await save();await assert.rejects(()=>loadReport(path,'baseline'));report.browserResult.horizon.t1HostMs=before;
  report.protocol='defuss-m1-v1';await save();await assert.rejects(()=>loadReport(path,'baseline'),/defuss-m/);
 }finally{await writeFile(resolve(dir,'retained.json'),JSON.stringify({purpose:'Synthetic sustained report test evidence retained in project tmp'})+'\n');}
});
