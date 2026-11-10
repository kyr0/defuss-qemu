#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {resolve,dirname,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
import {verifyRuntimeIdentity} from './runtime-identity.mjs';
import {openProgress,progressScope} from './progress.mjs';
import {settings} from './contract.mjs';
import {validateTranslationBuffer} from './jit.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
assert.ok(process.env.TMPDIR?.startsWith(root+'/tmp/'),'Run via scripts/with-tmp.py so browser scratch stays in project/tmp');
const {values}=parseArgs({options:{runtime:{type:'string'},fixture:{type:'string'},output:{type:'string'}}});
assert.ok(values.runtime&&values.fixture&&values.output);
const inside=name=>{const p=resolve(root,name);assert.ok(p.startsWith(root+'/'));return p;};
const runtime=inside(values.runtime),fixture=inside(values.fixture),output=inside(values.output);
assert.ok(output.startsWith(root+'/artifacts/'));await mkdir(dirname(output),{recursive:true});await mkdir(output);
// Persist each newly created output/ancestor directory entry before work.
for(let directory=dirname(output);directory===root||directory.startsWith(root+'/');directory=dirname(directory)){
 const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}
}
const sha=b=>createHash('sha256').update(b).digest('hex'),inputs={};
for(const p of [runtime+'/qemu-system-x86_64.js',runtime+'/qemu-system-x86_64.wasm',fixture+'/initramfs.cpio.gz',fixture+'/build-report.json',
 root+'/tests/regions-pressure/guest.mjs',root+'/tests/regions-pressure/run.mjs',root+'/tests/regions-pressure/runtime-identity.mjs',root+'/tests/regions-pressure/progress.mjs',root+'/tests/regions-pressure/contract.mjs',root+'/tests/regions-pressure/jit.mjs',root+'/tests/regions-pressure/build.py',root+'/tests/regions-pressure/fixture.c',root+'/tests/regions-pressure/fixture.S',root+'/experiments/m3a-region/reader.mjs',
 root+'/host/browser/qmp.mjs',root+'/packaging/bun-app/serial.mjs',root+'/assets/bun/amd64/vmlinuz-virt',
 ...['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'].map(name=>root+'/engine/qemu/pc-bios/'+name)])inputs[relative(root,p)]=sha(await readFile(p));
let browser,server,watchdog,runtimeProvenance,progress,report={status:'failed'};
try{
 runtimeProvenance=await verifyRuntimeIdentity({root,runtime});Object.assign(inputs,runtimeProvenance.inputs);
 const build=JSON.parse(await readFile(fixture+'/build-report.json','utf8'));
 assert.equal(build.status,'passed');assert.equal(build.initramfsSha256,inputs[relative(root,fixture+'/initramfs.cpio.gz')]);
 for(const source of ['tests/regions-pressure/build.py','tests/regions-pressure/fixture.c','tests/regions-pressure/fixture.S'])assert.equal(build.sources[source],inputs[source],'Fixture image does not match current source: '+source);
 progress=await openProgress(resolve(output,'progress.jsonl'),{createdUtc:new Date().toISOString(),settings,fixtureScope:'Diagnostic256MiB translation buffer; not production128MiB acceptance',runtimeProvenance,inputs:{...inputs}});
 server=createServer(async(req,res)=>{
  for(const [key,value] of Object.entries({'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-store'}))res.setHeader(key,value);
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name==='/'){res.end('Region retirement pressure fixture');return;}
  const path=resolve(root,'.'+name);if(!path.startsWith(root+'/')){res.writeHead(403);res.end();return;}
  try{const bytes=await readFile(path);const key=relative(root,path),h=sha(bytes);if(inputs[key])assert.equal(inputs[key],h);inputs[key]=h;
   res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream');res.end(bytes);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
 browser=await chromium.launch({headless:true,...(process.env.DEFUSS_VM_CHROME?{executablePath:process.env.DEFUSS_VM_CHROME}:{})});
 watchdog=setTimeout(()=>void browser.close(),1230000);const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.exposeFunction('__recordPressureGate',record=>progress.appendGate(record));
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 report=await page.evaluate(async({runtime,fixture})=>{
  const {runPressureGuest}=await import('/tests/regions-pressure/guest.mjs');
  const bytes=async p=>{const r=await fetch(p);if(!r.ok)throw Error(p);return r.arrayBuffer();},roms={};
  for(const name of ['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'])roms[name]=await bytes('/engine/qemu/pc-bios/'+name);
  return runPressureGuest({runtimeUrl:new URL(runtime+'/qemu-system-x86_64.js',location.href).href,kernel:await bytes('/assets/bun/amd64/vmlinuz-virt'),initramfs:await bytes(fixture+'/initramfs.cpio.gz'),roms});
 },{runtime:'/'+relative(root,runtime),fixture:'/'+relative(root,fixture)});
 report.browser=browser.version();report.pageErrors=errors;assert.ok(['passed','incomplete'].includes(report.status),report.failure);assert.deepEqual(errors,[]);
 assert.equal(report.configuration.phase,'preRun-before-vCPU');assert.equal(report.configuration.hotLimit,1500);assert.equal(report.configuration.flags,3);
 assert.equal(report.settings.instanceLimit,12000);assert.equal(report.finalPool.limit,12000);
 assert.deepEqual(report.settings,settings);assert.equal(report.configuration.tbMiB,256);assert.equal(report.configuration.guestRamMiB,512);
 assert.equal(report.arguments[report.arguments.indexOf('-accel')+1],'tcg,tb-size=256');assert.equal(report.arguments[report.arguments.indexOf('-m')+1],'512');
 for(const row of report.gates)assert.deepEqual(row.jit,validateTranslationBuffer(row),'Native translation-buffer evidence differs');
 assert.deepEqual(report.finalJit,validateTranslationBuffer({jitRaw:report.finalJitRaw,jitStatus:report.finalJitStatus,counters:report.finalCounters}));
 if(report.status==='passed')assert.equal(report.lifetime.selectedReinstantiationObserved,true);
}catch(error){report.status='failed';report.failure=String(error.stack||error);}
finally{
 clearTimeout(watchdog);if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
 if(progress)await progress.close();report.partialProgress=progress?{path:relative(root,resolve(output,'progress.jsonl')),gateRecords:progress.count,scope:progressScope}:null;
 report.inputRecheck=[];
 for(const [name,h] of Object.entries(inputs)){
  try{const actual=sha(await readFile(resolve(root,name)));if(actual!==h)report.inputRecheck.push({name,expected:h,actual});}
  catch(error){report.inputRecheck.push({name,error:String(error)});}
 }
 if(report.inputRecheck.length){report.status='failed';report.failure=(report.failure??'')+'\nInput integrity changed during fixture; raw evidence retained';}
 report.runtimeProvenance=runtimeProvenance??null;report.inputs=inputs;report.scope='Real Linux guest ordinary FIFO retirement, cap and natural reinstantiation diagnostic with256MiB TB buffer; not production128MiB acceptance. Guest512MiB, hard instance cap12000, flags3/hot1500 unchanged. Incomplete natural GC retained separately; not performance evidence';
 await writeFile(resolve(output,'serial.log'),report.serial??'',{flag:'wx'});delete report.serial;
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:report.status,output,failure:report.failure}));
}
process.exitCode=report.status==='passed'?0:report.status==='incomplete'?2:1;
