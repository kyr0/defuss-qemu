// Run only in a root-authorized gap. This is a standalone Wasm contract, no VM.
import assert from 'node:assert/strict';
import {readFile,mkdir,open,realpath} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const {values}=parseArgs({options:{build:{type:'string'},output:{type:'string'}}});
for(const key of ['build','output'])assert.match(values[key]??'',/^artifacts\/[A-Za-z0-9_.-]+$/);
const out=resolve(root,values.output),buildDir=resolve(root,values.build);
assert.equal(await realpath(buildDir),buildDir);assert.equal(await realpath(dirname(out)),dirname(out));await mkdir(out);
const syncDir=async path=>{const h=await open(path,'r');try{await h.sync();}finally{await h.close();}};await syncDir(dirname(out));
const write=async(name,value)=>{const h=await open(resolve(out,name),'wx');try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}await syncDir(out);};
const id=b=>({sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length});
const inputs={},buffers=new Map();
async function read(path,wanted){
 const full=resolve(root,path);assert.ok(full.startsWith(root+'/'));assert.equal(await realpath(full),full);const bytes=await readFile(full),actual=id(bytes);
 if(wanted)assert.deepEqual(actual,wanted);const name=relative(root,full);if(inputs[name])assert.deepEqual(inputs[name],actual);inputs[name]=actual;buffers.set(name,bytes);return bytes;
}
const sdk='registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812';
let mod,rawState,timeout;
const report={schema:1,kind:'m3b-actual-asyncify-contract-result',status:'failed',timingEligible:false,
 scope:'Actual standalone memory64 Asyncify service helper; capacity/GC/CPU context are stubs. No QEMU guest, worker-lifetime or natural-pressure acceptance.',
 node:{executable:process.execPath,version:process.version,execArgv:process.execArgv},inputs};
