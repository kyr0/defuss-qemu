#!/usr/bin/env node
// Real guest tests: no mocked VM, Bun, UART, migration or cache.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, stat, mkdtemp, rm} from 'node:fs/promises';
import {resolve, relative, extname} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const workspace = resolve('.'), root = resolve('packaging/bun-app');
const label = process.argv[2];
if (!label || !/^[a-z0-9-]+$/.test(label)) throw Error('Usage: node packaging/bun-app/test-e2e.mjs NEW_LABEL');
const output = resolve(root, 'validation', label);
await mkdir(resolve(root, 'validation'), {recursive: true});
await mkdir(output); // Refuse to overwrite prior evidence.
const summary = {status: 'running', startedUtc: new Date().toISOString(), checks: [], runs: {}};
const sha = value => createHash('sha256').update(value).digest('hex');
async function command(executable, args) {
  console.log([executable, ...args].join(' '));
  await new Promise((ok, bad) => {
    const child = spawn(executable, args, {cwd: workspace, stdio: 'inherit'});
    child.on('error', bad);
    child.on('exit', code => code === 0 ? ok() : bad(Error(`${executable} exited ${code}`)));
  });
}
const application = resolve(output, 'app.mjs.app');
async function nodeRun(name, app = application) {
  await command(process.execPath, [resolve(root, 'run.mjs'), app, '--cache', resolve(output, 'cache'), '--report', resolve(output, name + '.json'), '--send', 'P', '--until', 'APP_VERIFIED', '--timeout', '120000']);
  return JSON.parse(await readFile(resolve(output, name + '.json'), 'utf8'));
}
function verified(report, mode) {
  assert.equal(report.status, 'passed'); assert.equal(report.ready.mode, mode);
  const line = report.console.split(/\r?\n/).find(line => line.startsWith('APP_VERIFIED '));
  assert.ok(line, 'Missing complete application verification');
  const data = JSON.parse(line.slice('APP_VERIFIED '.length));
  assert.equal(data.mode, mode);
  for (const key of ['http', 'heap', 'file', 'serial']) assert.equal(data[key], true, key);
  assert.ok(report.com1.includes('PONG:' + data.nonce));
  if (mode === 'cold') {
    assert.ok(report.console.includes('BUN_APP_COLD_BOOT:')); assert.ok(report.console.includes('APP_INITIALIZED '));
    assert.equal(report.events.filter(e => e.event === 'snapshot-saved').length, 1);
  } else {
    assert.ok(!report.console.includes('BUN_APP_COLD_BOOT:')); assert.ok(!report.console.includes('APP_INITIALIZED '));
    assert.ok(!report.events.some(e => e.event.startsWith('snapshot-')));
  }
  return data;
}

