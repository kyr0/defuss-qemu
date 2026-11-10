#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {Oracle} from './oracle.mjs';
import {verifyAdmissionBinding} from './runtime-identity.mjs';
import {protocol,args,limits,bindingPath,bindingSha256,packagePath,guestGeneration} from './config.mjs';
import {inside,identity,verifyInputs,json,sources,sha} from './identity.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),{values}=parseArgs({options:{run:{type:'string'},output:{type:'string'}}});
const run=inside(root,values.run),output=inside(root,values.output);assert.ok(values.output.startsWith('artifacts/'));await mkdir(output);
const result={schema:1,status:'failed',protocol,timingEligible:false,scope:'Offline replay using the same frozen host oracle; not independent authorship.',inputs:{}};
try{
 const read=async name=>{const path=resolve(run,name);result.inputs[values.run+'/'+name]=await identity(path);return readFile(path,'utf8');};
 const report=JSON.parse(await read('report.json')),inventory=JSON.parse(await read('inputs.json'));assert.equal(report.status,'passed');assert.equal(report.protocol,protocol);assert.deepEqual(report.arguments,args);assert.equal(report.timeoutMs,limits.timeout);assert.equal(report.timingEligible,false);assert.equal(report.candidatePromotion,false);assert.equal(report.snapshots,0);assert.equal(report.coldOnly,true);assert.equal(report.inputsStable,true);
 assert.deepEqual(report.inputs,inventory.inputs);assert.equal(inventory.enabled,report.enabled);await verifyInputs(root,report.inputs);
 assert.equal(report.inputs[bindingPath].sha256,bindingSha256);assert.deepEqual(report.runtimeBinding,{path:bindingPath,...report.inputs[bindingPath]});
 const proof=await verifyAdmissionBinding(root,bindingPath);proof.buffers.clear();for(const [name,id]of Object.entries(proof.inputs))assert.deepEqual(id,report.inputs[name]);
 const binding=proof.binding,contract=await readFile(inside(root,binding.graphContract.path),'utf8');assert.equal(sha(contract),binding.graphContract.sha256);
 for(const [key,symbol]of [['graph','m3b_expected_graph'],['objects','m3b_expected_objects']]){const match=contract.match(new RegExp('static const char '+symbol+'\\[\\]\\s*=\\s*((?:"(?:[^"\\\\]|\\\\.)*"\\s*)+);'));assert.ok(match);const text=[...match[1].matchAll(/"(?:[^"\\]|\\.)*"/g)].map(m=>JSON.parse(m[0])).join('');assert.deepEqual(report[key],{text,sha256:sha(text),bytes:Buffer.byteLength(text)});}
 assert.equal(report.guestPackage,packagePath);assert.equal(report.guestManifest.generation,guestGeneration);assert.deepEqual(report.guestManifest,JSON.parse(await readFile(inside(root,packagePath+'/app.json'),'utf8')));
 const b=report.browserResult;assert.equal(b.status,'passed');assert.equal(b.enabled,report.enabled);assert.equal(b.protocol,protocol);assert.equal(b.timingEligible,false);assert.deepEqual(b.arguments,args);
 assert.deepEqual(b.configuration,{m3b:{enabled:report.enabled,profile:1,phase:'preRun-before-vCPU',returnCode:0,status:report.enabled?11:10},census:{enabled:true,phase:'preRun-before-vCPU',returnCode:0,status:3,abi:{version:2,words:2400,slots:4}},m3aEnabled:true,hotLimit:1500,runtimeFlags:3,instanceLimit:12000});
 for(const source of sources)assert.deepEqual(await identity(resolve(run,'source',source)),report.inputs[source]);
 for(const [path,id]of Object.entries(report.served))assert.deepEqual(id,report.inputs[path]);
 const oracle=new Oracle({enabled:report.enabled,graph:report.graph.text,objects:report.objects.text}),raw=await read('progress.jsonl');assert.ok(raw.endsWith('\n'));const rows=raw.trimEnd().split('\n').map(JSON.parse);assert.equal(rows.length,72);for(const row of rows)oracle.accept(row);
 const serial=await read('serial.log');assert.equal(oracle.serial,serial);assert.equal(report.browserResult.serial,serial);assert.deepEqual(oracle.finish(),report.summary);
 assert.equal(report.browserResult.gateAcks,69);assert.equal(report.browserResult.records,72);assert.deepEqual(report.browserResult.signals.map(s=>s.byte),[49,...Array(69).fill(71)]);assert.equal(report.browserResult.endStatus.running,false);assert.equal(report.browserResult.endStatus.status,'paused');assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.serverErrors,[]);
 result.summary=oracle.finish();result.status='passed';result.sourceIdentities=Object.fromEntries(sources.map(s=>[s,report.inputs[s]]));
}catch(e){result.failure=String(e.stack??e);}
await json(resolve(output,'review.json'),result);console.log(JSON.stringify({status:result.status,summary:result.summary,failure:result.failure}));if(result.status!=='passed')process.exitCode=1;
