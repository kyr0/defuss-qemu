// Pure validation of retained SDK start/completion and exact compiler inputs.
// No build, subprocess or guest execution. Synthetic tests are not live evidence.
import assert from 'node:assert/strict';
export const fixtureSdk='registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812';
const sourceCopies={
 'tests/m3b-xstate-v2/fixture.c':'fixture.c',
 'tests/m3b-xstate-v2/fixture.S':'fixture.S',
 'experiments/m3b-fallthrough/predecode.h':'predecode.h',
};
export function validateSdkInvocation(start,complete,{root,fixture,path}){
 assert.match(path,/^tmp\/sdk-[A-Za-z0-9_-]+\/invocation\.json$/);assert.match(fixture,/^artifacts\/[A-Za-z0-9_.-]+$/);
 assert.equal(start.schema,1);assert.equal(start.status,'running');assert.equal(start.sdk,fixtureSdk);
 const scratch=path.slice(0,-'/invocation.json'.length),containerScratch='/project/'+scratch;
 assert.equal(start.scratch,root+'/'+scratch);assert.equal(start.containerScratch,containerScratch);
 assert.ok(typeof start.startedUtc==='string'&&Number.isFinite(Date.parse(start.startedUtc)));
 const tail=['run','--rm','--platform','linux/amd64','--network','none',
  '-e','TMPDIR='+containerScratch,'-e','TMP='+containerScratch,'-e','TEMP='+containerScratch,
  '-v',root+':/project','-v','qemu-wasm-arm64-sdk-cache:/emsdk/upstream/emscripten/cache','-w','/project',fixtureSdk,
  'python3','tests/m3b-xstate-v2/build.py','--output',fixture];
 assert.ok(Array.isArray(start.command)&&start.command.length>tail.length&&start.command.every(x=>typeof x==='string'&&x.length>0));assert.deepEqual(start.command.slice(-tail.length),tail);
 const {status,returncode,finishedUtc,...unchanged}=complete;assert.equal(status,'passed');assert.equal(returncode,0);
 assert.ok(typeof finishedUtc==='string'&&Number.isFinite(Date.parse(finishedUtc))&&Date.parse(finishedUtc)>=Date.parse(start.startedUtc));
 const {status:startStatus,...startUnchanged}=start;assert.deepEqual(unchanged,startUnchanged);
}
export function validateImageBuild(build,{fixture}){
 assert.match(fixture,/^artifacts\/[A-Za-z0-9_.-]+$/);assert.match(build.scratch,/^tmp\/m3b-image-[A-Za-z0-9_-]+$/);
 assert.equal(build.schema,1);assert.equal(build.status,'passed');assert.equal(build.kind,'m3b-differential-fixture-image');assert.equal(build.guestExecuted,false);assert.equal(build.timingEligible,false);assert.equal(build.hostShapeValidated,true);
 assert.equal(build.sdk,fixtureSdk);assert.equal(build.sdkInvocation.startArtifact,'sdk-invocation-start.json');assert.equal(build.sdkInvocation.completionRequired,true);
 assert.deepEqual(Object.keys(build.copiedSources).sort(),Object.keys(sourceCopies).sort());
 for(const [source,artifact]of Object.entries(sourceCopies)){
  const row=build.copiedSources[source];assert.equal(row.artifact,artifact);assert.match(row.sha256,/^[a-f0-9]{64}$/);assert.equal(row.sha256,build.sources[source]);
  assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>0);assert.deepEqual(build.artifacts[artifact],{sha256:row.sha256,bytes:row.bytes});
 }
 for(const name of ['sdk.py','build.py','container_engine.py','runtime_dependencies.py'])assert.match(build.sources['scripts/'+name],/^[a-f0-9]{64}$/);
 assert.deepEqual(Object.keys(build.tools).sort(),['gcc','nm','objdump']);assert.match(build.compilerTarget,/x86_64.*linux/);
 for(const name of ['gcc','nm','objdump']){
  const tool=build.tools[name];assert.equal(typeof tool.path,'string');assert.ok(tool.path.startsWith('/'));assert.match(tool.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(tool.bytes)&&tool.bytes>0);assert.ok(typeof tool.version==='string'&&tool.version.trim().length>0);
  const rows=build.commands.filter(c=>JSON.stringify(c.argv)===JSON.stringify([tool.path,'--version']));assert.equal(rows.length,1);assert.equal(rows[0].exitCode,0);assert.equal(rows[0].stdout,tool.version);
 }
 const out='/project/'+fixture,scratch='/project/'+build.scratch;
 const expected=[...['gcc','nm','objdump'].map(name=>[build.tools[name].path,'--version']),[build.tools.gcc.path,'-dumpmachine'],
  [build.tools.gcc.path,'-O2','-static','-fno-pie','-no-pie','-mno-red-zone','-fno-tree-vectorize','-fno-tree-slp-vectorize',out+'/fixture.c',out+'/fixture.S','-o',out+'/fixture'],
  [build.tools.nm.path,'-n','--defined-only',out+'/fixture'],[build.tools.objdump.path,'-d','-w','--no-show-raw-insn',out+'/fixture'],
  [build.tools.gcc.path,'-std=c11','-O2','-I'+out,out+'/shape-probe.c','-o',scratch+'/shape-probe'],[scratch+'/shape-probe']];
 assert.deepEqual(build.commands.map(row=>row.argv),expected);for(const row of build.commands){assert.equal(row.exitCode,0);assert.equal(typeof row.stdout,'string');assert.equal(typeof row.stderr,'string');}
 const target=build.commands.filter(c=>JSON.stringify(c.argv)===JSON.stringify([build.tools.gcc.path,'-dumpmachine']));assert.equal(target.length,1);assert.equal(target[0].exitCode,0);assert.equal(target[0].stdout.trim(),build.compilerTarget);
}
