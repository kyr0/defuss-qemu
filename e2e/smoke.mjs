#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {startServer} from './server.mjs';
import {bootDisk} from './boot-fixture.mjs';
import {root, artifacts, chromeOptions, newRun, save} from './config.mjs';

// A real 16-bit BIOS guest, generated locally; no OS media or assembler needed.
// Prints a marker using INT 10h, echoes exactly seven keys via INT 16h, then
// halts. This gives trace controls and screenshots an explicit stable endpoint.

await newRun();
const report={status:'failed',checks:[],scope:'Browser page, local resources, firmware, VGA, keyboard, trace; not Windows acceptance'};
let server,browser,watchdog,page;
const errors=[],failed=[];
try {
  server=await startServer();report.runtime=server.runtime;report.identities=server.identities;
  // Every copied UI/worker/WASM dependency must be served locally with the isolation headers.
  const resources=[];
  for(const dir of ['e2e/web','host/browser']) {
    for(const file of await readdir(resolve(root,dir),{recursive:true})) {
      if(!/\.(mjs|html|wasm)$/.test(file))continue;
      const response=await fetch(server.origin+'/'+dir+'/'+file);
      assert.equal(response.status,200,file);
      assert.equal(response.headers.get('cross-origin-embedder-policy'),'require-corp');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(resolve(root,dir,file)));
      resources.push(dir+'/'+file);
    }
  }
  for(const url of ['/AGENT_HANDOFF.md','/e2e/win98/boot-win98-v68.mjs','/assets/secret','/host/browser/runtime/%2e%2e%2fpackage.json']) {
    assert.equal((await fetch(server.origin+url)).status,404,url);
  }
  report.resources=resources;report.checks.push('All page/module/worker/FatFs bytes served locally; source outside mounts is unavailable');
  browser=await chromium.launch(chromeOptions);
  watchdog=setTimeout(()=>void browser.close(),120000);
  page=await browser.newPage({viewport:{width:1280,height:1000}});
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)failed.push(r.url()+':'+r.status());});
  await page.goto(server.origin+'/',{waitUntil:'networkidle'});
  await page.waitForURL('**/win9x.html');
  assert.ok(await page.evaluate(()=>crossOriginIsolated&&typeof SharedArrayBuffer!=='undefined'));
  assert.match(await page.locator('#runtime-settings').innerText(),/1,?500/);
  await page.evaluate(async()=>WebAssembly.compile(await (await fetch('/host/browser/share/ff.wasm')).arrayBuffer()));
  report.checks.push('Page initialization, cross-origin isolation, shared memory, FatFs WASM validation');
  await page.locator('#disk').setInputFiles([]);
  await page.locator('#size').selectOption('128');
  await page.locator('#ram').selectOption('64');
  await page.locator('#tb-cache').selectOption('32');
  await page.locator('#sound-card').selectOption('off');
  await page.locator('#floppy').setInputFiles({name:'boot.img',mimeType:'application/octet-stream',buffer:bootDisk()});
  await page.locator('#boot').selectOption('a');
  await page.locator('#start').click();
  await page.waitForFunction(()=>['Running','Start failed'].includes(document.querySelector('#status').textContent),null,{timeout:90000});
  assert.equal(await page.locator('#status').innerText(),'Running',await page.locator('#error').innerText());
  // waitForFunction polls synchronously; an async predicate would be truthy
  // before the QMP read resolves. Poll awaited evaluate calls on the host.
  async function waitForText(expected) {
    const deadline=Date.now()+45000;let text='';
    do {
      text=await page.evaluate(()=>window.probePC.textScreen());
      if(text.includes(expected))return text;
      await page.waitForTimeout(100);
    } while(Date.now()<deadline);
    throw Error('Guest text not observed: '+expected+'; screen: '+text);
  }
  await waitForText('DEFUSS_E2E_VIDEO_OK');
  await page.locator('#screen').focus();await page.keyboard.type('test123',{delay:100});
  await waitForText('test123');
  report.screen=await page.evaluate(()=>window.probePC.textScreen());
  report.checks.push('Actual BIOS/floppy boot and VGA marker; guest keyboard echo');
  await page.locator('#record').click();
  await page.waitForFunction(()=>document.querySelector('#trace-status').textContent==='Recording');
  await page.waitForTimeout(2200);
  await page.locator('#record').click();
  await page.waitForFunction(()=>document.querySelector('#trace-status').textContent==='Stopped');
  const trace=await page.evaluate(()=>window.probeRecorder.export());
  assert.ok(trace.samples.length>0);assert.ok(trace.durationMs>0);
  await save('trace.json',trace);report.checks.push('Trace recording and export with real guest samples');
  report.screen=await page.evaluate(()=>window.probePC.textScreen());
  assert.match(report.screen,/DEFUSS_E2E_VIDEO_OK/);assert.match(report.screen,/test123/);
  await page.locator('#screen').screenshot({path:resolve(artifacts,'guest.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  report.errors=errors;report.failedResponses=failed;report.browser=browser.version();report.status='passed';
} catch(error){
  report.failure=String(error.stack||error);report.errors=errors;report.failedResponses=failed;
  if(page) {
    report.pageStatus=await page.locator('#status').innerText().catch(()=>null);
    report.pageError=await page.locator('#error').innerText().catch(()=>null);
    await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});
  }
  process.exitCode=1;
}
finally {
  clearTimeout(watchdog);if(browser)await browser.close();if(server)await server.close();
  await save('smoke.json',report);console.log(JSON.stringify(report));
}
