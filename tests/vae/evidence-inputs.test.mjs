import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {verifyRetainedInputs} from '../../experiments/engine-cpu-profile/evidence-inputs.mjs';

test('historical metadata stays frozen while executable inputs are checked live', async () => {
  await mkdir('tmp', {recursive: true});
  const root = await mkdtemp(resolve('tmp/evidence-inputs-'));
  const identity = text => ({bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex')});
  const inputs = {'package.json': identity('original metadata'), 'driver.mjs': identity('original driver')};
  try {
    await mkdir(root + '/manifests/history', {recursive: true});
    const archived = root + '/manifests/history/engine-capture-package.json';
    await writeFile(archived, 'original metadata');
    await writeFile(root + '/package.json', 'current release metadata');
    await writeFile(root + '/driver.mjs', 'original driver');
    await verifyRetainedInputs(root, inputs);
    await writeFile(archived, 'changed historical metadata');
    await assert.rejects(verifyRetainedInputs(root, inputs), /Changed input/);
    await writeFile(archived, 'original metadata');
    await writeFile(root + '/driver.mjs', 'changed driver');
    await assert.rejects(verifyRetainedInputs(root, inputs), /Changed input driver.mjs/);
  } finally {
    await rm(root, {recursive: true});
  }
});
