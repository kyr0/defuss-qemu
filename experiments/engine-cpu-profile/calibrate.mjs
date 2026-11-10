import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {CpuCollector, browserIdentity} from './collector.mjs';
import {json, readBound, durable, verifyInputs} from '../../benchmarks/harness/m2-msg1-timing/identity.mjs';
import {resolve} from 'node:path';

const root = process.cwd(), output = process.argv[2];
assert.match(output ?? '', /^artifacts\/[a-z0-9-]+$/);
assert.ok(process.env.TMPDIR?.startsWith(root + '/tmp/'));
await mkdir(output);
const save = (name, value) => json(resolve(output, name), value);
const inputs = {};
for (const path of ['experiments/engine-cpu-profile/collector.mjs',
  'experiments/engine-cpu-profile/calibrate.mjs', 'experiments/engine-cost/boundaries.mjs']) {
  inputs[path] = (await readBound(root, path)).id;
}
await save('inputs.json', inputs);
const fixture = `import {sameBytes} from '/boundaries.mjs';
const run = new WebAssembly.Instance(new WebAssembly.Module(sameBytes)).exports.run;
const iterations = 400000;
let expected = 123;
for (let i = 0; i < iterations; i++) expected = (Math.imul(expected, 1664525) + 1013904223) | 0;
export function work() {
  const start = performance.now(); let calls = 0;
  do { if (run(iterations) !== expected) throw Error('Real Wasm checksum mismatch'); calls++; }
  while (performance.now() - start < 1500);
  return {calls, expected};
}
if (typeof document === 'undefined') {
  onmessage = () => postMessage(work()); postMessage({ready:true});
}`;
const boundaries = await readFile('experiments/engine-cost/boundaries.mjs');
await durable(resolve(output, 'fixture.mjs'), fixture);
const server = createServer((req, res) => {
  if (req.url === '/boundaries.mjs' || req.url === '/fixture.mjs') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(req.url === '/fixture.mjs' ? fixture : boundaries);
  } else res.end('CPU sampling calibration');
});
let browser, collector;
const report = {status: 'failed', timingEligible: false, inputs, errors: []};
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless: true, executablePath: process.env.DEFUSS_VM_CHROME});
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.goto('http://127.0.0.1:' + server.address().port);
  const cdp = await browser.newBrowserCDPSession();
  report.browserIdentity = await browserIdentity(cdp);
  collector = new CpuCollector(cdp, save);
  await page.evaluate(async () => {
    globalThis.fixture = await import('/fixture.mjs');
    globalThis.worker = new Worker('/fixture.mjs', {type: 'module'});
    await new Promise((resolve, reject) => {
      worker.onmessage = event => event.data.ready ? resolve() : reject(Error('Worker initialization'));
      worker.onerror = reject;
    });
  });
  await collector.start('known-page-and-worker-wasm');
  report.results = await page.evaluate(async () => {
    const result = new Promise((resolve, reject) => {worker.onmessage = e => resolve(e.data); worker.onerror = reject;});
    worker.postMessage('go');
    return [fixture.work(), await result];
  });
  await collector.stop();
  report.profiles = collector.report();
  assert.deepEqual(report.profiles.errors, []);
  assert.deepEqual(report.errors, []);
  report.coverage = [];
  for (const target of report.profiles.segments[0].targets) {
    const profile = JSON.parse(await readFile(resolve(output, target.file)));
    const wasm = new Set(profile.nodes.filter(node => node.callFrame.url.startsWith('wasm:')).map(node => node.id));
    report.coverage.push({type: target.type, samples: profile.samples.length,
      wasmSamples: profile.samples.filter(id => wasm.has(id)).length});
  }
  for (const type of ['page', 'worker']) assert.ok(report.coverage.some(row => row.type === type && row.wasmSamples > 0), `No ${type} Wasm samples`);
  await verifyInputs(root, inputs);
  report.status = 'passed';
} catch (error) {report.failure = String(error.stack ?? error);}
finally {
  try {await collector?.close();} catch (error) {report.cleanupFailure = String(error); report.status = 'failed';}
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.completedUtc = new Date().toISOString(); await save('report.json', report);
}
console.log(`${new Date().toISOString()} ${report.status === 'passed' ? 'INFO' : 'ERROR'} calibration ${JSON.stringify({status: report.status, output, coverage: report.coverage, failure: report.failure})}`);
if (report.status !== 'passed') process.exitCode = 1;
