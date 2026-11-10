import assert from 'node:assert/strict';
import {readFile,mkdir,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,extname} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
const root=process.cwd();
const [mode,output]=process.argv.slice(2);
assert.ok(['native','hot','cold','pshufb','production','rnds2'].includes(mode));
assert.ok(output?.startsWith('artifacts/')&&!output.includes('..'));
assert.ok(process.env.TMPDIR.startsWith(root+'/tmp/'));
await mkdir(output);
const diagnostic=['native','hot','cold'].includes(mode);
const runtime=`artifacts/rnds2-lanes${diagnostic?'-check':''}-build-01/runtime/x86_64`;
const fixture=mode==='pshufb'?'pshufb':['hot','cold','rnds2'].includes(mode)?'rnds2':'setup';
const report={status:'failed',mode,runtime,fixture,inputs:{},served:{},pageErrors:[]};
const allowed=['experiments/rnds2-setup/fixture-guest.mjs','experiments/rnds2-lanes/fixture-run.mjs','tests/bun/fixture-config.mjs','host/browser/qmp.mjs','host/browser/machine.mjs','packaging/bun-app/serial.mjs','assets/bun/amd64/vmlinuz-virt',
 `artifacts/rnds2-setup-fixtures-01/${fixture}/initramfs.cpio.gz`,...['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'].map(n=>'engine/qemu/pc-bios/'+n),...['js','wasm'].map(s=>runtime+'/qemu-system-x86_64.'+s)];
const files=new Map();
for(const name of allowed){const bytes=await readFile(name);files.set('/'+name,bytes);report.inputs[name]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};}
// Refuse an incomplete static import closure before creating a browser.
for(const [name,bytes]of files){if(!name.endsWith('.mjs')&&!name.endsWith('.js'))continue;if(name.startsWith('/artifacts/'))continue;for(const match of bytes.toString().matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){if(!match[1].startsWith('.'))continue;const target=new URL(match[1],'http://localhost'+name).pathname;assert.ok(files.has(target),'Unserved transitive import '+target);}}
const durable=async(path,data)=>{const f=await open(path,'wx');try{await f.writeFile(data);await f.sync();}finally{await f.close();}};
await durable(output+'/inputs.json',JSON.stringify(report.inputs,null,2)+'\n');
const journal=await open(output+'/gates.jsonl','wx');
const server=createServer((req,res)=>{
 for(const [k,v]of Object.entries({'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-store'}))res.setHeader(k,v);
 const name=new URL(req.url,'http://localhost').pathname;
 if(name==='/'){res.end('RNDS2 scalar-lane correctness');return;}if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}
 const bytes=files.get(name);if(!bytes){res.writeHead(404);res.end();return;}
 report.served[name]=report.inputs[name.slice(1)];res.setHeader('Content-Type',extname(name)==='.wasm'?'application/wasm':'text/javascript');res.end(bytes);
});
let browser,watchdog;
try{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 browser=await chromium.launch({headless:true,executablePath:process.env.DEFUSS_VM_CHROME});report.browser=browser.version();
 watchdog=setTimeout(()=>void browser.close(),1820000);
 const page=await browser.newPage();page.on('pageerror',e=>report.pageErrors.push(String(e)));
 await page.exposeFunction('__setupGate',async gate=>{await journal.writeFile(JSON.stringify(gate)+'\n');await journal.sync();return true;});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const result=await page.evaluate(async({runtime,fixture,mode,diagnostic})=>{
  const runtimeUrl=new URL('/'+runtime+'/qemu-system-x86_64.js',location.href).href;
  if(mode==='native'){
   const {default:factory}=await import(runtimeUrl);
   const m=await factory({noInitialRun:true,mainScriptUrlOrBlob:runtimeUrl});
   const tests={};for(const suffix of ['guard_selftest','helper_selftest']){tests[suffix]=m['_defuss_inline_rnds2_'+suffix]();if(tests[suffix]!==0)throw Error(suffix+': '+tests[suffix]);}
   return {status:'passed',tests,unwind:m.pcUnwindStatus()};
  }
  const get=async p=>{const r=await fetch('/'+p);if(!r.ok)throw Error(p);return r.arrayBuffer();};
  const roms={};for(const n of ['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'])roms[n]=await get('engine/qemu/pc-bios/'+n);
  const {runGuest}=await import('/experiments/rnds2-setup/fixture-guest.mjs');
  return runGuest({runtimeUrl,fixture,roms,kernel:await get('assets/bun/amd64/vmlinuz-virt'),initramfs:await get(`artifacts/rnds2-setup-fixtures-01/${fixture}/initramfs.cpio.gz`),cold:mode==='cold',hotLimit:mode==='cold'?65535:1500,counterKind:diagnostic?'rnds2':null,timeoutMs:1800000});
 },{runtime,fixture,mode,diagnostic});
 report.result=result;assert.equal(result.status,'passed',result.failure);assert.deepEqual(report.pageErrors,[]);report.status='passed';
}catch(e){report.failure=String(e.stack??e);}
finally{
 clearTimeout(watchdog);await browser?.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));await journal.close();
 if(report.result?.serial){await durable(output+'/serial.log',report.result.serial);delete report.result.serial;}
 for(const [name,id]of Object.entries(report.inputs)){const b=await readFile(name);assert.equal(createHash('sha256').update(b).digest('hex'),id.sha256);}
 await durable(output+'/report.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({status:report.status,mode,failure:report.failure,tests:report.result?.tests,fixturePass:report.result?.fixturePass}));if(report.status!=='passed')process.exitCode=1;
