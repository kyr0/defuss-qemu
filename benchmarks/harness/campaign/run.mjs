#!/usr/bin/env node
// Durable orchestration only. The existing M1 runner owns one browser/guest.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {open,mkdir,readFile,readdir,lstat,realpath,unlink,rename} from 'node:fs/promises';
import {hostname} from 'node:os';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {loadReport} from '../analysis/analyze.mjs';
import {snapshotKey,canonical} from '../../../packaging/bun-app/snapshots.mjs';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sources=['benchmarks/harness/m1','benchmarks/harness/analysis','benchmarks/harness/campaign','benchmarks/harness/code',
  'benchmarks/workload','benchmarks/expected.json','host/browser','packaging/bun-app',
  'experiments/m1-profile','manifests/runtime-baseline.json','package.json','package-lock.json'];
// Generated evidence is not source. An explicit plan.inputs entry can pin it.
const generatedSourcePaths=new Set(['packaging/bun-app/validation','experiments/m1-profile/native-validation.json']);
const json=value=>JSON.stringify(value,null,2)+'\n';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async path=>{try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const within=(root,path)=>path.startsWith(root+sep);
function inside(root,value){assert.equal(typeof value,'string');const path=resolve(root,value);assert.ok(within(root,path),'Path must be inside project: '+value);return path;}
async function safePath(root,path){
  let cursor=path;
  while(cursor!==root){
    if(await exists(cursor)){assert.ok(!(await lstat(cursor)).isSymbolicLink(),'Symlink path refused: '+cursor);}
    cursor=dirname(cursor);assert.ok(cursor===root||within(root,cursor),'Path escaped project');
  }
}
async function syncDirectory(path){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
export async function durableNew(path,data){
  const file=await open(path,'wx');
  try{await file.writeFile(data);await file.sync();}finally{await file.close();}
  await syncDirectory(dirname(path));
}
async function newDirectory(path){await mkdir(path);await syncDirectory(dirname(path));}
async function identity(path){const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path)){hash.update(chunk);bytes+=chunk.length;}return {sha256:hash.digest('hex'),bytes};}

export function validatePlan(plan){
  assert.equal(plan.schema,1);assert.match(plan.id,/^[a-z0-9][a-z0-9-]{0,79}$/);
  assert.ok(Array.isArray(plan.steps)&&plan.steps.length>0&&plan.steps.length<=100);
  assert.ok(Array.isArray(plan.inputs??[])&&(plan.inputs??[]).every(x=>typeof x==='string'));
  const prior=new Map();
  for(const step of plan.steps){
    assert.match(step.id,/^[a-z0-9][a-z0-9-]{0,79}$/);assert.ok(!prior.has(step.id),'Duplicate step');
    assert.ok(['baseline','profile-off','profile-on'].includes(step.mode));assert.equal(typeof step.package,'string');
    assert.ok(['capture','restore'].includes(step.snapshot));
    assert.ok(Number.isSafeInteger(step.samplePeriod)&&step.samplePeriod>=1&&step.samplePeriod<=65536);
    assert.ok(Number.isSafeInteger(step.timeoutMs)&&step.timeoutMs>=1000&&step.timeoutMs<=1800000);
    assert.ok(step.captureCode===undefined||typeof step.captureCode==='boolean','captureCode must be boolean');
    if(step.captureCode)assert.equal(step.mode,'profile-on','Code capture requires enabled diagnostics');
    if(step.snapshot==='restore'){
      const capture=prior.get(step.captureStep);assert.ok(capture&&capture.snapshot==='capture','Restore needs an earlier capture step');
      assert.equal(capture.package,step.package,'Restore package differs');
    }else assert.equal(step.captureStep,undefined,'Capture cannot reference a capture step');
    prior.set(step.id,step);
  }
  return plan;
}

