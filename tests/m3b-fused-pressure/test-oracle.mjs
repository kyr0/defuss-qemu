// Synthetic host contracts only: fabricated native banks are NOT guest evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PressureOracle,decodePressure} from './oracle.mjs';
import {expectedPressureGate,pressureSettings,sentinelCodeHex} from './guest-contract.mjs';
import {argumentsFor} from './config.mjs';
import {files,verifySources,validateImageClosure} from './identity.mjs';
import {verifyChunkIndex} from './inspect.mjs';
const binding={schema:1,kind:'m3b-differential-runtime-binding-v1',status:'passed',timingEligible:false,variant:'m3b-context-census-v2',diagnosticExtensions:['context-entry-census-v2','generation-specific-injection-v1'],censusAbi:{version:2,words:2400,slots:4}};
const sentinel={a:'0x405004',b:'0x405009',back:'0x40500e',side:'0x405010',end:'0x405011',ownerBytes:12,codeHex:sentinelCodeHex};
const layout={schema:1,sentinel,generated:['0x70000000','0x700bb800'],...Object.fromEntries(['maxNodes','batch','iterations','retries','sleepNs'].map(k=>[k,pressureSettings[k]]))};
const proof={binding,graph:{text:'synthetic-graph\n'},objects:{text:'synthetic-objects\n'}};
const pair=(w,at,n)=>{n=BigInt(n);w[at]=Number(n&0xffffffffn);w[at+1]=Number(n>>32n);};
function bank({initial=false,configured=false,enabled=true,compiled=0,tci=0,rf=0,churn=0,attempts=0,installs=0,retired=0,charged=installs}={}){
 const a=Array(96).fill(0),b=Array(128).fill(0),c=Array(2400).fill(0),boundary=Array(256).fill(0);
 Object.assign(a,{0:0x4d335231,1:1,2:1,3:initial?0:1,5:256,6:104,7:32,8:4,9:64,10:8,11:configured?4:0,12:initial?1:3,18:compiled+rf+churn,19:compiled+rf+churn,23:installs,24:retired});
 Object.assign(b,{0:0x4d334231,1:1,2:enabled?63:62,5:1,6:32,7:128,8:12,9:32,10:20,11:configured?4:0,12:4});
 Object.assign(c,{0:0x4d334343,1:2,2:initial?3:7,5:2400,6:4,7:32,8:592,9:112,10:configured?4:0,12:compiled+tci+rf,13:configured?1:0});Object.assign(boundary,{0:0x4d334253,1:1,6:256,7:64});
 if(configured)for(let slot=0;slot<4;slot++){
  const begin=slot===0?BigInt(sentinel.a):slot===1?BigInt(layout.generated[0]):0n,end=slot===0?begin+1n:slot===1?BigInt(layout.generated[1]):0n,at=32+slot*592;
  pair(a,64+slot*8,begin);pair(a,66+slot*8,end);a[71+slot*8]=begin?1:0;pair(b,32+slot*20,begin);pair(b,34+slot*20,end);c[at+4]=slot+1;
  if(slot===0){pair(c,at,begin);c[at+2]=1;c[at+3]=enabled?1:0;}
 }
 a[68]=compiled+rf;if(a[68])pair(a,69,sentinel.a);a[76]=churn;if(churn)pair(a,77,BigInt(layout.generated[0])+4n);
 if(enabled&&compiled+tci){Object.assign(b,{16:1,17:1,20:compiled,21:tci,22:attempts,24:attempts,29:1,36:compiled,37:tci,38:attempts,40:attempts,41:1,43:1});pair(b,48,sentinel.a);pair(b,50,0x99n);}
 const at=32;c[at+6]=compiled+tci+rf;c[at+7]=rf;c[at+8+(enabled?0:4)]=compiled;c[at+9+(enabled?0:4)]=tci;c[at+10]=rf;c[at+20]=compiled+rf;c[at+21]=tci;
 if(compiled+tci){c[at+16]|=enabled?1:4;c[at+18]=enabled?0:2;c[at+19]=compiled?0:1;}
 if(rf){c[at+16]|=2;c[at+18]=1;c[at+19]=0;}
 for(const [kind,count]of [[enabled?0:2,compiled+tci],[1,rf]])if(count){
  const t=Array(112).fill(0);pair(t,0,sentinel.a);pair(t,2,0x1000n+BigInt(kind));pair(t,4,kind===1?0x98n:0x99n);pair(t,6,0x2000n+BigInt(kind));pair(t,8,sentinel.a);pair(t,10,0x100004n);pair(t,12,0xffffffffffffffffn);t[14]=0x18c0c2b3|(kind===1?0x10000:0);t[15]=0xff020000;t[16]=kind===0?1:0;t[17]=kind===1?0x10000:0;t[19]=0x200|(kind===1?0x10000:0);
  for(let i=0;i<t.length;i++)c[at+32+kind*112+i]=t[i];
 }
 return {status:{running:false,status:initial?'prelaunch':'paused'},captureErrors:[],m3aRaw:a,m3bRaw:b,boundaryRaw:boundary,nativeStatus:b[2],censusRaw:c,censusNativeStatus:c[2],pool:{limit:12000,charged,linearMemoryBytes:1048576}};
}
function transcript({enabled=true,incomplete=false}={}){
 let time=0;const rows=[],add=r=>{const t=++time;rows.push({...r,...(r.event==='gate'?{signalHostMs:t,readHostMs:t}:{hostMs:t})});};
 const raw=(options={})=>bank({enabled,...options});
 add({...raw({initial:true}),event:'startup',startupCpus:[{'cpu-index':0}],startupFailure:null,graphRaw:[...Buffer.from(proof.graph.text)],objectsRaw:[...Buffer.from(proof.objects.text)]});
 const gate=(seq,stage,nodes,attempt,options)=>add({...raw(options),event:'gate',seq,gate:expectedPressureGate({stage,nodes,attempt}),...(seq===0?{layout}:{}),jitRaw:{'human-readable-text':'gen code size '+(10000+seq)+'/268000000\nTB count 1000\nTB flush count 0\n'},jitError:null,jitStatus:{running:false,status:'paused'}});
 const ack=(seq,value)=>add({event:'ack',seq,ack:value,watchEpoch:{m3a:4,m3b:4,census:4}});
 gate(0,'layout',0,0,{});add({...raw({configured:true}),event:'configured',seq:0});ack(0,'K');
 const warm={configured:true,compiled:10,tci:2,rf:2,attempts:11,installs:5000};gate(1,'warm',0,0,warm);ack(1,'K');
 const retired={...warm,churn:10,installs:12000,retired:6000,charged:12000};gate(2,'churn',64,0,retired);ack(2,'R');
 let final;for(let attempt=0;attempt<(incomplete?16:1);attempt++){
  final={...retired,tci:3+attempt,attempts:12+attempt,...(!incomplete?{compiled:11,rf:3,installs:12001,charged:6001}:{})};gate(3+attempt,'revisit',64,attempt,final);ack(3+attempt,incomplete?'K':'R');
 }
 add({...raw(final),event:'complete',validation:{checks:74+(incomplete?16:1),nodes:64,attempts:incomplete?16:1},jitRaw:{'human-readable-text':'gen code size 20000/268000000\nTB count 1000\nTB flush count 0\n'},jitError:null,jitStatus:{running:false,status:'paused'}});return rows;
}
function replay(rows,enabled=true){const o=new PressureOracle({enabled,proof,layout:{schema:1,sentinel}});for(const r of rows)o.accept(r);return o;}
test('fabricated complete ON/OFF lifetime and bounded incomplete are distinguished',()=>{
 for(const enabled of [false,true]){const o=replay(transcript({enabled}),enabled);assert.equal(o.result,'passed');assert.equal(o.summary().reinstantiationSeq,3);}
 const o=replay(transcript({incomplete:true}));assert.equal(o.result,'incomplete');assert.equal(o.attempts,16);assert.equal(o.fullCapWithoutNewCompiledObservation,true);
});
test('reject cap/flush/retirement/reset/owner mutations without replacing observations',()=>{
 const cases=[r=>r.pool.charged=12001,r=>r.m3aRaw[24]=5999,r=>r.m3aRaw[26]=1,r=>r.censusRaw[10]=8,r=>r.censusRaw[32+32+4]++,r=>r.censusRaw[3]=24,r=>r.censusRaw[1]=1];
 for(const mutate of cases){const rows=transcript();mutate(rows.find(r=>r.event==='gate'&&r.seq===2));assert.throws(()=>replay(rows));}
});
test('hot RF compiled entries cannot stand in for fused same-owner reinstantiation',()=>{
 const rows=transcript(),r=rows.find(r=>r.event==='gate'&&r.seq===3);Object.assign(r,bank({configured:true,compiled:10,tci:3,rf:100,churn:10,attempts:12,installs:12001,retired:6000,charged:6001}));assert.throws(()=>replay(rows));
});
test('fresh descriptor or absent released capacity cannot satisfy natural lifetime',()=>{
 for(const mutate of [r=>r.m3aRaw[23]=12000,r=>{r.censusRaw[32+32+4]++;r.m3bRaw[50]++;},r=>r.m3aRaw[24]=12000]){const rows=transcript();mutate(rows.find(r=>r.event==='gate'&&r.seq===3));assert.throws(()=>replay(rows));}
});
test('sentinel calls during churn, forged tier partitions, and extra resets fail',()=>{
 for(const mutate of [r=>{r.m3aRaw[18]++;r.m3aRaw[19]++;r.m3aRaw[68]++;},r=>r.censusRaw[32+20]++,r=>r.m3bRaw[11]=8,r=>r.m3bRaw[40]++]){const rows=transcript();mutate(rows.find(r=>r.event==='gate'&&r.seq===2));assert.throws(()=>replay(rows));}
});
test('fixed configuration retains guarded argv,256MiB and exact image source closure',()=>{
 const args=argumentsFor();assert.equal(args.filter(v=>v==='tcg,tb-size=256').length,1);assert.ok(args.includes('-S')&&args.includes('-no-reboot')&&args.includes('apic.vapic=off'));assert.ok(!args.includes('-d'));
 const sources=['build.py','fixture.c','fixture.S','guest-contract.mjs'].map(n=>'tests/m3b-fused-pressure/'+n).concat(['experiments/m3b-fallthrough/predecode.h','packaging/bun_app_package.py',...['sdk.py','build.py','container_engine.py','runtime_dependencies.py'].map(n=>'scripts/'+n)]),build={sources:Object.fromEntries(sources.map(n=>[n,'a'.repeat(64)])),baseInitramfsSha256:'6dde230b0e49d80c54337e2854d7cff6e8c9aa8cfa37588eaf9df4dd325a87a9'};
 validateImageClosure(build);delete build.sources['packaging/bun_app_package.py'];assert.throws(()=>validateImageClosure(build));
});
test('unexpected trace bytes and raw ABI corruption are never silently omitted',()=>{
 assert.throws(()=>verifyChunkIndex([],{trace:Buffer.from('x'),serial:Buffer.alloc(0),stderr:Buffer.alloc(0)}));
 for(const mutate of [r=>r.censusRaw[98+64]=1,r=>r.m3bRaw[25]=1,r=>r.boundaryRaw[2]=1,r=>r.captureErrors.push({key:'bank'})]){const r=bank({configured:true});mutate(r);assert.throws(()=>decodePressure(r,{enabled:true}));}
});