let server, profile;
try {
  await command('python3', ['packaging/bundle-bun.py', 'packaging/bun-app/example/main.ts', '--project-root', 'packaging/bun-app/example', '--outfile', resolve(output, 'app.mjs')]);
  const manifest = JSON.parse(await readFile(resolve(application, 'app.json'), 'utf8'));
  const cacheFile = resolve(output, 'cache', manifest.appSha256, manifest.compatibilitySha256 + '.snapshot');
  const cold = await nodeRun('node-cold'), original = verified(cold, 'cold');
  const before = {sha256: sha(await readFile(cacheFile)), stat: await stat(cacheFile)};
  const warm = await nodeRun('node-restored');
  assert.equal(verified(warm, 'restored').nonce, original.nonce);
  assert.equal(sha(await readFile(cacheFile)), before.sha256);
  assert.equal((await stat(cacheFile)).mtimeMs, before.stat.mtimeMs);
  summary.runs.node = {coldReadyMs: cold.ready.readyMs, restoredReadyMs: warm.ready.readyMs, nonce: original.nonce, snapshotSha256: before.sha256, snapshotBytes: before.stat.size};
  summary.checks.push('Fresh Node process restores CPU/RAM/devices, heap, tmpfs file, Bun HTTP server and duplex COM1', 'Repeated COM1 signals and restore do not rewrite the first snapshot');

  const changedSource = resolve(output, 'changed.ts');
  await writeFile(changedSource, (await readFile(resolve(root, 'example/main.ts'), 'utf8')).replace('length: 4096', 'length: 4097'));
  await command('python3', ['packaging/bundle-bun.py', changedSource, '--project-root', output, '--outfile', resolve(output, 'changed.mjs')]);
  const changedApp = resolve(output, 'changed.mjs.app'), changedManifest = JSON.parse(await readFile(resolve(changedApp, 'app.json'), 'utf8'));
  assert.notEqual(changedManifest.appSha256, manifest.appSha256);
  const changed = await nodeRun('node-changed', changedApp), changedState = verified(changed, 'cold');
  assert.notEqual(changedState.nonce, original.nonce); assert.notEqual(changedState.sum, original.sum);
  assert.equal(sha(await readFile(cacheFile)), before.sha256);
  const changedWarm = await nodeRun('node-changed-restored', changedApp);
  assert.equal(verified(changedWarm, 'restored').nonce, changedState.nonce);
  summary.runs.changed = {appSha256: changedManifest.appSha256, coldReadyMs: changed.ready.readyMs, restoredReadyMs: changedWarm.ready.readyMs};
  summary.checks.push('Changed TypeScript bundle SHA-256 cold-boots into a separate snapshot and restores that new state');

  // Stable origin and an on-disk Chrome profile, with a complete browser restart.
  const prefixes = ['/packaging/bun-app/', '/host/browser/'];
  server = createServer(async (req, res) => {
    for (const [name, value] of Object.entries({'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-store'})) res.setHeader(name, value);
    const name = new URL(req.url, 'http://localhost').pathname;
    if (name === '/') { res.setHeader('Content-Type', 'text/plain'); res.end('Bun app snapshot validation'); return; }
    if (name === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const path = resolve(workspace, '.' + name);
    if (!path.startsWith(workspace + '/') || !prefixes.some(prefix => name.startsWith(prefix))) { res.writeHead(404); res.end(); return; }
    try {
      const data = await readFile(path);
      res.setHeader('Content-Type', ({'.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json'})[extname(path)] || 'application/octet-stream');
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', ok); });
  profile = await mkdtemp(resolve(tmpdir(), 'bun-snapshot-chrome-'));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const appURL = '/' + relative(workspace, application) + '/';
  async function browserRun(name) {
    const context = await chromium.launchPersistentContext(profile, {headless: true, ...(process.env.DEFUSS_VM_CHROME ? {executablePath: process.env.DEFUSS_VM_CHROME} : {})});
    try {
      const page = await context.newPage(), pageErrors = [];
      page.on('pageerror', error => pageErrors.push(String(error)));
      await page.goto(origin);
      const report = await page.evaluate(async appURL => {
        if (!crossOriginIsolated) throw Error('WASM threads require cross-origin isolation');
        const {startBunApp} = await import('/packaging/bun-app/vm.mjs');
        const manifest = await fetch(appURL + 'app.json').then(r => r.json());
        const report = {status: 'running', events: [], console: '', com1: '', browser: navigator.userAgent};
        let finish, bad, timer, vm;
        const done = new Promise((resolve, reject) => { finish = resolve; bad = reject; });
        done.catch(() => {});
        try {
          timer = setTimeout(() => bad(Error('Browser guest deadline exceeded')), 150000);
          vm = await startBunApp({manifest, runtimeUrl: new URL(appURL + manifest.generation + '/runtime/qemu-system-x86_64.js', location.href).href,
            readAsset: async name => { const r = await fetch(appURL + name); if (!r.ok) throw Error('Asset fetch failed: ' + name); return r.arrayBuffer(); },
            onConsole(text) { report.console += text; const end = report.console.lastIndexOf('\n'); if (end >= 0 && report.console.slice(0, end).includes('APP_VERIFIED ')) finish(); },
            onCom1(data) { report.com1 += new TextDecoder().decode(data); },
            onEvent(event) { report.events.push(event); if (event.event === 'error') bad(Error(event.reason)); },
          });
          report.ready = await vm.ready;
          vm.com1.write('P');
          await done; report.status = 'passed';
        } catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); }
        finally { clearTimeout(timer); if (vm) await vm.stop(); }
        return report;
      }, appURL);
      report.pageErrors = pageErrors;
      if (pageErrors.length) report.status = 'failed';
      await writeFile(resolve(output, name + '.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(name, report.status, report.ready?.readyMs, report.failure || '');
      return report;
    } finally { await context.close(); }
  }
  const browserCold = await browserRun('chrome-cold'), browserState = verified(browserCold, 'cold');
  const browserWarm = await browserRun('chrome-restored');
  assert.equal(verified(browserWarm, 'restored').nonce, browserState.nonce);
  assert.deepEqual(browserWarm.events.find(e => e.event === 'cache-hit').metadata, browserCold.events.find(e => e.event === 'snapshot-saved').metadata);
  summary.runs.chrome = {coldReadyMs: browserCold.ready.readyMs, restoredReadyMs: browserWarm.ready.readyMs, nonce: browserState.nonce, browser: browserCold.browser};
  summary.checks.push('IndexedDB snapshot survives complete Chrome restart and restores the same app state without cold initialization');
  summary.appSha256 = manifest.appSha256; summary.compatibilitySha256 = manifest.compatibilitySha256;
  summary.status = 'passed';
} catch (error) {
  summary.status = 'failed'; summary.failure = String(error.stack || error); process.exitCode = 1;
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (profile) await rm(profile, {recursive: true, force: true});
  summary.finishedUtc = new Date().toISOString();
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}
