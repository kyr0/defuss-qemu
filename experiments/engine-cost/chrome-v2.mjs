import assert from 'node:assert/strict';
import {mkdir,readFile,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {loadavg} from 'node:os';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {probe,helperBytes,sameBytes,importedBytes} from './boundaries.mjs';
const out=process.argv[2];assert.ok(out?.startsWith('artifacts/')&&!out.includes('..'));await mkdir(out);
assert.ok(!process.env.NODE_OPTIONS,'Controlled Node probe requires no NODE_OPTIONS override');
const save=async(n,x)=>{const f=await open(out+'/'+n,'wx');await f.writeFile(typeof x==='string'||x instanceof Uint8Array?x:JSON.stringify(x,null,2)+'\n');await f.sync();await f.close();};
const inputs={};for(const n of ['experiments/engine-cost/boundaries.mjs','experiments/engine-cost/chrome-v2.mjs']){const b=await readFile(n);inputs[n]={sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length};}
await save('inputs.json',inputs);for(const [n,b]of Object.entries({helper:helperBytes,same:sameBytes,imported:importedBytes}))await save(n+'.wasm',b);
await save('prior-node.json',{path:'artifacts/engine-cost-01/node.json',sha256:createHash('sha256').update(await readFile('artifacts/engine-cost-01/node.json')).digest('hex'),scope:'Completed Node measurements retained from first attempt; Chrome command-line metadata call then failed before its measurements'});
const source=await readFile('experiments/engine-cost/boundaries.mjs');
const server=createServer((req,res)=>{if(req.url==='/boundaries.mjs'){res.setHeader('Content-Type','text/javascript');res.end(source);}else res.end('Engine call boundary probe');});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,executablePath:process.env.DEFUSS_VM_CHROME});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto('http://127.0.0.1:'+server.address().port);
 const cdp=await page.context().newCDPSession(page),versions=await cdp.send('Browser.getVersion');let commandLine;try{commandLine=await cdp.send('Browser.getBrowserCommandLine');}catch(e){commandLine={unavailable:String(e.message)};}await cdp.detach();
 const ownedProcesses=execFileSync('ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n').filter(l=>l.includes(process.env.TMPDIR)&&l.includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));assert.ok(ownedProcesses.length>0);assert.ok(ownedProcesses.every(l=>!l.includes('--js-flags')));
 const loadBefore=loadavg();const result=await page.evaluate(async()=>(await import('/boundaries.mjs')).probe());assert.deepEqual(errors,[]);
 await save('chrome.json',{versions,commandLine,ownedProcesses,loadBefore,...result,loadAfter:loadavg(),pageErrors:errors});
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({status:'passed',output:out,scope:'component only'}));
