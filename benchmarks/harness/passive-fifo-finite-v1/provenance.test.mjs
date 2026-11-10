import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(new URL('../../..',import.meta.url).pathname),sha=b=>createHash('sha256').update(b).digest('hex');
test('all inherited workload/timing sources and frozen FIFO reader remain unchanged',async()=>{
 const old=JSON.parse(await readFile(resolve(root,'artifacts/m2-sustained-v2-source-01/manifest.json')));
 for(const [path,digest] of Object.entries(old.files))assert.equal(sha(await readFile(resolve(root,path))),digest,path);
 const overlay=JSON.parse(await readFile(resolve(root,'artifacts/passive-fifo-overlay-source-01/manifest.json')));
 for(const row of overlay.files)assert.equal(sha(await readFile(resolve(root,row.path))),row.sha256,row.path);
 assert.equal(sha(await readFile(resolve(root,'artifacts/m2-sustained-v2-bundle-01/app.mjs'))),'f9ed5327b4549350c4ddd554c6ada074487a45924435ded873abe46e0aa7d668');
});
