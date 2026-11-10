import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createGunzip} from 'node:zlib';
import {createHash} from 'node:crypto';
import {unpackRecord} from '../../../packaging/bun-app/snapshots.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifySnapshot(path,manifest,identity){
 const bytes=await readFile(path);assert.deepEqual({sha256:sha(bytes),bytes:bytes.length},identity,'Snapshot envelope changed');
 const {metadata:m,data}=unpackRecord(bytes);assert.equal(m.schema,1);assert.equal(m.encoding,'gzip');
 assert.equal(m.appSha256,manifest.appSha256);assert.equal(m.compatibilitySha256,manifest.compatibilitySha256);
 assert.ok(Number.isSafeInteger(m.bytes)&&m.bytes>0&&m.bytes<=1073741824);assert.equal(m.compressedBytes,data.length);assert.equal(m.compressedSha256,sha(data));
 let rawBytes=0;const hash=createHash('sha256'),stream=Readable.from([data]).pipe(createGunzip());
 for await(const chunk of stream){rawBytes+=chunk.length;assert.ok(rawBytes<=m.bytes,'Snapshot expands beyond bound');hash.update(chunk);}
 assert.equal(rawBytes,m.bytes);assert.equal(hash.digest('hex'),m.sha256,'Snapshot inner digest differs');
 return m;
}
