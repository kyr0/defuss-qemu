import test from 'node:test';
import assert from 'node:assert/strict';
import {PressureOracle} from './oracle.mjs';
import {layout,gate} from './test-contract.mjs';
import {codeAdd,codeSub} from './guest-contract.mjs';
const binding={schema:1,kind:'m3b-differential-runtime-binding-v1',status:'passed',timingEligible:false,variant:'m3b-context-census-v2',diagnosticExtensions:['context-entry-census-v2','generation-specific-injection-v1'],censusAbi:{version:2,words:2400,slots:4}};
const proof={binding,graph:{text:'synthetic-graph'},objects:{text:'synthetic-objects'}};
const pair=(w,i,n)=>{n=BigInt(n);w[i]=Number(n&0xffffffffn);w[i+1]=Number(n>>32n);};
function native(enabled,seq,initial=false){
 const a=Array(96).fill(0),b=Array(128).fill(0),c=Array(2400).fill(0),d=Array(256).fill(0),w=Array(2112).fill(0);
 Object.assign(a,{0:0x4d335231,1:1,2:1,3:initial?0:1,5:176,6:88,7:24,8:4,9:64,10:8,12:initial?1:3,25:seq});
 Object.assign(b,{0:0x4d334231,1:1,2:enabled?63:62,5:1,6:32,7:128,8:12,9:32,10:20,12:4});
 Object.assign(c,{0:0x4d334343,1:2,2:initial?3:7,5:2400,6:4,7:32,8:592,9:112});Object.assign(d,{0:0x4d334253,1:1,6:256,7:64});Object.assign(w,{0:0x4d33434f,1:1,2:2112,3:16,4:128,12:64});
 if(enabled)for(let i=0;i<seq;i++){
  const r=Array(128).fill(0),compiled=i===seq-1?100:150;Object.assign(r,{0:2,1:i+1,10:0x18c0c2b3,11:0xff020000,12:12,13:5,28:compiled,29:3,70:0x18c0c2b3,71:0x101});
  for(const [at,n] of [[2,0x1000+i*256],[4,0x20000004],[6,0x123004],[8,0xffffffffffffffffn],[14,0x99+i],[16,0x2000+i*256],[18,0x20000004],[20,0x20000004],[22,0x234000],[24,0x234000],[26,0x234000],[64,0x80050033],[66,0x350eb0],[68,0xd01]])pair(r,at,n);
  const bytes=Buffer.from((i%2?codeSub:codeAdd).slice(8,-2),'hex');for(let j=0;j<bytes.length;j++)r[32+(j>>>2)]=(r[32+(j>>>2)]|(bytes[j]<<((j%4)*8)))>>>0;
  w.splice(64+i*128,128,...r);w[5]++;w[6]+=compiled;w[7]+=3;
 }
 if(enabled){Object.assign(b,{16:w[5],17:w[5],20:w[6],21:w[7],22:w[6],24:w[6],29:w[5]});}a[18]=a[19]=seq*200;
 return {status:{running:false,status:initial?'prelaunch':'paused'},captureErrors:[],m3aRaw:a,m3bRaw:b,censusRaw:c,boundaryRaw:d,codeRaw:w,nativeStatus:b[2],censusNativeStatus:c[2],pool:{charged:5000,limit:12000,linearMemoryBytes:2147483648}};
}
export function transcript(enabled=true){
 const rows=[];let clock=0;const push=r=>{clock++;rows.push({...r,...(r.event==='gate'?{signalHostMs:clock,readHostMs:clock}:{hostMs:clock})});};
 const storage={jitError:null,jitStatus:{running:false,status:'paused'},jitRaw:{'human-readable-text':'gen code size 10000/134152192\nTB count 1000\nTB flush count 0\n'}};
 push({...native(enabled,0,true),event:'startup',startupFailure:null,startupCpus:[{'cpu-index':0}],graphRaw:[...Buffer.from(proof.graph.text)],objectsRaw:[...Buffer.from(proof.objects.text)]});
 for(let seq=0;seq<10;seq++){
  push({...native(enabled,seq),...structuredClone(storage),event:'gate',seq,gate:gate(seq),...(seq===0?{layout}:{})});
  push({event:'ack',seq,ack:'K',watchEpoch:{m3a:0,m3b:0,census:0}});
 }
 push({...native(enabled,9),...storage,event:'complete',validation:{calls:9,signals:8,contexts:8,patches:8}});return rows;
}
function replay(rows,enabled=true){const o=new PressureOracle({enabled,proof,layout:{schema:1,sentinel:{codeHex:codeAdd.slice(8,-2)}}});for(const r of rows)o.accept(r);return o;}
test('eight replacements have positive old/new attempts and earlier owners stay quiescent',()=>{for(const enabled of [false,true]){const o=replay(transcript(enabled),enabled);assert.equal(o.result,'passed');assert.equal(o.summary().epochs.length,9);assert.deepEqual(o.summary().resets,[]);}});
test('generation, page, bytes, payment, controls and guest-state corruptions reject',()=>{
 const mutations=[r=>r.codeRaw[64+128+14]=0x99,r=>r.codeRaw[64+128+6]+=4096,r=>r.codeRaw[64+128+33]^=0x2800,r=>r.m3bRaw[24]++,r=>r.codeRaw[9]++,r=>r.m3bRaw[11]=4,r=>r.gate.sample.gpr[0]='0x0',r=>r.gate.sample.beforeRxHex=codeSub,r=>r.jitRaw['human-readable-text']=r.jitRaw['human-readable-text'].replace('flush count 0','flush count 1')];
 for(const mutate of mutations){const rows=transcript();mutate(rows.find(r=>r.event==='gate'&&r.seq===2));assert.throws(()=>replay(rows));}
 const rows=transcript(),r=rows.find(r=>r.event==='gate'&&r.seq===3);r.codeRaw[64+28]++;r.codeRaw[6]++;r.m3bRaw[20]++;assert.throws(()=>replay(rows));
});
test('resets and missing ACK cannot complete',()=>{const rows=transcript();rows.splice(3,0,{...structuredClone(rows[1]),event:'configured',hostMs:3});assert.throws(()=>replay(rows));const missing=transcript();missing.splice(-2,1);assert.throws(()=>replay(missing));});
