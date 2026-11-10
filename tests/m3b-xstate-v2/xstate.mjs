import assert from 'node:assert/strict';
export function caps(value){
 assert.deepEqual(Object.keys(value).sort(),['bndcsrOffset','bndregsOffset','mask','patterns','pkruOffset','schema','size','ymmOffset']);
 assert.equal(value.schema,1);assert.equal(value.patterns,2);assert.ok([7,31,519,543].includes(value.mask));
 assert.ok(Number.isInteger(value.size)&&value.size>=832&&value.size<=4096);
 assert.equal(value.ymmOffset,576);assert.equal(value.pkruOffset,(value.mask&512)!==0?2688:0);
 assert.equal(value.size,(value.mask&512)!==0?2696:(value.mask&24)?1088:832);
 assert.equal(value.bndregsOffset,(value.mask&24)?960:0);assert.equal(value.bndcsrOffset,(value.mask&24)?1024:0);
 return value;
}
export function seeded(c,pattern){
 caps(c);assert.ok(pattern===0||pattern===1);const b=Buffer.alloc(c.size);
 b.writeUInt16LE(0x037f+pattern*0x400,0);b[4]=255;b.writeUInt32LE(0x1f80+pattern*0x2000,24);
 for(let i=0;i<8;i++){b.writeBigUInt64LE(0x8000000000000000n|(BigInt(i+1)*0x01020304050607n+BigInt(pattern)),32+i*16);b.writeUInt16LE(0x3ff0+i,40+i*16);}
 for(let i=0;i<256;i++){b[160+i]=(i*73+29+pattern*101)&255;b[c.ymmOffset+i]=((i+256)*73+29+pattern*101)&255;}
 if(c.bndregsOffset){for(let i=0;i<8;i++)b.writeBigUInt64LE(0x0102030405060708n*BigInt(i+1)+BigInt(pattern),c.bndregsOffset+i*8);b.writeBigUInt64LE(0x100000n+BigInt(pattern)*4096n,c.bndcsrOffset+8);}
 b.writeBigUInt64LE(BigInt(c.mask),512);if(c.pkruOffset)b.writeUInt32LE(pattern?0xaaaaaaa8:0x55555554,c.pkruOffset);
 return b;
}
export function compare(actual,c,pattern){
 assert.ok(Buffer.isBuffer(actual)&&actual.length===c.size);const expected=seeded(c,pattern);
 const ranges=[[0,5],[8,28],[160,416],[512,528],[c.ymmOffset,c.ymmOffset+256],...Array.from({length:8},(_,i)=>[32+i*16,42+i*16])];
 if(c.bndregsOffset)ranges.push([c.bndregsOffset,c.bndregsOffset+64],[c.bndcsrOffset,c.bndcsrOffset+16]);
 if(c.pkruOffset)ranges.push([c.pkruOffset,c.pkruOffset+4]);
 for(const [a,b]of ranges)assert.deepEqual(actual.subarray(a,b),expected.subarray(a,b),'Required component bytes '+a+'..'+b);
 assert.equal(actual.readUInt16LE(6)&0x7ff,0);
 const mxcsrMask=actual.readUInt32LE(28);assert.notEqual(mxcsrMask,0);assert.equal(actual.readUInt32LE(24)&~mxcsrMask,0);
 return {mxcsrMask};
}
export function state(value,configuration,gate){
 const c=caps(configuration);assert.deepEqual(Object.keys(value).sort(),['invocations','samples','seq']);assert.equal(value.seq,gate.seq);
 const n=(gate.checks-4)/20;assert.ok(Number.isInteger(n)&&n>=0&&n<=47168);assert.equal(value.invocations,n);assert.equal(value.samples.length,2);
 for(let p=0;p<2;p++){
  const sample=value.samples[p];assert.deepEqual(Object.keys(sample).sort(),['after','before','invocation','pattern']);assert.equal(sample.pattern,p);assert.equal(sample.invocation,n?n-1+p:0);
  const blocks=['before','after'].map(key=>{assert.match(sample[key],/^(?:[0-9a-f]{2})+$/);const b=Buffer.from(sample[key],'hex');assert.equal(b.length,c.size);return b;});
  if(!n){for(const b of blocks)assert.ok(b.every(x=>x===0));continue;}
  assert.deepEqual(compare(blocks[0],c,p),compare(blocks[1],c,p));
 }
 return {seq:gate.seq,invocations:n,patterns:n?2:0,mask:c.mask};
}
