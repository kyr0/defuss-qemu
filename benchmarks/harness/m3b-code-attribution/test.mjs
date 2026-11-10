import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Oracle,decodeObservation,delta} from './oracle.mjs';
import {gatePlan,parameters,orders,expected,prefix} from '../m1/protocol.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
function observation(enabled=false,initial=false){
 const m3aRaw=Array(96).fill(0),m3bRaw=Array(128).fill(0),censusRaw=Array(2400).fill(0),boundaryRaw=Array(256).fill(0);
 m3aRaw.splice(0,13,0x4d335231,1,1,Number(!initial),0,176,88,24,4,64,8,0,1);
 m3bRaw.splice(0,13,0x4d334231,1,enabled?63:62,0,0,1,32,128,12,32,20,0,4);
 censusRaw.splice(0,10,0x4d334343,2,initial?3:7,0,0,2400,4,32,592,112);
 Object.assign(boundaryRaw,{0:0x4d334253,1:1,6:256,7:64});
 const codeRaw=Array(2112).fill(0);codeRaw.splice(0,5,0x4d33434f,1,2112,16,128);codeRaw[12]=64;
 return {status:{running:false,status:initial?'prelaunch':'paused'},m3aRaw,m3bRaw,codeRaw,boundaryRaw,nativeStatus:enabled?63:62,censusRaw,censusNativeStatus:initial?3:7,pool:{limit:12000,charged:0,linearMemoryBytes:2147483648}};
}
function bank(compiled=10,tci=3){
 const w=Array(2112).fill(0);w.splice(0,8,0x4d33434f,1,2112,16,128,1,compiled,tci);w[12]=64;const p=(i,n)=>{n=BigInt(n);w[i]=Number(n&0xffffffffn);w[i+1]=Number(n>>32n);};const at=64;
 w[at]=compiled+tci?2:1;w[at+1]=1;p(at+2,0x1000);p(at+4,0x20000004);p(at+6,0x123004);p(at+8,0xffffffffffffffffn);w[at+10]=0x18c0c2b3;w[at+11]=0xff020000;w[at+12]=12;w[at+13]=5;p(at+22,0x234000);
 if(compiled+tci){p(at+14,0x99);p(at+16,0x2000);p(at+18,0x20000004);p(at+20,0x20000004);p(at+24,0x234000);p(at+26,0x234000);w[at+28]=compiled;w[at+29]=tci;p(at+64,0x80050033);p(at+66,0x350eb0);p(at+68,0xd01);w[at+70]=0x18c0c2b3;w[at+71]=0x101;}
 const bytes=Buffer.from('83f900740701f083e901ebf4','hex');for(let i=0;i<bytes.length;i++)w[at+32+(i>>>2)]=(w[at+32+(i>>>2)]|(bytes[i]<<((i%4)*8)))>>>0;return w;
}
function rows(enabled=false){
 const base={protocol:'defuss-m1-v1',bun:'1.4.4',revision:'38afee6c84fcf48c0edb2466aa4b27d287a59c30',arch:'x64',pid:42,nonce:'00000000-0000-0000-0000-000000000001',heap:true,file:true,heapLength:4096,heapChecksum:123,parameters,orders};
 const prepared={...base,event:'snapshot-prepared',ordinal:0},resumed={...base,event:'resumed',ordinal:1,mode:'cold'},serial=e=>prefix+JSON.stringify(e)+'\n';
 const out=[{...observation(enabled,true),sequence:0,kind:'startup',serialChunk:'',graph:'graph\n',objects:'objects\n',cpus:[{'cpu-index':0}]},{...observation(enabled),sequence:1,kind:'ready',serialChunk:serial(prepared),signal:49}];
 for(const [i,p]of gatePlan().entries()){
  const event={...base,...p,seq:i+1,ordinal:1,mode:'cold'};
  if(['initialized','maps'].includes(p.event))Object.assign(event,{maps:'example\n',mapsSha256:sha('example\n'),mapsBytes:8});
  if(p.event==='result')Object.assign(event,{value:expected[p.name],guestMs:1});if(p.event==='gate-result')event.guestMs=0;
  if(['warmup-complete','complete'].includes(p.event))event.values=expected;
  const row={...observation(enabled),sequence:out.length,kind:'gate',signal:71,gate:event,serialChunk:(i===0?serial(resumed):'')+serial(event)};
  if(enabled){row.m3bRaw[16]=row.m3bRaw[17]=row.m3bRaw[29]=1;row.m3bRaw[20]=i;row.m3bRaw[22]=i;row.m3bRaw[24]=i;row.codeRaw=bank(i,0);}out.push(row);
 }
 const final={...structuredClone(out.at(-1)),sequence:71,kind:'final',serialChunk:'',gateAcks:69};delete final.gate;delete final.signal;out.push(final);return out;
}
const replay=r=>{const o=new Oracle({enabled:r[0].nativeStatus===63,graph:'graph\n',objects:'objects\n'});r.forEach(row=>o.accept(row));return o.finish();};
test('full unchanged protocol OFF and ON produce thirteen bounded phase deltas',()=>{for(const enabled of [false,true]){const s=replay(rows(enabled));assert.equal(s.gates,69);assert.equal(s.results,12);assert.equal(s.phases[1].name,'integer');assert.equal(s.phases[1].m3b.compiledEntries,enabled?1:0);}});
for(const [name,mutate]of Object.entries({
 'wrong guest result':r=>{const x=r.find(x=>x.gate?.event==='result');x.gate.value=0;x.serialChunk=prefix+JSON.stringify(x.gate)+'\n';},
 'missing raw gate':r=>{r[5].serialChunk='';},
 'changed raw/event identity':r=>{r[5].gate={...r[5].gate,pid:43};},
 'read while running':r=>{r[5].status.running=true;},
 'wrong graph':r=>{r[0].graph='changed';},
 'counter reset':r=>{r[5].m3bRaw[20]=0;},
 'unpaid B boundary':r=>{r[5].m3bRaw[24]++;},
 'census fault':r=>{r[5].censusRaw[3]=1;},
 'unexpected injection':r=>{r[5].m3aRaw[34]=1;},
 'changed boundary control':r=>{r[5].boundaryRaw[4]=1;},
 'missing ACK':r=>{r.at(-1).gateAcks=68;},
 'partial run':r=>{r.pop();},
 'extra gate':r=>{r.splice(6,0,structuredClone(r[5]));},
 'changed heap continuation':r=>{const events=r[2].serialChunk.trimEnd().split('\n');const e=JSON.parse(events[0].slice(prefix.length));e.heapChecksum++;events[0]=prefix+JSON.stringify(e);r[2].serialChunk=events.join('\n')+'\n';},
}))test('rejects '+name,()=>{const r=rows(true);mutate(r);assert.throws(()=>replay(r));});
test('OFF refuses any fusion count',()=>{const r=observation();r.m3bRaw[20]=1;assert.throws(()=>decodeObservation(r,false));});
test('delta rejects wrapping and fractional values',()=>{assert.throws(()=>delta({a:4},{a:3}));assert.throws(()=>delta({a:0},{a:0.5}));});

test('all-zero enabled protocol remains explicit non-attribution',()=>{const r=rows(false);for(const x of r){x.nativeStatus=63;x.m3bRaw[2]=63;}assert.equal(replay(r).attributionAccepted,false);});
