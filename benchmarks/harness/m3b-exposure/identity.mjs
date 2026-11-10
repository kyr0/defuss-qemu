import assert from 'node:assert/strict';
import {readFile,open,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
export const sources=Object.freeze([
 ...['config.mjs','identity.mjs','oracle.mjs','guest.mjs','run.mjs','inspect.mjs','test.mjs','controller.py','README.md'].map(p=>'benchmarks/harness/m3b-exposure/'+p),
 'benchmarks/harness/m1/protocol.mjs','host/browser/qmp.mjs','host/browser/machine.mjs','packaging/bun-app/serial.mjs','packaging/bun-app/vm.mjs','packaging/bun-app/snapshots.mjs',
 'experiments/m3a-region/reader.mjs','tests/m3b-fallthrough/reader.mjs','tests/m3b-fallthrough/runtime-identity.mjs','tests/m3b-context-accounting-v3/census-browser.mjs','tests/m3b-context-accounting-v3/census-reader.mjs',
 'scripts/with-tmp.py','package.json','package-lock.json','node_modules/playwright/package.json','node_modules/playwright-core/package.json']);
export const sha=b=>createHash('sha256').update(b).digest('hex');
export async function identity(path){const h=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path)){h.update(chunk);bytes+=chunk.length;}return {sha256:h.digest('hex'),bytes};}
export function inside(root,name){const path=resolve(root,name);assert.ok(path.startsWith(root+'/'));assert.equal(relative(root,path),name);return path;}
export async function verifyInputs(root,inputs){for(const [name,id]of Object.entries(inputs)){const path=inside(root,name);assert.equal(await realpath(path),path);assert.deepEqual(await identity(path),id,'Changed input '+name);}}
export async function durable(path,data){const h=await open(path,'wx');try{await h.writeFile(data);await h.sync();}finally{await h.close();}}
export async function json(path,value){await durable(path,JSON.stringify(value,null,2)+'\n');}
export async function readBound(root,name,expected){const bytes=await readFile(inside(root,name)),id={bytes:bytes.length,sha256:sha(bytes)};if(expected)assert.deepEqual(id,expected);return {bytes,id};}
