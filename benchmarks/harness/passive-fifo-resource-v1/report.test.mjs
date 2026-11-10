import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadReport} from './report.mjs';
import {loadReport as timingLoad} from '../m2-sustained-v2/report.mjs';
import {syntheticReport} from './fixture.mjs';
test('full synthetic sustained resource report replays twenty warmups and thirty-two measured batches',async()=>{
 const {report,path,save}=await syntheticReport();const loaded=await loadReport(path,'baseline');assert.equal(loaded.report.browserResult.warmups.length,20);assert.equal(loaded.report.browserResult.results.length,32);
 await assert.rejects(()=>timingLoad(path,'baseline'),/defuss-m2/);
 report.browserResult.warmups[0].sample=99;await save();await assert.rejects(()=>loadReport(path,'baseline'),/warmup order/);report.browserResult.warmups[0].sample=0;
 const measured=report.browserResult.results[0];report.browserResult.results[0]={...report.browserResult.warmups[0]};await save();await assert.rejects(()=>loadReport(path,'baseline'),/Phase start type/);report.browserResult.results[0]=measured;
 report.protocol='defuss-m1-v1';await save();await assert.rejects(()=>loadReport(path,'baseline'),/defuss-m/);
});
test('diagnostic reports reject altered serial evidence, COM1 pairing and timing eligibility',async()=>{
 const {report,path,save,dir,serial}=await syntheticReport();
 report.browserResult.signals[3].byte=72;await save();await assert.rejects(()=>loadReport(path,'baseline'),/COM1 gate/);report.browserResult.signals[3].byte=71;
 report.timingEligible=true;await save();await assert.rejects(()=>loadReport(path,'baseline'));report.timingEligible=false;
 report.browserResult.timingEligible=true;await save();await assert.rejects(()=>loadReport(path,'baseline'));report.browserResult.timingEligible=false;await save();
 await writeFile(resolve(dir,'serial.log'),serial.replace('"heapChecksum":17','"heapChecksum":18'));await assert.rejects(()=>loadReport(path,'baseline'),/Raw serial/);
 await writeFile(resolve(dir,'serial.log'),serial.split('\n').slice(1).join('\n'));await assert.rejects(()=>loadReport(path,'baseline'),/Raw serial/);
 await writeFile(resolve(dir,'serial.log'),serial);assert.ok(await loadReport(path,'baseline'));
});
