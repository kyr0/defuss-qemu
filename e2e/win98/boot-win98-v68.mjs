// Port of the desktop-asserting root boot runner; v68 is its historical name.
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {profile, artifacts, chromeOptions, cdpPort, newRun, requireDisk, save} from '../config.mjs';
import {startServer} from '../server.mjs';
const disk = await requireDisk();
await newRun();
const server = await startServer();
const demoUrl = server.demoUrl;
const token = randomUUID();
let browser;
try {
  browser = await chromium.launch({...chromeOptions,
    args:['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`]});
} catch (error) {await server.close();throw error;}
const session = {status:'starting', token, profile, demoUrl, cdpUrl:`http://127.0.0.1:${cdpPort}`,
  runtime:server.runtime, identities:server.identities, disk};
await save('session.json',session);
const watchdog = setTimeout(()=>void close(1), Number(process.env.BOOT_TIMEOUT_MS || 300000));
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  clearTimeout(watchdog);
  session.status = code ? 'failed' : 'closed';
  await save('session.json',session);
  try { await browser.close(); } catch {}
  await server.close();
  process.exit(code);
}
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
browser.on('disconnected', () => { if (!closing) void close(1); });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', error => { errors.push(String(error)); console.error('PAGE ERROR', String(error)); });
  page.on('console', message => {
    if (message.type() === 'error') { errors.push(message.text()); console.error('CONSOLE ERROR', message.text()); }
  });
  if (process.env.ACK_REPAINT === '1') await page.route('**/win9x-ui.mjs', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'recorder.attach(pc,metadata);';
    if (!source.includes(marker)) throw new Error('Diagnostic hook not found');
    let body = source;
    if (process.env.ACK_REPAINT === '1') {
      const observer = "  if(!recorder?.running)return;";
      const immediate = "  if(!frameScheduler.drawing && !document.hidden && ['auto','responsive'].includes(el('display').value))schedule(0);\n  enqueue(list);";
      if (!body.includes(observer) || !body.includes(immediate)) throw new Error('Ack-repaint hooks not found');
      body = body.replace(observer,
        "  if(kind==='sent'&&!frameScheduler.drawing&&!document.hidden&&['auto','responsive'].includes(el('display').value))schedule(0);\n" + observer);
      body = body.replace(immediate, "  enqueue(list);");
    }
    await route.fulfill({ response, body });
  });
  await page.goto(demoUrl, { waitUntil: 'domcontentloaded' });
  const title = await page.locator('h1').innerText();
  if (!title.includes('defuss-vm')) throw new Error('Wrong test page: ' + title);
  await page.evaluate(token => {window.defussE2eSession=token;}, token);
  const capabilities = await page.evaluate(() => ({
    crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    userAgent: navigator.userAgent
  }));
  console.log('CAPABILITIES ' + JSON.stringify(capabilities));
  if (!capabilities.crossOriginIsolated || !capabilities.sharedArrayBuffer) throw Error('Required browser isolation unavailable');
  await page.locator('#disk').setInputFiles(disk);
  await page.locator('#boot').selectOption('c');
  for (const [id, variable] of [['cpu','CPU'], ['display-hz','DISPLAY_HZ'], ['sound-card','SOUND'], ['ram','RAM'], ['tb-cache','TB_CACHE'], ['display','DISPLAY'], ['hot-limit','HOT_LIMIT'], ['video','VIDEO'], ['pointer','POINTER'], ['compat','COMPAT']]) {
    if (process.env[variable]) await page.locator('#' + id).selectOption(process.env[variable]);
  }
  if (process.env.HELPERS === '1') await page.locator('#helpers').check();
  if (process.env.DEEP === '1') await page.locator('#deep').check();
  const settings = await page.evaluate(() => Object.fromEntries(
    ['ram','tb-cache','cpu','video','pointer','compat','hot-limit','sound-card','display','display-hz']
      .map(id => [id, document.getElementById(id)?.value])
  ));
  const started = performance.now();
  await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'Running');
  const runningMs = performance.now() - started;
  console.log('VM RUNNING ' + JSON.stringify({ runningMs, settings }));
  await page.locator('#screen').screenshot({ path: path.join(artifacts, 'running.png') });

  const colorStats = () => {
    const canvas = document.querySelector('#screen');
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let teal = 0, samples = 0;
    for (let y = 0; y < canvas.height; y += 16) {
      for (let x = 0; x < canvas.width; x += 16) {
        const i = (y * canvas.width + x) * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (r < 30 && g >= 95 && g <= 160 && Math.abs(g - b) < 20) teal++;
        samples++;
      }
    }
    let taskbarGray = 0, taskbarSamples = 0;
    for (let y = canvas.height - 32; y < canvas.height; y += 4) {
      for (let x = 0; x < canvas.width; x += 16) {
        const i = (y * canvas.width + x) * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (r >= 150 && r <= 230 && Math.max(r, g, b) - Math.min(r, g, b) < 12) taskbarGray++;
        taskbarSamples++;
      }
    }
    return { width: canvas.width, height: canvas.height, tealFraction: teal / samples,
      taskbarGrayFraction: taskbarGray / taskbarSamples };
  };
  const usableDesktop = stats => stats.width === 1024 && stats.height === 768 &&
    stats.tealFraction > 0.4 && stats.taskbarGrayFraction > 0.6;
  let desktop = null;
  const deadline = Date.now() + Number(process.env.DESKTOP_TIMEOUT_MS || 240000);
  let lastLog = 0;
  while (Date.now() < deadline) {
    desktop = await page.evaluate(colorStats);
    if (usableDesktop(desktop)) break;
    if (Date.now() - lastLog > 15000) {
      console.log('BOOT PROGRESS ' + JSON.stringify({ elapsedMs: performance.now() - started, ...desktop }));
      lastLog = Date.now();
    }
    await page.waitForTimeout(500);
  }
  if (!desktop || !usableDesktop(desktop)) {
    throw new Error('Desktop not detected: ' + JSON.stringify(desktop));
  }
  const desktopMs = performance.now() - started;
  await page.locator('#screen').screenshot({ path: path.join(artifacts, 'desktop.png') });
  if (errors.length) throw Error('Browser errors: '+JSON.stringify(errors));
  const result = { status:'passed', profile, runningMs, desktopMs, settings, desktop, errors, capabilities, runtime:session.runtime, identities:session.identities };
  session.status='ready';await save('session.json',session);
  await writeFile(path.join(artifacts, 'boot.json'), JSON.stringify(result, null, 2));
  console.log('DESKTOP READY ' + JSON.stringify(result));
  console.log('CDP http://127.0.0.1:' + cdpPort);
  console.log('BASELINE_READY ' + profile);
  if (process.env.KEEP_OPEN === '1') {clearTimeout(watchdog);await new Promise(() => {});}
  await close(0);
} catch (error) {
  await save('failure.json',{status:'failed',failure:String(error?.stack||error)});
  for (const page of browser.contexts().flatMap(c=>c.pages())) await page.screenshot({path:path.join(artifacts,'boot-failure.png')}).catch(()=>{});
  console.error('AUTOMATION FAILED', error?.stack || String(error));
  await close(1);
}
