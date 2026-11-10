// Separate forced-tier diagnostic. Dump native code without the Debugger domain.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
const [kind,tier,out]=process.argv.slice(2);
assert.ok(['original','candidate'].includes(kind)&&['baseline','optimizing'].includes(tier));
assert.ok(out.startsWith('artifacts/')&&!out.includes('..'));await mkdir(out);
const input='artifacts/rnds2-lanes-node-codegen-01/'+kind+'.wasm',bytes=await readFile(input);
const flags=['--print-wasm-code','--print-wasm-code-function-index=0','--no-wasm-lazy-compilation',tier==='baseline'?'--liftoff-only':'--no-liftoff'];
const report={status:'failed',timingEligible:false,kind,tier,flags,input,sha256:createHash('sha256').update(bytes).digest('hex'),scope:'Forced-tier component lowering in actual Chrome, not a default VM tier or performance measurement'};
const server=createServer((req,res)=>{res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');if(req.url==='/module.wasm'){res.setHeader('Content-Type','application/wasm');res.end(bytes);}else res.end('Untimed lowering diagnostic');});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({headless:true,executablePath:process.env.DEFUSS_VM_CHROME,args:['--js-flags='+flags.join(' ')]});
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 const cdp=await page.context().newCDPSession(page);report.versions=await cdp.send('Browser.getVersion');await cdp.detach();
 report.result=await page.evaluate(async()=>{
  if(!crossOriginIsolated)throw Error('Isolation required');
  const bytes=await(await fetch('/module.wasm')).arrayBuffer(),m=new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
  const v=new DataView(m.memory.buffer);v.setBigUint64(0,64n,true);v.setBigUint64(8,96n,true);v.setBigUint64(16,128n,true);v.setBigUint64(24,7n,true);v.setBigUint64(32,11n,true);
  m.run(0n);const r=(x,n)=>(x>>>n)|(x<<(32-n)),t=((r(7,6)^r(7,11)^r(7,25))+11)>>>0;
  const expected=[7,t,7,(t+(r(7,2)^r(7,13)^r(7,22)))>>>0],actual=Array.from({length:4},(_,i)=>v.getUint32(64+4*i,true));
  if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('Wrong state');return{status:'passed',actual};
 });report.status='passed';
}catch(e){report.failure=String(e.stack??e);}
finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
if(report.status!=='passed')process.exitCode=1;
