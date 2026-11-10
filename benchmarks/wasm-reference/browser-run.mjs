#!/usr/bin/env node
// Fresh Chrome process; owned loopback server; immutable in-memory input routes.
// Run serially with other VM/build/reference work. Never downloads a browser.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import os from 'node:os';
import {chromium} from 'playwright';

const directory=dirname(fileURLToPath(import.meta.url)),root=resolve(directory,'../..');
const {values,positionals}=parseArgs({allowPositionals:true,options:{samples:{type:'string'},warmup:{type:'string'},calls:{type:'string'},timeout:{type:'string'}}});
const [buildArgument,label]=positionals;
assert.ok(positionals.length===2&&buildArgument&&label,
  'Usage: node benchmarks/wasm-reference/browser-run.mjs BUILD_DIRECTORY FRESH_LABEL [--samples 7 --warmup 5 --calls 10 --timeout 300000]');
assert.match(label,/^[a-z0-9][a-z0-9-]*$/,'Use a simple fresh label');
const build=resolve(root,buildArgument),output=resolve(root,'artifacts/wasm-reference',label);
assert.ok(build.startsWith(root+'/'),'Build directory must be inside defuss-vm');
const config={samples:Number(values.samples??process.env.REFERENCE_SAMPLES??7),
  warmup:Number(values.warmup??process.env.REFERENCE_WARMUP??5),
  callsPerSample:Number(values.calls??process.env.REFERENCE_CALLS??10)};
const timeoutMs=Number(values.timeout??process.env.REFERENCE_TIMEOUT??300000);
for(const [name,value,min,max] of [['samples',config.samples,1,100],['warmup',config.warmup,0,100],
  ['calls',config.callsPerSample,1,1000],['timeout',timeoutMs,1000,1800000]])
  assert.ok(Number.isInteger(value)&&value>=min&&value<=max,'Invalid '+name);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['kernels.c','build.py','reference.mjs','oracle.mjs','validate.mjs','benchmark.mjs',
  'node-runner.mjs','check.mjs','run.mjs','browser-run.mjs'];
const browserModules=['reference.mjs','oracle.mjs','validate.mjs','benchmark.mjs'];
const hostLoad=()=>({utc:new Date().toISOString(),freeMemoryBytes:os.freemem(),loadavg:os.loadavg()});
await mkdir(dirname(output),{recursive:true});await mkdir(output);
const report={schema:1,status:'failed',scope:'Chrome standalone component correctness and exploratory reference timing; no integrated guest acceleration claim',
  createdUtc:new Date().toISOString(),host:{node:process.version,controllerV8:process.versions.v8,
    platform:process.platform,architecture:process.arch,release:os.release(),cpu:os.cpus()[0]?.model,
    logicalCPUs:os.cpus().length,totalMemoryBytes:os.totalmem(),before:hostLoad()},
  launch:{headless:true,browserSelection:process.env.DEFUSS_VM_CHROME?'DEFUSS_VM_CHROME':'installed Playwright Chromium',
    executablePath:process.env.DEFUSS_VM_CHROME??chromium.executablePath(),timeoutMs},
  config,source:{},inputs:{},served:{},pageErrors:[],serverErrors:[]};
