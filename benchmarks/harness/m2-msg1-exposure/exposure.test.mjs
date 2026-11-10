import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readExposure,validateExposure,exposureDelta,validateSelectedExposure,exposureProtocol,bankFields,configureExposure,requirePaused} from './exposure.mjs';
import {validatePhases,phasePartition} from './analyze.mjs';
import {loadReport} from '../analysis/analyze.mjs';

const row=(original,inline,fallback)=>({schema:1,...Object.fromEntries(bankFields.map((key,i)=>[key,String([original,inline,fallback][i])]))});
test('stopped memory reads retain uint64 precision and never reset counters',()=>{
  const memory=new SharedArrayBuffer(64),words=new BigUint64Array(memory,8,3);words.set([9007199254740997n,123n,9007199254740996n]);
  const calls=[],mod={_defuss_m2_msg1_counts:clear=>{calls.push(clear);return 8n;},pcProfileWords:()=>new Uint32Array(memory)};
  assert.deepEqual(readExposure(mod),row(9007199254740997n,123n,9007199254740996n));assert.deepEqual(calls,[0]);
  assert.throws(()=>readExposure({...mod,_defuss_m2_msg1_counts:()=>9n}),/pointer/);
  assert.throws(()=>readExposure({...mod,_defuss_m2_msg1_counts:()=>64n}),/pointer/);
  assert.throws(()=>readExposure({...mod,pcProfileWords:()=>new Uint32Array(16)}),/shared-memory/);
  assert.throws(()=>readExposure({...mod,_defuss_m2_msg1_counts:undefined}),/ABI/);
});
test('deltas partition helper and inline without double-counting compiled fallback',()=>{
  const delta=exposureDelta(row(9007199254740997n,10,9007199254740996n),row(9007199254741097n,50,9007199254741056n));
  assert.deepEqual(delta,{...row(100,40,60),interpretedHelperEntries:'40',allExecutions:'140'});
  assert.throws(()=>validateExposure(row(1,0,2)),/subset/);
  assert.throws(()=>validateExposure(row(2n**64n,0,0)),/uint64/);
  assert.throws(()=>validateExposure({...row(1,0,0),originalHelperEntries:1}),/decimal string/);
  assert.throws(()=>exposureDelta(row(10,4,1),row(9,4,1)),/decreased/);
  assert.throws(()=>exposureDelta(row(10,4,1),row(11,4,3)),/Phase fallback/);
});
test('selected exposure requires the compiled SHA path while JSON/HTTP may honestly be zero or positive',()=>{
  const delta=(...counts)=>exposureDelta(row(0,0,0),row(...counts));
  assert.equal(validateSelectedExposure(delta(100,200,0),true,{requireCompiled:true}),true);
  assert.equal(validateSelectedExposure(delta(300,0,200),false,{requireCompiled:true}),true);
  for(const enabled of [false,true])assert.equal(validateSelectedExposure(delta(0,0,0),enabled),true);
  assert.equal(validateSelectedExposure(delta(10,0,0),true),true);
  assert.throws(()=>validateSelectedExposure(delta(100,0,0),true,{requireCompiled:true}),/No selected compiled/);
  assert.throws(()=>validateSelectedExposure(delta(100,0,0),false,{requireCompiled:true}),/No selected compiled/);
  assert.throws(()=>validateSelectedExposure(delta(100,20,1),true),/fallback/);
  assert.throws(()=>validateSelectedExposure(delta(100,1,20),false),/Disabled/);
});
function phases(enabled){
  const initial=row(1000,0,0);let previous=initial;
  const result={exposureInitialized:initial,results:[]};
  const names=['warmup','integer','json','sha256','http','http','sha256','json','integer','json','sha256','http','integer'];
  for(const name of names){
    const counts=bankFields.map(key=>BigInt(previous[key]));
    if(['warmup','sha256'].includes(name)){counts[0]+=enabled?10n:100n;counts[enabled?1:2]+=90n;}
    const end=row(...counts),value={name,sample:null,iterations:null,counters:null,exposure:{begin:previous,end,delta:exposureDelta(previous,end)}};
    if(name==='warmup')result.warmup=value;else result.results.push(value);previous=end;
  }
  result.exposureComplete=previous;return result;
}
test('whole report phase accounting detects reset, tampered deltas and missing compiled SHA exposure',()=>{
  for(const enabled of [false,true])assert.equal(validatePhases(phases(enabled),enabled).length,13);
  const tampered=phases(true);tampered.results[0].exposure.delta.allExecutions='1';
  assert.throws(()=>validatePhases(tampered,true),/delta differs/);
  const reset=phases(true);reset.exposureComplete=row(0,0,0);assert.throws(()=>validatePhases(reset,true),/decreased/);
  const missing=phases(true),sha=missing.results.find(r=>r.name==='sha256');
  sha.exposure.end=sha.exposure.begin;sha.exposure.delta=exposureDelta(sha.exposure.begin,sha.exposure.end);
  assert.throws(()=>validatePhases(missing,true),/No selected compiled/);
  const forbiddenBoot=phases(false);forbiddenBoot.exposureInitialized.compiledInlineExecutions='1';
  assert.throws(()=>validatePhases(forbiddenBoot,false),/Disabled/);
});
test('diagnostic outer protocol is rejected by the existing timing report loader',async()=>{
  assert.ok(process.env.TMPDIR?.startsWith(process.cwd()+'/tmp/'));const scratch=process.env.TMPDIR;
  const dir=await mkdtemp(resolve(scratch,'m2-msg1-exposure-test-'));
  const path=resolve(dir,'report.json');await writeFile(path,JSON.stringify({schema:1,status:'passed',protocol:exposureProtocol}));
  await assert.rejects(()=>loadReport(path,'baseline'),/defuss-m[12]/);
  // Preserve project-local scratch so interruption/debugging never depends on /tmp.
});
test('isolated copied adapter provenance is exact and frozen source files were not edited',async()=>{
  const provenance=JSON.parse(await readFile(new URL('./adapter-provenance.json',import.meta.url)));
  const root=new URL('../../../',import.meta.url),sha=data=>createHash('sha256').update(data).digest('hex');
  for(const [name,record] of Object.entries(provenance.sources)){
    assert.equal(sha(await readFile(new URL(record.source,root))),record.sourceSha256);
    assert.equal(sha(await readFile(new URL(name,import.meta.url))),record.derivedSha256);
  }
});

