#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {loadReport,requireTimingObservation} from '../analysis/analyze.mjs';
import {validateResult} from './campaign.mjs';
import {comparePackages} from './plan.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=data=>createHash('sha256').update(data).digest('hex');
export const median=values=>{const a=[...values].sort((a,b)=>a-b),i=a.length>>1;return a.length%2?a[i]:(a[i-1]+a[i])/2;};
export function interval(ratios,{draws=50000,seed=20261107,alpha=.01}={}){
 assert.ok(ratios.length>=2&&ratios.every(x=>Number.isFinite(x)&&x>0));
 const logs=ratios.map(Math.log),samples=[];let state=seed>>>0;
 const rng=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
 for(let i=0;i<draws;i++){let total=0;for(let j=0;j<logs.length;j++)total+=logs[Math.floor(rng()*logs.length)];samples.push(total/logs.length);}
 samples.sort((a,b)=>a-b);const quantile=p=>samples[Math.min(samples.length-1,Math.floor(p*(samples.length-1)))];
 return {geometricMean:Math.exp(logs.reduce((a,b)=>a+b,0)/logs.length),lower:Math.exp(quantile(alpha/2)),upper:Math.exp(quantile(1-alpha/2)),
  oneSidedUpper:Math.exp(quantile(1-alpha)),draws,seed,alpha,method:'Percentile bootstrap of whole paired log-ratios; nested batches are not resampled as independent observations'};
}
export function endpointSummary(pairs,name,plan){
 const ratios=pairs.map(pair=>pair.candidate[name]/pair.control[name]);
 const geometricMean=Math.exp(ratios.map(Math.log).reduce((a,b)=>a+b,0)/ratios.length);
 const alpha=plan.service?.includes(name)?0.01/2:(name===plan.primary||name==='ready')?0.01:0.01/3;
 return {ratios,geometricMean,...(plan.kind==='confirmation'?{interval:interval(ratios,{draws:plan.bootstrapDraws,seed:plan.bootstrapSeed,alpha})}:{} )};
}
export async function analyze(campaign){
 const output=resolve(root,campaign),frozen=JSON.parse(await readFile(resolve(output,'frozen.json'))),plan=frozen.plan;
 const frozenSha=sha(await readFile(resolve(output,'frozen.json')));
 for(const name of ['analyze.mjs','campaign.mjs','plan.mjs'])assert.equal(sha(await readFile(resolve(root,'benchmarks/harness/m2',name))),frozen.files['benchmarks/harness/m2/'+name]?.sha256,'Analyzer source differs from frozen campaign');
 assert.equal(plan.experiment,'sha256msg2-v1');assert.ok(['screen','confirmation'].includes(plan.kind));
 assert.equal(sha(await readFile(resolve(output,'plan.json'))),frozen.planSha256);
 comparePackages(plan.packages.control.manifest,plan.packages.candidate.manifest);
 const reports=[],nonces=new Set(),pairs=new Map();
 for(const step of plan.steps){
  let accepted=null;
  for(const folder of await readdir(resolve(output,'attempts'))){
   const dir=resolve(output,'attempts',folder);let request,record;
   try{request=JSON.parse(await readFile(resolve(dir,'request.json')));record=JSON.parse(await readFile(resolve(dir,'accepted.json')));}catch(error){if(error.code==='ENOENT')continue;throw error;}
   if(request.stepId!==step.id)continue;assert.equal(accepted,null,'Multiple accepted attempts for one step');
   assert.equal(request.freezeSha256,frozenSha,'Attempt freeze identity differs');
   const exit=JSON.parse(await readFile(resolve(dir,'exit.json')));assert.equal(exit.code,0,'Failed child cannot enter analysis');
   const result=await validateResult({root,reportPath:resolve(dir,'run/report.json'),step,request,frozen});assert.equal(result.reportSha256,record.reportSha256);
   assert.equal(sha(await readFile(resolve(dir,'request.json'))),record.requestSha256);accepted={dir,request,record};
  }
  assert.ok(accepted,'Missing accepted step '+step.id);
  const loaded=await loadReport(resolve(accepted.dir,'run/report.json'),'baseline'),r=loaded.report;requireTimingObservation(r);
  assert.deepEqual(r.manifest,plan.packages[step.enabled?'candidate':'control'].manifest,'Manifest differs from planned mode');
  assert.equal(r.snapshotMode,'capture');const nonce=loaded.events.find(e=>e.event==='resumed').nonce;
  assert.ok(!nonces.has(nonce),'Capture identity reused');nonces.add(nonce);
  if(plan.selection)assert.ok(!plan.selection.captureNonces.includes(nonce),'Screen capture reused in confirmation');
  const observed={ready:r.browserResult.startup.readyHostMs};
  const gates=r.browserResult.calibration.map(row=>row.hostMs).sort((a,b)=>a-b);
  observed.emptyGateP95=gates[Math.ceil(.95*gates.length)-1];
  observed.resultStopMaxMs=Math.max(...r.browserResult.results.map(row=>row.resultToStopMs));
  for(const name of [plan.primary,...plan.secondary])observed[name]=median(r.browserResult.results.filter(row=>row.name===name).map(row=>row.hostMs));
  const stats=[r.browserResult.warmup,...r.browserResult.results].map(row=>row.runtimeStats?.jitPool);
  assert.ok(stats.every(s=>s&&s.limit===12000&&s.charged<=s.limit&&s.linearMemoryBytes>0),'Missing/breached resource observations');
  observed.peakObservedLinearMemoryBytes=Math.max(...stats.map(s=>s.linearMemoryBytes));observed.peakObservedChargedInstances=Math.max(...stats.map(s=>s.charged));
  const group=pairs.get(step.pair)??{pair:step.pair};assert.equal(group[step.enabled?'candidate':'control'],undefined);group[step.enabled?'candidate':'control']=observed;pairs.set(step.pair,group);
  reports.push({stepId:step.id,path:resolve(accepted.dir,'run/report.json'),sha256:accepted.record.reportSha256,nonce,browser:r.browser,host:r.host,observed});
 }
 const units=[...pairs.values()];assert.equal(units.length,plan.pairs);assert.ok(units.every(x=>x.control&&x.candidate));
 for(const report of reports){assert.equal(report.browser,reports[0].browser);for(const field of ['platform','arch','release','logicalCPUs','totalMemoryBytes'])assert.equal(report.host[field],reports[0].host[field]);}
 const endpoints=Object.fromEntries([plan.primary,...plan.secondary,'ready',...plan.service].map(name=>[name,endpointSummary(units,name,plan)]));
 const memoryRatios=units.map(p=>p.candidate.peakObservedLinearMemoryBytes/p.control.peakObservedLinearMemoryBytes);
 const selected=plan.kind==='screen'&&endpoints[plan.primary].geometricMean<plan.primaryUpperRatio&&plan.secondary.every(n=>endpoints[n].geometricMean<plan.secondaryUpperRatio);
 const confirmationPassed=plan.kind==='confirmation'&&endpoints[plan.primary].interval.upper<plan.primaryUpperRatio&&
  plan.secondary.every(n=>endpoints[n].interval.oneSidedUpper<plan.secondaryUpperRatio)&&endpoints.ready.interval.oneSidedUpper<plan.readyUpperRatio&&Math.max(...memoryRatios)<=plan.memoryUpperRatio&&plan.service.every(n=>endpoints[n].interval.oneSidedUpper<plan.serviceUpperRatio);
 return {schema:1,status:'passed',kind:plan.kind,createdUtc:new Date().toISOString(),sourceCampaign:campaign,frozenSha256:sha(await readFile(resolve(output,'frozen.json'))),
  packages:plan.packages,plan,pairs:units,reports,captureNonces:[...nonces],endpoints,memoryRatios,selected,confirmationPassed,productPromotionEligible:false,
  resourceCoverage:{runtimeArtifactBytes:Object.fromEntries(Object.entries(plan.packages.control.manifest.artifacts).filter(([name])=>name.startsWith('runtime/')).map(([name,info])=>[name,info.bytes])),
   linearMemory:'Phase-boundary observations only; not host peak memory',generatedCodeBytes:'Unmeasured; declared1.10 ratio budget not verified',service:'Bounded ACK/stop control proxies only; not a worst-case guest service latency proof'},
  analyzerSha256:sha(await readFile(fileURLToPath(import.meta.url))),scope:'candidate/control paired fresh-capture elapsed ratios. Screen and confirmation remain separate; statistical gate is not product promotion.'};
}
async function main(){
 const {values}=parseArgs({options:{campaign:{type:'string'},output:{type:'string'}}});assert.ok(values.campaign&&values.output);
 const r=await analyze(values.campaign),output=resolve(values.output);await mkdir(output);
 await writeFile(resolve(output,'analysis.json'),JSON.stringify(r,null,2)+'\n',{flag:'wx'});
 const lines=['# M2 SHA256MSG2 '+r.kind,'',`Paired captures: ${r.pairs.length}. Candidate/control ratios below1 mean faster. Screening selected: ${r.selected}. Confirmation gates passed: ${r.confirmationPassed}.`,'',
 '| Endpoint | Geometric ratio | Confidence interval |','|---|---:|---|'];
 for(const [name,e] of Object.entries(r.endpoints))lines.push(`| ${name} | ${e.geometricMean.toFixed(4)} | ${e.interval?e.interval.lower.toFixed(4)+'–'+e.interval.upper.toFixed(4):'Descriptive screen only'} |`);
 lines.push('','Secondary regression decisions use their Bonferroni one-sided upper bounds retained in JSON. All raw batches, calibration and startup scopes remain in the original reports. No observations were excluded.','');
 await writeFile(resolve(output,'REPORT.md'),lines.join('\n'),{flag:'wx'});console.log(JSON.stringify({status:r.status,selected:r.selected,confirmationPassed:r.confirmationPassed,output}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
