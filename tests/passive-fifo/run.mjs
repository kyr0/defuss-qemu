#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {resolve,dirname,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
import {verifyIdentity} from './identity.mjs';
import {sha} from './derive.mjs';
import {openProgress,progressScope} from './progress.mjs';
import {openEvents,validateEvents} from './events.mjs';
import {settings,mainOrder,validateMainOracle} from './contract.mjs';
import {hostConditionIdentity,observeHostCondition} from '../../benchmarks/harness/m2-sustained-v2/host-condition.mjs';
import {replayPolicyReport} from './replay.mjs';
import {validateSerial} from './serial.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
assert.ok(process.env.TMPDIR?.startsWith(root+'/tmp/'),'Run through scripts/with-tmp.py');
const {values}=parseArgs({options:{runtime:{type:'string'},binding:{type:'string'},image:{type:'string'},fixture:{type:'string'},enabled:{type:'string'},output:{type:'string'}}});
assert.ok(values.runtime&&values.binding&&values.image&&values.output&&['main','pressure','combined'].includes(values.fixture)&&['0','1'].includes(values.enabled));
const inside=name=>{const p=resolve(root,name);assert.ok(p.startsWith(root+'/'));return p;};
const runtime=inside(values.runtime),bindingPath=inside(values.binding),fixturePath=inside(values.image),output=inside(values.output);
assert.ok(output.startsWith(root+'/artifacts/'));await mkdir(dirname(output),{recursive:true});await mkdir(output);
for(let directory=dirname(output);directory===root||directory.startsWith(root+'/');directory=dirname(directory)){const h=await open(directory,'r');try{await h.sync();}finally{await h.close();}}
const inputs={};let browser,server,watchdog,startupTimer,provenance,progress,events,hostCondition,report={status:'failed',timingEligible:false};
const errors=[];let failRun;const failed=new Promise((_,reject)=>{failRun=reject;});failed.catch(()=>{});
const recordEvent=async value=>{try{await events.append(value);}catch(e){failRun(e);throw e;}};
try{
 events=await openEvents(resolve(output,'events.jsonl'));await recordEvent({event:'runner-start',fixture:values.fixture,enabled:values.enabled==='1'});
 provenance=await verifyIdentity({root,bindingPath,runtime,fixturePath,fixture:values.fixture});Object.assign(inputs,provenance.inputs);
 for(const name of ['tests/passive-fifo/run.mjs','tests/passive-fifo/guest.mjs','tests/passive-fifo/contract.mjs','tests/passive-fifo/identity.mjs','tests/passive-fifo/bind.py','tests/passive-fifo/derive.mjs','tests/passive-fifo/observer.js','experiments/passive-fifo/reader.mjs','host/browser/qmp.mjs','packaging/bun-app/serial.mjs','tests/regions-pressure/progress.mjs','assets/bun/amd64/vmlinuz-virt',...['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'].map(n=>'engine/qemu/pc-bios/'+n)])inputs[name]=sha(await readFile(resolve(root,name)));
 for(const [name,text]of [['derived-runtime.js',provenance.derived.output],['derivation.json',JSON.stringify(provenance.derived.derivation,null,2)+'\n']]){const h=await open(resolve(output,name),'wx');try{await h.writeFile(text);await h.sync();}finally{await h.close();}}
 inputs['tests/regions-pressure/jit.mjs']=sha(await readFile(resolve(root,'tests/regions-pressure/jit.mjs')));
 inputs['tests/passive-fifo/progress.mjs']=sha(await readFile(resolve(root,'tests/passive-fifo/progress.mjs')));
 inputs['tests/passive-fifo/build-combined.py']=sha(await readFile(resolve(root,'tests/passive-fifo/build-combined.py')));
 inputs['tests/passive-fifo/replay.mjs']=sha(await readFile(resolve(root,'tests/passive-fifo/replay.mjs')));
 inputs['tests/passive-fifo/events.mjs']=sha(await readFile(resolve(root,'tests/passive-fifo/events.mjs')));
 inputs['tests/passive-fifo/serial.mjs']=sha(await readFile(resolve(root,'tests/passive-fifo/serial.mjs')));
 inputs['benchmarks/harness/m2-sustained-v2/host-condition.mjs']=sha(await readFile(resolve(root,'benchmarks/harness/m2-sustained-v2/host-condition.mjs')));
 progress=await openProgress(resolve(output,'progress.jsonl'),{utc:new Date().toISOString(),kind:'passive-fifo-diagnostic',settings,fixture:values.fixture,enabled:values.enabled==='1',binding:provenance.binding,derivation:provenance.derived.derivation,inputs:{...inputs}});
 server=createServer(async(req,res)=>{
  for(const [k,v]of Object.entries({'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-store'}))res.setHeader(k,v);
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/'){res.end('Passive FIFO diagnostic fixture');return;}
  const path=resolve(root,'.'+name);if(!path.startsWith(root+'/')){res.writeHead(403);res.end();return;}
  try{const bytes=await readFile(path),key=relative(root,path),h=sha(bytes);if(inputs[key])assert.equal(inputs[key],h);inputs[key]=h;
   res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream');
   res.end(path===resolve(runtime,'qemu-system-x86_64.js')?provenance.derived.output:bytes);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
 hostCondition={configuration:await hostConditionIdentity()};hostCondition.before=await observeHostCondition(hostCondition.configuration);
 browser=await chromium.launch({headless:true,...(process.env.DEFUSS_VM_CHROME?{executablePath:process.env.DEFUSS_VM_CHROME}:{})});
 watchdog=setTimeout(()=>{void recordEvent({event:'host-deadline'}).finally(()=>failRun(Error('Host guest deadline exceeded'))).catch(()=>{});},settings.timeoutMs+30000);
 const page=await browser.newPage();
 const fatal=(event,text)=>{if(errors.length<4096)errors.push(String(text).slice(0,65536));void recordEvent({event,text:String(text)}).finally(()=>failRun(Error(event+': '+String(text).slice(0,65536)))).catch(()=>{});};
 page.on('pageerror',e=>fatal('pageerror',e.stack??String(e)));page.on('crash',()=>fatal('page-crash','Browser page crashed'));
 page.on('console',message=>{void recordEvent({event:'console',type:message.type(),text:message.text(),location:message.location()}).catch(()=>{});});
 page.on('worker',worker=>{void recordEvent({event:'worker-created',url:worker.url()}).catch(()=>{});worker.on('close',()=>{void recordEvent({event:'worker-closed',url:worker.url()}).catch(()=>{});});});
 await page.exposeFunction('__recordPolicyEvent',recordEvent);
 await page.exposeFunction('__recordPolicyGate',async row=>{await progress.appendGate(row);if(row.sequence===0){clearTimeout(startupTimer);await recordEvent({event:'first-stopped-gate'});}});await page.goto('http://127.0.0.1:'+server.address().port+'/');
 startupTimer=setTimeout(()=>{void recordEvent({event:'startup-deadline',timeoutMs:settings.startupTimeoutMs}).finally(()=>failRun(Error('No first stopped gate within startup deadline'))).catch(()=>{});},settings.startupTimeoutMs);
 report=await Promise.race([failed,page.evaluate(async({runtime,image,enabled,fixture})=>{
  const {runPolicyGuest}=await import('/tests/passive-fifo/guest.mjs');
  const bytes=async p=>{const r=await fetch(p);if(!r.ok)throw Error(p);return r.arrayBuffer();},roms={};
  for(const name of ['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'])roms[name]=await bytes('/engine/qemu/pc-bios/'+name);
  return runPolicyGuest({runtimeUrl:new URL(runtime+'/qemu-system-x86_64.js',location.href).href,kernel:await bytes('/assets/bun/amd64/vmlinuz-virt'),initramfs:await bytes(image+'/initramfs.cpio.gz'),roms,enabled,fixture});
 },{runtime:'/'+relative(root,runtime),image:'/'+relative(root,fixturePath),enabled:values.enabled==='1',fixture:values.fixture})]);
 clearTimeout(startupTimer);report.browser=browser.version();report.pageErrors=errors;assert.ok(['passed','incomplete'].includes(report.status),report.failure);assert.deepEqual(errors,[]);
 assert.deepEqual(report.settings,settings);assert.equal(report.enabled,values.enabled==='1');assert.equal(report.configuration.phase,'preRun-before-vCPU');assert.equal(report.configuration.diagnostic,true);
 assert.equal(report.arguments[report.arguments.indexOf('-accel')+1],'tcg,tb-size=256');assert.equal(report.arguments[report.arguments.indexOf('-m')+1],'512');
 for(const row of report.gates){assert.equal(row.status.running,false);assert.equal(row.status.status,'paused');assert.equal(row.snapshot.budget,12000);}
 if(values.fixture!=='pressure'&&report.status==='passed'){const gates=report.gates.filter(g=>g.fixturePhase==='main');assert.deepEqual(gates.map(g=>g.stage),mainOrder);validateMainOracle({...report,gates});}
 if(values.fixture!=='main'&&report.status==='passed'){
  assert.equal(report.trace.phase,3);assert.ok(report.trace.rows.some(r=>r[0]===8));assert.ok(report.final.observer.matchedEpisodes>0);
  if(values.enabled==='1'){assert.ok(report.final.snapshot.counters.softBatches>=2);assert.ok(report.final.snapshot.counters.gcConsumed>=256);}
 }
 report.protocolReplay=replayPolicyReport(report);
 if(report.status==='passed')report.serialReplay=validateSerial(report,report.serial);
}catch(error){report.status='failed';report.failure=String(error.stack||error);if(error.observation)report.failedObservation=error.observation;}
finally{
 clearTimeout(watchdog);clearTimeout(startupTimer);if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}if(progress)await progress.close();
 report.pageErrors=errors;if(events){try{await events.close();}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nEvent log write failed: '+String(e);}const bytes=await readFile(resolve(output,'events.jsonl'));report.diagnosticEvents={path:'events.jsonl',sha256:sha(bytes),bytes:bytes.length,records:events.count,scope:'Bounded durable host/page/worker-console/runtime-stderr evidence; not guest acceptance.'};if(['passed','incomplete'].includes(report.status)){try{report.eventReplay=validateEvents(bytes,report.diagnosticEvents);}catch(e){report.status='failed';report.failure=String(e);}}}
 if(hostCondition?.before){try{hostCondition.after=await observeHostCondition(hostCondition.configuration);}catch(e){hostCondition.after=e.observation??{error:String(e)};report.status='failed';report.failure=(report.failure??'')+'\nCompiler VM host condition failed';}}report.hostCondition=hostCondition??null;
 report.partialProgress=progress?{path:relative(root,resolve(output,'progress.jsonl')),rows:progress.count,scope:progressScope}:null;report.inputRecheck=[];
 for(const [name,expected]of Object.entries(inputs)){try{const actual=sha(await readFile(resolve(root,name)));if(actual!==expected)report.inputRecheck.push({name,expected,actual});}catch(e){report.inputRecheck.push({name,error:String(e)});}}
 if(report.inputRecheck.length){report.status='failed';report.failure=(report.failure??'')+'\nInput integrity drift';}
 report.provenance=provenance?{binding:provenance.binding,fixtureBuild:provenance.fixtureBuild,derivation:provenance.derived.derivation}:null;report.inputs=inputs;report.timingEligible=false;
 report.serialSha256=sha(report.serial??'');
 for(const [name,text]of [['serial.log',report.serial??''],['report.json',JSON.stringify({...report,serial:undefined},null,2)+'\n']]){const h=await open(resolve(output,name),'wx');try{await h.writeFile(text);await h.sync();}finally{await h.close();}}
 const dir=await open(output,'r');try{await dir.sync();}finally{await dir.close();}
 console.log(JSON.stringify({status:report.status,output,failure:report.failure}));
}
process.exitCode=report.status==='passed'?0:report.status==='incomplete'?2:1;
