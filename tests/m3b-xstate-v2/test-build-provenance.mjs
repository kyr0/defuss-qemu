// Synthetic validation only. Unexecuted while timing collection is active.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureSdk,validateSdkInvocation,validateImageBuild} from './build-provenance.mjs';
const context={root:'/host/defuss-vm',fixture:'artifacts/synthetic-m3b-image',path:'tmp/sdk-synthetic/invocation.json'};
function invocation(){
 const t='/project/tmp/sdk-synthetic';const start={schema:1,status:'running',startedUtc:'2026-01-01T00:00:00.000Z',sdk:fixtureSdk,scratch:context.root+'/tmp/sdk-synthetic',containerScratch:t,
  command:['docker','run','--rm','--platform','linux/amd64','--network','none','-e','TMPDIR='+t,'-e','TMP='+t,'-e','TEMP='+t,'-v',context.root+':/project','-v','qemu-wasm-arm64-sdk-cache:/emsdk/upstream/emscripten/cache','-w','/project',fixtureSdk,'python3','tests/m3b-xstate-v2/build.py','--output',context.fixture]};
 return {start,complete:{...structuredClone(start),status:'passed',returncode:0,finishedUtc:'2026-01-01T00:00:01.000Z'}};
}
test('SDK start requires exact isolated invocation and successful later wrapper completion',()=>{
 const r=invocation();validateSdkInvocation(r.start,r.complete,context);
 for(const mutate of [r=>r.complete.status='running',r=>r.complete.returncode=1,r=>r.complete.returncode=false,r=>r.complete.finishedUtc='2025-01-01T00:00:00Z',r=>r.complete.command.push('extra'),r=>r.start.schema=true,
  r=>{r.start.sdk=r.complete.sdk='unpinned-sdk';},r=>{r.start.command[r.start.command.indexOf('linux/amd64')]='linux/arm64';r.complete.command=[...r.start.command];},
  r=>{r.start.command[r.start.command.indexOf('none')]='host';r.complete.command=[...r.start.command];},r=>{r.start.command[r.start.command.indexOf('--output')+1]='artifacts/other';r.complete.command=[...r.start.command];},
  r=>{r.start.scratch=r.complete.scratch='/other/tmp/sdk-synthetic';}]){
  const r=invocation();mutate(r);assert.throws(()=>validateSdkInvocation(r.start,r.complete,context));
 }
 assert.throws(()=>validateSdkInvocation(r.start,r.complete,{...context,path:'tmp/sdk-synthetic/../invocation.json'}));
});
function image(){
 const h='a'.repeat(64),tools=Object.fromEntries(['gcc','nm','objdump'].map(name=>[name,{path:'/usr/bin/'+name,sha256:h,bytes:123,version:name+' synthetic version\n'}]));
 const copies={'tests/m3b-xstate-v2/fixture.c':'fixture.c','tests/m3b-xstate-v2/fixture.S':'fixture.S','experiments/m3b-fallthrough/predecode.h':'predecode.h'},sources={},artifacts={},copiedSources={};
 for(const [source,artifact]of Object.entries(copies)){sources[source]=h;artifacts[artifact]={sha256:h,bytes:99};copiedSources[source]={artifact,...artifacts[artifact]};}
 for(const n of ['sdk.py','build.py','container_engine.py','runtime_dependencies.py'])sources['scripts/'+n]=h;
 const out='/project/'+context.fixture,scratch='/project/tmp/m3b-image-synthetic';const argv=[...['gcc','nm','objdump'].map(name=>[tools[name].path,'--version']),[tools.gcc.path,'-dumpmachine'],
  [tools.gcc.path,'-O2','-static','-fno-pie','-no-pie','-mno-red-zone','-fno-tree-vectorize','-fno-tree-slp-vectorize',out+'/fixture.c',out+'/fixture.S','-o',out+'/fixture'],
  [tools.nm.path,'-n','--defined-only',out+'/fixture'],[tools.objdump.path,'-d','-w','--no-show-raw-insn',out+'/fixture'],
  [tools.gcc.path,'-std=c11','-O2','-I'+out,out+'/shape-probe.c','-o',scratch+'/shape-probe'],[scratch+'/shape-probe']];
 const commands=argv.map((a,i)=>({argv:a,exitCode:0,stdout:i<3?tools[['gcc','nm','objdump'][i]].version:i===3?'x86_64-linux-gnu\n':'',stderr:''}));
 return {schema:1,status:'passed',kind:'m3b-differential-fixture-image',guestExecuted:false,timingEligible:false,hostShapeValidated:true,sdk:fixtureSdk,
  sdkInvocation:{startArtifact:'sdk-invocation-start.json',completionRequired:true},scratch:'tmp/m3b-image-synthetic',compilerTarget:'x86_64-linux-gnu',tools,sources,artifacts,copiedSources,commands};
}
test('image evidence binds exact compiled C/S/header copies and absolute SDK tools',()=>{
 validateImageBuild(image(),context);
 for(const mutate of [x=>delete x.artifacts['fixture.S'],x=>x.copiedSources['tests/m3b-xstate-v2/fixture.c'].sha256='b'.repeat(64),x=>x.artifacts['predecode.h'].bytes++,x=>delete x.sources['scripts/sdk.py'],
  x=>x.commands[4].argv[8]='/project/tests/m3b-xstate-v2/fixture.c',x=>x.commands[7].argv[3]='-I/project/experiments/m3b-fallthrough',x=>x.tools.gcc.path='gcc',x=>x.commands[8].exitCode=1,x=>x.hostShapeValidated=1]){
  const x=image();mutate(x);assert.throws(()=>validateImageBuild(x,context));
 }
});
