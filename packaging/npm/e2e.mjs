import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, mkdtemp, realpath} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {bootDisk} from '../../e2e/boot-fixture.mjs';

const root = process.cwd(), tarball = resolve(process.argv[2]), label = process.argv[3];
assert.match(label || '', /^[a-z0-9-]+$/);
const output = resolve('output/npm-e2e', label);
await mkdir(output, {recursive: false}).catch(async error => {
  if (error.code !== 'ENOENT') throw error;
  await mkdir(resolve('output/npm-e2e'), {recursive: true}); await mkdir(output);
});
await mkdir('tmp', {recursive: true});
const consumer = await mkdtemp(resolve('tmp/npm-consumer-'));
await writeFile(consumer + '/package.json', JSON.stringify({private:true, type:'module'}));
execFileSync('npm', ['install', '--ignore-scripts', '--offline', '--package-lock=false', '--cache', resolve('tmp/npm-cache'), tarball], {cwd:consumer, stdio:'pipe'});
const packageRoot = await realpath(consumer + '/node_modules/defuss-qemu');
const report = {status:'failed', tarball, tarballSha256:createHash('sha256').update(await readFile(tarball)).digest('hex'), packageRoot, checks:[]};
await writeFile(output + '/consumer.json', JSON.stringify(report, null, 2));
const mime = {'.js':'text/javascript', '.mjs':'text/javascript', '.wasm':'application/wasm', '.json':'application/json'};
async function serve() {
  const requests = [];
  const server = createServer(async (req,res) => {
    for (const [k,v] of Object.entries({'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'cross-origin','Access-Control-Allow-Origin':'*'})) res.setHeader(k,v);
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if (pathname === '/') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><link rel="icon" href="data:,"><canvas id="screen" width="720" height="400"></canvas>');return;}
    try {
      assert.ok(pathname.startsWith('/package/'));
      const file = await realpath(resolve(packageRoot, '.' + pathname.slice('/package'.length)));
      assert.ok(file.startsWith(packageRoot + sep));
      res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
      res.end(await readFile(file)); requests.push(pathname);
    } catch {res.writeHead(404);res.end();}
  });
  await new Promise((ok,bad) => {server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
  return {origin:`http://127.0.0.1:${server.address().port}`, requests, async close(){server.closeAllConnections();await new Promise(ok=>server.close(ok));}};
}
let app,cdn,browser,timer;
try {
  app = await serve(); cdn = await serve();
  browser = await chromium.launch({headless:true,...(process.env.DEFUSS_VM_CHROME ? {executablePath:process.env.DEFUSS_VM_CHROME} : {})});
  timer = setTimeout(() => void browser.close(), 180000);
  for (const kind of ['same-origin','cross-origin']) {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {if(message.type()==='error')errors.push(message.text());});
    page.on('requestfailed', request => errors.push(request.url()+': '+request.failure()?.errorText));
    page.on('response', response => {if(response.status()>=400)errors.push(response.status()+': '+response.url());});
    await page.goto(app.origin);
    const source = (kind === 'same-origin' ? app : cdn).origin + '/package/dist/';
    await page.evaluate(async ({source, disk}) => {
      if (!crossOriginIsolated) throw Error('Cross-origin isolation required');
      const api = await import(source + 'index.mjs');
      const {startPC} = await import(source + 'host/browser/win9x.mjs');
      const roms = {};
      for (const name of ['bios-256k.bin','kvmvapic.bin','vgabios-stdvga.bin','vgabios-cirrus.bin']) {
        const response = await fetch(api.firmwareURL(name)); if (!response.ok) throw Error(name);
        roms[name] = new Uint8Array(await response.arrayBuffer());
      }
      window.pc = await startPC({factory: api.createQemu, roms, floppy:new Uint8Array(disk), cdrom:new Uint8Array(2048), boot:'a', diskMiB:8, ramMiB:64, tbMiB:32, sound:'off'});
      if (window.pc.cdBackend !== 'wasmrom') throw Error('Native CD staging required');
      window.api = api;
    }, {source, disk:[...bootDisk()]});
    let screen = '', deadline = Date.now() + 45000;
    do {screen = await page.evaluate(() => window.pc.textScreen());if (screen.includes('DEFUSS_E2E_VIDEO_OK')) break;await page.waitForTimeout(100);} while (Date.now() < deadline);
    assert.match(screen, /DEFUSS_E2E_VIDEO_OK/);
    for (const key of 'test123') {
      await page.evaluate(key => window.pc.qmp.send('send-key',{keys:[{type:'qcode',data:key}], 'hold-time':70}), key);
      await page.waitForTimeout(90);
    }
    deadline = Date.now() + 5000;
    do {screen = await page.evaluate(() => window.pc.textScreen());if (screen.includes('test123')) break;await page.waitForTimeout(100);} while (Date.now() < deadline);
    assert.match(screen, /test123/); assert.deepEqual(errors, []);
    const validation = await page.evaluate(async () => {
      const errors = [];
      try {window.api.runtimeURL('invalid');} catch(error) {errors.push(error.name);}
      try {window.api.firmwareURL('../private');} catch(error) {errors.push(error.name);}
      try {await window.api.createQemu({msg1:'on'});} catch(error) {errors.push(error.name);}
      const frame = await window.pc.frame();
      const canvas = document.querySelector('#screen');canvas.width=frame.w;canvas.height=frame.h;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.rgba),frame.w,frame.h),0,0);
      return errors;
    });
    assert.deepEqual(validation, ['RangeError','TypeError','TypeError']);
    await page.screenshot({path:output + '/' + kind + '.png'});
    const settings = await page.evaluate(() => window.pc.runtimeSettings);
    assert.ok([0x10002,0x10004].includes(settings.msg1Status));
    assert.deepEqual(errors, []);
    report.checks.push({kind, screen, errors, settings});await page.close();
  }
  report.status='passed';report.browser=browser.version();report.requests={app:app.requests,cdn:cdn.requests};
} catch(error) {report.failure=String(error.stack || error);process.exitCode=1;}
finally {
  clearTimeout(timer);if(browser)await browser.close();if(app)await app.close();if(cdn)await cdn.close();
  await writeFile(output + '/report.json', JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,output,packageRoot,failure:report.failure}));
}
