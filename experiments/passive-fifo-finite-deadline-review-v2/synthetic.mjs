// Synthetic orchestration fixtures only. No browser/guest/build is launched.
import {readFile,writeFile,mkdir,mkdtemp,cp,readdir} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {makeExecutionPolicy,executionPolicyRule,orchestration} from '../../benchmarks/harness/passive-fifo-finite-deadline-v2/execution-policy.mjs';
import {analyze} from '../../benchmarks/harness/passive-fifo-finite-deadline-v2/analyze.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),sha=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>JSON.parse(await readFile(p)),write=async(p,v)=>{await mkdir(dirname(p),{recursive:true});await writeFile(p,JSON.stringify(v,null,2)+'\n');};
const fixture=spawnSync(process.execPath,['experiments/passive-fifo-finite-review/synthetic.mjs'],{cwd:root,encoding:'utf8'});if(fixture.status!==0)throw Error(fixture.stderr);const old=JSON.parse(fixture.stdout);
const scratch=await mkdtemp(resolve(root,'tmp/deadline-v2-fixture-')),oldCampaign=resolve(root,old.exploration.directory),original=await read(resolve(oldCampaign,'plan.json')),originalPath=resolve(scratch,'original-plan.json');await write(originalPath,original);
const ref=async path=>({path:relative(root,path),sha256:sha(await readFile(path))});
const preserved=resolve(scratch,'preserved-invalid-set01');await mkdir(preserved);await write(resolve(preserved,'frozen.json'),{schema:1,planSha256:(await ref(originalPath)).sha256,plan:original});await write(resolve(preserved,'invalid-completed-observation.json'),{schema:1,utc:'2026-11-07T00:40:00Z',attempt:relative(root,preserved)+'/attempts/failed',reason:'Campaign acceptance is permanently invalid; synthetic non-evidence record.'});
const oldPlans=[resolve(scratch,'old-02.json'),resolve(scratch,'old-03.json')];for(const p of oldPlans)await write(p,original);
const declarationPath=resolve(scratch,'declaration.json');await write(declarationPath,{schema:1,createdUtc:'2026-11-07T00:20:00Z',protocol:original.protocol,originalPlan:await ref(originalPath),repetitions:[{number:1,plan:relative(root,originalPath),campaign:relative(root,preserved),analysis:relative(root,resolve(scratch,'old-analysis01')),review:relative(root,resolve(scratch,'old-review01'))},...[2,3].map((number,i)=>({number,plan:relative(root,oldPlans[i]),campaign:relative(root,resolve(scratch,'old-campaign'+number)),analysis:relative(root,resolve(scratch,'old-analysis'+number)),review:relative(root,resolve(scratch,'old-review'+number))}))]});
const results=[];
for(const timeoutMs of [600000,1800000]){
 const base=resolve(scratch,String(timeoutMs));await mkdir(base);const repetition=timeoutMs===600000?2:3;
 const reps=[2,3].map(number=>({number,plan:relative(root,resolve(base,'plan-'+number+'.json')),campaign:relative(root,resolve(base,'campaign-'+number)),analysis:relative(root,resolve(base,'analysis-'+number)),review:relative(root,resolve(base,'review-'+number))}));const named=reps.find(r=>r.number===repetition),output=resolve(root,named.campaign),planPath=resolve(root,named.plan);
 const amendmentPath=resolve(base,'amendment.json');await write(amendmentPath,{schema:1,kind:'passive-fifo-finite-deadline-amendment',status:'prospective-declared',createdUtc:'2026-11-07T00:50:00Z',protocol:original.protocol,timeoutMs,hostGraceMs:20000,decision:{source:'assistant-default-after-unanswered-optional-clarification',explicitUserAnswer:false,timeoutMs},reporting:'all-retained-descriptive-only',originalPlan:await ref(originalPath),repetitionsDeclaration:await ref(declarationPath),preservedCampaign:{path:relative(root,preserved),frozenSha256:(await ref(resolve(preserved,'frozen.json'))).sha256,haltSha256:(await ref(resolve(preserved,'invalid-completed-observation.json'))).sha256},retainedPlans:await Promise.all(oldPlans.map(async(path,i)=>({number:i+2,...await ref(path)}))),repetitions:reps});
 const execution=await makeExecutionPolicy(root,relative(root,amendmentPath),repetition,timeoutMs,relative(root,planPath));
 const plan={...original,id:orchestration+'-repeat-'+repetition,createdUtc:'2026-11-07T01:00:00Z',orchestration,executionPolicyRule,executionPolicy:execution.policy,steps:original.steps.map(s=>({...s,timeoutMs})),inputs:[...new Set([...original.inputs,...execution.references])]};await write(planPath,plan);
 await cp(oldCampaign,output,{recursive:true});await write(resolve(output,'plan.json'),plan);const frozen=await read(resolve(output,'frozen.json'));frozen.plan=plan;frozen.planSha256=(await ref(planPath)).sha256;
 const add=async path=>{const b=await readFile(path);frozen.files[relative(root,path)]={sha256:sha(b),bytes:b.length};};
 for(const path of [planPath,...execution.references.map(p=>resolve(root,p))])await add(path);
 for(const directory of ['benchmarks/harness/passive-fifo-finite-deadline-v2','experiments/passive-fifo-finite-deadline-review-v2'])for(const name of await readdir(resolve(root,directory))){const path=resolve(root,directory,name);await add(path);}
 await write(resolve(output,'frozen.json'),frozen);const freezeSha=(await ref(resolve(output,'frozen.json'))).sha256;
 const shift=iso=>new Date(Date.parse(iso)+7200000).toISOString();
 for(const name of await readdir(resolve(output,'attempts'))){
  const attempt=resolve(output,'attempts',name),run=resolve(attempt,'run'),request=await read(resolve(attempt,'request.json')),raw=await read(resolve(run,'report.json')),marker=await read(resolve(run,'execution-start.json'));
  request.freezeSha256=freezeSha;request.utc=shift(request.utc);request.cache=relative(root,resolve(run,'snapshots'));request.command[3]=relative(root,planPath);request.command[7]=relative(root,run);request.command[request.command.length-1]=String(timeoutMs);
  marker.utc=shift(marker.utc);await write(resolve(run,'execution-start.json'),marker);raw.executionBoundary.recordSha256=(await ref(resolve(run,'execution-start.json'))).sha256;raw.createdUtc=shift(raw.createdUtc);raw.cache=request.cache;raw.timeoutMs=timeoutMs;
  raw.inputHashes=Object.fromEntries(Object.entries(frozen.files).map(([p,i])=>[p,i.sha256]));await write(resolve(run,'report.json'),raw);await write(resolve(attempt,'request.json'),request);
  for(const file of ['spawned.json','exit.json']){const r=await read(resolve(attempt,file));r.utc=shift(r.utc);await write(resolve(attempt,file),r);}
  const accepted=await read(resolve(attempt,'accepted.json'));accepted.utc=shift(accepted.utc);accepted.reportSha256=(await ref(resolve(run,'report.json'))).sha256;accepted.requestSha256=(await ref(resolve(attempt,'request.json'))).sha256;await write(resolve(attempt,'accepted.json'),accepted);
 }
 const analysis=await analyze(named.campaign);analysis.synthetic=true;const analysisPath=resolve(root,named.analysis+'.json');await write(analysisPath,analysis);results.push({timeoutMs,campaign:named.campaign,analysis:relative(root,analysisPath),plan:named.plan,amendment:relative(root,amendmentPath)});
}
console.log(JSON.stringify({scope:'Synthetic orchestration test files only; no actual policy timing or acceptance',scratch,results}));
