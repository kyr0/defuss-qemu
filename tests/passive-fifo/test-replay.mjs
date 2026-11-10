import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {decodeFifoSnapshot} from '../../experiments/passive-fifo/reader.mjs';
import {observerBus,observerSnapshot,mainOrder,settings} from './contract.mjs';
import {parseTranslationBuffer} from '../regions-pressure/jit.mjs';
import {openProgress} from './progress.mjs';
import {replayPolicyReport} from './replay.mjs';
import {parseSerialRecords,validateSerial} from './serial.mjs';
function epoch(sequence){
 const raw=new Array(64).fill(0);Object.assign(raw,{0:0x46494631,1:1,2:sequence,3:sequence,5:7,8:512,9:512,12:12000,13:256,14:1,16:512,26:1,33:100,35:1,36:sequence,38:512,39:512,40:1});
 const snapshot={...decodeFifoSnapshot(raw,sequence,true),rawWords:raw};
 const obs=new Array(64).fill(0);Object.assign(obs,{0:0x464f4231,1:1,2:1,4:512,5:512,14:512,63:sequence});
 const bus=observerBus(1024),w=new Uint32Array(bus.buffer);w.set(obs,64);w[63]=w[127]=sequence;
 return {snapshot,observer:observerSnapshot(bus,snapshot),control:{status:7,state:3,rejections:0}};
}
async function mainReport(){
 const original=JSON.parse(await readFile(new URL('../../artifacts/m3-region-off-03/report.json',import.meta.url),'utf8'));
 const status={running:false,status:'paused'},jitRaw={'human-readable-text':'gen code size 1000/268368896\nTB count 1\nTB flush count 0\n'},jit=parseTranslationBuffer(jitRaw);
 const gates=mainOrder.map((stage,i)=>({stage,fixturePhase:'main',status,...epoch(i+1),jitRaw,jit,jitStatus:status,ack:'K'})),final=epoch(18);
 const r={status:'passed',fixture:'main',enabled:true,timingEligible:false,settings,gates,results:original.results,interrupts:original.interrupts,validation:original.validation,final,finalStatus:status,finalJitRaw:jitRaw,finalJit:jit,finalJitStatus:status,
  signals:gates.map(()=>({bytes:[71]})),markers:gates.map(g=>({fixturePhase:'main',stage:g.stage})),acks:gates.map((g,sequence)=>({sequence,fixturePhase:'main',stage:g.stage,ack:'K'}))};
 r.mainPolicyExposure={before:gates[0].snapshot.counters,after:final.snapshot.counters,delta:Object.fromEntries(['softBatches','softRetired','emergencyRetired','gcConsumed','compiledCalls','interpretedCalls'].map(k=>[k,0]))};return r;
}
test('raw epochs and exact received marker/signal/ACK replay reject corruption',async()=>{
 const r=await mainReport();assert.equal(replayPolicyReport(r).status,'passed');
 for(const mutate of [r=>r.signals.push({bytes:[71]}),r=>r.signals[3].bytes=[72],r=>r.acks[3].ack='R',r=>r.markers[2].stage=7,r=>r.gates[5].snapshot.rawWords[2]++,r=>r.gates[4].observer.raw[7]++,r=>r.mainPolicyExposure.delta.softBatches=1,r=>r.finalJitStatus.running=true]){
  const bad=structuredClone(r);mutate(bad);assert.throws(()=>replayPolicyReport(bad));
 }
});
test('durable combined progress accepts223 stopped rows and rejects overflow, running and large records',async()=>{
 const root=process.cwd();assert.ok(process.env.TMPDIR?.startsWith(root+'/tmp/'));const dir=await mkdtemp(resolve(process.env.TMPDIR,'fifo-progress-')),path=resolve(dir,'progress.jsonl');
 const writer=await openProgress(path,{test:true});
 for(let sequence=0;sequence<223;sequence++)await writer.appendGate({sequence,row:{status:{running:false,status:'paused'}}});
 await assert.rejects(writer.appendGate({sequence:223,row:{status:{running:false,status:'paused'}}}),/bound/);await writer.close();assert.equal((await readFile(path,'utf8')).trim().split('\n').length,224);
 for(const [name,row]of [['running',{status:{running:true,status:'running'}}],['large',{status:{running:false,status:'paused'},text:'x'.repeat(65536)}]]){
  const w=await openProgress(resolve(dir,name+'.jsonl'),{});await assert.rejects(w.appendGate({sequence:0,row}));await w.close();
 }
});
test('retained raw serial reconstructs oracle and rejects duplicate completion/missing records',async()=>{
 const serial=await readFile(new URL('../../artifacts/m3-region-off-03/serial.log',import.meta.url),'utf8'),old=JSON.parse(await readFile(new URL('../../artifacts/m3-region-off-03/report.json',import.meta.url),'utf8'));
 const report={...old,fixture:'main',markers:mainOrder.map(stage=>({fixturePhase:'main',stage}))};assert.equal(validateSerial(report,serial).status,'passed');
 const pass=serial.split('\n').find(line=>line.startsWith('REGION_PASS:'));
 assert.throws(()=>parseSerialRecords(serial+'\n'+pass+'\n'),/Duplicate/);
 assert.throws(()=>validateSerial(report,serial.replace(/^REGION_RESULT:[^\n]*\n/m,'')));
 assert.throws(()=>parseSerialRecords(serial+'\nREGION_UNKNOWN:{}\n'),/Unknown/);
});
