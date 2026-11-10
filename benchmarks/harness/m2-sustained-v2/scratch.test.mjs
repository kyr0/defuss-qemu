import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {prepareScratch} from './scratch.mjs';
test('browser scratch and child temp environment stay in a short retained project directory',async()=>{
 const root=resolve(new URL('../../..',import.meta.url).pathname),record=await prepareScratch(resolve(root,'artifacts/scratch-test-placeholder'));
 assert.match(record.projectRelative,/^tmp\/s-[a-zA-Z0-9]{6}$/);
 for(const name of ['TMPDIR','TMP','TEMP'])assert.equal(process.env[name],record.directory);
 const saved=JSON.parse(await readFile(resolve(record.directory,'run.json')));assert.equal(saved.output,record.output);assert.equal(saved.directory,record.directory);
});
