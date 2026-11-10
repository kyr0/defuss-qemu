import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readExposure,validateExposure,exposureDelta,validateSelectedExposure,exposureProtocol,bankFields} from './exposure.mjs';
import {validatePhases} from './analyze.mjs';
import {loadReport} from '../analysis/analyze.mjs';

const row=(original,inline,fallback)=>({schema:1,...Object.fromEntries(bankFields.map((key,i)=>[key,String([original,inline,fallback][i])]))});
test('stopped memory reads retain uint64 precision and never reset counters',()=>{
  const memory=new SharedArrayBuffer(64),words=new BigUint64Array(memory,8,3);words.set([9007199254740997n,123n,9007199254740996n]);
  const calls=[],mod={_defuss_m2_msg2_counts:clear=>{calls.push(clear);return 8n;},pcProfileWords:()=>new Uint32Array(memory)};
  assert.deepEqual(readExposure(mod),row(9007199254740997n,123n,9007199254740996n));assert.deepEqual(calls,[0]);
  assert.throws(()=>readExposure({...mod,_defuss_m2_msg2_counts:()=>9n}),/pointer/);
  assert.throws(()=>readExposure({...mod,_defuss_m2_msg2_counts:()=>64n}),/pointer/);
  assert.throws(()=>readExposure({...mod,pcProfileWords:()=>new Uint32Array(16)}),/shared-memory/);
  assert.throws(()=>readExposure({...mod,_defuss_m2_msg2_counts:undefined}),/ABI/);
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
  const scratch=fileURLToPath(new URL('../../../tmp/',import.meta.url));await mkdir(scratch,{recursive:true});
  const dir=await mkdtemp(resolve(scratch,'m2-exposure-test-'));
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