export async function fingerprint(root,planPath,plan,sourcePaths=sources){
  const files={};
  async function visit(path,sourceOnly=false){
    if(sourceOnly&&generatedSourcePaths.has(relative(root,path)))return;
    await safePath(root,path);const info=await lstat(path);
    if(info.isDirectory()){
      for(const name of (await readdir(path)).sort())if(!['__pycache__','.DS_Store'].includes(name))await visit(resolve(path,name),sourceOnly);
    }else {assert.ok(info.isFile(),'Only regular input files allowed');files[relative(root,path)]=await identity(path);}
  }
  for(const name of sourcePaths)await visit(inside(root,name),true);
  for(const name of new Set([relative(root,planPath),...(plan.inputs??[]),...plan.steps.map(x=>x.package)]))await visit(inside(root,name));
  return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
async function environment(){
  const {chromium}=await import('playwright');
  const chrome=resolve(process.env.DEFUSS_VM_CHROME||chromium.executablePath());
  return {node:process.execPath,nodeVersion:process.version,nodeIdentity:await identity(process.execPath),
    chrome,chromeIdentity:await identity(chrome),nodeOptions:process.env.NODE_OPTIONS??null};
}

function alive(pid){
  assert.ok(Number.isSafeInteger(pid)&&pid>0,'Invalid lock PID');
  try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}
}
export async function recoverLock(root,token,confirmed){
  assert.equal(confirmed,true,'Recovery requires --confirm-owned-processes-stopped after checking owned descendants');
  const path=resolve(root,'artifacts/.m1-campaign.lock'),guard=path+'.recovery';
  // Serialize recoverers too, so a second recovery cannot rename a new owner's lock.
  await durableNew(guard,json({pid:process.pid,host:hostname(),utc:new Date().toISOString()}));
  try{
  const bytes=await readFile(path),owner=JSON.parse(bytes);
  assert.equal(owner.token,token,'Lock token differs');assert.equal(owner.host,hostname(),'Foreign-host lock requires manual inspection');
  assert.equal(alive(owner.pid),false,'Lock owner is still alive (or PID reused)');
  const output=inside(root,owner.output);await safePath(root,output);
  if(await exists(resolve(output,'attempts')))for(const name of await readdir(resolve(output,'attempts'))){
    const path=resolve(output,'attempts',name,'spawned.json');
    if(await exists(path)){
      const child=await readJSON(path);
      // Completed children are proven closed; old PIDs can otherwise be reused.
      if(!await exists(resolve(dirname(path),'exit.json')))assert.equal(alive(child.pid),false,'An unclosed child PID is alive (or reused)');
    }
  }
  assert.deepEqual(await readFile(path),bytes,'Lock changed during recovery');
  await rename(path,path+'.recovered-'+randomUUID());await syncDirectory(dirname(path));
  }finally{await unlink(guard);await syncDirectory(dirname(guard));}
}

export async function execute(command,{cwd,attempt}){
  const log=await open(resolve(attempt,'child.log'),'wx');
  let child,error,publishError;
  try{
    child=spawn(command[0],command.slice(1),{cwd,stdio:['ignore',log.fd,log.fd]});
    const closed=new Promise(ok=>{child.once('error',e=>{error=String(e);});child.once('close',(code,signal)=>ok({code,signal,error:error??null}));});
    // A crash before this record still leaves the pre-spawn request and lock.
    if(child.pid)try{await durableNew(resolve(attempt,'spawned.json'),json({pid:child.pid,utc:new Date().toISOString()}));}catch(e){publishError=e;}
    const result=await closed;await log.sync();
    if(publishError)throw publishError;return result;
  }finally{await log.close();}
}

export function validateCodeCapture(capture){
  assert.equal(capture?.schema,1);assert.ok(['captured','partial','unresolved','no-candidates'].includes(capture.status));
  assert.ok(Array.isArray(capture.rows)&&capture.rows.length<=16,'Unbounded code capture');
  for(const row of capture.rows){
    assert.ok(['captured','unresolved'].includes(row.status));
    if(row.status==='captured'){
      assert.ok(Number.isSafeInteger(row.bytesRequested)&&row.bytesRequested>=1&&row.bytesRequested<=256);
      assert.match(row.hex,/^[0-9a-f]+$/);assert.equal(row.hex.length,row.bytesRequested*2);
      assert.equal(digest(Buffer.from(row.hex,'hex')),row.sha256,'Captured code digest differs');
      assert.ok(Array.isArray(row.segments)&&row.segments.length>0&&row.segments.length<=2);
      for(const segment of row.segments){assert.match(segment.hex,/^[0-9a-f]+$/);assert.equal(segment.hex.length,segment.bytes*2);}
      assert.equal(row.segments.map(segment=>segment.hex).join(''),row.hex,'Captured segments differ');
    }
  }
  const captured=capture.rows.filter(row=>row.status==='captured').length;
  if(capture.status!=='unresolved'){
    assert.equal(capture.captured,captured);assert.equal(capture.unresolved,capture.rows.length-captured);
    assert.equal(capture.status,capture.rows.length===0?'no-candidates':captured===capture.rows.length?'captured':'partial');
  }
}

