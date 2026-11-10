import {attach, artifacts, profile} from '../config.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const {browser,page} = await attach();
const release = 'defuss-vm';
const errors = [];
const watchdog = setTimeout(()=>{console.error('Benchmark timed out');process.exit(1);},Number(process.env.BENCHMARK_TIMEOUT_MS||240000));
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const cdp = await browser.newBrowserCDPSession();
const processInfo = () => cdp.send('SystemInfo.getProcessInfo');
const processDelta = (before, after) => after.processInfo.map(p => ({
  type: p.type,
  id: p.id,
  cpuMs: (p.cpuTime - (before.processInfo.find(q => q.id === p.id)?.cpuTime ?? p.cpuTime)) * 1000
})).filter(p => p.cpuMs > 0.01);
const result = { release, profile, keyHoldMs:70, workload: 'warm Start menu / Run / Notepad open-close cycles', baseline: [], traceCycles: [], errors };

await page.evaluate(() => {
  const sample = document.createElement('canvas');
  sample.width = 64; sample.height = 48;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  window.vmBenchStats = () => {
    const source = document.querySelector('#screen');
    ctx.drawImage(source, 0, 0, 64, 48);
    const d = ctx.getImageData(0, 0, 64, 48).data;
    let white = 0, grayLeft = 0, grayLeftN = 0, runWhite = 0, runN = 0, runGray = 0, runGrayN = 0;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      if (r > 230 && g > 230 && b > 230) white++;
      if (x >= 4 && x <= 20 && y >= 40 && y <= 42) {
        if (r > 230 && g > 230 && b > 230) runWhite++;
        runN++;
      }
      if (x >= 12 && x <= 20 && y >= 36 && y <= 46) {
        if (r >= 120 && r <= 230 && Math.max(r,g,b)-Math.min(r,g,b)<20) runGray++;
        runGrayN++;
      }
      if (x < 12 && y >= 24 && y < 46) {
        if (r >= 150 && r <= 230 && Math.max(r, g, b) - Math.min(r, g, b) < 15) grayLeft++;
        grayLeftN++;
      }
    }
    return { white: white / (64 * 48), grayLeft: grayLeft / grayLeftN, runWhite: runWhite / runN, runGray: runGray / runGrayN };
  };
});
async function ensureInput() {
  const canvas = page.locator('#screen'), box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await canvas.focus();
  await page.waitForTimeout(100);
  if (await page.evaluate(() => document.activeElement?.id) !== 'screen') throw new Error('Guest canvas did not retain focus');
}
async function closeNotepad() {
  await ensureInput();
  const before = await page.evaluate(() => window.vmBenchStats());
  if (before.white < 0.08) return { closeMs: 0, closeAttempts: 0 };
  const t = performance.now();
  // Like the historical Start-menu action, retry a missed GUI shortcut within
  // a bound. Preserve all elapsed time and attempts; this is not a speed gate.
  for (let attempt=1; attempt<=3; attempt++) {
    await page.keyboard.press('Alt+F4', {delay:70});
    try {
      await page.waitForFunction(() => window.vmBenchStats().white < 0.05, null, { timeout: 4000, polling: 100 });
      const closeMs=performance.now()-t;
      await page.waitForTimeout(300);
      return {closeMs, closeAttempts:attempt};
    } catch(error) {
      if(attempt===3)throw error;
      await ensureInput();
    }
  }
}
async function openNotepad() {
  await ensureInput();
  const menuStart = performance.now();
  for (let attempt = 0; ; attempt++) {
    await page.keyboard.press('Control+Escape', {delay:70});
    try {
      await page.waitForFunction(() => window.vmBenchStats().grayLeft > 0.25, null, { timeout: 2500, polling: 100 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await ensureInput();
    }
  }
  const menuMs = performance.now() - menuStart;
  await page.waitForTimeout(200);
  if (process.env.MENU_LAUNCH === '1') {
    const launchStart = performance.now();
    await page.keyboard.press('p');
    await page.waitForTimeout(350);
    await page.keyboard.press('a');
    await page.waitForTimeout(350);
    await page.keyboard.press('n');
    await page.waitForFunction(() => window.vmBenchStats().white > 0.08, null, { timeout: 30000, polling: 100 });
    return { menuMs, runMs: null, launchMs: performance.now() - launchStart };
  }
  const runStart = performance.now();
  for (let attempt = 0; ; attempt++) {
    await page.keyboard.press('r');
    try {
      await page.waitForFunction(() => window.vmBenchStats().runGray > 0.4, null, { timeout: 3000, polling: 100 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.keyboard.press('Control+Escape', {delay:70});
      await page.waitForFunction(() => window.vmBenchStats().grayLeft > 0.25, null, { timeout: 5000, polling: 100 });
    }
  }
  const runMs = performance.now() - runStart;
  await page.waitForTimeout(200);
  await page.keyboard.type('notepad', { delay: 50 });
  const launchStart = performance.now();
  await page.keyboard.press('Enter', {delay:70});
  await page.waitForFunction(() => window.vmBenchStats().white > 0.08, null, { timeout: 30000, polling: 100 });
  const launchMs = performance.now() - launchStart;
  return { menuMs, runMs, launchMs };
}
async function cycle() { return { ...(await closeNotepad()), ...(await openNotepad()) }; }
async function save() { await writeFile(path.join(artifacts, 'benchmark.json'), JSON.stringify(result, null, 2)); }

try {
  const requestedIterations=Number(process.env.ITERATIONS??5);
  const seconds=Number(process.env.TRACE_SECONDS??35);
  if(!Number.isInteger(requestedIterations)||requestedIterations<1||requestedIterations>100||!Number.isFinite(seconds)||seconds<=0||seconds>120)throw Error('Invalid ITERATIONS or TRACE_SECONDS');
  await closeNotepad();
  await openNotepad(); // warm-up, excluded
  await page.evaluate(() => {
    window.baselineCapture = { frames: 0, changed: 0, captureMs: 0, decodeMs: 0, transports: {} };
    if (window.captureMonitorInstalled || !window.probePC?.frame) return;
    window.captureMonitorInstalled = true;
    const original = window.probePC.frame;
    window.probePC.frame = async (...args) => {
      const frame = await original(...args), stats = window.baselineCapture;
      if (frame && stats) {
        stats.frames++;
        if (frame.dirtyH) stats.changed++;
        stats.captureMs += frame.captureMs ?? 0;
        stats.decodeMs += frame.decodeMs ?? 0;
        const transport = frame.transport ?? 'ppm';
        stats.transports[transport] = (stats.transports[transport] ?? 0) + 1;
      }
      return frame;
    };
  });
  const baselineBefore = await processInfo();
  const baselineStart = performance.now();
  for (let i = 0; i < Number(process.env.ITERATIONS ?? 5); i++) {
    const row = await cycle();
    result.baseline.push(row);
    console.log('BASELINE ' + JSON.stringify({ iteration: i + 1, ...row }));
  }
  result.baselineElapsedMs = performance.now() - baselineStart;
  result.baselineProcessCpu = processDelta(baselineBefore, await processInfo());
  result.baselineCapture = await page.evaluate(() => window.baselineCapture ?? null);
  result.directFrameStatus = await page.evaluate(() => window.probePC?.directFrameStatus?.() ?? null);
  await page.locator('#screen').screenshot({ path: path.join(artifacts, 'baseline-notepad.png') });
  await save();
  if (process.env.BASELINE_ONLY === '1') {
    await closeNotepad();
    await page.locator('#screen').screenshot({ path: path.join(artifacts, 'after-baseline.png') });
    if(errors.length)throw Error('Browser errors: '+JSON.stringify(errors));
    result.errors = errors;
    result.status='passed';
    await save();
    console.log('BASELINE COMPLETE ' + JSON.stringify(result));
    process.exit(0);
  }

  await closeNotepad();
  if (await page.locator('#deep').isChecked()) throw new Error('Deep TCG profiling unexpectedly enabled');
  await page.locator('#record').evaluate(button => button.click());
  await page.waitForFunction(() => document.querySelector('#trace-status')?.textContent === 'Recording');
  const traceBefore = await processInfo();
  const traceStart = performance.now();
  let iterations = 0;
  while (performance.now() - traceStart < Number(process.env.TRACE_SECONDS ?? 35) * 1000) {
    const row = await cycle();
    result.traceCycles.push(row);
    iterations++;
    console.log('TRACE CYCLE ' + JSON.stringify({ iteration: iterations, ...row }));
  }
  await closeNotepad();
  result.traceActionElapsedMs = performance.now() - traceStart;
  result.traceProcessCpu = processDelta(traceBefore, await processInfo());
  await page.locator('#record').evaluate(button => button.click());
  await page.waitForFunction(() => document.querySelector('#trace-status')?.textContent === 'Stopped');
  const trace = await page.evaluate(() => window.probeRecorder.export());
  await writeFile(path.join(artifacts, 'light-trace.json'), JSON.stringify(trace));
  result.trace = {
    durationMs: trace.durationMs,
    samples: trace.samples.length,
    droppedWindows: trace.droppedWindows,
    metadata: trace.metadata,
    lightDiagnostics: trace.lightDiagnostics,
    deepRequested: trace.deepRequested
  };
  if(errors.length)throw Error('Browser errors: '+JSON.stringify(errors));
  result.errors = errors;result.status='passed';
  await page.locator('#screen').screenshot({ path: path.join(artifacts, 'after-trace.png') });
  await save();
  console.log('BENCHMARK COMPLETE ' + JSON.stringify(result));
  process.exit(0);
} catch (error) {
  result.status='failed';
  result.failure = String(error?.stack || error);
  result.errors = errors;
  await save();
  await page.locator('#screen').screenshot({ path: path.join(artifacts, 'benchmark-failure.png') }).catch(() => {});
  console.error('BENCHMARK FAILED', error?.stack || error);
  process.exit(1);
}
