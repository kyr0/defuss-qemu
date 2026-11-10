import assert from 'node:assert/strict';
import {prefix} from '../m1/protocol.mjs';
import {exposureProtocol} from './exposure.mjs';
import {progressScope} from './progress.mjs';

// These are the only fields added by this host adapter. Guest identity,
// configuration, maps and oracle fields remain in the exact comparison.
const hostFields=new Set(['hostMs','pairedHostMs','signalHostMs','stopRequestHostMs',
 'stoppedHostMs','stoppedStatus','msg1','readCompleteHostMs','stoppedReadMs',
 'ackHostMs','contReplyHostMs','mapsArtifact']);
export function validateRawSerial(serial,events){
 assert.equal(typeof serial,'string');assert.ok(Array.isArray(events));
 assert.ok(!serial.includes('Kernel panic')&&!serial.includes('BUN_APP_FAILURE'),'Guest failure marker in raw serial');
 const raw=serial.split(/\r?\n/).filter(line=>line.startsWith(prefix)).map(line=>JSON.parse(line.slice(prefix.length)));
 const expected=events.map(event=>Object.fromEntries(Object.entries(event).filter(([key])=>!hostFields.has(key))));
 assert.deepEqual(raw,expected,'Exact raw serial/report records differ');
 return {records:raw.length};
}

export function validateProgress(progress,report,gates){
 assert.ok(Array.isArray(progress));assert.equal(progress.length,gates.length+1,'Progress row count differs');
 assert.ok(report.inputHashes&&Object.keys(report.inputHashes).length,'Missing progress input identity');
 for(const digest of Object.values(report.inputHashes))assert.match(digest,/^[a-f0-9]{64}$/,'Invalid progress input digest');
 assert.deepEqual(progress[0],{
  protocol:exposureProtocol,experiment:report.experiment,package:report.package,
  inputs:report.inputHashes,runtimeIdentity:report.runtimeIdentity,
  schema:1,kind:'partial-progress-header',scope:progressScope,
 },'Full progress header differs');
 assert.deepEqual(report.partialProgress,{path:'progress.jsonl',rows:gates.length,scope:progressScope},'Progress metadata differs');
 for(let i=0;i<gates.length;i++){
  const event={...gates[i]};delete event.ackHostMs;delete event.contReplyHostMs;delete event.mapsArtifact;
  assert.deepEqual(progress[i+1],{sequence:i,event,schema:1,kind:'stopped-gate'},'Full durable pre-ACK row differs');
 }
 return {gates:gates.length};
}

export const browserSources=Object.freeze([
 'benchmarks/harness/m2-msg1-exposure/browser.mjs',
 'benchmarks/harness/m2-msg1-exposure/vm-adapter.mjs',
 'benchmarks/harness/m2-msg1-exposure/exposure.mjs',
 'benchmarks/harness/m1/protocol.mjs',
 'host/browser/qmp.mjs',
 'host/browser/machine.mjs',
 'packaging/bun-app/serial.mjs',
 'packaging/bun-app/snapshots.mjs',
]);
export function validateServedIdentities(report){
 assert.ok(report.servedHashes&&report.inputHashes,'Missing served/input identities');
 const required=[...browserSources];
 for(const [name,info]of Object.entries(report.manifest.artifacts)){
  const path=[report.package,report.manifest.generation,name].join('/');required.push(path);
  assert.equal(report.inputHashes[path],info.sha256,'Package input/manifest identity differs: '+path);
 }
 for(const path of required){
  assert.match(report.inputHashes[path],/^[a-f0-9]{64}$/,'Missing input identity: '+path);
  assert.match(report.servedHashes[path],/^[a-f0-9]{64}$/,'Missing served identity: '+path);
  assert.equal(report.servedHashes[path],report.inputHashes[path],'Served/input identity differs: '+path);
 }
 return {required};
}
