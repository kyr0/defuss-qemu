#!/usr/bin/env node
// Actual unchanged Bun workload in a fresh isolated Chrome VM; not a timing campaign.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname, extname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = resolve(root, process.argv[2] || 'runtime/x86_64');
const label = process.argv[3];
assert.match(label || '', /^[a-z0-9-]+$/, 'Provide a fresh report label');
assert.ok(runtime.startsWith(root + '/'));
const output = resolve(root, 'artifacts/validation', label);
await mkdir(dirname(output), {recursive: true}); await mkdir(output);
const headers = {'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store'};
const server = createServer(async (req, res) => {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') { res.end('Bun consolidation smoke check'); return; }
  const path = resolve(root, '.' + name);
  if (!path.startsWith(root + '/')) { res.writeHead(404); res.end(); return; }
  try {
    const data = await readFile(path);
    res.setHeader('Content-Type', ({'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm'})[extname(path)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', ok); });
let browser, watchdog, report = {status:'failed'};
try {
  browser = await chromium.launch({headless:true, ...(process.env.DEFUSS_VM_CHROME ? {executablePath:process.env.DEFUSS_VM_CHROME} : {})});
  watchdog = setTimeout(() => void browser.close(), 300000);
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  report = await page.evaluate(async runtimePath => {
    if (!crossOriginIsolated) throw Error('Cross-origin isolation unavailable');
    const {runGuest} = await import('/tests/bun/guest.mjs');
    const bytes = async path => { const r = await fetch(path); if (!r.ok) throw Error(path); return r.arrayBuffer(); };
    const roms = {};
    for (const name of ['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin']) roms[name] = await bytes('/engine/qemu/pc-bios/' + name);
    return runGuest({runtimeUrl:new URL(runtimePath + '/qemu-system-x86_64.js', location.href).href,
      kernel:await bytes('/assets/bun/amd64/vmlinuz-virt'),
      initramfs:await bytes('/assets/bun/amd64/initramfs-benchmark.cpio.gz'), roms});
  }, '/' + relative(root, runtime));
  report.browser = browser.version(); report.pageErrors = errors;
  assert.equal(report.status, 'passed', report.failure);
  assert.deepEqual(errors, []);
  const expected = JSON.parse(await readFile(resolve(root, 'benchmarks/expected.json')));
  const results = report.events.filter(e => e.event === 'result');
  assert.equal(results.length, 12);
  for (const result of results) { assert.equal(result.value, expected[result.name]); assert.equal(result.iterations, 20); }
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); }
finally {
  clearTimeout(watchdog); if (browser) await browser.close();
  await new Promise(ok => server.close(ok));
  report.scope = 'Correctness smoke, not performance confirmation';
  report.identities = {};
  for (const name of ['qemu-system-x86_64.js','qemu-system-x86_64.wasm']) {
    report.identities[name] = createHash('sha256').update(await readFile(resolve(runtime, name))).digest('hex');
  }
  await writeFile(resolve(output, 'serial.log'), report.serial || ''); delete report.serial;
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({status:report.status, report:resolve(output,'report.json'), results:report.events?.filter(e=>e.event==='result').length, failure:report.failure}));
}
process.exitCode = report.status === 'passed' ? 0 : 1;
