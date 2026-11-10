#!/usr/bin/env node
// Actual pinned Emscripten FS contract; QMP is stubbed, and no guest is started.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {stoppedMemoryReader} from './physical.mjs';

const [runtime,output]=process.argv.slice(2);
assert.ok(runtime&&output,'Usage: check-runtime-fs.mjs RUNTIME_JS FRESH_REPORT_JSON');
const sha=data=>createHash('sha256').update(data).digest('hex');
const path=resolve(runtime),{default:factory}=await import(pathToFileURL(path));
const mod=await factory({noInitialRun:true});
assert.throws(()=>mod.FS.open('/unsupported-mode','wx'),/Unknown file open mode/);
const qmp={async send(command,args){
  if(command==='query-status')return {running:false,status:'paused'};
  assert.equal(command,'pmemsave');
  mod.FS.writeFile(args.filename,new Uint8Array(args.size).fill(73));
}};
const reader=stoppedMemoryReader({qmp,fs:mod.FS});
assert.deepEqual(await reader.readPhysical(0x100000,8),new Uint8Array(8).fill(73));
assert.equal(mod.FS.analyzePath('/defuss-m1-code-1.bin').exists,false);
mod.FS.writeFile('/defuss-m1-code-2.bin',new Uint8Array([99]));
await assert.rejects(reader.readPhysical(0x100000,8));
assert.deepEqual(mod.FS.readFile('/defuss-m1-code-2.bin'),new Uint8Array([99]));
const report={schema:1,status:'passed',scope:'Actual candidate Emscripten FS with QMP transport stub; no guest execution or physical-memory read',
  runtime:{path,jsSha256:sha(await readFile(path)),wasmSha256:sha(await readFile(resolve(dirname(path),'qemu-system-x86_64.wasm')))},
  readerSha256:sha(await readFile(new URL('./physical.mjs',import.meta.url))),
  wxRejected:true,numericExclusiveCreate:true,ownedFileCleanup:true,collisionPreservesExistingFile:true};
await writeFile(resolve(output),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
// Emscripten's preallocated workers outlive noInitialRun; this isolated check owns them.
process.exit(0);