let server,browser,page,watchdog;
try{
  const buildBytes=await readFile(resolve(build,'build-report.json')),buildReport=JSON.parse(buildBytes);
  assert.equal(buildReport.status,'passed');
  const wasm=await readFile(resolve(build,'references.wasm'));
  assert.equal(sha(wasm),buildReport.wasmSha256,'Built WASM identity mismatch');
  assert.equal(wasm.length,buildReport.wasmBytes,'Built WASM size mismatch');
  const sources=new Map();
  for(const name of sourceFiles){const bytes=await readFile(resolve(directory,name));sources.set(name,bytes);report.source[name]=sha(bytes);report.inputs[relative(root,resolve(directory,name))]=sha(bytes);}
  assert.equal(report.source['kernels.c'],buildReport.sourceSha256,'Kernel source changed since build');
  assert.equal(report.source['build.py'],buildReport.buildScriptSha256,'Build script changed since build');
  const originalBytes=await readFile(resolve(root,'benchmarks/expected.json')),original=JSON.parse(originalBytes);
  report.inputs['benchmarks/expected.json']=sha(originalBytes);
  report.inputs[relative(root,resolve(build,'build-report.json'))]=sha(buildBytes);
  report.inputs[relative(root,resolve(build,'references.wasm'))]=sha(wasm);
  report.build={directory:relative(root,build),wasmSha256:sha(wasm),wasmBytes:wasm.length,
    buildReportSha256:sha(buildBytes),sdk:buildReport.sdk,emccVersion:buildReport.emccVersion,
    command:buildReport.command,memoryModel:buildReport.memoryModel};
  const routes=new Map(browserModules.map(name=>['/modules/'+name,{body:sources.get(name),type:'text/javascript',sha256:report.source[name]}]));
  routes.set('/references.wasm',{body:wasm,type:'application/wasm',sha256:sha(wasm)});
  server=createServer((request,response)=>{
    for(const [name,value] of Object.entries({'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
      'Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'no-store'}))response.setHeader(name,value);
    try{
      const path=new URL(request.url,'http://localhost').pathname;
      if(request.method!=='GET'){response.writeHead(405);response.end();return;}
      if(path==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>defuss-vm WASM reference</title>');return;}
      if(path==='/favicon.ico'){response.writeHead(204);response.end();return;}
      const route=routes.get(path);if(!route){response.writeHead(404);response.end();return;}
      const served=report.served[path]??={sha256:route.sha256,bytes:route.body.length,requests:0};served.requests++;
      response.setHeader('Content-Type',route.type);response.end(route.body);
    }catch(error){report.serverErrors.push(String(error));if(!response.headersSent)response.writeHead(500);response.end(String(error));}
  });
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
  browser=await chromium.launch({headless:true,...(process.env.DEFUSS_VM_CHROME?{executablePath:process.env.DEFUSS_VM_CHROME}:{})});
  report.browser={version:browser.version()};
  const cdp=await browser.newBrowserCDPSession();
  try{report.browser.details=await cdp.send('Browser.getVersion');}finally{await cdp.detach();}
  watchdog=setTimeout(()=>{report.deadlineExceeded=true;void browser.close();server.closeAllConnections();},timeoutMs);
  page=await browser.newPage();page.on('pageerror',error=>report.pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result=await page.evaluate(async({config,original,identities})=>{
    const partial={};globalThis.__defussReferenceReport=partial;
    if(!crossOriginIsolated||!crypto?.subtle)throw Error('Cross-origin isolation and WebCrypto validation are required');
    const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
    partial.fetched={};let wasm;
    for(const [url,wanted] of Object.entries(identities)){
      const response=await fetch(url);if(!response.ok)throw Error('Reference fetch failed: '+url);
      const bytes=await response.arrayBuffer(),actual=await digest(bytes);
      if(actual!==wanted.sha256||bytes.byteLength!==wanted.bytes)throw Error('Fetched reference identity mismatch: '+url);
      partial.fetched[url]={sha256:actual,bytes:bytes.byteLength};if(url==='/references.wasm')wasm=bytes;
    }
    const [{createReference},{validateReference},{runBenchmarks}]=await Promise.all([
      import('/modules/reference.mjs'),import('/modules/validate.mjs'),import('/modules/benchmark.mjs')]);
    partial.browserEnvironment={userAgent:navigator.userAgent,platform:navigator.platform,
      hardwareConcurrency:navigator.hardwareConcurrency,crossOriginIsolated,
      clock:'performance.now',origin:performance.timeOrigin};
    const api=await createReference(wasm);partial.runtime=api.metadata;
    partial.validation=await validateReference(api);
    if(partial.validation.status!=='passed'||partial.validation.originalSha256!==original.sha256||
      api.integerChecked(123,250000,1664525,1013904223)!==original.integer)throw Error('Original benchmark identity mismatch');
    partial.benchmark=await runBenchmarks(api,config);
    if(partial.benchmark.status!=='passed'||partial.benchmark.expected.integer!==original.integer||
      partial.benchmark.expected.sha256!==original.sha256)throw Error('Measured reference identity mismatch');
    return partial;
  },{config,original,identities:Object.fromEntries(Array.from(routes,([url,item])=>[url,{sha256:item.sha256,bytes:item.body.length}]))});
  Object.assign(report,result);
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.serverErrors,[]);
  for(const [path,digest] of Object.entries(report.inputs))assert.equal(sha(await readFile(resolve(root,path))),digest,'Input changed during run: '+path);
  report.status='passed';
}catch(error){
  report.status='failed';report.failure=String(error.stack||error);
  if(page)try{const partial=await page.evaluate(()=>globalThis.__defussReferenceReport??null);if(partial)Object.assign(report,partial);}catch{}
}finally{
  clearTimeout(watchdog);if(browser)await browser.close().catch(()=>{});
  if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
  report.host.after=hostLoad();
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:report.status,report:resolve(output,'report.json'),browser:report.browser?.version,
    observations:report.benchmark?.observations?.length,failure:report.failure}));
}
process.exitCode=report.status==='passed'?0:1;
