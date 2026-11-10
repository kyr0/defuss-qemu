#!/usr/bin/env node
// A shared-capture diagnostic comparison, never independent performance evidence.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {loadReport,commonHashes,profileCoverage,requireTimingObservation} from './analyze.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(a,b,message)=>assert.deepEqual(canonical(a),canonical(b),message);
const keyFields=['pc','context','flags','cflags','tier','privilege'];
const key=value=>Object.fromEntries(keyFields.map(field=>[field,value[field]]));
const identity=(row,table)=>JSON.stringify(table==='pcs'?key(row):[key(row.from),key(row.to)]);
const count=value=>{
  assert.ok((typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)||
    (typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)),'Invalid exact count');
  const n=BigInt(value);assert.ok(n<=0xffffffffffffffffn,'Counter exceeds uint64');return n;
};

export function validatePair(capture,restore) {
  const c=capture.report,r=restore.report;
  requireTimingObservation(c);requireTimingObservation(r);
  assert.equal(c.mode,'profile-on');assert.equal(r.mode,'profile-on');
  assert.equal(c.snapshotMode,'capture');assert.equal(r.snapshotMode,'restore');
  assert.notEqual(c.samplePeriod,r.samplePeriod,'Sensitivity comparison requires different sampling periods');
  equal(c.manifest,r.manifest,'Capture/restore package differs');
  assert.equal(c.browser,r.browser,'Browser changed');
  for(const field of ['platform','arch','release','logicalCPUs','totalMemoryBytes'])
    assert.equal(c.host[field],r.host[field],`Host ${field} changed`);
  equal(commonHashes(capture),commonHashes(restore),'Diagnostic harness/source changed');
  equal(c.snapshot,r.snapshot,'Snapshot bytes or file identity changed');
  assert.equal(r.captureReport.sha256,capture.artifacts.find(row=>row.kind==='raw-report').sha256,
    'Restore references a different capture report');
  return true;
}

// Shares describe the deterministic sampled stream only. A missing table key
// has no reported bound: replacement can evict it, so absence is never zero.
export function compareTables(captureProfile,restoreProfile,table,limit=20) {
  assert.ok(['pcs','edges'].includes(table));assert.ok(Number.isSafeInteger(limit)&&limit>0&&limit<=2048);
  const sampleCounter=table==='pcs'?'pcSamples':'edgeSamples';
  const indexes=[captureProfile,restoreProfile].map(profile=>new Map(profile[table].map(row=>[identity(row,table),row])));
  const selected=new Map();
  for(const profile of [captureProfile,restoreProfile]){
    const sorted=profile[table].slice().sort((a,b)=>{
      const x=count(a.samplesEstimate),y=count(b.samplesEstimate);return x===y?identity(a,table).localeCompare(identity(b,table)):x>y?-1:1;
    });
    for(const row of sorted.slice(0,limit))selected.set(identity(row,table),row);
  }
  const side=(profile,index,id)=>{
    const row=index.get(id),denominator=count(profile.counters[sampleCounter]);
    if(!row)return {status:'absent-from-bounded-table',sampleDenominator:profile.counters[sampleCounter],shareLower:null,shareUpper:null};
    const lower=count(row.samplesLowerBound),upper=count(row.samplesEstimate);
    assert.ok(denominator>0n&&lower<=upper&&upper<=denominator,'Invalid represented sample share');
    return {status:'represented',sampleDenominator:profile.counters[sampleCounter],
      samplesLowerBound:row.samplesLowerBound,samplesEstimate:row.samplesEstimate,samplesError:row.samplesError,
      shareLower:Number(lower)/Number(denominator),shareUpper:Number(upper)/Number(denominator)};
  };
  return [...selected].map(([id,row])=>({key:table==='pcs'?key(row):{from:key(row.from),to:key(row.to)},
    capture:side(captureProfile,indexes[0],id),restore:side(restoreProfile,indexes[1],id)}));
}

const limitations=[
  'The restored run reuses this capture and adds another warmup and workload sequence. It is not an independent capture or a controlled sampling-period-only experiment.',
  'Normalized lower/upper shares divide table replacement bounds by the observed PC or edge sample count of that phase. They describe the deterministic sampled stream, not retired instructions, CPU time, random-sampling confidence intervals, or true population shares.',
  'Counts remain exact integers or decimal strings; normalized shares are approximate floating-point values. Sampling periods are not multiplied into population estimates.',
  'Absent keys may have been evicted and are never assigned zero or a fabricated bound. The union selects up to 20 highest-estimate keys from each run per phase, then looks them up in each full bounded table.',
  'Matching PC/context/flags/tier keys establish address-key recurrence only. Map captures do not prove process identity, JIT tier, unchanged code bytes, or code generation across either run.',
  'Every batch remains separate; approximate table counts are not summed across phases. Timing differences include evolving VM/JIT/pool/scheduler state and are not attributed to sampling period.',
];

