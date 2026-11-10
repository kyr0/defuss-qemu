import {validateHeldout} from './oracle.mjs';
import {verifyRuntime,recheckInputs} from './runtime-proof.mjs';
import {readFifoPerformance} from '../../experiments/passive-fifo/reader.mjs';
import {verifySnapshot} from '../../benchmarks/harness/passive-fifo-finite-v1/snapshot.mjs';
import {durableNew} from '../../benchmarks/harness/passive-fifo-finite-v1/attempt.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {startBunApp} from '../../benchmarks/harness/passive-fifo-finite-v1/vm-adapter.mjs';
import {fileSnapshotStore} from '../../packaging/bun-app/file-store.mjs';
import {snapshotKey} from '../../packaging/bun-app/snapshots.mjs';

const [packageArg,outputArg,restoreArg]=process.argv.slice(2);assert.ok(packageArg&&outputArg);
const directory=resolve(packageArg),output=resolve(outputArg);await mkdir(output);
const sha=data=>createHash('sha256').update(data).digest('hex');
const manifest=JSON.parse(await readFile(resolve(directory,'app.json'))),events=[];
let consoleText='',tail='',finish,fail,vm,resultRecords=0;
const completed=new Promise((yes,no)=>{finish=yes;fail=no;});completed.catch(()=>{});
const timer=setTimeout(()=>fail(Error('Held-out guest timeout')),240000);
const report={schema:1,status:'failed',protocol:'defuss-passive-fifo-heldout-v1',timingEligible:false,scope:'Node full-system fresh passive-FIFO capture/restore using unchanged held-out SHA payload; no performance result',
  node:process.version,package:directory,manifest,events,snapshotMode:restoreArg?'restored':'cold',
  runnerSha256:sha(await readFile(new URL(import.meta.url))),fixtureSha256:sha(await readFile(new URL('../accelerators/msg2-heldout.mjs',import.meta.url)))};
