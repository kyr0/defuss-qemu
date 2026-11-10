// Validate an already built bundle in two separate VM processes.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const directory = resolve(process.argv[2]), label = process.argv[3];
assert.match(label || '', /^[a-z0-9-]+$/);
const output = resolve('artifacts', label);
await mkdir(output);
const identity = async path => {
  const data = await readFile(path);
  return {bytes:data.length, sha256:createHash('sha256').update(data).digest('hex')};
};
const summary = {status:'failed', directory, inputs:{}, runs:[]};
try {
  const manifest = JSON.parse(await readFile(directory + '/app.json'));
  assert.equal(manifest.snapshot.readyMode, 'after-module');
  assert.equal(manifest.vm.msg1, true);
  summary.inputs['app.json'] = await identity(directory + '/app.json');
  for (const [name, expected] of Object.entries(manifest.artifacts)) {
    assert.deepEqual(await identity(resolve(directory, manifest.generation, name)), expected);
  }
  for (const name of ['run','vm','snapshots','file-store','serial']) {
    summary.inputs['packaging/bun-app/' + name + '.mjs'] = await identity('packaging/bun-app/' + name + '.mjs');
  }
  summary.inputs['host/browser/candidate.mjs'] = await identity('host/browser/candidate.mjs');
  summary.inputs['host/browser/runtime-loader.mjs'] = await identity('host/browser/runtime-loader.mjs');
  summary.inputs['tests/bun-bundle.mjs'] = await identity('tests/bun-bundle.mjs');
  for (const mode of ['cold','restored']) {
    const reportPath = resolve(output, mode + '.json');
    await new Promise((ok,bad) => {
      const child = spawn(process.execPath, ['packaging/bun-app/run.mjs', directory,
        '--cache', output + '/snapshots', '--report', reportPath, '--until','AUTO_VERIFIED','--timeout','180000'], {stdio:'inherit'});
      child.once('error',bad);child.once('exit',code => code === 0 ? ok() : bad(Error('Bun VM exited ' + code)));
    });
    const report = JSON.parse(await readFile(reportPath));
    assert.equal(report.status,'passed');assert.equal(report.ready.mode,mode);
    const state = JSON.parse(report.console.split(/\r?\n/).find(s => s.startsWith('AUTO_VERIFIED ')).slice(14));
    assert.equal(state.file,true);assert.equal(state.http,true);
    assert.equal(report.console.includes('AUTO_INITIALIZED '), mode === 'cold');
    assert.equal(report.console.includes('BUN_APP_COLD_BOOT:'), mode === 'cold');
    assert.ok(report.events.some(e => e.event === 'vm-started' && [0x10002,0x10004].includes(e.msg1Status)));
    summary.runs.push({mode,nonce:state.nonce,readyMs:report.ready.readyMs});
  }
  assert.equal(summary.runs[0].nonce,summary.runs[1].nonce);
  summary.status = 'passed';
} catch(error) {summary.failure=String(error.stack||error);process.exitCode=1;}
await writeFile(output + '/report.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
