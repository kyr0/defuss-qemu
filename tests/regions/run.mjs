#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const {values}=parseArgs({options:{runtime:{type:'string'},fixture:{type:'string'},output:{type:'string'},enabled:{type:'string'}}});
assert.ok(values.runtime&&values.fixture&&values.output&&['0','1'].includes(values.enabled));
const inside=name=>{const p=resolve(root,name);assert.ok(p.startsWith(root+'/'));return p;};
const runtime=inside(values.runtime),fixture=inside(values.fixture),output=inside(values.output);
assert.ok(output.startsWith(root+'/artifacts/'));await mkdir(dirname(output),{recursive:true});await mkdir(output);
const sha=b=>createHash('sha256').update(b).digest('hex'),inputs={};
for(const p of [runtime+'/qemu-system-x86_64.js',runtime+'/qemu-system-x86_64.wasm',fixture+'/initramfs.cpio.gz',fixture+'/build-report.json',
 root+'/tests/regions/guest.mjs',root+'/tests/regions/run.mjs',root+'/tests/regions/build.py',root+'/tests/regions/fixture.c',root+'/tests/regions/fixture.S',root+'/experiments/m3a-region/reader.mjs'])inputs[relative(root,p)]=sha(await readFile(p));
let browser,server,watchdog,report={status:'failed'};
try{
 const build=JSON.parse(await readFile(fixture+'/build-report.json','utf8'));
 assert.equal(build.status,'passed');assert.equal(build.initramfsSha256,inputs[relative(root,fixture+'/initramfs.cpio.gz')]);
 for(const source of ['tests/regions/build.py','tests/regions/fixture.c','tests/regions/fixture.S'])assert.equal(build.sources[source],inputs[source],'Fixture image does not match current source: '+source);
 server=createServer(async(req,res)=>{
  for(const [key,value] of Object.entries({'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-store'}))res.setHeader(key,value);
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name==='/'){res.end('Region differential fixture');return;}
  const path=resolve(root,'.'+name);if(!path.startsWith(root+'/')){res.writeHead(403);res.end();return;}
  try{const bytes=await readFile(path);const key=relative(root,path),h=sha(bytes);if(inputs[key])assert.equal(inputs[key],h);inputs[key]=h;
   res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream');res.end(bytes);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
 browser=await chromium.launch({headless:true,...(process.env.DEFUSS_VM_CHROME?{executablePath:process.env.DEFUSS_VM_CHROME}:{})});
 watchdog=setTimeout(()=>void browser.close(),330000);const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 report=await page.evaluate(async({runtime,fixture,enabled})=>{
  const {runRegionGuest}=await import('/tests/regions/guest.mjs');
  const bytes=async p=>{const r=await fetch(p);if(!r.ok)throw Error(p);return r.arrayBuffer();},roms={};
  for(const name of ['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'])roms[name]=await bytes('/engine/qemu/pc-bios/'+name);
  return runRegionGuest({runtimeUrl:new URL(runtime+'/qemu-system-x86_64.js',location.href).href,kernel:await bytes('/assets/bun/amd64/vmlinuz-virt'),initramfs:await bytes(fixture+'/initramfs.cpio.gz'),roms,enabled});
 },{runtime:'/'+relative(root,runtime),fixture:'/'+relative(root,fixture),enabled:values.enabled==='1'});
 report.browser=browser.version();report.pageErrors=errors;assert.equal(report.status,'passed',report.failure);assert.deepEqual(errors,[]);
 assert.equal(report.configuration.phase,'preRun-before-vCPU');assert.equal(report.configuration.enabled,values.enabled==='1');
 for(const settings of [report,report.configuration]){
  assert.equal(settings.hotLimit,1500);assert.equal(settings.flags,2);assert.equal(settings.admission,false);assert.equal(settings.rep16,true);assert.equal(settings.instanceLimit,12000);
 }
 assert.deepEqual(report.gateObservations.map(g=>g.stage),[-1,0,5,6,7,11,14,15,1,10,16,17,2,12,3,13,4]);
 assert.equal(report.finalPool.limit,12000);
 for(const gate of report.gateObservations){assert.equal(gate.status.running,false);assert.equal(gate.status.status,'paused');assert.equal(gate.pool.limit,12000);}
}catch(error){report.status='failed';report.failure=String(error.stack||error);}
finally{
 clearTimeout(watchdog);if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
 for(const [name,h] of Object.entries(inputs))assert.equal(sha(await readFile(resolve(root,name))),h,'Input changed during fixture');
 report.inputs=inputs;report.scope='Real Linux guest state/fault/SMC/interrupt/suspension fixture, with exact selected-PC-range exposure; not performance evidence';
 await writeFile(resolve(output,'serial.log'),report.serial??'',{flag:'wx'});delete report.serial;
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:report.status,output,failure:report.failure}));
}
process.exitCode=report.status==='passed'?0:1;
