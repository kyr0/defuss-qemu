import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,unlink,symlink} from 'node:fs/promises';
import {tmpdir,hostname} from 'node:os';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runCampaign,execute,validatePlan,validateResult,recoverLock,durableNew,fingerprint,validateCodeCapture} from './campaign.mjs';

const sha=data=>createHash('sha256').update(data).digest('hex');
const parse=async path=>JSON.parse(await readFile(path,'utf8'));
async function fixture(t,count=2){
  const root=await mkdtemp(resolve(tmpdir(),'defuss-m1-campaign-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(resolve(root,'package'));await writeFile(resolve(root,'package/app.json'),'{}');
  await writeFile(resolve(root,'source.mjs'),'frozen source');
  const plan={schema:1,experiment:'sha256msg2-v1',kind:'screen',id:'fixture',inputs:['source.mjs'],steps:Array.from({length:count},(_,i)=>({id:'step-'+i,mode:'baseline',package:'package',snapshot:'capture',samplePeriod:257,timeoutMs:1000}))};
  await writeFile(resolve(root,'plan.json'),JSON.stringify(plan));
  const launches=[];
  const validate=async({reportPath,step})=>{const data=await readFile(reportPath),report=JSON.parse(data);assert.equal(report.status,'passed');assert.equal(report.step,step.id);return {reportSha256:sha(data)};};
  const runChild=async(command,{attempt})=>{
    const request=await parse(resolve(attempt,'request.json')); // Must exist before execution.
    assert.deepEqual(request.command,command);launches.push({attempt,request});
    await mkdir(resolve(attempt,'run'));await writeFile(resolve(attempt,'run/report.json'),JSON.stringify({status:'passed',step:request.stepId}));
    return {code:0,signal:null,error:null};
  };
  return {root,plan,launches,runChild,options:{root,planPath:'plan.json',output:'artifacts/campaign',sourcePaths:[],getEnvironment:async()=>({fixture:true}),onProgress:()=>{},validate,runChild}};
}

test('serial steps persist before execution; rerun validates and resumes without launches',async t=>{
  const f=await fixture(t,3);let active=0,max=0;
  const result=await runCampaign({...f.options,runChild:async(...args)=>{active++;max=Math.max(max,active);try{return await f.runChild(...args);}finally{active--;}}});
  assert.equal(result.status,'passed');assert.equal(max,1);assert.equal(f.launches.length,3);
  const before=await Promise.all(f.launches.map(x=>readFile(resolve(x.attempt,'request.json'))));
  assert.deepEqual(await runCampaign(f.options),result);assert.equal(f.launches.length,3);
  assert.deepEqual(await Promise.all(f.launches.map(x=>readFile(resolve(x.attempt,'request.json')))),before);
});

test('child failure stops later steps; next invocation preserves failure and creates fresh attempt',async t=>{
  const f=await fixture(t);let calls=0,failed;
  await assert.rejects(runCampaign({...f.options,runChild:async(command,options)=>{
    calls++;failed=options.attempt;await mkdir(resolve(failed,'run'));await writeFile(resolve(failed,'run/report.json'),'crashed partial evidence');return {code:7,signal:null};
  }}),/Child failed/);
  assert.equal(calls,1);const evidence=await readFile(resolve(failed,'run/report.json'));
  await runCampaign(f.options);assert.equal(f.launches.length,2);assert.notEqual(f.launches[0].attempt,failed);
  assert.deepEqual(await readFile(resolve(failed,'run/report.json')),evidence);
});

test('zero exit with invalid report fails validation and retries fresh',async t=>{
  const f=await fixture(t,1);let attempt;
  await assert.rejects(runCampaign({...f.options,runChild:async(command,options)=>{
    attempt=options.attempt;await mkdir(resolve(attempt,'run'));await writeFile(resolve(attempt,'run/report.json'),'{}');return {code:0,signal:null};
  }}));
  await runCampaign(f.options);assert.notEqual(f.launches[0].attempt,attempt);
});

test('crash after complete report is recovered without re-executing a passed step',async t=>{
  const f=await fixture(t,1);await runCampaign(f.options);const attempt=f.launches[0].attempt;
  await unlink(resolve(attempt,'accepted.json'));await unlink(resolve(attempt,'exit.json'));
  await runCampaign(f.options);assert.equal(f.launches.length,1);assert.equal((await parse(resolve(attempt,'accepted.json'))).recovered,true);
});

test('missing report retries fresh, while tampered previously accepted evidence stops',async t=>{
  const f=await fixture(t,1);await assert.rejects(runCampaign({...f.options,runChild:async()=>({code:0,signal:null})}));
  await runCampaign(f.options);const report=resolve(f.launches[0].attempt,'run/report.json');
  await writeFile(report,JSON.stringify({status:'passed',step:'step-0',changed:true}));
  await assert.rejects(runCampaign(f.options),/Previously accepted evidence/);assert.equal(f.launches.length,1);
});

test('source/config drift fails before a new child starts',async t=>{
  const f=await fixture(t,1);await runCampaign(f.options);
  await writeFile(resolve(f.root,'source.mjs'),'changed');await assert.rejects(runCampaign(f.options),/Frozen inputs/);
  await writeFile(resolve(f.root,'source.mjs'),'frozen source');
  await assert.rejects(runCampaign({...f.options,getEnvironment:async()=>({fixture:false})}),/Frozen inputs/);
  assert.equal(f.launches.length,1);
});

test('restore gets the successful capture attempt and immutable hash',async t=>{
  const f=await fixture(t,2);Object.assign(f.plan.steps[1],{mode:'baseline',snapshot:'restore',captureStep:'step-0',samplePeriod:263,captureCode:false});
  await writeFile(resolve(f.root,'plan.json'),JSON.stringify(f.plan));await runCampaign(f.options);
  const [capture,restore]=f.launches;assert.equal(restore.request.cache,capture.request.cache);
  assert.equal(restore.request.captureReportSha256,sha(await readFile(resolve(capture.attempt,'run/report.json'))));
  assert.ok(restore.request.command.includes('--capture-report'));assert.ok(restore.request.command.includes('263'));
  assert.ok(!restore.request.command.includes('--capture-code'));assert.ok(!capture.request.command.includes('--capture-code'));
  await runCampaign(f.options);assert.equal(f.launches.length,2);
});

test('concurrent campaign invocation is refused and does not disturb the owner',async t=>{
  const f=await fixture(t,1);let unblock,started;
  const ready=new Promise(ok=>started=ok),hold=new Promise(ok=>unblock=ok);
  const running=runCampaign({...f.options,runChild:async(...args)=>{started();await hold;return f.runChild(...args);}});
  await ready;await assert.rejects(runCampaign(f.options),/lock exists/);unblock();await running;
  assert.equal(f.launches.length,1);
});

test('execution exception retains lock; active owner cannot be recovered',async t=>{
  const f=await fixture(t,1);await assert.rejects(runCampaign({...f.options,runChild:async()=>{throw Error('lost child handle');}}),/lost child/);
  const lock=await parse(resolve(f.root,'artifacts/.m1-campaign.lock'));
  await assert.rejects(runCampaign(f.options),/lock exists/);
  await assert.rejects(recoverLock(f.root,lock.token,true),/still alive/);
});

test('explicit stale recovery requires matching token, stopped-process acknowledgement and dead owner',async t=>{
  const f=await fixture(t,1);await mkdir(resolve(f.root,'artifacts'));
  const child=spawnSync(process.execPath,['-e','']);assert.equal(child.status,0);
  const lock={token:'test-token',pid:child.pid,host:hostname(),output:'artifacts/campaign'};
  await durableNew(resolve(f.root,'artifacts/.m1-campaign.lock'),JSON.stringify(lock));
  await assert.rejects(recoverLock(f.root,lock.token,false),/Recovery requires/);
  await assert.rejects(recoverLock(f.root,'wrong',true),/token differs/);
  await recoverLock(f.root,lock.token,true);
  assert.equal((await readdir(resolve(f.root,'artifacts'))).filter(x=>x.startsWith('.m1-campaign.lock.recovered-')).length,1);
});

test('real subprocess waits for close, records PID and logs; spawn failure is reported',async t=>{
  const f=await fixture(t,1),attempt=resolve(f.root,'child');await mkdir(attempt);
  const result=await execute([process.execPath,'-e','console.log("child evidence"); process.exitCode=4'],{cwd:f.root,attempt});
  assert.equal(result.code,4);assert.ok((await parse(resolve(attempt,'spawned.json'))).pid>0);
  assert.match(await readFile(resolve(attempt,'child.log'),'utf8'),/child evidence/);
  const missing=resolve(f.root,'missing');await mkdir(missing);
  const failure=await execute([resolve(f.root,'no-command')],{cwd:f.root,attempt:missing});assert.notEqual(failure.code,0);assert.match(failure.error,/ENOENT/);
});

test('unsafe plan dependencies, symlink inputs and output/input overlap are rejected',async t=>{
  const f=await fixture(t,1);assert.throws(()=>validatePlan({...f.plan,steps:[{...f.plan.steps[0],snapshot:'restore',captureStep:'later'}]}));
  await symlink(resolve(f.root,'package'),resolve(f.root,'linked'));f.plan.steps[0].package='linked';
  await writeFile(resolve(f.root,'plan.json'),JSON.stringify(f.plan));await assert.rejects(runCampaign(f.options),/Symlink/);
  f.plan.steps[0].package='artifacts';await writeFile(resolve(f.root,'plan.json'),JSON.stringify(f.plan));
  await assert.rejects(runCampaign(f.options),/overlaps/);
});

test('production validation rejects a status-only report',async t=>{
  const f=await fixture(t,1),path=resolve(f.root,'fake.json');await writeFile(path,JSON.stringify({schema:1,status:'passed',protocol:'defuss-m1-v1',mode:'baseline',snapshotMode:'capture',samplePeriod:257}));
  await assert.rejects(validateResult({root:f.root,reportPath:path,step:f.plan.steps[0],request:{},frozen:{}}));
});

test('generated validation evidence is excluded from automatic sources but explicit inputs are pinned',async t=>{
  const f=await fixture(t,1),source='packaging/bun-app';
  await mkdir(resolve(f.root,source,'validation'),{recursive:true});
  await writeFile(resolve(f.root,source,'vm.mjs'),'source');await writeFile(resolve(f.root,source,'validation/report.json'),'generated');
  const path=resolve(f.root,'plan.json');
  const automatic=await fingerprint(f.root,path,f.plan,[source]);
  assert.ok(automatic[source+'/vm.mjs']);assert.equal(automatic[source+'/validation/report.json'],undefined);
  const explicit=await fingerprint(f.root,path,{...f.plan,inputs:[...f.plan.inputs,source+'/validation/report.json']},[source]);
  assert.ok(explicit[source+'/validation/report.json']);
});

test('code capture verifies bytes/digests and preserves honest unresolved rows',()=>{
  const row={status:'captured',bytesRequested:2,hex:'abcd',sha256:sha(Buffer.from('abcd','hex')),segments:[{hex:'abcd',bytes:2}]};
  const capture={schema:1,status:'partial',captured:1,unresolved:1,rows:[row,{status:'unresolved',error:{code:'not-present'}}]};
  assert.doesNotThrow(()=>validateCodeCapture(capture));
  assert.doesNotThrow(()=>validateCodeCapture({schema:1,status:'unresolved',rows:[],error:{code:'unsupported-mode'}}));
  assert.doesNotThrow(()=>validateCodeCapture({schema:1,status:'no-candidates',rows:[],captured:0,unresolved:0}));
  assert.throws(()=>validateCodeCapture({...capture,rows:[{...row,sha256:'0'.repeat(64)}]}),/digest/);
  assert.throws(()=>validateCodeCapture({...capture,rows:[{...row,segments:[{hex:'abab',bytes:2}]}]}),/segments/);
});

test('stale recovery refuses an unclosed live child and preserves original lock',async t=>{
  const f=await fixture(t,1),attempt=resolve(f.root,'artifacts/campaign/attempts/interrupted');await mkdir(attempt,{recursive:true});
  const dead=spawnSync(process.execPath,['-e','']);assert.equal(dead.status,0);
  const lock={token:'child-test',pid:dead.pid,host:hostname(),output:'artifacts/campaign'};
  await durableNew(resolve(f.root,'artifacts/.m1-campaign.lock'),JSON.stringify(lock));
  await durableNew(resolve(attempt,'spawned.json'),JSON.stringify({pid:process.pid}));
  await assert.rejects(recoverLock(f.root,lock.token,true),/child PID is alive/);
  assert.deepEqual(await parse(resolve(f.root,'artifacts/.m1-campaign.lock')),lock);
});
