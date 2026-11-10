import {createHash} from 'node:crypto';

export const SNAPSHOT_CHUNK_BYTES = 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 1024 ** 3;

// One token, one ordered upload, one commit. Publication belongs to the caller
// after finish verifies the exact packed bytes. Partial uploads stay in memory.
export class SnapshotUpload {
  constructor() { this.parts=[];this.bytes=0;this.total=null;this.digest=null;this.sealed=false; }
  append(offset,total,digest,body) {
    try {
      if(this.sealed||!Number.isSafeInteger(offset)||offset!==this.bytes||
         !Number.isSafeInteger(total)||total<=0||total>MAX_SNAPSHOT_BYTES||
         !/^[a-f0-9]{64}$/.test(digest)||
         (this.total!==null&&(total!==this.total||digest!==this.digest))||
         offset>=total||body.length!==Math.min(SNAPSHOT_CHUNK_BYTES,total-offset))
        throw Error('Invalid snapshot chunk ordering, size or identity');
      this.total=total;this.digest=digest;
      this.parts.push(Buffer.from(body));this.bytes+=body.length;
      return this.bytes;
    } catch(error) { this.sealed=true;this.parts=[];throw error; }
  }
  finish() {
    if(this.sealed||this.total===null||this.bytes!==this.total) {
      this.sealed=true;this.parts=[];throw Error('Incomplete or already committed snapshot upload');
    }
    this.sealed=true;
    const packed=Buffer.concat(this.parts,this.bytes);this.parts=[];
    if(createHash('sha256').update(packed).digest('hex')!==this.digest)
      throw Error('Snapshot upload checksum mismatch');
    return packed;
  }
}

export async function readBoundedBody(stream,limit) {
  const parts=[];let length=0;
  for await(const part of stream) {
    length+=part.length;if(length>limit)throw Error('Snapshot request body exceeds limit');
    parts.push(part);
  }
  return Buffer.concat(parts,length);
}
