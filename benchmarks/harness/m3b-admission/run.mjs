#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,open} from 'node:fs/promises';
import {resolve,dirname,extname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {loadavg,freemem,cpus,platform,arch,release} from 'node:os';
import {chromium} from 'playwright';
import {runtimeFiles} from '../../../tests/m3b-fallthrough/runtime-identity.mjs';
import {verifyAdmissionBinding} from './runtime-identity.mjs';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
import {requireCensusBinding} from '../../../tests/m3b-context-accounting-v3/census-browser.mjs';
import {protocol,bindingPath,bindingSha256,packagePath,guestGeneration,unchangedGuest,limits,scope,args} from './config.mjs';
import {Oracle} from './oracle.mjs';
import {sources,sha,inside,verifyInputs,durable,json,readBound} from './identity.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const {values}=parseArgs({options:{enabled:{type:'string'},output:{type:'string'},timeout:{type:'string',default:'1800000'}}});
assert.ok(['0','1'].includes(values.enabled));const enabled=values.enabled==='1',timeoutMs=Number(values.timeout);
assert.equal(timeoutMs,limits.timeout);assert.ok(process.env.TMPDIR?.startsWith(root+'/tmp/'));
assert.equal(process.env.DEFUSS_VM_CHROME,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
assert.ok(values.output?.startsWith('artifacts/'));const output=inside(root,values.output);await mkdir(output);
const now=()=>({utc:new Date().toISOString(),loadavg:loadavg(),freeMemoryBytes:freemem()});
const report={schema:1,protocol,status:'failed',enabled,timingEligible:false,candidatePromotion:false,productionDefaultEnabled:false,scope,timeoutMs,arguments:[...args],createdUtc:new Date().toISOString(),inputs:{},served:{},pageErrors:[],serverErrors:[],host:{platform:platform(),arch:arch(),release:release(),cpus:cpus().length,before:now()},coldOnly:true,snapshots:0};
let browser,server,watchdog,journal,serialFile,oracle,recordQueue=Promise.resolve(),recordCount=0;const serve=new Map();
try{
 const proof=await verifyAdmissionBinding(root,bindingPath);requireCensusBinding(proof.binding);Object.assign(report.inputs,proof.inputs);
 assert.equal(proof.inputs[bindingPath].sha256,bindingSha256);
 report.runtimeBinding={path:bindingPath,...proof.inputs[bindingPath]};report.graph=proof.graph;report.objects=proof.objects;
 for(const file of runtimeFiles){const path=relative(root,resolve(root,dirname(proof.admissionBinding.buildReport.path),file));serve.set('/'+path,proof.buffers.get(path));}proof.buffers.clear();
 await mkdir(resolve(output,'source'));
 for(const path of sources){const {bytes,id}=await readBound(root,path);if(report.inputs[path])assert.deepEqual(report.inputs[path],id);report.inputs[path]=id;serve.set('/'+path,bytes);const dest=resolve(output,'source',path);await mkdir(dirname(dest),{recursive:true});await durable(dest,bytes);}
 const manifestPath=packagePath+'/app.json',{bytes:manifestBytes,id:manifestId}=await readBound(root,manifestPath);report.inputs[manifestPath]=manifestId;
 const manifest=JSON.parse(manifestBytes);await validateManifest(manifest);assert.equal(manifest.generation,guestGeneration);assert.equal(manifest.appSha256,unchangedGuest.appSha256);assert.equal(manifest.artifacts['initramfs.cpio.gz'].sha256,unchangedGuest.initramfsSha256);assert.equal(manifest.snapshot.readyMode,'manual');
 assert.deepEqual(manifest.vm,{machine:'pc,acpi=off',cpu:'max',ramMiB:512,smp:1,tbMiB:128,hotLimit:1500,runtimeFlags:3});report.guestManifest=manifest;report.guestPackage=packagePath;
 const assets={};for(const name of ['app.mjs','kernel','initramfs.cpio.gz','rom/bios-256k.bin','rom/kvmvapic.bin','rom/linuxboot_dma.bin']){const path=packagePath+'/'+manifest.generation+'/'+name,{bytes,id}=await readBound(root,path,manifest.artifacts[name]);report.inputs[path]=id;serve.set('/'+path,bytes);if(name!=='app.mjs')assets[name]='/'+path;}
 await json(resolve(output,'inputs.json'),{schema:1,protocol,enabled,inputs:report.inputs,sourceArchive:'source/',scope});
 journal=await open(resolve(output,'progress.jsonl'),'wx');serialFile=await open(resolve(output,'serial.log'),'wx');const directory=await open(output,'r');await directory.sync();await directory.close();
 oracle=new Oracle({enabled,graph:proof.graph.text,objects:proof.objects.text});
 server=createServer((req,res)=>{for(const [key,value]of Object.entries({'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'no-store'}))res.setHeader(key,value);
  try{assert.equal(req.method,'GET');const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.end('M3b unchanged Bun cold diagnostic exposure');return;}if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
   const bytes=serve.get(path);assert.ok(bytes,'Unbound resource '+path);const name=path.slice(1),id={sha256:sha(bytes),bytes:bytes.length};assert.deepEqual(id,report.inputs[name]);report.served[name]=id;res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json'})[extname(path)]??'application/octet-stream');res.end(bytes);
  }catch(e){report.serverErrors.push(String(e));res.writeHead(500);res.end(String(e));}});
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
 browser=await chromium.launch({headless:true,executablePath:process.env.DEFUSS_VM_CHROME});report.browser=browser.version();
 watchdog=setTimeout(()=>{report.deadlineExceeded=true;void browser.close();server.closeAllConnections();},timeoutMs+20000);
 const page=await browser.newPage();let rejectFatal;const fatal=new Promise((_,bad)=>rejectFatal=bad);fatal.catch(()=>{});
 page.on('pageerror',error=>{report.pageErrors.push(String(error));rejectFatal(error);});page.on('crash',()=>rejectFatal(Error('Page crash')));
 await page.exposeFunction('__m3bExposureRecord',row=>{recordQueue=recordQueue.then(async()=>{
  const bytes=Buffer.from(JSON.stringify(row)+'\n');assert.ok(bytes.length<=limits.record&&recordCount<limits.records);assert.equal(typeof row.serialChunk,'string');
  // Preserve rejected raw evidence as well as successful observations.
  await serialFile.writeFile(row.serialChunk);await serialFile.sync();await journal.writeFile(bytes);await journal.sync();recordCount++;
  try{oracle.accept(row);}catch(e){report.oracleFailure=String(e.stack??e);throw e;}return {accepted:true};
 });return recordQueue;});
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 report.browserResult=await Promise.race([fatal,page.evaluate(async options=>(await import('/benchmarks/harness/m3b-admission/guest.mjs')).run(options),{runtimeUrl:'/'+proof.runtime+'/qemu-system-x86_64.js',assets,binding:proof.binding,enabled,timeoutMs})]);
 assert.equal(report.browserResult.status,'passed',report.browserResult.failure);assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.serverErrors,[]);
 assert.equal(report.browserResult.serial,oracle.serial);report.summary=oracle.finish();assert.equal(report.browserResult.endStatus.running,false);assert.equal(report.browserResult.endStatus.status,'paused');
 await verifyInputs(root,report.inputs);report.inputsStable=true;report.status='passed';
}catch(e){report.failure=String(e.stack??e);}
finally{
 clearTimeout(watchdog);await recordQueue.catch(()=>{});await journal?.close();await serialFile?.close();
 try{await browser?.close();}catch(e){report.status='failed';report.cleanupFailure=String(e);}if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
 report.host.after=now();report.recordCount=recordCount;report.completedUtc=new Date().toISOString();await json(resolve(output,'report.json'),report);
}
console.log(JSON.stringify({status:report.status,enabled,records:recordCount,summary:report.summary,failure:report.failure}));if(report.status!=='passed')process.exitCode=1;