export async function validateResult({root,reportPath,step,request,frozen}){
  const loaded=await loadReport(reportPath,step.mode),report=loaded.report;
  assert.equal(report.snapshotMode,step.snapshot);assert.equal(report.samplePeriod,step.samplePeriod);
  assert.equal(report.captureCode??false,step.captureCode??false,'Code-capture option differs');
  assert.equal(report.browserResult.captureCode??false,step.captureCode??false,'Browser code-capture option differs');
  if(step.captureCode)for(const row of [report.browserResult.warmup,...report.browserResult.results])validateCodeCapture(row.codeCapture);
  assert.equal(report.timeoutMs,step.timeoutMs);assert.equal(report.package,step.package);
  assert.equal(report.cache,request.cache);
  const manifest=await readJSON(inside(root,step.package+'/app.json'));assert.deepEqual(report.manifest,manifest);
  for(const [path,hash] of Object.entries({...report.inputHashes,...report.servedHashes})){
    assert.equal(frozen.files[path]?.sha256,hash,'Report input was not frozen or differs: '+path);
  }
  if(step.snapshot==='restore'){
    assert.equal(report.captureReport.path,request.captureReport);assert.equal(report.captureReport.sha256,request.captureReportSha256);
  }
  const snapshot=inside(root,report.cache+'/'+snapshotKey(manifest)+'.snapshot');await safePath(root,snapshot);
  assert.deepEqual(await identity(snapshot),{sha256:report.snapshot.sha256,bytes:report.snapshot.bytes},'Snapshot changed');
  return {reportSha256:(await identity(reportPath)).sha256};
}

