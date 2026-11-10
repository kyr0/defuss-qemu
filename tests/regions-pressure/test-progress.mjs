import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openProgress,progressScope} from './progress.mjs';
const directory=await mkdtemp(resolve(process.env.TMPDIR,'pressure-progress-'));
const stopped=sequence=>({sequence,row:{stage:'churn',status:{running:false,status:'paused'},pool:{charged:12000,limit:12000}}});
test('completed stopped rows survive abrupt process exit without recorder close',async()=>{
 const path=resolve(directory,'abrupt.jsonl'),module=new URL('./progress.mjs',import.meta.url).href;
 const source=`import {openProgress} from ${JSON.stringify(module)};const p=await openProgress(process.argv[1],{test:true});await p.appendGate(${JSON.stringify(stopped(0))});process.exit(0);`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',source,path],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 const rows=(await readFile(path,'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(rows.length,2);assert.equal(rows[0].scope,progressScope);assert.equal(rows[1].sequence,0);assert.equal(rows[1].row.pool.charged,12000);
});
test('concurrent duplicate sequences cannot produce duplicate durable rows',async()=>{
 const path=resolve(directory,'duplicate.jsonl'),p=await openProgress(path,{});
 const result=await Promise.allSettled([p.appendGate(stopped(0)),p.appendGate(stopped(0))]);
 assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');await p.close();
 assert.equal((await readFile(path,'utf8')).trim().split('\n').length,2);
});
test('running snapshots, oversized records and excess rows reject before append',async()=>{
 const running=await openProgress(resolve(directory,'running.jsonl'),{});
 await assert.rejects(running.appendGate({sequence:0,row:{status:{running:true,status:'running'}}}),/confirmed stopped/);await running.close();
 const oversized=await openProgress(resolve(directory,'oversized.jsonl'),{});
 await assert.rejects(oversized.appendGate({...stopped(0),extra:'x'.repeat(65536)}),/64KiB/);await oversized.close();
 const bounded=await openProgress(resolve(directory,'bounded.jsonl'),{},{maxRows:1});await bounded.appendGate(stopped(0));
 await assert.rejects(bounded.appendGate(stopped(1)),/bound/);await bounded.close();
});
