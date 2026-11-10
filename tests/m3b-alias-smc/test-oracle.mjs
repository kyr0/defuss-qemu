// Synthetic protocol/native-bank models only; not VM evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PressureOracle} from './oracle.mjs';
import {stages,codeAdd,codeSub,expectedValues} from './guest-contract.mjs';
const binding={schema:1,kind:'m3b-differential-runtime-binding-v1',status:'passed',timingEligible:false,variant:'m3b-context-census-v2',diagnosticExtensions:['context-entry-census-v2','generation-specific-injection-v1'],censusAbi:{version:2,words:2400,slots:4}};
const sentinel={a:'0x20000004',b:'0x20000009',back:'0x2000000e',side:'0x20000010',end:'0x20000011',ownerBytes:12,codeHex:codeAdd.slice(8,-2)};
const layout={generated:['0x70000000','0x700bb800']};
const guestLayout={schema:1,rx:'0x20000000',rw:'0x21000000',a:sentinel.a,b:sentinel.b,back:sentinel.back,side:sentinel.side,end:sentinel.end,pageBytes:4096,codeBytes:17,physicalFrame:'0x123'};
const proof={binding,graph:{text:'synthetic-graph'},objects:{text:'synthetic-objects'}};
const pair=(w,at,n)=>{n=BigInt(n);w[at]=Number(n&0xffffffffn);w[at+1]=Number(n>>32n);};
function bankRaw({initial=false,configured=false,enabled=true,compiled=0,tci=0,rf=0,churn=0,attempts=0,installs=0,retired=0,charged=installs}={}){
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
function native({enabled=true,epoch=4,phase=0,work=false,invalidations=0,initial=false}={}){
 const completed=phase+Number(work),r=bankRaw({initial,enabled,configured:epoch>0,compiled:work?100:0,tci:work?10:0,attempts:work?90:0,installs:initial?0:5000}),a=r.m3aRaw,b=r.m3bRaw,c=r.censusRaw;
 a[11]=b[11]=c[10]=epoch;a.fill(0,72,80);b.fill(0,52,72);
 a[18]=a[19]=100*completed;a[25]=invalidations;c[12]=110*completed;
 if(enabled){b[16]=b[17]=b[29]=completed;b[20]=100*completed;b[21]=10*completed;b[22]=b[24]=90*completed;}
 if(epoch)for(let slot=0;slot<4;slot++)c[32+slot*592+4]=epoch-3+slot;
 if(work){const kind=enabled?0:2,at=32+32+kind*112;pair(c,at+2,0x1000+phase*256+kind);pair(c,at+4,0x99+phase);pair(c,at+6,0x2000+phase*256+kind);pair(c,at+10,0x123004);if(enabled)pair(b,50,0x99+phase);}
 return r;
}
function gate(seq){const sub=seq===2||seq===3;return {seq,stage:stages[seq],checks:[0,8,8,16,16,24][seq],patches:[0,0,1,1,2,2][seq],rxPagemap:'0xa080000000000123',rwPagemap:'0xa080000000000123',rxHex:sub?codeSub:codeAdd,rwHex:sub?codeSub:codeAdd,values:seq%2?expectedValues(sub):[]};}
function transcript(enabled=true){
 const rows=[];let time=0;const push=r=>{const t=++time;rows.push({...r,...(r.event==='gate'?{signalHostMs:t,readHostMs:t}:{hostMs:t})});};
 push({...native({enabled,epoch:0,initial:true}),event:'startup',startupFailure:null,startupCpus:[{'cpu-index':0}],graphRaw:[...Buffer.from(proof.graph.text)],objectsRaw:[...Buffer.from(proof.objects.text)]});
 let epoch=0,phase=0,work=false;
 const storage=()=>({jitRaw:{'human-readable-text':'gen code size '+(10000+time)+'/134152192\nTB count 1000\nTB flush count 0\n'},jitError:null,jitStatus:{running:false,status:'paused'}});
 for(let seq=0;seq<6;seq++){
  const invalidations=Math.floor(seq/2);work=seq>0;
  push({...native({enabled,epoch,phase,work,invalidations}),...storage(),event:'gate',seq,gate:gate(seq),...(seq===0?{layout:guestLayout}:{})});
  if(seq%2===0){phase=seq/2;epoch+=4;push({...native({enabled,epoch,phase,work:false,invalidations}),event:'configured',seq});}
  push({event:'ack',seq,ack:'K',watchEpoch:{m3a:epoch,m3b:epoch,census:epoch}});
 }
 push({...native({enabled,epoch:12,phase:2,work:true,invalidations:2}),...storage(),event:'complete',validation:{checks:24,calls:24,patches:2}});return rows;
}
function replay(rows,enabled=true){const o=new PressureOracle({enabled,proof,layout:{schema:1,sentinel}});for(const r of rows)o.accept(r);return o;}
test('three fresh compiled owners and exact reset epochs in ON and OFF models',()=>{
 for(const enabled of [false,true]){const o=replay(transcript(enabled),enabled);assert.equal(o.result,'passed');assert.equal(o.seq,6);assert.equal(o.summary().epochs.length,3);assert.deepEqual(o.summary().resets,[{seq:0,epoch:4},{seq:2,epoch:8},{seq:4,epoch:12}]);}
});
test('stale generation, physical mismatch, unobserved invalidation and missing compiled exposure reject',()=>{
 for(const mutate of [r=>r.censusRaw[32+32+4]=0x99,r=>r.censusRaw[32+32+10]+=4096,r=>r.censusRaw[32+32+2]=0x1000,r=>r.censusRaw[32+32+6]=0x2000,r=>r.m3bRaw[36]=0,r=>r.gate.rxHex=codeAdd,r=>r.gate.values=expectedValues(false)]){
  const rows=transcript();mutate(rows.find(r=>r.event==='gate'&&r.seq===3));assert.throws(()=>replay(rows));
 }
 const rows=transcript();rows.find(r=>r.event==='gate'&&r.seq===2).m3aRaw[25]=0;assert.throws(()=>replay(rows));
});
test('no execution during patch window, no extra reset and no flush masking owner reuse',()=>{
 for(const mutate of [r=>r.censusRaw[32+6]++,r=>r.m3aRaw[68]++,r=>r.gate.rxPagemap='0xa080000000000124',r=>r.jitRaw['human-readable-text']=r.jitRaw['human-readable-text'].replace('flush count 0','flush count 1')]){const rows=transcript();mutate(rows.find(r=>r.event==='gate'&&r.seq===2));assert.throws(()=>replay(rows));}
 const rows=transcript();rows.find(r=>r.event==='ack'&&r.seq===1).watchEpoch.census=8;assert.throws(()=>replay(rows));
});
