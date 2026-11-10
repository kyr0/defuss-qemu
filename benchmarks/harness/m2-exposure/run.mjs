#!/usr/bin/env node
// Diagnostic MSG2 exposure only. One fresh Chrome VM, serialized with all other work.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,access,readdir,stat} from 'node:fs/promises';
import {resolve,relative,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {arch,platform,release,cpus,totalmem,freemem,loadavg} from 'node:os';
import {chromium} from 'playwright';
import {fileSnapshotStore} from '../../../packaging/bun-app/file-store.mjs';
import {snapshotKey,packRecord,unpackRecord} from '../../../packaging/bun-app/snapshots.mjs';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
import {exposureProtocol,unchangedGuest} from './exposure.mjs';
import {SnapshotUpload,readBoundedBody,SNAPSHOT_CHUNK_BYTES,MAX_SNAPSHOT_BYTES} from '../m1/snapshot-upload.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const {values}=parseArgs({options:{package:{type:'string'},output:{type:'string'},mode:{type:'string',default:'baseline'},
  snapshot:{type:'string',default:'capture'},cache:{type:'string'},'capture-report':{type:'string'},
  timeout:{type:'string',default:'600000'},'sample-period':{type:'string',default:'257'},'capture-code':{type:'boolean',default:false}}});
const inside=(argument,label)=>{assert.ok(argument,`${label} is required`);const path=resolve(root,argument);assert.ok(path.startsWith(root+'/'),`${label} must be inside defuss-vm`);return path;};
const directory=inside(values.package,'--package'),output=inside(values.output,'--output');
assert.ok(output.startsWith(resolve(root,'artifacts')+'/'),'Reports belong under artifacts/');
assert.ok(['baseline','profile-off','profile-on'].includes(values.mode),'Unknown diagnostic mode');
assert.ok(['capture','restore'].includes(values.snapshot),'Unknown snapshot mode');
assert.ok(!values['capture-code']||values.mode==='profile-on','Code capture requires profile-on');
const timeoutMs=Number(values.timeout),samplePeriod=Number(values['sample-period']);
assert.ok(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=1800000,'Invalid timeout');
assert.ok(Number.isSafeInteger(samplePeriod)&&samplePeriod>=1&&samplePeriod<=65536,'Invalid sample period');
const cache=values.cache?inside(values.cache,'--cache'):resolve(output,'snapshots');
const exists=async path=>{try{await access(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const sha=data=>createHash('sha256').update(data).digest('hex');
const load=()=>({utc:new Date().toISOString(),loadavg:loadavg(),freeMemoryBytes:freemem()});
await mkdir(dirname(output),{recursive:true});await mkdir(output);
const report={schema:1,status:'failed',protocol:exposureProtocol,timingEligible:false,mode:values.mode,snapshotMode:values.snapshot,
  scope:'Diagnostic MSG2 helper/inline phase exposure under production hotLimit1500/runtimeFlags3. Timings are ineligible for performance decisions; the M1 workload and guest ACK protocol are unchanged.',
  createdUtc:new Date().toISOString(),package:relative(root,directory),cache:relative(root,cache),timeoutMs,samplePeriod,captureCode:values['capture-code'],
  host:{platform:platform(),arch:arch(),release:release(),logicalCPUs:cpus().length,totalMemoryBytes:totalmem(),before:load()},
  inputHashes:{},servedHashes:{},pageErrors:[],serverErrors:[],transport:{acceptedChunks:0,totalChunkBytes:0,publications:0}};
let server,browser,page,watchdog,published=null,uploadFailure=null;
const hashInputs=async base=>{for(const entry of await readdir(base,{withFileTypes:true})){
  const path=resolve(base,entry.name);if(entry.isDirectory())await hashInputs(path);
  else if(/\.(mjs|ts|json)$/.test(entry.name))report.inputHashes[relative(root,path)]=sha(await readFile(path));
}};
try{
  await hashInputs(resolve(root,'benchmarks/harness/m1'));
  await hashInputs(resolve(root,'benchmarks/harness/m2'));
  await hashInputs(resolve(root,'benchmarks/harness/m2-exposure'));
  await hashInputs(resolve(root,'benchmarks/harness/code'));
  for(const name of ['benchmarks/workload/operations.ts','benchmarks/expected.json','manifests/runtime-baseline.json'])report.inputHashes[name]=sha(await readFile(resolve(root,name)));
  const manifest=JSON.parse(await readFile(resolve(directory,'app.json'),'utf8'));await validateManifest(manifest);
  assert.equal(manifest.appSha256,unchangedGuest.appSha256,'Original M1 bundle required');
  assert.equal(manifest.artifacts['initramfs.cpio.gz'].sha256,unchangedGuest.initramfsSha256,'Original M1 guest filesystem required');
  assert.equal(manifest.snapshot.readyMode,'manual');report.manifest=manifest;
  assert.deepEqual(manifest.vm,{machine:'pc,acpi=off',cpu:'max',ramMiB:512,smp:1,tbMiB:128,hotLimit:1500,runtimeFlags:3},
    'M1 only supports the fixed standard Bun VM configuration; AOT/translation-plan options are unsupported');
  report.executionConfiguration={unsupportedAot:true,aotEnabled:false,planDisabled:true,
    scope:'Harness factory passes neither pcWasmAot nor a translation plan; standalone M1 profiles require standard dynamic TCG admission.'};
  assert.equal(values.mode,'baseline','Exposure uses only the MSG2 diagnostic ABI');
  assert.equal(values.snapshot,'capture','Exposure requires a fresh capture');
  assert.equal(values['capture-code'],false,'Exposure disables code inspection');
  assert.equal(manifest.experiment?.name,'sha256msg2-v1');
  assert.equal(typeof manifest.experiment.enabled,'boolean');
  report.experiment=manifest.experiment;
  report.inputHashes[relative(root,resolve(directory,'app.json'))]=sha(await readFile(resolve(directory,'app.json')));
  for(const [name,identity] of Object.entries(manifest.artifacts)){
    const path=resolve(directory,manifest.generation,name),data=await readFile(path);
    assert.equal(data.length,identity.bytes);assert.equal(sha(data),identity.sha256);report.inputHashes[relative(root,path)]=identity.sha256;
  }
  const store=fileSnapshotStore(cache),key=snapshotKey(manifest),snapshotPath=resolve(cache,key+'.snapshot');
  let captureIdentity=null,beforeSnapshot=null;
  if(values.snapshot==='capture'){
    assert.equal(await exists(cache),false,'Capture requires a fresh cache directory');await mkdir(cache,{recursive:true});
  }else{
    const capturePath=inside(values['capture-report'],'--capture-report'),capture=JSON.parse(await readFile(capturePath,'utf8'));
    assert.equal(capture.status,'passed');assert.equal(capture.snapshotMode,'capture');
    assert.equal(capture.manifest.appSha256,manifest.appSha256);assert.equal(capture.manifest.compatibilitySha256,manifest.compatibilitySha256);
    captureIdentity=capture.browserResult.events.find(event=>event.event==='snapshot-prepared');assert.ok(captureIdentity);
    const data=await readFile(snapshotPath),info=await stat(snapshotPath,{bigint:true});
    beforeSnapshot={sha256:sha(data),bytes:data.length,mtimeNs:String(info.mtimeNs)};
    assert.equal(beforeSnapshot.sha256,capture.snapshot.sha256);assert.equal(beforeSnapshot.bytes,capture.snapshot.bytes);
    report.captureReport={path:relative(root,capturePath),sha256:sha(await readFile(capturePath))};
  }
  const route='/snapshot/'+randomUUID(),upload=new SnapshotUpload();
  server=createServer(async(req,res)=>{
    for(const [name,value] of Object.entries({'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
      'Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'no-store'}))res.setHeader(name,value);
    const pathname=new URL(req.url,'http://localhost').pathname;
    try{
      if(pathname===route+'/chunk'){
        assert.ok(values.snapshot==='capture'&&req.method==='POST'&&!uploadFailure);
        const body=await readBoundedBody(req,SNAPSHOT_CHUNK_BYTES);
        const received=upload.append(Number(req.headers['x-snapshot-offset']),Number(req.headers['x-snapshot-total']),req.headers['x-snapshot-sha256'],body);
        report.transport.acceptedChunks++;report.transport.totalChunkBytes+=body.length;res.end(JSON.stringify({received}));return;
      }
      if(pathname===route){
        if(req.method==='GET'){const record=await store.get(key);if(!record){res.writeHead(404);res.end();}else res.end(packRecord(record));return;}
        assert.ok(values.snapshot==='capture'&&req.method==='POST'&&!uploadFailure);await readBoundedBody(req,0);
        const packed=upload.finish(),record=unpackRecord(packed),metadata=record.metadata;
        assert.equal(metadata.schema,1);assert.equal(metadata.encoding,'gzip');
        assert.ok(Number.isSafeInteger(metadata.bytes)&&metadata.bytes>0&&metadata.bytes<=MAX_SNAPSHOT_BYTES);
        assert.equal(metadata.appSha256,manifest.appSha256);assert.equal(metadata.compatibilitySha256,manifest.compatibilitySha256);
        assert.equal(metadata.compressedBytes,record.data.length);assert.equal(sha(record.data),metadata.compressedSha256);
        assert.equal(await store.putIfAbsent(key,record),true,'Fresh snapshot publication collided');
        report.transport.publications++;published={sha256:sha(packed),bytes:packed.length,metadata};res.end('true');return;
      }
      if(req.method!=='GET'){res.writeHead(405);res.end();return;}
      if(pathname==='/'){res.end('defuss-vm M1 diagnostic harness');return;}
      if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
      const path=pathname.startsWith('/package/')?resolve(directory,decodeURIComponent(pathname.slice(9))):resolve(root,'.'+decodeURIComponent(pathname));
      const base=pathname.startsWith('/package/')?directory:root;
      assert.ok(path.startsWith(base+'/'),'Invalid resource path');
      const data=await readFile(path),name=relative(root,path),digest=sha(data);
      if(report.servedHashes[name])assert.equal(report.servedHashes[name],digest,'Served source changed');report.servedHashes[name]=digest;
      res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json'})[extname(path)]||'application/octet-stream');res.end(data);
    }catch(error){
      if(req.method==='POST'&&pathname.startsWith(route))uploadFailure??=String(error);
      report.serverErrors.push({path:pathname.startsWith(route)?'/snapshot'+pathname.slice(route.length):pathname,error:String(error)});
      if(!res.headersSent)res.writeHead(500);res.end(String(error));
    }
  });
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
  browser=await chromium.launch({headless:true,...(process.env.DEFUSS_VM_CHROME?{executablePath:process.env.DEFUSS_VM_CHROME}:{})});
  report.browser=browser.version();
  watchdog=setTimeout(()=>{report.deadlineExceeded=true;void browser.close();server.closeAllConnections();},timeoutMs+20000);
  page=await browser.newPage();page.on('pageerror',error=>report.pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  report.browserResult=await page.evaluate(async options=>{
    const {run}=await import('/benchmarks/harness/m2-exposure/browser.mjs');return run(options);
  },{manifest,packageURL:'/package',route,mode:values.mode,snapshotMode:values.snapshot,captureIdentity,timeoutMs,chunkBytes:SNAPSHOT_CHUNK_BYTES,samplePeriod,captureCode:values['capture-code']});
  assert.equal(report.browserResult.status,'passed',report.browserResult.failure);
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.serverErrors,[]);
  const data=await readFile(snapshotPath),info=await stat(snapshotPath,{bigint:true});
  report.snapshot={sha256:sha(data),bytes:data.length,mtimeNs:String(info.mtimeNs)};
  if(values.snapshot==='capture'){assert.ok(published);assert.equal(report.snapshot.sha256,published.sha256);assert.equal(report.transport.publications,1);}
  else {assert.deepEqual(report.snapshot,beforeSnapshot);assert.equal(report.transport.publications,0);}
  for(const [path,digest] of Object.entries({...report.inputHashes,...report.servedHashes}))assert.equal(sha(await readFile(resolve(root,path))),digest,'Input changed: '+path);
  report.status='passed';
}catch(error){
  report.failure=String(error.stack||error);
  if(page&&!report.browserResult)try{report.browserResult=await page.evaluate(()=>globalThis.__defussM1Report??null);}catch{}
}finally{
  clearTimeout(watchdog);if(browser)await browser.close().catch(()=>{});
  if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
  report.host.after=load();
  if(report.browserResult){
    await writeFile(resolve(output,'serial.log'),report.browserResult.console??'',{flag:'wx'});delete report.browserResult.console;
    for(const event of report.browserResult.events??[])if(event.maps){
      const name=event.event==='initialized'?'initialized.maps':'post-warmup.maps';
      await writeFile(resolve(output,name),event.maps,{flag:'wx'});
      event.mapsArtifact={path:name,sha256:sha(Buffer.from(event.maps)),bytes:Buffer.byteLength(event.maps),scope:'Exact /proc/self/maps at named gate; later mappings/code generations may differ.'};
      delete event.maps;
    }
  }
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:report.status,report:resolve(output,'report.json'),results:report.browserResult?.results?.length,failure:report.failure}));
}
process.exitCode=report.status==='passed'?0:1;