test('isolated MSG1 selector is initially unchosen, single-use and never accepts another candidate',()=>{
 for(const enabled of [false,true]){
  let status=0x10000;const calls=[],mod={_defuss_m2_msg1_status:()=>status,_defuss_m2_msg1_counts:()=>8n,_defuss_m2_msg1_config:value=>{calls.push(value);status|=value?2:1;return 0;}};
  assert.deepEqual(configureExposure(mod,enabled),{before:0x10000,chosen:0x10000|(enabled?2:1),enabled,phase:'preRun-before-vCPU',diagnostic:true});assert.deepEqual(calls,[Number(enabled)]);
  assert.throws(()=>configureExposure(mod,enabled),/initially/);
 }
 for(const forbidden of ['_defuss_m2_msg2_config','_defuss_fifo_abi','_defuss_m3_region_config','_defuss_m1_abi']){
  const mod={_defuss_m2_msg1_status:()=>0x10000,_defuss_m2_msg1_counts:()=>8n,_defuss_m2_msg1_config:()=>0,[forbidden]:()=>0};assert.throws(()=>configureExposure(mod,true),/forbidden/);
 }
 assert.throws(()=>requirePaused({running:false,status:'prelaunch'}),/paused/);assert.throws(()=>requirePaused({running:true,status:'paused'}),/paused/);assert.equal(requirePaused({running:false,status:'paused'}).status,'paused');
});
test('exact boot/gap/tail conservation retains positive non-SHA observations without transferred MSG2 expectations',()=>{
 const b=phases(true);for(const r of [b.warmup,...b.results])r.startSeq=1;
 // Translate every boundary after the initialized read by a real gap increment.
 for(const r of [b.warmup,...b.results])for(const edge of ['begin','end'])r.exposure[edge]={...r.exposure[edge],originalHelperEntries:String(BigInt(r.exposure[edge].originalHelperEntries)+7n)};
 b.exposureComplete={...b.exposureComplete,originalHelperEntries:String(BigInt(b.exposureComplete.originalHelperEntries)+12n)};
 const p=phasePartition(b,true);assert.equal(p.gaps[0].originalHelperEntries,'7');assert.equal(p.tail.originalHelperEntries,'5');assert.equal(p.boot.originalHelperEntries,'1000');
 assert.equal(p.phases.filter(r=>r.name==='json').every(r=>r.allExecutions==='0'),true);
 const positive=exposureDelta(row(0,0,0),row(14,8,0));assert.equal(validateSelectedExposure(positive,true),true);assert.equal(positive.allExecutions,'22');
});
