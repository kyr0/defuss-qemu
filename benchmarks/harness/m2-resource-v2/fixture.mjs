// Synthetic host-validator fixture only; never launches a browser or guest.
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {protocol,prefix,parameters,orders,warmupOrders,expected,gatePlan} from '../m2-sustained-v2/protocol.mjs';
import {canonical} from '../../../packaging/bun-app/snapshots.mjs';
export const root=resolve(new URL('../../..',import.meta.url).pathname),sha=b=>createHash('sha256').update(b).digest('hex');
export const hostFields=new Set(['hostMs','pairedHostMs','signalHostMs','stopRequestHostMs','stoppedHostMs','readCompleteHostMs','stoppedReadMs','ackHostMs','contReplyHostMs','mapsArtifact']);
export async function syntheticReport(suppliedManifest){
 await mkdir(resolve(root,'tmp'),{recursive:true});const dir=await mkdtemp(resolve(root,'tmp/resource-v2-test-'));
 const manifest=suppliedManifest??JSON.parse(await readFile(resolve(root,'artifacts/m2-package-off-01/app.json')));
 if(!suppliedManifest){manifest.benchmark={protocol};manifest.observation={name:'module-input-bytes-sustained-v2',diagnostic:true};const {compatibilitySha256,generation,...spec}=manifest;manifest.compatibilitySha256=manifest.generation=sha(canonical(spec));}
 const identity={protocol,bun:'1.4.4',revision:'38afee6c84fcf48c0edb2466aa4b27d287a59c30',arch:'x64',pid:1,nonce:randomUUID(),heap:true,file:true,heapLength:4096,heapChecksum:17,ordinal:1,mode:'cold'};
 const prepared={...identity,event:'snapshot-prepared',ordinal:0,parameters,orders,warmupOrders,hostMs:0};
 const resumed={...identity,event:'resumed',parameters,orders,warmupOrders,hostMs:1};
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
 const protocolPath='benchmarks/harness/m2-sustained-v2/protocol.mjs';
 const report={schema:1,status:'passed',timingEligible:false,protocol:'defuss-m2-resource-v2',observation:'diagnostic-module-input-bytes-sustained-v2',mode:'baseline',snapshotMode:'capture',samplePeriod:257,captureCode:false,manifest,
  executionConfiguration:{aotEnabled:false,planDisabled:true},inputHashes:{[protocolPath]:sha(await readFile(resolve(root,protocolPath)))},servedHashes:{},pageErrors:[],serverErrors:[],snapshot:{sha256:'a'.repeat(64)},transport:{publications:1},
  browserResult:{status:'passed',timingEligible:false,observation:'diagnostic-module-input-bytes-sustained-v2',mode:'baseline',snapshotMode:'capture',captureCode:false,events,warmups,results,calibration,signals:[{byte:49,hostMs:0},...events.filter(e=>e.seq).map(e=>({byte:71,hostMs:e.signalHostMs}))],gateAcks:148,startup:{preparedHostMs:0,readyHostMs:1,resumedHostMs:1},ready:{readyMs:1,mode:'cold',snapshotSaved:true,appSha256:manifest.appSha256,compatibilitySha256:manifest.compatibilitySha256}}};
 const rawEvents=events.map(e=>{const raw=Object.fromEntries(Object.entries(e).filter(([key])=>!hostFields.has(key)));if(e.mapsArtifact)raw.maps=maps.toString('utf8');return raw;});
 const serial=rawEvents.map(e=>prefix+JSON.stringify(e)).join('\n')+'\n';await writeFile(resolve(dir,'serial.log'),serial);
 await writeFile(resolve(dir,'retained.json'),JSON.stringify({purpose:'Synthetic resource-v2 host validation only; no guest execution'})+'\n');
 const path=resolve(dir,'report.json'),save=()=>writeFile(path,JSON.stringify(report));await save();return {dir,path,report,save,rawEvents,serial};
}
