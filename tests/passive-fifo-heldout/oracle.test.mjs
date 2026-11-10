import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateHeldout} from './oracle.mjs';
test('heldout oracle revalidates retained payload-only cases and rejects digest/state corruption',async()=>{
 // Historical guest data exercises the unchanged arithmetic oracle only. This
 // test is explicitly not new passive-policy guest evidence.
 const report=JSON.parse(await readFile(new URL('../../artifacts/m2-heldout-off-capture-01/report.json',import.meta.url)));
 assert.equal(validateHeldout(report.result,'cold'),384);
 for(const mutate of [r=>r.mode='restored',r=>r.results[0].direct='0'.repeat(64),r=>r.results[1].inputUnchanged=false,r=>r.results.pop(),r=>r.results[4].offset++]){const r=structuredClone(report.result);mutate(r);assert.throws(()=>validateHeldout(r,'cold'));}
});
