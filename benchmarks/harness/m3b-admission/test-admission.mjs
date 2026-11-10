import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeAdmission} from './admission.mjs';
const blank=()=>{const w=Array(128).fill(0);w.splice(0,3,0x4d334241,1,128);return w;};
function example(){const w=blank();w[16]=5;w[19]=3;w[20]=1;w[21]=1;w[37]=1;w[48]=3;w[51]=2;w[8]=9;w[9]=0x123;w[10]=0x456;w[12]=0x1000;w[64]=0x1234;w[65]=0x7f00;w[66]=0x123;w[67]=0x456;w[68]=2;w[69]=512;w[70]=5;w[72]=0x123456;w[96]=0x8b48;return w;}
test('idle startup and exact stage/shape partition with overlapping reasons',()=>{decodeAdmission(blank(),{predecodeAccepted:0},true);const row=decodeAdmission(example(),{predecodeAccepted:0});assert.equal(row.counters.translations,5);assert.equal(row.decoder.memory,1);assert.equal(row.rejections.profile+row.rejections.mode,5);assert.equal(row.lastDecode.bytesHex,'488b');assert.equal(row.lastDecode.pc,'0x7f0000001234');});
for(const [name,mutate]of Object.entries({
 saturation:w=>w[3]++,reserved:w=>w[71]++,partition:w=>w[16]++,shape:w=>w[37]++,unexplained:w=>w[24]++,bounds:w=>w[25]++,reasonTooLarge:w=>w[48]++,reasonMissing:w=>{w[48]=0;w[51]=0;},sampleTail:w=>w[97]++,sampleZero:w=>w[68]=0,sampleTooLarge:w=>w[68]=129,maxInsns:w=>w[69]=513,unknownShape:w=>w[70]=8,
}))test('admission decoder rejects '+name,()=>{const w=example();mutate(w);assert.throws(()=>decodeAdmission(w,{predecodeAccepted:0}));});
test('accepted shape must equal original native trial counter',()=>{const w=example();w[37]=0;w[32]=1;w[70]=0;decodeAdmission(w,{predecodeAccepted:1});assert.throws(()=>decodeAdmission(w,{predecodeAccepted:0}));});
test('startup cannot contain prior translations',()=>assert.throws(()=>decodeAdmission(example(),{predecodeAccepted:0},true)));
