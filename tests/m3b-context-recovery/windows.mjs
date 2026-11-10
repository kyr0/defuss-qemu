import assert from 'node:assert/strict';
import {StoppedWindows as BaselineWindows,maxWindowBytes} from '../m3b-context-runner/windows.mjs';
export {maxWindowBytes};
export class StoppedWindows extends BaselineWindows{
 async accept(row){
  if(row.event==='injection-request'||row.event==='injection'){
   assert.equal(this.phase,'configured');assert.equal(row.seq,this.seq);
   assert.equal(row.streams.streams.trace.seen,this.gateEnd,'No execution during paused mutation');
   return null;
  }
  return super.accept(row);
 }
}
