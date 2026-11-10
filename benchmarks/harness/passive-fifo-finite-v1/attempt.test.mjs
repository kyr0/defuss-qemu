import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {beginAttempt,certifyPreStartFailure,provenPreStartFailure,durableNew} from './attempt.mjs';
async function directory(){const base=resolve(new URL('../../../tmp',import.meta.url).pathname);await mkdir(base,{recursive:true});return mkdtemp(resolve(base,'fifo-start-'));}
test('missing start record never proves pre-start; only bound failure certificate permits retry',async()=>{const dir=await directory();assert.equal(await provenPreStartFailure(dir),false);const bytes=JSON.stringify({status:'failed',executionBoundary:{started:false}});await durableNew(resolve(dir,'report.json'),bytes);assert.equal(await provenPreStartFailure(dir),false);await certifyPreStartFailure(dir,bytes);assert.equal(await provenPreStartFailure(dir),true);await writeFile(resolve(dir,'report.json'),bytes+' ');assert.equal(await provenPreStartFailure(dir),false);});
test('durable start marker blocks a forged pre-start certificate and duplicate launch',async()=>{const dir=await directory();const marker=await beginAttempt(dir);assert.equal(JSON.parse(await readFile(resolve(dir,'execution-start.json'))).id,marker.id);await assert.rejects(beginAttempt(dir),/EEXIST/);await assert.rejects(certifyPreStartFailure(dir,JSON.stringify({status:'failed',executionBoundary:{started:false}})));assert.equal(await provenPreStartFailure(dir),false);});
