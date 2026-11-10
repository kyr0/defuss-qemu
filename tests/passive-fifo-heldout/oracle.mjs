import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=data=>createHash('sha256').update(data).digest('hex');
export function validateHeldout(result,mode){
  assert.equal(result.schema,1);assert.equal(result.bun,'1.4.4');assert.equal(result.mode,mode);
  const lengths=[0,1,7,31,55,56,63,64,65,119,120,127,128,129,255,256,1023,1024,4095,4096,65535,65536,65537,1048576];
  assert.equal(result.results.length,lengths.length*8);
  for(let i=0;i<result.results.length;i++){
    const row=result.results[i],round=Math.floor(i/lengths.length),index=i%lengths.length;
    assert.equal(row.round,round);assert.equal(row.index,index);assert.equal(row.length,lengths[index]);assert.equal(row.offset,(index+round)%17);
    const seed=(0x9e3779b9^Math.imul(round+1,65537)^Math.imul(index+1,1664525))>>>0;assert.equal(row.seed,seed);
    let state=seed;const data=Buffer.alloc(row.length);
    for(let j=0;j<data.length;j++){state^=state<<13;state^=state>>>17;state^=state<<5;data[j]=state&255;}
    const expected=sha(data);assert.equal(row.direct,expected);assert.equal(row.streamed,expected);assert.equal(row.inputUnchanged,true);
  }
  return result.results.length*2;
}
