import assert from 'node:assert/strict';
import {mkdir,readFile,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {loadavg} from 'node:os';
import {chromium} from 'playwright';
import {probe,helperBytes,sameBytes,importedBytes} from './boundaries.mjs';
const out=process.argv[2];assert.ok(out?.startsWith('artifacts/')&&!out.includes('..'));await mkdir(out);
assert.ok(!process.env.NODE_OPTIONS,'Controlled Node probe requires no NODE_OPTIONS override');
const save=async(n,x)=>{const f=await open(out+'/'+n,'wx');await f.writeFile(typeof x==='string'||x instanceof Uint8Array?x:JSON.stringify(x,null,2)+'\n');await f.sync();await f.close();};
const inputs={};for(const n of ['experiments/engine-cost/boundaries.mjs','experiments/engine-cost/run.mjs']){const b=await readFile(n);inputs[n]={sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length};}
await save('inputs.json',inputs);for(const [n,b]of Object.entries({helper:helperBytes,same:sameBytes,imported:importedBytes}))await save(n+'.wasm',b);
await save('node.json',{versions:process.versions,flags:process.execArgv,loadBefore:loadavg(),...await probe(),loadAfter:loadavg()});
const source=await readFile('experiments/engine-cost/boundaries.mjs');
const server=createServer((req,res)=>{if(req.url==='/boundaries.mjs'){res.setHeader('Content-Type','text/javascript');res.end(source);}else res.end('Engine call boundary probe');});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,executablePath:process.env.DEFUSS_VM_CHROME});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto('http://127.0.0.1:'+server.address().port);
 const cdp=await page.context().newCDPSession(page),versions=await cdp.send('Browser.getVersion'),commandLine=await cdp.send('Browser.getBrowserCommandLine');await cdp.detach();
 const loadBefore=loadavg();const result=await page.evaluate(async()=>(await import('/boundaries.mjs')).probe());assert.deepEqual(errors,[]);
 await save('chrome.json',{versions,commandLine,loadBefore,...result,loadAfter:loadavg(),pageErrors:errors});
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({status:'passed',output:out,scope:'component only'}));
