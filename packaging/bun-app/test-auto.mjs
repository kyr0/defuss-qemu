#!/usr/bin/env node
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const label = process.argv[2];
if (!label || !/^[a-z0-9-]+$/.test(label)) throw Error('Usage: node packaging/bun-app/test-auto.mjs NEW_LABEL');
const root = resolve('packaging/bun-app'), output = resolve(root, 'validation', label);
await mkdir(resolve(root, 'validation'), {recursive: true}); await mkdir(output);
async function command(exe, args) {
  await new Promise((ok, bad) => {
    const child = spawn(exe, args, {stdio: 'inherit'});
    child.on('error', bad); child.on('exit', code => code === 0 ? ok() : bad(Error(`${exe} exited ${code}`)));
  });
}
const summary = {status: 'running', checks: []};
try {
  await command('python3', ['packaging/bundle-bun.py', resolve(root, 'example/automatic.ts'), '--project-root', resolve(root, 'example'), '--outfile', resolve(output, 'automatic.mjs')]);
  const packagePath = resolve(output, 'automatic.mjs.app');
  const manifest = JSON.parse(await readFile(resolve(packagePath, 'app.json'), 'utf8'));
  assert.equal(manifest.snapshot.readyMode, 'after-module');
  const runs = [];
  for (const mode of ['cold', 'restored']) {
    const reportPath = resolve(output, mode + '.json');
    await command(process.execPath, [resolve(root, 'run.mjs'), packagePath, '--report', reportPath, '--until', 'AUTO_VERIFIED', '--timeout', '120000']);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.status, 'passed'); assert.equal(report.ready.mode, mode);
    const state = JSON.parse(report.console.split(/\r?\n/).find(line => line.startsWith('AUTO_VERIFIED ')).slice('AUTO_VERIFIED '.length));
    assert.equal(state.file, true); assert.equal(state.http, true);
    assert.equal(report.console.includes('AUTO_INITIALIZED '), mode === 'cold');
    assert.equal(report.console.includes('BUN_APP_COLD_BOOT:'), mode === 'cold');
    runs.push({mode, nonce: state.nonce, readyMs: report.ready.readyMs});
  }
  assert.equal(runs[0].nonce, runs[1].nonce);
  summary.runs = runs;
  summary.checks.push('Default bundling signals COM1 automatically after top-level await/module initialization', 'A console line containing 1 does not trigger capture', 'Automatic snapshot resumes the same heap, file and HTTP state without initialization');
  summary.status = 'passed';
} catch (error) { summary.status = 'failed'; summary.failure = String(error.stack || error); process.exitCode = 1; }
await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