try{
  assert.ok(process.env.TMPDIR?.startsWith(resolve(new URL('../../tmp',import.meta.url).pathname)+'/'),'Use scripts/with-tmp.py for all task scratch');
  assert.deepEqual(manifest.vm,{machine:'pc,acpi=off',cpu:'max',ramMiB:512,smp:1,tbMiB:128,hotLimit:1500,runtimeFlags:3});
  assert.equal(manifest.experiment?.name,'passive-fifo-v1');assert.equal(typeof manifest.experiment.enabled,'boolean');assert.equal(manifest.benchmark?.measurementProtocol,report.protocol);
  const prior=JSON.parse(await readFile(resolve(directory,'runtime-provenance.json')));report.runtimeProvenance=await verifyRuntime(prior);assert.deepEqual(report.runtimeProvenance,prior);
  report.inputs={...prior.inputs};
  for(const name of ['app.json','runtime-provenance.json'])report.inputs[resolve(directory,name)]=sha(await readFile(resolve(directory,name)));
  for(const [name,id] of Object.entries(manifest.artifacts)){const path=resolve(directory,manifest.generation,name),bytes=await readFile(path);assert.equal(bytes.length,id.bytes);assert.equal(sha(bytes),id.sha256);report.inputs[path]=id.sha256;}
  for(const name of ['qemu-system-x86_64.js','qemu-system-x86_64.wasm'])assert.equal(manifest.artifacts['runtime/'+name].sha256,prior.artifacts['runtime/x86_64/'+name].sha256);
  for(const path of [new URL(import.meta.url),new URL('./runtime-proof.mjs',import.meta.url),new URL('./oracle.mjs',import.meta.url),new URL('../../benchmarks/harness/passive-fifo-finite-v1/vm-adapter.mjs',import.meta.url),new URL('../../experiments/passive-fifo/reader.mjs',import.meta.url)])report.inputs[path.pathname]=sha(await readFile(path));
  for(const name of ['benchmarks/harness/passive-fifo-finite-v1/snapshot.mjs','benchmarks/harness/passive-fifo-finite-v1/attempt.mjs','host/browser/qmp.mjs','host/browser/machine.mjs','host/browser/hotspots.mjs','host/browser/helper-names.mjs','benchmarks/harness/code/physical.mjs','packaging/bun-app/serial.mjs','packaging/bun-app/snapshots.mjs','packaging/bun-app/file-store.mjs','tests/accelerators/msg2-heldout.mjs']){const path=new URL('../../'+name,import.meta.url);report.inputs[path.pathname]=sha(await readFile(path));}
  assert.equal(manifest.appSha256,report.fixtureSha256,'Packaged application differs from held-out source');
  const snapshotPath=resolve(restoreArg?resolve(restoreArg):output,'snapshots',snapshotKey(manifest)+'.snapshot');
  const snapshotIdentity=async()=>{const bytes=await readFile(snapshotPath);return {sha256:sha(bytes),bytes:bytes.length};};
  let snapshotStore=fileSnapshotStore(resolve(output,'snapshots'));
  if(restoreArg){
    const source=resolve(restoreArg),bytes=await readFile(resolve(source,'report.json')),capture=JSON.parse(bytes);
    assert.equal(capture.protocol,report.protocol);assert.equal(capture.status,'passed');assert.equal(capture.snapshotMode,'cold');assert.deepEqual(capture.manifest,manifest);
    assert.deepEqual(await snapshotIdentity(),capture.snapshotIdentity,'Retained capture bytes changed');
    report.snapshotIdentity=capture.snapshotIdentity;
    const store=fileSnapshotStore(resolve(source,'snapshots'));
    snapshotStore={get:key=>store.get(key),putIfAbsent:()=>{throw Error('Restore must not replace retained capture');},delete:()=>{throw Error('Restore must not delete retained capture');}};
    report.restoreSource={path:source,reportSha256:sha(bytes)};report.inputs[resolve(source,'report.json')]=sha(bytes);
  }
  vm=await startBunApp({manifest,snapshotStore,
    runtimeUrl:pathToFileURL(resolve(directory,manifest.generation,'runtime/qemu-system-x86_64.js')).href,
    workerScript:resolve(directory,manifest.generation,'runtime/qemu-system-x86_64.js'),
    readAsset:name=>readFile(resolve(directory,name)),timeoutMs:240000,
    onEvent:event=>{events.push(event);if(event.event==='error')fail(Error(event.reason));},
    onConsole:text=>{
      consoleText+=text;tail+=text;if(tail.length>2097152){fail(Error('Unbounded held-out console'));return;}
      let end;while((end=tail.indexOf('\n'))>=0){const line=tail.slice(0,end).replace(/\r$/,'');tail=tail.slice(end+1);
        if(line.startsWith('MSG2_HELDOUT:'))try{resultRecords++;finish(JSON.parse(line.slice(13)));}catch(e){fail(e);}
        if(line.includes('BUN_APP_FAILURE:')||line.includes('Kernel panic'))fail(Error(line));
      }
    }});
  report.ready=await vm.ready;assert.equal(report.ready.mode,report.snapshotMode);assert.equal(report.ready.snapshotSaved,!restoreArg);assert.equal(report.ready.appSha256,manifest.appSha256);assert.equal(report.ready.compatibilitySha256,manifest.compatibilitySha256);
  if(!restoreArg)report.snapshotIdentity=await snapshotIdentity();
  const result=await completed;await vm.pause();
  assert.equal(resultRecords,1);assert.ok(!consoleText.includes('BUN_APP_FAILURE:')&&!consoleText.includes('Kernel panic'));
  report.resultRecords=resultRecords;report.checkedDigests=validateHeldout(result,report.snapshotMode);
  report.fifo=readFifoPerformance(vm.module,manifest.experiment.enabled);
  report.result=result;report.checkedDigests=result.results.length*2;
  assert.equal(sha(await readFile(new URL('../accelerators/msg2-heldout.mjs',import.meta.url))),report.fixtureSha256,'Held-out source changed during run');
  assert.deepEqual(await snapshotIdentity(),report.snapshotIdentity,'Snapshot changed during guest execution');
  report.snapshotMetadata=await verifySnapshot(snapshotPath,manifest,report.snapshotIdentity);await recheckInputs(report.inputs);report.status='passed';
}catch(error){report.status='failed';report.failure=String(error.stack??error);}
finally{
  clearTimeout(timer);if(vm)await vm.stop().catch(error=>{report.status='failed';report.cleanupFailure=String(error);});
  await writeFile(resolve(output,'serial.log'),consoleText,{flag:'wx'});
  await durableNew(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({status:report.status,checkedDigests:report.checkedDigests,failure:report.failure,report:resolve(output,'report.json')}));
process.exit(report.status==='passed'?0:1);
