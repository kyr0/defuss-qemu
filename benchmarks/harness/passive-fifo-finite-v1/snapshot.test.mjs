import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {packRecord} from '../../../packaging/bun-app/snapshots.mjs';
import {verifySnapshot} from './snapshot.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('snapshot verifies outer envelope, compressed digest and bounded raw digest',async()=>{
 const base=resolve(new URL('../../../tmp',import.meta.url).pathname);await mkdir(base,{recursive:true});const dir=await mkdtemp(resolve(base,'fifo-snapshot-')),path=resolve(dir,'snapshot');
 const raw=Buffer.from('unchanged guest snapshot'),data=gzipSync(raw),manifest={appSha256:'a'.repeat(64),compatibilitySha256:'b'.repeat(64)};
 const metadata={schema:1,encoding:'gzip',...manifest,bytes:raw.length,sha256:sha(raw),compressedBytes:data.length,compressedSha256:sha(data)};
 async function save(m){const bytes=packRecord({metadata:m,data});await writeFile(path,bytes);return {sha256:sha(bytes),bytes:bytes.length};}
 await verifySnapshot(path,manifest,await save(metadata));
 for(const mutate of [m=>m.sha256='c'.repeat(64),m=>m.bytes--,m=>m.compressedSha256='d'.repeat(64),m=>m.compatibilitySha256='e'.repeat(64)]){const m={...metadata};mutate(m);const id=await save(m);await assert.rejects(()=>verifySnapshot(path,manifest,id));}
});
