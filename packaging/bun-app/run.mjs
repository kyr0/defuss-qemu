#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises';
import {resolve, relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {fileSnapshotStore} from './file-store.mjs';
import {startBunApp} from './vm.mjs';

const {values, positionals} = parseArgs({allowPositionals: true, options: {
  cache: {type: 'string'}, report: {type: 'string'}, until: {type: 'string'}, send: {type: 'string'},
  timeout: {type: 'string', default: '180000'},
}});
if (positionals.length !== 1) throw Error('Usage: node packaging/bun-app/run.mjs APP_DIRECTORY [--cache DIRECTORY] [--report FILE] [--send TEXT] [--until CONSOLE_MARKER]');
const directory = resolve(positionals[0]), timeoutMs = Number(values.timeout);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('Invalid timeout');
const manifest = JSON.parse(await readFile(resolve(directory, 'app.json'), 'utf8'));
const artifact = name => {
  const path = resolve(directory, name);
  if (relative(directory, path).startsWith('..')) throw Error('Artifact outside app directory');
  return path;
};
const runtime = artifact(manifest.generation + '/runtime/qemu-system-x86_64.js');
const report = {status: 'running', host: process.version, events: [], console: '', com1: ''};
let vm, finish, rejectDone, deadline;
const done = new Promise((resolve, reject) => { finish = resolve; rejectDone = reject; });
done.catch(() => {});
process.once('SIGINT', () => finish('SIGINT')); process.once('SIGTERM', () => finish('SIGTERM'));
try {
  vm = await startBunApp({manifest, readAsset: name => readFile(artifact(name)), runtimeUrl: pathToFileURL(runtime).href, workerScript: runtime,
    snapshotStore: fileSnapshotStore(values.cache || resolve(directory, 'snapshots')), timeoutMs,
    onConsole(text) {
      process.stdout.write(text); report.console += text;
      const lastNewline = report.console.lastIndexOf('\n');
      if (values.until && lastNewline >= 0 && report.console.slice(0, lastNewline).includes(values.until)) finish('marker');
    },
    onCom1(data) { report.com1 += new TextDecoder().decode(data); },
    onEvent(event) {
      report.events.push(event);
      if (event.event === 'error') rejectDone(Error(event.reason));
      if (event.event !== 'stderr') process.stderr.write(`[${event.event}] ${Math.round(event.atMs)} ms\n`);
    },
  });
  report.ready = await vm.ready;
  if (values.send) vm.com1.write(values.send);
  if (values.until) deadline = setTimeout(() => rejectDone(Error('Console marker deadline exceeded')), timeoutMs);
  else {
    process.stdin.on('data', data => vm.com1.write(data));
    process.stdin.resume();
  }
  report.end = await done;
  if (values.until && report.end !== 'marker') throw Error('Stopped before console marker: ' + report.end);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = String(error.stack || error); process.stderr.write(report.failure + '\n');
} finally {
  clearTimeout(deadline);
  if (vm) await vm.stop().catch(error => { report.stopError = String(error); report.status = 'failed'; });
  if (values.report) await writeFile(values.report, JSON.stringify(report, null, 2) + '\n');
}
// The standalone CLI owns this process and its WASM worker pool.
process.exit(report.status === 'passed' ? 0 : 1);
