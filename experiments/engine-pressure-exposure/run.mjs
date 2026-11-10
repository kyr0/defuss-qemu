// Diagnostic fork; original runtime and guest application are unchanged.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,open} from 'node:fs/promises';
import {resolve,dirname,extname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {loadavg,freemem,cpus,platform,arch,release} from 'node:os';
import {chromium} from 'playwright';
import {validateManifest} from '../../packaging/bun-app/vm.mjs';
import {hostConditionIdentity,observeHostCondition,hostMemory} from '../../benchmarks/harness/m2-sustained-v2/host-condition.mjs';
import {planPath,packagePath,guestGeneration,unchangedGuest,limits,args} from '../../benchmarks/harness/m2-msg1-timing/config.mjs';
const protocol='defuss-engine-pressure-exposure-v1';
const scope='Diagnostic pressure-counter exposure of retained RNDS2. Adds existing pressure meter bit to flags3; no CPU profiler, timing, or speedup claim.';
import {Oracle} from '../../benchmarks/harness/m2-msg1-timing/oracle.mjs';
import {sources as originalSources,sha,inside,verifyInputs,durable,json,readBound} from '../../benchmarks/harness/m2-msg1-timing/identity.mjs';
const sources=[...originalSources,'experiments/engine-pressure-exposure/guest.mjs'];
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const {values}=parseArgs({options:{arm:{type:'string'},output:{type:'string'},timeout:{type:'string',default:'1800000'}}});
assert.equal(values.arm,'original');const arm=values.arm,timeoutMs=Number(values.timeout);
assert.equal(timeoutMs,limits.timeout);assert.ok(process.env.TMPDIR?.startsWith(root+'/tmp/'));
assert.equal(process.env.DEFUSS_VM_CHROME,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
assert.ok(values.output?.startsWith('artifacts/'));const output=inside(root,values.output);await mkdir(output);
const now=()=>({utc:new Date().toISOString(),loadavg:loadavg(),freeMemoryBytes:freemem(),cpuTimes:cpus().map(c=>c.times)});
const report={schema:1,protocol,status:'failed',arm,timingEligible:false,candidatePromotion:false,productionDefaultEnabled:false,scope,timeoutMs,arguments:[...args],createdUtc:new Date().toISOString(),inputs:{},served:{},pageErrors:[],serverErrors:[],host:{platform:platform(),arch:arch(),release:release(),cpus:cpus().length,before:now()},coldOnly:true,snapshots:0};
let browser,server,watchdog,hostSampler,journal,serialFile,oracle,recordQueue=Promise.resolve(),recordCount=0;const serve=new Map();
try{
 const plan=JSON.parse(await readFile(resolve(root,planPath)));assert.equal(plan.status,'frozen');await verifyInputs(root,plan.inputs);Object.assign(report.inputs,plan.inputs);report.inputs[planPath]=(await readBound(root,planPath)).id;
 for(const path of ['experiments/engine-pressure-exposure/run.mjs','experiments/engine-pressure-exposure/guest.mjs']){const {bytes,id}=await readBound(root,path);report.inputs[path]=id;await durable(resolve(output,path.split('/').at(-1)),bytes);}
 report.plan=planPath;report.hostCondition=await hostConditionIdentity();report.host.beforeCondition=await observeHostCondition(report.hostCondition);report.host.beforeMemory=await hostMemory();report.host.samples=[now()];hostSampler=setInterval(()=>report.host.samples.push(now()),15000);
 const runtime=plan.runtimes[arm];report.runtime=runtime;
 for(const path of runtime.files){const {bytes}=await readBound(root,path,plan.inputs[path]);serve.set('/'+path,bytes);}
 await mkdir(resolve(output,'source'));
 for(const path of sources){const {bytes,id}=await readBound(root,path);if(report.inputs[path])assert.deepEqual(report.inputs[path],id);report.inputs[path]=id;serve.set('/'+path,bytes);const dest=resolve(output,'source',path);await mkdir(dirname(dest),{recursive:true});await durable(dest,bytes);}
 for(const path of sources){if(!path.endsWith('.mjs'))continue;const bytes=serve.get('/'+path);for(const match of bytes.toString().matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){if(!match[1].startsWith('.'))continue;const target=new URL(match[1],'http://localhost/'+path).pathname;assert.ok(serve.has(target),'Unserved transitive module '+target);}}
 const manifestPath=packagePath+'/app.json',{bytes:manifestBytes,id:manifestId}=await readBound(root,manifestPath);report.inputs[manifestPath]=manifestId;
 const manifest=JSON.parse(manifestBytes);await validateManifest(manifest);assert.equal(manifest.generation,guestGeneration);assert.equal(manifest.appSha256,unchangedGuest.appSha256);assert.equal(manifest.artifacts['initramfs.cpio.gz'].sha256,unchangedGuest.initramfsSha256);assert.equal(manifest.snapshot.readyMode,'manual');
 assert.deepEqual(manifest.vm,{machine:'pc,acpi=off',cpu:'max',ramMiB:512,smp:1,tbMiB:128,hotLimit:1500,runtimeFlags:3});report.guestManifest=manifest;report.guestPackage=packagePath;
 const assets={};for(const name of ['app.mjs','kernel','initramfs.cpio.gz','rom/bios-256k.bin','rom/kvmvapic.bin','rom/linuxboot_dma.bin']){const path=packagePath+'/'+manifest.generation+'/'+name,{bytes,id}=await readBound(root,path,manifest.artifacts[name]);report.inputs[path]=id;serve.set('/'+path,bytes);if(name!=='app.mjs')assets[name]='/'+path;}
 await json(resolve(output,'inputs.json'),{schema:1,protocol,arm,inputs:report.inputs,sourceArchive:'source/',scope});
 journal=await open(resolve(output,'progress.jsonl'),'wx');serialFile=await open(resolve(output,'serial.log'),'wx');const directory=await open(output,'r');await directory.sync();await directory.close();
 oracle=new Oracle({arm});
 server=createServer((req,res)=>{for(const [key,value]of Object.entries({'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'no-store'}))res.setHeader(key,value);
  try{assert.equal(req.method,'GET');const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.end('RNDS2 pressure exposure diagnostic');return;}if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
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
  try{oracle.accept(row);assert.equal(row.pressureCounts.length,7);assert.ok(row.pressureCounts.every(value=>Number.isInteger(value)&&value>=0&&value<=0xffffffff));}catch(e){report.oracleFailure=String(e.stack??e);throw e;}return {accepted:true};
 });return recordQueue;});
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 report.browserResult=await Promise.race([fatal,page.evaluate(async options=>(await import('/experiments/engine-pressure-exposure/guest.mjs')).run(options),{runtimeUrl:'/'+runtime.directory+'/qemu-system-x86_64.js',assets,arm,timeoutMs})]);
 report.browserResult.timingEligible=false;report.browserResult.scope=scope;
 assert.equal(report.browserResult.status,'passed',report.browserResult.failure);assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.serverErrors,[]);
 assert.equal(report.browserResult.serial,oracle.serial);report.summary=oracle.finish();assert.equal(report.browserResult.endStatus.running,false);assert.equal(report.browserResult.endStatus.status,'paused');
 report.host.afterCondition=await observeHostCondition(report.hostCondition);report.host.afterMemory=await hostMemory();
 await verifyInputs(root,report.inputs);report.inputsStable=true;report.status='passed';
}catch(e){report.failure=String(e.stack??e);}
finally{
 clearInterval(hostSampler);clearTimeout(watchdog);await recordQueue.catch(()=>{});await journal?.close();await serialFile?.close();
 try{await browser?.close();}catch(e){report.status='failed';report.cleanupFailure=String(e);}if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
 report.host.after=now();report.recordCount=recordCount;report.completedUtc=new Date().toISOString();await json(resolve(output,'report.json'),report);
}
console.log(new Date().toISOString()+' '+(report.status==='passed'?'INFO':'ERROR')+' diagnostic '+JSON.stringify({status:report.status,arm,records:recordCount,nonce:report.summary?.nonce,horizonMs:report.summary?.horizonMs,failure:report.failure}));if(report.status!=='passed')process.exitCode=1;