export async function analyzeSensitivity({capture:cp,restore:rp}) {
  const capture=await loadReport(cp,'profile-on'),restore=await loadReport(rp,'profile-on');
  validatePair(capture,restore);
  const phases=run=>[run.report.browserResult.warmup,...run.report.browserResult.results];
  const left=phases(capture),right=phases(restore);
  assert.equal(left.length,right.length,'Phase count changed');
  const diagnostics=left.map((c,i)=>{
    const r=right[i];equal([c.name,c.sample,c.iterations],[r.name,r.sample,r.iterations],'Phase order changed');
    const pc=c.counters.profile,pr=r.counters.profile;
    assert.equal(pc.pcAddressingRevision??0,pr.pcAddressingRevision??0,'PC-addressing revision changed');
    return {name:c.name,sample:c.sample,iterations:c.iterations,
      capture:{period:pc.period,hostMs:c.hostMs,coverage:profileCoverage(pc),counters:pc.counters},
      restore:{period:pr.period,hostMs:r.hostMs,coverage:profileCoverage(pr),counters:pr.counters},
      pcs:compareTables(pc,pr,'pcs'),edges:compareTables(pc,pr,'edges')};
  });
  const artifacts=[...capture.artifacts,...restore.artifacts];
  return {schema:1,status:'passed',createdUtc:new Date().toISOString(),
    scope:'Shared-capture exploratory deterministic sampling sensitivity and restore validation; no statistical inference or promotion',
    capturePeriod:capture.report.samplePeriod,restorePeriod:restore.report.samplePeriod,
    bundleSha256:capture.report.manifest.appSha256,browser:capture.report.browser,
    dependency:{independentCaptures:1,freshBrowserProcesses:2,restoreReferencesCaptureSha256:restore.report.captureReport.sha256,
      snapshotSha256:capture.report.snapshot.sha256},
    artifacts:[...new Map(artifacts.map(row=>[row.path+'\0'+row.sha256,row])).values()],
    analyzerInputs:Object.fromEntries(await Promise.all(['sensitivity.mjs','analyze.mjs','maps.mjs'].map(async name=>[name,sha(await readFile(resolve(here,name)))]))),
    diagnostics,limitations};
}

export function markdown(report) {
  const lines=['# M1 restore and sampling sensitivity','',
    `Capture period ${report.capturePeriod}; fresh-browser restore period ${report.restorePeriod}. Both passed workload/protocol validation and reference the same snapshot.`,
    '','This is one shared capture. Another warmup and workload sequence runs after restoration; differences cannot be attributed solely to the sampling period.','',
    '| Phase/sample | Capture known entries | Restore known entries | Capture PC/edge rows | Restore PC/edge rows |',
    '|---|---:|---:|---:|---:|'];
  for(const row of report.diagnostics){const c=row.capture.coverage,r=row.restore.coverage;
    lines.push(`| ${row.name}/${row.sample??'warmup'} | ${c.knownPcEntries} | ${r.knownPcEntries} | ${c.pcTableRows}/${c.edgeTableRows} | ${r.pcTableRows}/${r.edgeTableRows} |`);
  }
  lines.push('','The JSON report retains separate per-phase address-key comparisons and represented-key replacement bounds normalized to each sampled stream. Missing keys are unknown, not zero.','',...report.limitations.map(value=>'- '+value),'');
  return lines.join('\n');
}

async function main() {
  const {values}=parseArgs({options:{capture:{type:'string'},restore:{type:'string'},output:{type:'string'}}});
  for(const name of ['capture','restore','output'])assert.ok(values[name],`--${name} is required`);
  const report=await analyzeSensitivity(values),output=resolve(values.output);
  await mkdir(dirname(output),{recursive:true});await mkdir(output);
  await writeFile(resolve(output,'analysis.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  await writeFile(resolve(output,'REPORT.md'),markdown(report),{flag:'wx'});
  console.log(JSON.stringify({status:report.status,output}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