try{
 const build=JSON.parse(await read(values.build+'/build-report.json'));
 assert.equal(build.schema,1);assert.equal(build.kind,'m3b-actual-asyncify-contract-build');assert.equal(build.status,'passed');assert.equal(build.sdk,sdk);
 assert.equal(build.timingEligible,false);assert.equal(build.qemuRuntimeChanged,false);assert.equal(build.guestExecution,false);
 const sourceRoot='experiments/m3b-asyncify-v2/asyncify-contract/',baseSource='artifacts/m3a-source-04/source/tcg/wasm64.c';
 const expectedSources=[baseSource,...['build.py','contract.c','observer-pre.js','run.mjs','README.md'].map(n=>sourceRoot+n),
  'experiments/m3b-fallthrough/core.h','experiments/m3b-fallthrough/runtime-service.inc',
  'scripts/sdk.py','scripts/build.py','scripts/container_engine.py'];
 assert.deepEqual(Object.keys(build.sources).sort(),expectedSources.sort(),'Mandatory actual source closure');
 for(const [path,wanted]of Object.entries(build.sources))await read(path,wanted);
 for(const [name,wanted]of Object.entries(build.artifacts)){assert.match(name,/^[A-Za-z0-9_.-]+$/);await read(values.build+'/'+name,wanted);}
 for(const [name,path]of [['contract.c',sourceRoot+'contract.c'],['observer-pre.js',sourceRoot+'observer-pre.js'],
  ['core.h','experiments/m3b-fallthrough/core.h'],['runtime-service.inc','experiments/m3b-fallthrough/runtime-service.inc']]){
  assert.deepEqual(buffers.get(values.build+'/'+name),buffers.get(path),'Exact copied compiler input: '+name);
 }
 const originalSource=buffers.get(baseSource).toString('utf8'),declaration='#define MAX_EXEC_NUM 50000\nstatic __thread int exec_cnt = MAX_EXEC_NUM;\n';
 assert.equal(originalSource.split(declaration).length-1,1);
 const body=originalSource.match(/^static inline void trysleep\(void\)\n\{.*?^\}/ms);assert.ok(body);
 const extracted=Buffer.from(declaration+body[0]+'\n');assert.deepEqual(extracted,buffers.get(values.build+'/original-trysleep.inc'));assert.deepEqual(id(extracted),build.extractedTrysleep);
 assert.match(build.compiler.path,/^\/emsdk\/upstream\/emscripten\/emcc(?:\.py)?$/);
 assert.match(build.compiler.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(build.compiler.bytes)&&build.compiler.bytes>0);assert.ok(typeof build.compiler.version==='string'&&build.compiler.version.trim());
 const nativeOut='/project/'+values.build,flags=['-O2','-std=c11','-Wall','-Wextra','-Werror','-pthread','-msimd128','-m64','-sMEMORY64=1',
  '-sASYNCIFY=1','-sWASM_BIGINT','-sMODULARIZE=1','-sEXPORT_ES6=1','-sENVIRONMENT=node',
  '-sALLOW_TABLE_GROWTH=1','-sINITIAL_MEMORY=64MB',
  '-sSTACK_SIZE=1048576','-sDEFAULT_PTHREAD_STACK_SIZE=1048576','-sSTACK_OVERFLOW_CHECK=2',
  '-sEXPORTED_RUNTIME_METHODS=ccall','--no-entry','--pre-js',nativeOut+'/observer-pre.js'];
 assert.deepEqual(build.commands.map(row=>row.argv),[[build.compiler.path,'--version'],[build.compiler.path,...flags,nativeOut+'/contract.c','-o',nativeOut+'/contract.mjs']]);
 for(let i=0;i<2;i++){const row=build.commands[i];assert.equal(row.returncode,0);assert.equal(typeof row.stdout,'string');assert.equal(typeof row.stderr,'string');assert.deepEqual(JSON.parse(buffers.get(values.build+'/command-0'+(i+1)+'.json')),row);}
 assert.equal(build.commands[0].stdout,build.compiler.version);
 const start=JSON.parse(buffers.get(values.build+'/sdk-invocation-start.json'));
 assert.match(build.sdkInvocation,/^tmp\/sdk-[A-Za-z0-9_-]+\/invocation.json$/);
 const complete=JSON.parse(await read(build.sdkInvocation));assert.equal(start.schema,1);assert.equal(start.status,'running');assert.equal(start.sdk,sdk);
 const scratch=build.sdkInvocation.slice(0,-'/invocation.json'.length),guestScratch='/project/'+scratch;
 assert.equal(start.scratch,root+'/'+scratch);assert.equal(start.containerScratch,guestScratch);
 const tail=['run','--rm','--platform','linux/amd64','--network','none','-e','TMPDIR='+guestScratch,'-e','TMP='+guestScratch,'-e','TEMP='+guestScratch,
  '-v',root+':/project','-v','qemu-wasm-arm64-sdk-cache:/emsdk/upstream/emscripten/cache','-w','/project',sdk,
  'python3','experiments/m3b-asyncify-v2/asyncify-contract/build.py','--output',values.build];
 assert.ok(start.command.length>tail.length);assert.deepEqual(start.command.slice(-tail.length),tail);
 const {status,returncode,finishedUtc,...unchanged}=complete,{status:oldStatus,...old}=start;
 assert.equal(status,'passed');assert.equal(returncode,0);assert.deepEqual(unchanged,old);assert.ok(Number.isFinite(Date.parse(finishedUtc))&&Date.parse(finishedUtc)>=Date.parse(start.startedUtc));
 await write('sdk-completion.json',complete);
 const get=name=>buffers.get(values.build+'/'+name),derivation=JSON.parse(get('derivation.json'));
 assert.equal(derivation.kind,'m3b-standalone-asyncify-observer');assert.equal(derivation.wasmChanged,false);assert.equal(derivation.newYield,false);assert.equal(derivation.forceGC,false);
 assert.deepEqual(id(get('contract.mjs')),derivation.originalJs);assert.deepEqual(id(get('contract-observed.mjs')),derivation.derivedJs);assert.deepEqual(id(get('contract.wasm')),derivation.wasm);
 const patches=[
  ['runAndAbortIfError(()=>_asyncify_start_unwind(Asyncify.currData))','runAndAbortIfError(()=>m3bContractTransition(1,()=>_asyncify_start_unwind(Asyncify.currData)))'],
  ['runAndAbortIfError(_asyncify_stop_unwind)','runAndAbortIfError(()=>m3bContractTransition(2,_asyncify_stop_unwind))'],
  ['runAndAbortIfError(()=>_asyncify_start_rewind(Asyncify.currData))','runAndAbortIfError(()=>m3bContractTransition(3,()=>_asyncify_start_rewind(Asyncify.currData)))'],
  ['runAndAbortIfError(_asyncify_stop_rewind)','runAndAbortIfError(()=>m3bContractTransition(4,_asyncify_stop_rewind))']];
 let reconstructed=get('contract.mjs').toString('utf8');
 for(const [before,after]of patches){assert.equal(reconstructed.split(before).length-1,1);reconstructed=reconstructed.replace(before,after);}
 assert.equal(reconstructed,get('contract-observed.mjs').toString('utf8'));
 const startup=async()=>{
  const wasm=await WebAssembly.compile(get('contract.wasm')),factory=(await import(pathToFileURL(resolve(buildDir,'contract-observed.mjs')))).default;
  return factory({noInitialRun:true,m3bRawState:()=>{assert.equal(typeof rawState,'function');return rawState();},
   instantiateWasm(imports,receive){const instance=new WebAssembly.Instance(wasm,imports);rawState=instance.exports.asyncify_get_state;assert.equal(typeof rawState,'function');receive(instance,wasm);return instance.exports;}});
 };
 mod=await Promise.race([startup(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Wasm/module/factory startup exceeded60s')),60000);})]);clearTimeout(timeout);
 const initial=mod.m3bObserverArm(mod._contract_data());assert.equal(initial.length,32);assert.equal(initial[0],0x4d334143);assert.equal(initial[1],1);assert.equal(initial[19],32);
 assert.ok(initial.slice(2,19).every(n=>n===0)&&initial.slice(20).every(n=>n===0));
 const result=await Promise.race([mod.ccall('run_contract','number',[],[],{async:true}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Actual Asyncify contract exceeded60s')),60000);})]);
 clearTimeout(timeout);assert.equal(result,0);report.observation=mod.m3bObserverRead();
 const {events,bank,nativeState,jsState}=report.observation;
 assert.equal(nativeState,0);assert.equal(jsState,0);assert.equal(events.length,8);
 const expected=(stage)=>{const w=Array(32).fill(0);Object.assign(w,{0:0x4d334143,1:1,2:stage,6:stage===3?2:4,7:1,8:stage===3?2:4,
  10:stage===3?0:1,13:stage===3?3:5,14:1,16:0x56789abc,17:0x1234,18:stage===3?3:5,19:32});return w;};
 for(let i=0;i<events.length;i++){
  const e=events[i],which=i%4;assert.equal(e.event,which+1);assert.deepEqual([e.before,e.after],[[0,1],[1,0],[0,2],[2,0]][which]);
  assert.deepEqual(e.bank,expected(i<4?3:5));assert.deepEqual(e.bankAfter,e.bank);
 }
 const final=Array(32).fill(0);Object.assign(final,{0:0x4d334143,1:1,2:7,3:1,5:7,6:4,7:1,8:4,9:1,10:2,11:1,12:1,13:8,14:2,16:0x56789abc,17:0x1234,18:8,19:32});assert.deepEqual(bank,final);
 for(const [path,wanted]of Object.entries(inputs))await read(path,wanted);
 report.status='passed';report.actualEpisodes=2;report.exactDebtPayments=4;
 report.exclusions=['No real charged-instance pool or FinalizationRegistry callbacks','No QEMU owning-worker, dormant-fiber or generated-region validation','No natural VM pressure, forced VM threshold, forced VM yield or GC'];
}catch(error){report.failure=String(error.stack??error);if(mod)try{report.observation=mod.m3bObserverRead();}catch(observationError){report.observationFailure=String(observationError);}}
finally{clearTimeout(timeout);await write('report.json',report);}
process.stdout.write(JSON.stringify({status:report.status,output:values.output})+'\n');if(report.status!=='passed')process.exitCode=1;
