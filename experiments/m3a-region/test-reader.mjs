import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {configureM3Region,readM3Region,watchM3Region,injectM3Region} from './reader.mjs';
const bytes=readFileSync(process.argv[2]), words=new Uint32Array(128);
assert.equal(bytes.length,384);
words.set(new Uint32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),16);
const mod={_defuss_m3_abi:()=>1,_defuss_m3_data:()=>64n,pcProfileWords:()=>words,
  _defuss_m3_configure:value=>{assert.ok(value===0||value===1);return 0;},
  _defuss_m3_watch:(slot,begin,end)=>{assert.equal(slot,0);assert.equal(begin,0x400000n);assert.equal(end,0x401000n);return 0;},
  _defuss_m3_test_abi:()=>1,
  _defuss_m3_test_inject:(action,slot,pc)=>{assert.ok(action===1||action===2);assert.equal(slot,0);assert.equal(pc,0x400000n);return 1;}};
configureM3Region(mod,true);configureM3Region(mod,false);
assert.throws(()=>configureM3Region(mod,1));
assert.throws(()=>configureM3Region({...mod,_defuss_m3_configure:()=>-1},true));
const result=readM3Region(mod);
assert.equal(result.counters.selectedEntries,4);assert.equal(result.counters.invalidRedispatches,2);
assert.equal(result.fallbacks.unsupportedMode,2);assert.equal(result.watches[0].selectedEntries,3);
assert.equal(result.watches[0].begin,'0x400000');assert.equal(result.watches[0].lastSelectedPC,'0x400020');
watchM3Region(mod,0,0x400000n,0x401000n);
assert.throws(()=>watchM3Region(mod,4,0,1));assert.throws(()=>watchM3Region(mod,0,2,1));
assert.throws(()=>watchM3Region(mod,0,2**60,2**61));
assert.throws(()=>watchM3Region({...mod,_defuss_m3_watch:()=>-1},0,1n,2n));
for (const action of ['stale-instance','invalid-descriptor']) {
 assert.deepEqual(injectM3Region(mod,action,0,0x400000n),{action,slot:0,pc:'0x400000',mutations:1});
 assert.throws(()=>injectM3Region({...mod,_defuss_m3_test_inject:()=>-2},action,0,0x400000n));
}
for (const args of [['unknown',0,0x400000n],['stale-instance',4,0x400000n],['stale-instance',0,2**60],['stale-instance',0,0n]])
 assert.throws(()=>injectM3Region(mod,...args));
assert.throws(()=>injectM3Region({...mod,_defuss_m3_test_abi:()=>0},'stale-instance',0,0x400000n));
assert.throws(()=>readM3Region({...mod,_defuss_m3_data:()=>65n}));
assert.throws(()=>readM3Region({...mod,_defuss_m3_data:()=>10000000000000000n}));
words[16+18]++;assert.throws(()=>readM3Region(mod));words[16+18]--;
words[16+4]=1;words[16+18]=0xffffffff;assert.equal(readM3Region(mod).saturated,true);
words[16+1]=2;assert.throws(()=>readM3Region(mod));
console.log('PASS: C/JS diagnostic ABI, entry partitions, watch ranges, exact pointers, configuration rejection');