// Memory-only provenance fixture: the large trace identity is deliberately
// fabricated. No large buffer, file read or executed-baseline claim is made.
function sourceFixture(change=()=>{}){
 const hash=b=>createHash('sha256').update(b).digest('hex'),data=new Map(),ids=new Map();
 const add=(path,value)=>{const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value)),id={sha256:hash(bytes),bytes:bytes.length};data.set(path,bytes);ids.set(path,id);return {path,...id};};
 const manifestPath='artifacts/pressure-synthetic-source/manifest.json',reviewPath='artifacts/pressure-synthetic-review/review.json';
 const parent={...binding,sourceManifest:{path:'artifacts/native/manifest.json',sha256:'1'.repeat(64),bytes:1},sourceReview:{path:'artifacts/native/review.json',sha256:'2'.repeat(64),bytes:2},sourceFingerprint:'3'.repeat(64)},parentBinding=add('artifacts/pressure-synthetic-binding/binding.json',parent);
 const trace='artifacts/synthetic-baseline/native-trace.log',traceId={sha256:'4'.repeat(64),bytes:139*1024*1024};ids.set(trace,traceId);
 const baseline={status:'passed',baselinePassed:true,binding:parentBinding,inventory:{[trace]:traceId}};
 const baselineReview=add('artifacts/pressure-synthetic-baseline/review.json',baseline);
 const old=add('tests/regions-pressure/fixture.c','synthetic preserved workload');
 const manifest={schema:1,kind:'m3b-fused-pressure-source-freeze',status:'frozen',timingEligible:false,parentSourceManifest:parent.sourceManifest,parentSourceReview:parent.sourceReview,sourceFingerprint:parent.sourceFingerprint,parentBinding,baselineReview,files:files.map(path=>{const id=add(path,'synthetic source '+path),archive=manifestPath.slice(0,-'manifest.json'.length)+'source/'+path;add(archive,data.get(path).toString());return {...id,archive};}),dependencies:{[old.path]:ids.get(old.path),[trace]:traceId}};
 change({manifest,baseline,trace,traceId});
 // Rebind metadata after a semantic corruption so its JSON/hash is internally
 // consistent. The guard, not a stale metadata hash, must detect omission.
 manifest.baselineReview=add(baselineReview.path,baseline);const ref=add(manifestPath,manifest);add(reviewPath,{status:'passed',sourceBlockers:[],sourceManifest:ref});
 const streamed=[],read=async(path,id)=>{assert.notEqual(path,trace,'Historical trace must use identity-only verification');assert.ok(data.has(path));if(id)assert.deepEqual({sha256:hash(data.get(path)),bytes:data.get(path).length},{sha256:id.sha256,bytes:id.bytes});return data.get(path);};
 const verifyInput=async(path,id)=>{assert.deepEqual(id,ids.get(path));streamed.push(path);return id;};
 return {options:{read,verifyInput,manifestPath,reviewPath,binding:parent},streamed,trace};
}
test('full baseline inventory uses identity-only verification without retaining historical trace buffers',async()=>{
 const f=sourceFixture(),result=await verifySources(f.options);assert.equal(result.naturalLifetimeOnly,true);assert.ok(f.streamed.includes(f.trace));
});
test('baseline closure rejects omitted identity and self-consistent binding or inventory corruption',async()=>{
 for(const change of [({manifest,trace})=>delete manifest.dependencies[trace],({baseline})=>baseline.binding={...baseline.binding,bytes:baseline.binding.bytes+1},({baseline})=>baseline.inventory={},({manifest,trace})=>manifest.dependencies[trace]={sha256:'5'.repeat(64),bytes:139*1024*1024}]){
  const f=sourceFixture(change);await assert.rejects(()=>verifySources(f.options));
 }
});
