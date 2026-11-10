// Synthetic argument corruptions; no VM actions or acceptance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyRuntimeArguments,runtimeIdentity} from './argv.mjs';
const runtime=await readFile(new URL('../../'+runtimeIdentity.path,import.meta.url));
const expected=['-nodefaults','-machine','pc,acpi=off,hpet=off,usb=off'];
test('exact bound runtime proves one in-place argv0 prepend only',()=>{
 const h=[...expected],r=['./this.program',...expected];const result=verifyRuntimeArguments(expected,h,r,runtime);
 assert.equal(result.captureStatusUnchanged,true);assert.equal(result.locations.length,2);assert.deepEqual(h,expected);assert.deepEqual(r,['./this.program',...expected]);
});
test('missing duplicate wrong argv0 and any CLI mutation remain failures',()=>{
 for(const [h,r]of [[expected,expected],[expected,['./this.program','./this.program',...expected]],[expected,['wrong',...expected]],[expected,['./this.program',...expected,'-nochain']],[expected.slice(1),['./this.program',...expected]],[[...expected,'-nochain'],['./this.program',...expected]],[expected,['./this.program',true,...expected.slice(1)]]])assert.throws(()=>verifyRuntimeArguments(expected,h,r,runtime));
});
test('similar or modified runtime text is not admitted by matching anchor alone',()=>{
 const bytes=Buffer.from(runtime);bytes[0]^=1;assert.throws(()=>verifyRuntimeArguments(expected,expected,['./this.program',...expected],bytes),/runtime JS/);
 assert.throws(()=>verifyRuntimeArguments(expected,expected,['./this.program',...expected],runtime.subarray(1)));
});
