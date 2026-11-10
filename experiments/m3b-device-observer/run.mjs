#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,mkdir,open,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
import {hostConditionIdentity,observeHostCondition} from '../../benchmarks/harness/m2-sustained-v2/host-condition.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const {values}=parseArgs({options:{mode:{type:'string'},output:{type:'string'},timeout:{type:'string',default:'180000'}}});
assert.equal(values.mode,'off','Only explicit --mode off is accepted');assert.ok(values.output);
const timeoutMs=Number(values.timeout);assert.ok(Number.isInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=300000);
const chromePath='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
assert.equal(process.env.DEFUSS_VM_CHROME,chromePath,'Explicit real Chrome required');
assert.equal(await realpath(chromePath),chromePath,'Chrome path must resolve to the explicit application executable');
for(const key of ['TMPDIR','TMP','TEMP'])assert.ok(process.env[key]&&
 (await realpath(process.env[key])).startsWith(root+'/tmp/'),'Use scripts/with-tmp.py: '+key);
const output=resolve(root,values.output);assert.equal(dirname(output),root+'/artifacts');
assert.equal(await realpath(root+'/artifacts'),root+'/artifacts');await mkdir(output);
const syncDir=async p=>{const h=await open(p,'r');try{await h.sync();}finally{await h.close();}};
await syncDir(dirname(output));
const durable=async(name,value)=>{const h=await open(resolve(output,name),'wx',0o600);
 try{await h.writeFile(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}await syncDir(output);};
const runtime='artifacts/m3a-build-01/runtime/x86_64',fixture='artifacts/m3-region-fixture-02';
const hostConditionSource='benchmarks/harness/m2-sustained-v2/host-condition.mjs';
const hostConditionSourceSha='29aaa0118a459c1e7bd76cdee0e6ed8c83b053dfc9e8c7bda827226ec2dd3c2f';
const metadata={
 'artifacts/m3a-build-01/build-report.json':'86537d2bd206097fb36303a15b0563a96404aca24332c25ac2bc164d387d643c',
 'artifacts/m3a-build-01/source-recheck.json':'078bb8264b4cfb52a32ad2aac29cbc8a2634b4859bf90a863a5ff340b4711099',
 'artifacts/m3a-source-04/source-m3-overlay.json':'382f59faebb37a485a02797475438091546ce5dd3d914794c824a474e018e359',
 'artifacts/m3-region-fixture-02/build-report.json':'1a48e0875417e9616b6febb20985fa59603701d81babae51a22e6ad955f295c6',
 'artifacts/m3-region-fixture-source-05.json':'f004b82803dd382966842027496ca641e7f69369801c36d89755670bf4e1631c',
 'artifacts/m3-region-on-03/report.json':'d93f8784feded20469bb79ed7b33cbd1661d8392964502bf0fd2f95f0d75b1d2',
};
const sources=['run.mjs','browser.mjs','graph.mjs','test-graph.mjs','README.md'].map(n=>'experiments/m3b-device-observer/'+n);
const browserSources=['experiments/m3b-device-observer/browser.mjs','experiments/m3b-device-observer/graph.mjs',
 'experiments/m3a-region/reader.mjs','host/browser/qmp.mjs','host/browser/machine.mjs'];
const inputs={},served={},files=new Map();let server,browser,context,watchdog,closing=false,events,queue=Promise.resolve(),logFailure=null,records=0,eventBytes=0,hostCondition;
let report={schema:1,protocol:'defuss-m3b-device-observation-v1',status:'failed',mode:'off',timingEligible:false,eligibilityEstablished:false};
let rejectFatal;const fatal=new Promise((_,reject)=>rejectFatal=reject);fatal.catch(()=>{});
const record=async value=>{
 try{
  if(logFailure)throw logFailure;
  const b=Buffer.from(JSON.stringify({...value,schema:1,recordSequence:records,utc:new Date().toISOString()})+'\n');
  assert.ok(records<40000&&b.length<=1024*1024+4096&&eventBytes+b.length<=32*1024*1024,'Durable event bounds');
  records++;eventBytes+=b.length;queue=queue.then(async()=>{await events.writeFile(b);await events.sync();});await queue;
 }catch(e){logFailure=e;rejectFatal(e);throw e;}
};
const readInput=async(name,expected)=>{
 const path=resolve(root,name);assert.ok(path.startsWith(root+'/'));assert.equal(await realpath(path),path,'No symlink input');
 const bytes=await readFile(path),h=sha(bytes);if(expected)assert.equal(h,expected,'Pinned input '+name);
 if(inputs[name])assert.equal(inputs[name].sha256,h);inputs[name]={sha256:h,bytes:bytes.length};files.set('/'+name,bytes);return bytes;
};
await durable('request.json',{schema:1,kind:'m3b-device-observation-request',createdUtc:new Date().toISOString(),pid:process.pid,
 argv:process.argv,mode:'off',timeoutMs,runtime,fixture,chromePath,scope:'OFF-only prelaunch observation. No guest continuation, snapshot, or fusion eligibility.'});
try{
 events=await open(resolve(output,'events.jsonl'),'wx',0o600);await syncDir(output);await record({event:'runner-start',mode:'off'});
 await readInput(hostConditionSource,hostConditionSourceSha);
 hostCondition={configuration:await hostConditionIdentity()};
 // The fixed helper owns this external executable identity. It is recorded,
 // rechecked after the run, and never exposed through the asset server.
 inputs[relative(root,hostCondition.configuration.executable)]={sha256:hostCondition.configuration.sha256,bytes:hostCondition.configuration.bytes};
 try{hostCondition.before=await observeHostCondition(hostCondition.configuration);}
 catch(e){hostCondition.before=e.observation??{error:String(e),stdout:e.stdout??'',stderr:e.stderr??''};throw e;}
 await record({event:'host-condition-before',value:hostCondition});
 for(const [name,h] of Object.entries(metadata))await readInput(name,h);
 const build=JSON.parse(files.get('/artifacts/m3a-build-01/build-report.json'));
 assert.equal(build.status,'passed');assert.equal(build.sourceFingerprint,'b517b8d6c23d67db7e74fe4d2d5c4ff421693cb01b86c8666ffba006ca772d49');
 for(const [name,id] of Object.entries(build.artifacts)){
  const bytes=await readInput('artifacts/m3a-build-01/'+name,id.sha256);assert.equal(bytes.length,id.bytes);
 }
 const historical=JSON.parse(files.get('/artifacts/m3-region-on-03/report.json'));
 const imageBuild=JSON.parse(files.get('/'+fixture+'/build-report.json'));
 assert.equal(imageBuild.status,'passed');await readInput(fixture+'/initramfs.cpio.gz',imageBuild.initramfsSha256);
 for(const name of ['assets/bun/amd64/vmlinuz-virt',...['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'].map(n=>'engine/qemu/pc-bios/'+n)]){
  assert.match(historical.inputs[name],/^[a-f0-9]{64}$/);await readInput(name,historical.inputs[name]);
 }
 for(const name of [...new Set([...sources,...browserSources,'scripts/with-tmp.py','package.json','package-lock.json'])])await readInput(name);
 assert.equal(inputs['experiments/m3a-region/reader.mjs'].sha256,'e54b4e804d9631039677e097646c766f68892fbec7dcfeb24890db96fae973af');
 const payloads=[runtime+'/qemu-system-x86_64.js',runtime+'/qemu-system-x86_64.wasm',fixture+'/initramfs.cpio.gz',
  'assets/bun/amd64/vmlinuz-virt',...['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'].map(n=>'engine/qemu/pc-bios/'+n)];
 const serveNames=new Set([...browserSources,...payloads,...Object.keys(build.artifacts).map(n=>'artifacts/m3a-build-01/'+n)]);
 await durable('preflight.json',{schema:1,mode:'off',runtime,fixture,timeoutMs,chromePath,hostCondition,inputs});
 server=createServer((req,res)=>{
  for(const [k,v] of Object.entries({'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-store'}))res.setHeader(k,v);
  try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   if(name==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>M3b OFF-only graph observer</title>');return;}
   if(!serveNames.has(name.slice(1))){res.writeHead(404);res.end();return;}
   const b=files.get(name);assert.ok(b);served[name.slice(1)]=inputs[name.slice(1)];
   res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm'})[extname(name)]??'application/octet-stream');res.end(b);
  }catch(e){rejectFatal(e);res.writeHead(500);res.end();}
 });
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
 watchdog=setTimeout(()=>rejectFatal(Error('Host OFF observer deadline exceeded')),timeoutMs+20000);
 browser=await chromium.launch({headless:true,timeout:Math.min(timeoutMs,60000),executablePath:chromePath});
 context=await browser.newContext();const page=await context.newPage();
 const event=(name,text)=>{void record({event:name,text:String(text).slice(0,65536)}).catch(()=>{});};
 const fail=(name,text)=>{event(name,text);rejectFatal(Error(name+': '+text));};
 page.on('pageerror',e=>fail('pageerror',e.stack??e));page.on('crash',()=>fail('page-crash','Owned page crashed'));
 browser.on('disconnected',()=>{if(!closing)fail('browser-disconnected','Owned browser disconnected');});
 page.on('console',m=>event('console-'+m.type(),m.text()));
 page.on('worker',w=>event('worker-created',w.url()));
 await page.exposeFunction('__recordM3bDevice',record);await page.goto('http://127.0.0.1:'+server.address().port+'/',{timeout:Math.min(timeoutMs,60000)});
 report=await Promise.race([fatal,page.evaluate(async({runtime,fixture,timeoutMs})=>{
  const {observeMachine}=await import('/experiments/m3b-device-observer/browser.mjs');
  const get=async path=>{const r=await fetch(path);if(!r.ok)throw Error(path);return r.arrayBuffer();};
  const roms={};for(const n of ['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'])roms[n]=await get('/engine/qemu/pc-bios/'+n);
  return observeMachine({runtimeUrl:new URL('/'+runtime+'/qemu-system-x86_64.js',location.href).href,
   kernel:await get('/assets/bun/amd64/vmlinuz-virt'),initramfs:await get('/'+fixture+'/initramfs.cpio.gz'),roms,mode:'off',timeoutMs});
 },{runtime,fixture,timeoutMs})]);
 report.browser=browser.version();assert.equal(report.status,'observed',report.failure);
 for(const name of [...browserSources,...payloads])assert.deepEqual(served[name],inputs[name],'Required served identity '+name);
 assert.equal(report.graph.completeness.nativeBlkAllNextVerified,false);assert.equal(report.eligibilityEstablished,false);
}catch(e){report.status='failed';report.failure=String(e.stack??e);}
finally{
 clearTimeout(watchdog);closing=true;
 for(const close of [()=>context?.close(),()=>browser?.close(),async()=>{if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}}]){
  try{await close();}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nCleanup: '+e;}
 }
 if(hostCondition){
  try{hostCondition.after=await observeHostCondition(hostCondition.configuration);}
  catch(e){hostCondition.after=e.observation??{error:String(e),stdout:e.stdout??'',stderr:e.stderr??''};
   report.status='failed';report.failure=(report.failure??'')+'\nCompiler VM host condition failed: '+e;}
  if(events)try{await record({event:'host-condition-after',value:hostCondition.after});}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nHost-condition evidence: '+e;}
 }
 if(events){try{await queue;if(logFailure)throw logFailure;}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nEvents: '+e;}finally{await events.close();}}
 report.inputRecheck=[];for(const [name,id] of Object.entries(inputs)){
  try{assert.equal(sha(await readFile(resolve(root,name))),id.sha256);}catch(e){report.inputRecheck.push({path:name,error:String(e)});}
 }
 if(report.inputRecheck.length){report.status='failed';report.failure=(report.failure??'')+'\nInput drift';}
 report.inputs=inputs;report.served=served;report.timeoutMs=timeoutMs;report.chromePath=chromePath;report.hostCondition=hostCondition??null;report.completedUtc=new Date().toISOString();
 report.timingEligible=false;report.eligibilityEstablished=false;report.hiddenBackendCount=null;
 report.scope='OFF-only frozen M3a runtime at -S prelaunch. No M3b implementation, guest execution, snapshot or lifecycle enforcement acceptance. Native all-backend zero and future graph fences remain required.';
 const artifacts={};for(const [name,text] of [['qmp.log',report.rawQmp??''],['qtree.txt',report.graph?.qtree??''],['serial.log',report.serial??'']]){
  await durable(name,text);artifacts[name]={bytes:Buffer.byteLength(text),sha256:sha(text)};
 }
 if(events){const b=await readFile(resolve(output,'events.jsonl'));artifacts['events.jsonl']={bytes:b.length,sha256:sha(b),records};}
 report.artifacts=artifacts;delete report.rawQmp;delete report.serial;if(report.graph)delete report.graph.qtree;
 await durable('report.json',report);console.log(JSON.stringify({status:report.status,output:relative(root,output),failure:report.failure}));
}
process.exitCode=report.status==='observed'?0:1;
