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
 return {status:{running:false,status:initial?'prelaunch':'paused'},m3aRaw,m3bRaw,boundaryRaw,nativeStatus:enabled?63:62,censusRaw,censusNativeStatus:initial?3:7,pool:{limit:12000,charged:0,linearMemoryBytes:2147483648}};
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
  if(enabled){row.m3bRaw[20]=i;row.m3bRaw[22]=i;row.m3bRaw[24]=i;}out.push(row);
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
