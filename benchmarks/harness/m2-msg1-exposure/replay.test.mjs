import test from 'node:test';
import assert from 'node:assert/strict';
import {prefix} from '../m1/protocol.mjs';
import {exposureProtocol} from './exposure.mjs';
import {progressScope} from './progress.mjs';
import {validateRawSerial,validateProgress,validateServedIdentities,browserSources} from './replay.mjs';

// These are corruption tests for host evidence validation, not guest execution.
test('raw serial must equal all guest fields after removing only known host annotations',()=>{
 const raw=[{event:'initialized',seq:1,nonce:'retained-nonce',maps:'guest map\n'},
  {event:'result',seq:2,name:'integer',value:1526500379,guestMs:12}];
 const events=raw.map((row,i)=>({...row,hostMs:i,pairedHostMs:i,stoppedStatus:{running:false,status:'paused'},msg1:{schema:1},ackHostMs:i+1,contReplyHostMs:i+2}));
 events[0].mapsArtifact={path:'initialized.maps',sha256:'a'.repeat(64),bytes:10};
 const serial=rows=>'kernel log\n'+rows.map(row=>prefix+JSON.stringify(row)).join('\r\n')+'\n';
 assert.deepEqual(validateRawSerial(serial(raw),events),{records:2});
 for(const change of [r=>delete r[0].nonce,r=>delete r[1].value,r=>r[1].value++,r=>r.reverse(),r=>r.push(r[1]),r=>r[0].extra='unobserved']){
  const bad=structuredClone(raw);change(bad);assert.throws(()=>validateRawSerial(serial(bad),events),/Exact raw/);
 }
 const altered=structuredClone(events);altered[1].unknownHostAnnotation=true;
 assert.throws(()=>validateRawSerial(serial(raw),altered),/Exact raw/);
 for(const marker of ['Kernel panic - not syncing','BUN_APP_FAILURE: retained failure']){
  assert.throws(()=>validateRawSerial(marker+'\n'+serial(raw),events),/Guest failure marker/);
  assert.throws(()=>validateRawSerial(serial(raw)+'unprefixed tail '+marker+'\n',events),/Guest failure marker/);
 }
});

test('progress replay requires the entire bound header and exact typed pre-ACK rows',()=>{
 const report={experiment:{name:'sha256msg1-v1',enabled:true},package:'artifacts/test-package',
  inputHashes:{'source.mjs':'a'.repeat(64),'payload.wasm':'b'.repeat(64)},runtimeIdentity:{status:'verified',contract:{sourceFingerprint:'c'.repeat(64)}},
  partialProgress:{path:'progress.jsonl',rows:1,scope:progressScope}};
 const gate={event:'initialized',seq:1,maps:'guest map\n',hostMs:1,stoppedStatus:{running:false,status:'paused'},
  readCompleteHostMs:2,ackHostMs:3,contReplyHostMs:4,mapsArtifact:{path:'initialized.maps'}};
 const event={...gate};delete event.ackHostMs;delete event.contReplyHostMs;delete event.mapsArtifact;
 const progress=[{protocol:exposureProtocol,experiment:report.experiment,package:report.package,inputs:report.inputHashes,
  runtimeIdentity:report.runtimeIdentity,schema:1,kind:'partial-progress-header',scope:progressScope},
  {sequence:0,event,schema:1,kind:'stopped-gate'}];
 assert.deepEqual(validateProgress(progress,report,[gate]),{gates:1});
 for(const key of ['schema','kind','protocol','experiment','package','inputs','runtimeIdentity','scope']){
  const bad=structuredClone(progress);delete bad[0][key];assert.throws(()=>validateProgress(bad,report,[gate]),/header/);
 }
 for(const change of [p=>p[0].inputs['source.mjs']='0'.repeat(64),p=>delete p[0].inputs['payload.wasm'],
  p=>p[0].runtimeIdentity.status='unverified',p=>p[1].schema=2,p=>p[1].kind='unpaused',
  p=>delete p[1].event.maps,p=>p[1].sequence=1,p=>p[1].unrecorded=true]){
  const bad=structuredClone(progress);change(bad);assert.throws(()=>validateProgress(bad,report,[gate]));
 }
 const badReport=structuredClone(report);delete badReport.partialProgress;
 assert.throws(()=>validateProgress(progress,badReport,[gate]),/metadata/);
});

test('every browser source and every package payload needs its exact served identity',()=>{
 const names=['app.mjs','kernel','initramfs.cpio.gz','runtime/qemu-system-x86_64.js','runtime/qemu-system-x86_64.wasm',
  'rom/bios-256k.bin','rom/kvmvapic.bin','rom/linuxboot_dma.bin'];
 const report={package:'artifacts/test-package',manifest:{generation:'generation',artifacts:{}},inputHashes:{},servedHashes:{}};
 for(const name of browserSources)report.inputHashes[name]=report.servedHashes[name]='a'.repeat(64);
 for(const name of names){const path=report.package+'/generation/'+name;report.manifest.artifacts[name]={sha256:'b'.repeat(64),bytes:1};report.inputHashes[path]=report.servedHashes[path]='b'.repeat(64);}
 const {required}=validateServedIdentities(report);assert.equal(required.length,16);
 for(const path of required)for(const category of ['servedHashes','inputHashes']){
  const bad=structuredClone(report);delete bad[category][path];assert.throws(()=>validateServedIdentities(bad));
 }
 for(const change of [r=>r.servedHashes[browserSources[0]]='0'.repeat(64),r=>delete r.inputHashes[browserSources[1]],
  r=>r.servedHashes={'unrelated.mjs':'f'.repeat(64)},r=>r.inputHashes[r.package+'/generation/kernel']='c'.repeat(64)]){
  const bad=structuredClone(report);change(bad);assert.throws(()=>validateServedIdentities(bad));
 }
});
