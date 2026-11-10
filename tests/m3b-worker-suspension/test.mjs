// Synthetic host contracts only: fabricated native banks are NOT guest evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PressureOracle,decodePressure} from './oracle.mjs';
import {expectedPressureGate,pressureSettings,sentinelCodeHex} from './guest-contract.mjs';
import {argumentsFor} from './config.mjs';
import {files,verifySources,validateImageClosure} from './identity.mjs';
import {verifyChunkIndex} from './inspect.mjs';
import {decodeSuspension} from './suspension.mjs';
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
 return {suspensionAbi:1,suspensionRaw:emptyObserver(),status:{running:false,status:initial?'prelaunch':'paused'},captureErrors:[],m3aRaw:a,m3bRaw:b,boundaryRaw:boundary,nativeStatus:b[2],censusRaw:c,censusNativeStatus:c[2],pool:{limit:12000,charged,linearMemoryBytes:1048576}};
}
function emptyObserver(){return Object.assign(Array(2624).fill(0),{0:0x4d335357,1:1,2:2624,3:4,4:640,14:64});}
function episode(){
 const raw=emptyObserver();Object.assign(raw,{5:1,9:1,10:4,12:0x4000,16:0x5000});const w=Array(640).fill(0);
 Object.assign(w,{0:1,1:2,2:1,3:1,4:0x10000,6:Number(BigInt(sentinel.a)),8:0x2000,10:0x99,12:0x1000,14:1,16:0x6000,18:4,20:11,21:11,23:1,24:12,25:12,29:12000,30:6000});
 for(let k=0;k<4;k++){const a=288+k*64;Object.assign(w,{[a]:k+1,[a+1]:[0,1,0,2][k],[a+2]:[1,0,2,0][k],[a+3]:1,[a+4]:0x10000,[a+7]:12,[a+8]:12,[a+11]:1,[a+12]:12000});}
 for(let i=0;i<640;i++)raw[64+i]=w[i];return raw;
}
function transcript({enabled=true,observed=true}={}){
 let time=0;const rows=[],add=r=>{const t=++time;rows.push({...r,...(r.event==='gate'?{signalHostMs:t,readHostMs:t}:{hostMs:t})});};
 const raw=(options={})=>bank({enabled,...options});
 add({...raw({initial:true}),event:'startup',startupCpus:[{'cpu-index':0}],startupFailure:null,graphRaw:[...Buffer.from(proof.graph.text)],objectsRaw:[...Buffer.from(proof.objects.text)]});
 const gate=(seq,stage,nodes,attempt,options,obs=false)=>add({...raw(options),...(obs?{suspensionRaw:episode()}:{}),event:'gate',seq,gate:expectedPressureGate({stage,nodes,attempt}),...(seq===0?{layout}:{}),jitRaw:{'human-readable-text':'gen code size '+(10000+seq)+'/268000000\nTB count 1000\nTB flush count 0\n'},jitError:null,jitStatus:{running:false,status:'paused'}});
 const ack=(seq,value)=>add({event:'ack',seq,ack:value,watchEpoch:{m3a:4,m3b:4,census:4}});
 gate(0,'layout',0,0,{});add({...raw({configured:true}),event:'configured',seq:0});ack(0,'K');
 gate(1,'prefill',64,0,{configured:true,churn:10,installs:7000});ack(1,'R');
 const warm={configured:true,compiled:10,tci:2,rf:2,attempts:11,churn:10,installs:7001};gate(2,'warm',64,0,warm);ack(2,'K');
 const retired={...warm,churn:20,installs:12000,retired:6000,charged:12000};gate(3,'churn',128,0,retired);ack(3,'R');
 let final;for(let attempt=0;attempt<16;attempt++){
  final={...retired,tci:3+attempt,compiled:11+attempt,attempts:12+attempt};gate(4+attempt,'revisit',128,attempt,final,enabled&&observed);ack(4+attempt,'K');
 }
 add({...raw(final),...(enabled&&observed?{suspensionRaw:episode()}:{}),event:'complete',validation:{checks:154,nodes:128,attempts:16},jitRaw:{'human-readable-text':'gen code size 20000/268000000\nTB count 1000\nTB flush count 0\n'},jitError:null,jitStatus:{running:false,status:'paused'}});return rows;
}
function replay(rows,enabled=true){const o=new PressureOracle({enabled,proof,layout:{schema:1,sentinel}});for(const r of rows)o.accept(r);return o;}
test('fixed OFF control, positive owning-worker ON and absent-episode incomplete',()=>{
 for(const enabled of [false,true]){const o=replay(transcript({enabled}),enabled);assert.equal(o.result,'passed');assert.equal(o.attempts,16);assert.equal(o.summary().qualifyingEpisodes.length,enabled?1:0);}
 const o=replay(transcript({observed:false}));assert.equal(o.result,'incomplete');assert.equal(o.attempts,16);
});
test('every observer field group rejects mutation, including reserved state and events',()=>{
 decodeSuspension(episode(),{enabled:true});decodeSuspension(emptyObserver(),{enabled:false});assert.throws(()=>decodeSuspension(episode(),{enabled:false}));
 for(const at of [0,1,2,3,4,5,6,7,9,10,11,14,15,18,64,65,66,67,78,79,82,83,84,85,87,88,89,90,91,92,93,96,224,352,353,354,355,356,358,359,360,361,363,364,365,608,704]){
  const r=episode();r[at]++;assert.throws(()=>decodeSuspension(r,{enabled:true}),'corruption at '+at);
 }
});
test('no owner/tier substitution, late-warm omission, premature completion or extra reset',()=>{
 for(const mutate of [
  rows=>rows.find(r=>r.event==='gate'&&r.seq===1).m3aRaw[23]=6999,
  rows=>rows.find(r=>r.event==='gate'&&r.seq===2).gate.nodes=0,
  rows=>rows.find(r=>r.event==='gate'&&r.seq===3).m3aRaw[24]=5999,
  rows=>rows.find(r=>r.event==='gate'&&r.seq===4).censusRaw[10]=8,
  rows=>rows.find(r=>r.event==='gate'&&r.seq===4).suspensionRaw[64+8]++,
  rows=>rows.find(r=>r.event==='gate'&&r.seq===5).suspensionRaw[64+32]++,
  rows=>rows.find(r=>r.event==='ack'&&r.seq===4).ack='R',
  rows=>rows.find(r=>r.event==='complete').validation.attempts=15,
 ]){const rows=transcript();mutate(rows);assert.throws(()=>replay(rows));}
 for(const at of [2,8,10,12]){const rows=transcript();for(const r of rows)if(r.suspensionRaw?.[5])r.suspensionRaw[64+at]=at===2?0:r.suspensionRaw[64+at]+1;assert.equal(replay(rows).result,'incomplete','Unmatched episode must not qualify');}
});
test('original guarded VM limits, zero trace, fixed node and image source bounds',()=>{
 assert.equal(pressureSettings.timeoutMs,1800000);assert.equal(pressureSettings.prefillInstalls,7000);assert.equal(pressureSettings.retries,16);const args=argumentsFor();assert.equal(args.filter(x=>x==='tcg,tb-size=256').length,1);assert.ok(!args.includes('-d'));
 assert.throws(()=>verifyChunkIndex([],{trace:Buffer.from('x'),serial:Buffer.alloc(0),stderr:Buffer.alloc(0)}));
 for(const bad of [{stage:'prefill',nodes:63,attempt:0},{stage:'warm',nodes:0,attempt:0},{stage:'revisit',nodes:64,attempt:16}])assert.throws(()=>expectedPressureGate(bad));
});

import {readFile} from 'node:fs/promises';
test('unchanged generated loop work and static sentinel bytes; fixed revisit loop',async()=>{
 const [old,fresh,oldS,freshS]=await Promise.all(['../m3b-fused-pressure/fixture.c','./fixture.c','../m3b-fused-pressure/fixture.S','./fixture.S'].map(p=>readFile(new URL(p,import.meta.url),'utf8')));
 assert.equal(oldS,freshS);const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
 assert.equal(section(fresh,' const size_t bytes=',' printf('),section(old,' const size_t bytes=',' printf('));
 assert.equal(section(fresh,'static void sentinel(void){','int main(void){'),section(old,'static void sentinel(void){','int main(void){'));
 assert.ok(fresh.includes('if(gate("revisit",used,attempt)!=\'K\')fail("fixed revisit ACK");'));
});
