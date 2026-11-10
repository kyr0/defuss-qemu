// A built Bun guest and installed npm host, including a complete Chrome restart.
import assert from 'node:assert/strict';
import {readFile, mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {startServer} from './server.mjs';
import {chromeOptions,newRun,save,artifacts} from './config.mjs';

assert.ok(process.env.DEFUSS_QEMU_PACKAGE);
const directory=resolve(process.argv[2]),manifest=JSON.parse(await readFile(directory+'/app.json'));
await newRun();
const media={},names={};
for(const name of Object.keys(manifest.artifacts)) {
  const path=manifest.generation+'/'+name,key='bun-'+name.replaceAll('/','_');
  media[key]=resolve(directory,path);names[path]='/guest-media/'+key;
}
const report={status:'failed',directory,packageRoot:resolve(process.env.DEFUSS_QEMU_PACKAGE),manifest,runs:[],inputs:{}};
for(const name of ['e2e/bun-bundle.mjs','e2e/server.mjs','e2e/config.mjs',report.packageRoot+'/dist/manifest.json']) {
  report.inputs[name]=createHash('sha256').update(await readFile(name)).digest('hex');
}
const profile=await mkdtemp(resolve('tmp/bun-chrome-'));
let server,cdn;
try {
  server=await startServer();cdn=await startServer({media,crossOrigin:true});report.runtime=cdn.identities;
  for(const mode of ['cold','restored']) {
    const context=await chromium.launchPersistentContext(profile,chromeOptions);
    try {
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(String(e)));
      await page.goto(server.demoUrl);
      const run=await page.evaluate(async({manifest,names,origin})=>{
        const {startBunApp}=await import(origin+'/package/dist/packaging/bun-app/vm.mjs');
        const {runtimeURL}=await import(origin+'/package/dist/index.mjs');
        let vm,finish,bad,timer;
        const report={status:'failed',console:'',events:[]};
        const done=new Promise((ok,fail)=>{finish=ok;bad=fail;});done.catch(()=>{});
        try {
          timer=setTimeout(()=>bad(Error('Bun browser deadline')),180000);
          vm=await startBunApp({manifest,runtimeUrl:runtimeURL().href,
            readAsset:async name=>{const r=await fetch(origin+names[name]);if(!r.ok)throw Error(name);return r.arrayBuffer();},
            onConsole(text){report.console+=text;if(/AUTO_VERIFIED [^\n]+\n/.test(report.console))finish();},
            onEvent(event){report.events.push(event);if(event.event==='error')bad(Error(event.reason));}});
          report.ready=await vm.ready;await done;report.status='passed';
        } catch(error){report.failure=String(error.stack||error);}
        finally {clearTimeout(timer);if(vm)await vm.stop();}
        return report;
      },{manifest,names,origin:cdn.origin});
      await save(mode+'.json',{...run,errors});
      assert.equal(run.status,'passed',run.failure);assert.deepEqual(errors,[]);assert.equal(run.ready.mode,mode);
      const state=JSON.parse(run.console.split(/\r?\n/).find(s=>s.startsWith('AUTO_VERIFIED ')).slice(14));
      assert.equal(state.file,true);assert.equal(state.http,true);
      assert.equal(run.console.includes('AUTO_INITIALIZED '),mode==='cold');
      assert.ok(run.events.some(e=>e.event==='vm-started'&&[0x10002,0x10004].includes(e.msg1Status)));
      report.runs.push({mode,nonce:state.nonce,readyMs:run.ready.readyMs});
    } finally {await context.close();}
  }
  assert.equal(report.runs[0].nonce,report.runs[1].nonce);report.status='passed';
} catch(error){report.failure=String(error.stack||error);process.exitCode=1;}
finally {if(server)await server.close();if(cdn)await cdn.close();await save('report.json',report);}
console.log(JSON.stringify({status:report.status,artifacts,runs:report.runs,failure:report.failure}));
