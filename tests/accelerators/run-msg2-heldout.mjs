#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {startBunApp} from '../../benchmarks/harness/m2/vm-adapter.mjs';
import {fileSnapshotStore} from '../../packaging/bun-app/file-store.mjs';
import {snapshotKey} from '../../packaging/bun-app/snapshots.mjs';

const [packageArg,outputArg,restoreArg]=process.argv.slice(2);assert.ok(packageArg&&outputArg);
const directory=resolve(packageArg),output=resolve(outputArg);await mkdir(output);
const sha=data=>createHash('sha256').update(data).digest('hex');
const manifest=JSON.parse(await readFile(resolve(directory,'app.json'))),events=[];
let consoleText='',tail='',finish,fail,vm;
const completed=new Promise((yes,no)=>{finish=yes;fail=no;});completed.catch(()=>{});
const timer=setTimeout(()=>fail(Error('Held-out guest timeout')),240000);
const report={schema:1,status:'failed',scope:'Node full-system pinned Bun held-out SHA correctness; no performance result',
  node:process.version,package:directory,manifest,events,snapshotMode:restoreArg?'restored':'cold',
  runnerSha256:sha(await readFile(new URL(import.meta.url))),fixtureSha256:sha(await readFile(new URL('./msg2-heldout.mjs',import.meta.url)))};
try{
  assert.equal(manifest.appSha256,report.fixtureSha256,'Packaged application differs from held-out source');
  const snapshotPath=resolve(restoreArg?resolve(restoreArg):output,'snapshots',snapshotKey(manifest)+'.snapshot');
  const snapshotIdentity=async()=>{const bytes=await readFile(snapshotPath);return {sha256:sha(bytes),bytes:bytes.length};};
  let snapshotStore=fileSnapshotStore(resolve(output,'snapshots'));
  if(restoreArg){
    const source=resolve(restoreArg),bytes=await readFile(resolve(source,'report.json')),capture=JSON.parse(bytes);
    assert.equal(capture.status,'passed');assert.equal(capture.snapshotMode,'cold');assert.deepEqual(capture.manifest,manifest);
    assert.deepEqual(await snapshotIdentity(),capture.snapshotIdentity,'Retained capture bytes changed');
    report.snapshotIdentity=capture.snapshotIdentity;
    const store=fileSnapshotStore(resolve(source,'snapshots'));
    snapshotStore={get:key=>store.get(key),putIfAbsent:()=>{throw Error('Restore must not replace retained capture');},delete:()=>{throw Error('Restore must not delete retained capture');}};
    report.restoreSource={path:source,reportSha256:sha(bytes)};
  }
  vm=await startBunApp({manifest,snapshotStore,
    runtimeUrl:pathToFileURL(resolve(directory,manifest.generation,'runtime/qemu-system-x86_64.js')).href,
    workerScript:resolve(directory,manifest.generation,'runtime/qemu-system-x86_64.js'),
    readAsset:name=>readFile(resolve(directory,name)),timeoutMs:240000,
    onEvent:event=>{events.push(event);if(event.event==='error')fail(Error(event.reason));},
    onConsole:text=>{
      consoleText+=text;tail+=text;if(tail.length>2097152){fail(Error('Unbounded held-out console'));return;}
      let end;while((end=tail.indexOf('\n'))>=0){const line=tail.slice(0,end).replace(/\r$/,'');tail=tail.slice(end+1);
        if(line.startsWith('MSG2_HELDOUT:'))try{finish(JSON.parse(line.slice(13)));}catch(e){fail(e);}
        if(line.includes('BUN_APP_FAILURE:')||line.includes('Kernel panic'))fail(Error(line));
      }
    }});
  report.ready=await vm.ready;assert.equal(report.ready.mode,report.snapshotMode);
  if(!restoreArg)report.snapshotIdentity=await snapshotIdentity();
  const result=await completed;await vm.pause();
  assert.equal(result.schema,1);assert.equal(result.bun,'1.4.4');assert.equal(result.mode,report.snapshotMode);
  const lengths=[0,1,7,31,55,56,63,64,65,119,120,127,128,129,255,256,1023,1024,4095,4096,65535,65536,65537,1048576];
  assert.equal(result.results.length,lengths.length*8);
  for(let i=0;i<result.results.length;i++){
    const row=result.results[i],round=Math.floor(i/lengths.length),index=i%lengths.length;
    assert.equal(row.round,round);assert.equal(row.index,index);assert.equal(row.length,lengths[index]);assert.equal(row.offset,(index+round)%17);
    const seed=(0x9e3779b9^Math.imul(round+1,65537)^Math.imul(index+1,1664525))>>>0;assert.equal(row.seed,seed);
    let state=seed;const data=Buffer.alloc(row.length);
    for(let j=0;j<data.length;j++){state^=state<<13;state^=state>>>17;state^=state<<5;data[j]=state&255;}
    const expected=sha(data);assert.equal(row.direct,expected);assert.equal(row.streamed,expected);assert.equal(row.inputUnchanged,true);
  }
  report.runtimeConfig=vm.module._defuss_m2_msg2_status();assert.equal(report.runtimeConfig,0x10000|(manifest.experiment.enabled?4:3));
  report.result=result;report.checkedDigests=result.results.length*2;report.status='passed';
  assert.equal(sha(await readFile(new URL('./msg2-heldout.mjs',import.meta.url))),report.fixtureSha256,'Held-out source changed during run');
  assert.deepEqual(await snapshotIdentity(),report.snapshotIdentity,'Snapshot changed during guest execution');
}catch(error){report.failure=String(error.stack??error);}
finally{
  clearTimeout(timer);if(vm)await vm.stop().catch(error=>{report.status='failed';report.cleanupFailure=String(error);});
  await writeFile(resolve(output,'serial.log'),consoleText,{flag:'wx'});
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({status:report.status,checkedDigests:report.checkedDigests,failure:report.failure,report:resolve(output,'report.json')}));
process.exit(report.status==='passed'?0:1);