export async function runCampaign({root=project,planPath,output,runChild=execute,validate=validateResult,
  sourcePaths=sources,getEnvironment=environment,onProgress=console.log}){
  root=await realpath(root);planPath=inside(root,planPath);output=inside(root,output);
  assert.ok(within(resolve(root,'artifacts'),output),'Campaign output belongs under artifacts/');
  await safePath(root,planPath);await safePath(root,output);
  const planBytes=await readFile(planPath),plan=validatePlan(JSON.parse(planBytes));
  for(const input of [...sourcePaths,...(plan.inputs??[]),...plan.steps.map(x=>x.package)]){
    const path=inside(root,input);assert.ok(path!==output&&!within(path,output)&&!within(output,path),'Campaign output overlaps an input');
  }
  const lockPath=resolve(root,'artifacts/.m1-campaign.lock');await mkdir(dirname(lockPath),{recursive:true});
  const owner={schema:1,token:randomUUID(),pid:process.pid,host:hostname(),output:relative(root,output),utc:new Date().toISOString()};
  try{await durableNew(lockPath,json(owner));}catch(e){
    if(e.code==='EEXIST')throw Error('M1 campaign lock exists; no automatic stale recovery. Inspect '+lockPath);throw e;
  }
  let release=true;
  try{
    const current={schema:1,planSha256:digest(planBytes),plan,environment:await getEnvironment(),files:await fingerprint(root,planPath,plan,sourcePaths)};
    const freezePath=resolve(output,'frozen.json');
    if(!await exists(output)){
      await mkdir(dirname(output),{recursive:true});await newDirectory(output);
      await durableNew(resolve(output,'plan.json'),planBytes);await durableNew(freezePath,json(current));
      await newDirectory(resolve(output,'attempts'));
    }else assert.ok(await exists(freezePath),'Incomplete campaign initialization; preserve it and choose a fresh output');
    const frozen=await readJSON(freezePath);assert.equal(canonical(frozen),canonical(current),'Frozen inputs/configuration changed; use a new campaign');
    const freezeSha=digest(await readFile(freezePath));
    const checkFrozen=async()=>{
      assert.equal(digest(await readFile(planPath)),frozen.planSha256,'Plan changed');
      assert.equal(canonical(await fingerprint(root,planPath,plan,sourcePaths)),canonical(frozen.files),'Frozen inputs changed');
      assert.equal(canonical(await getEnvironment()),canonical(frozen.environment),'Execution environment changed');
    };
    const completed=new Map(),attemptsPath=resolve(output,'attempts');
    for(const step of plan.steps){
      await checkFrozen();let accepted=null;
      for(const name of (await readdir(attemptsPath)).sort()){
        const attempt=resolve(attemptsPath,name);await safePath(root,attempt);
        if(!await exists(resolve(attempt,'request.json')))continue;
        const requestBytes=await readFile(resolve(attempt,'request.json')),request=JSON.parse(requestBytes);
        if(request.stepId!==step.id)continue;
        assert.equal(request.freezeSha256,freezeSha,'Attempt belongs to different frozen inputs');
        const reportPath=resolve(attempt,'run/report.json'),acceptPath=resolve(attempt,'accepted.json');
        const prior=await exists(acceptPath)?await readJSON(acceptPath):null;
        try{
          assert.equal(request.cache,step.snapshot==='capture'?relative(root,resolve(attempt,'run/snapshots')):completed.get(step.captureStep).request.cache,'Attempt cache differs');
          if(step.snapshot==='restore'){
            const capture=completed.get(step.captureStep);
            assert.equal(request.captureReport,relative(root,resolve(capture.attempt,'run/report.json')));
            assert.equal(request.captureReportSha256,capture.reportSha256);
          }
          if(await exists(resolve(attempt,'exit.json')))assert.equal((await readJSON(resolve(attempt,'exit.json'))).code,0,'Child failed');
          const checked=await validate({root,reportPath,step,request,frozen});
          if(prior){assert.equal(checked.reportSha256,prior.reportSha256,'Accepted report changed');assert.equal(digest(requestBytes),prior.requestSha256,'Accepted request changed');}
          else await durableNew(acceptPath,json({...checked,requestSha256:digest(requestBytes),recovered:true,utc:new Date().toISOString()}));
          accepted={attempt,request,...checked};break;
        }catch(e){if(prior)throw Error('Previously accepted evidence no longer validates: '+e.message);}
      }
      if(accepted){completed.set(step.id,accepted);onProgress(JSON.stringify({step:step.id,status:'resumed',report:resolve(accepted.attempt,'run/report.json')}));continue;}
      const attempt=resolve(attemptsPath,step.id+'-'+Date.now()+'-'+randomUUID());await newDirectory(attempt);
      const runOutput=relative(root,resolve(attempt,'run'));
      const command=[process.execPath,resolve(root,'benchmarks/harness/m1/run.mjs'),'--package',step.package,
        '--output',runOutput,'--mode',step.mode,'--snapshot',step.snapshot,'--sample-period',String(step.samplePeriod),'--timeout',String(step.timeoutMs)];
      if(step.captureCode)command.push('--capture-code');
      const request={schema:1,stepId:step.id,freezeSha256:freezeSha,utc:new Date().toISOString(),command,cache:runOutput+'/snapshots'};
      if(step.snapshot==='restore'){
        const capture=completed.get(step.captureStep);assert.ok(capture,'Capture step not completed');
        request.cache=capture.request.cache;request.captureReport=relative(root,resolve(capture.attempt,'run/report.json'));
        request.captureReportSha256=capture.reportSha256;
        command.push('--cache',request.cache,'--capture-report',request.captureReport);
      }
      await durableNew(resolve(attempt,'request.json'),json(request));
      onProgress(JSON.stringify({step:step.id,status:'started',attempt}));
      let exit;
      // If execution throws without proving close, retain lock for explicit recovery.
      try{exit=await runChild(command,{cwd:root,attempt});}catch(e){release=false;throw e;}
      await durableNew(resolve(attempt,'exit.json'),json({...exit,utc:new Date().toISOString()}));
      assert.equal(exit.code,0,'Child failed; attempt retained at '+attempt);
      await checkFrozen();
      const checked=await validate({root,reportPath:resolve(attempt,'run/report.json'),step,request,frozen});
      await durableNew(resolve(attempt,'accepted.json'),json({...checked,requestSha256:digest(await readFile(resolve(attempt,'request.json'))),recovered:false,utc:new Date().toISOString()}));
      completed.set(step.id,{attempt,request,...checked});onProgress(JSON.stringify({step:step.id,status:'passed'}));
    }
    return {status:'passed',campaign:output,steps:Object.fromEntries([...completed].map(([id,row])=>[id,relative(root,resolve(row.attempt,'run/report.json'))]))};
  }finally{
    if(release){assert.equal((await readJSON(lockPath)).token,owner.token,'Lock ownership changed');await unlink(lockPath);await syncDirectory(dirname(lockPath));}
  }
}

async function main(){
  const {values}=parseArgs({options:{plan:{type:'string'},output:{type:'string'},'recover-lock':{type:'string'},'confirm-owned-processes-stopped':{type:'boolean',default:false}}});
  if(values['recover-lock']){await recoverLock(project,values['recover-lock'],values['confirm-owned-processes-stopped']);console.log('Stale lock archived; invoke the campaign again to resume.');return;}
  assert.ok(values.plan&&values.output,'Usage: run.mjs --plan project-relative.json --output artifacts/fresh-campaign');
  console.log(json(await runCampaign({planPath:values.plan,output:values.output})));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
