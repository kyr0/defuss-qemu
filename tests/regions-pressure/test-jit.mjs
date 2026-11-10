import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTranslationBuffer,validateTranslationBuffer} from './jit.mjs';
const text=`Translation buffer state:
gen code size       123456789/268430336
TB count            81000
TB avg target size  11 max=256 bytes

Statistics:
TB flush count      0
TB invalidate count 16000
`;
const raw=value=>({'human-readable-text':value});
test('native translation storage reports actual used/capacity and separate flush count',()=>{
 const x=parseTranslationBuffer(raw(text));assert.equal(x.usedBytes,123456789);assert.equal(x.capacityBytes,268430336);assert.equal(x.tbCount,81000);assert.equal(x.flushCount,0);assert.equal(x.configuredTbMiB,256);
 assert.equal(parseTranslationBuffer(raw(text.replaceAll('\n','\r\n'))).usedBytes,x.usedBytes);
});
test('missing, duplicate, fractional, unsafe and oversized native statistics reject',()=>{
 for(const bad of [text.replace('TB count','wrong'),text+'TB flush count 0\n',text.replace('123456789/','1.5/'),text.replace('81000','9007199254740992'),text+'x'.repeat(32769)])assert.throws(()=>parseTranslationBuffer(raw(bad)));
 assert.throws(()=>parseTranslationBuffer({text}));
});
test('native capacity pins the separately scoped256MiB fixture and rejects overflow',()=>{
 for(const bad of [text.replace('268430336','134212608'),text.replace('268430336','268435457'),text.replace('123456789','268435456'),text.replace('81000','0')])assert.throws(()=>parseTranslationBuffer(raw(bad)));
 assert.throws(()=>parseTranslationBuffer(raw(text),128));
});
test('post-read pause and native/M3 flush counts are mandatory',()=>{
 const row={jitRaw:raw(text),jitStatus:{status:'paused',running:false},counters:{counters:{flushes:0}}};assert.equal(validateTranslationBuffer(row).flushCount,0);
 assert.throws(()=>validateTranslationBuffer({...row,jitError:'unsupported command'}));
 assert.throws(()=>validateTranslationBuffer({...row,jitStatus:{status:'running',running:true}}));
 assert.throws(()=>validateTranslationBuffer({...row,counters:{counters:{flushes:1}}}));
});
