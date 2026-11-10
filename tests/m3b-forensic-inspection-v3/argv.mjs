// Narrow offline metadata compatibility; never alters a retained capture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const runtimeIdentity=Object.freeze({path:'artifacts/m3b-build-01/runtime/x86_64/qemu-system-x86_64.js',sha256:'9867ded695fff11741b74cfc472a9252ea5154fab12e451d6e7021989dc0bc1a',bytes:191691});
export function verifyRuntimeArguments(expected,headerArguments,reportedArguments,runtimeBytes){
 assert.ok(runtimeBytes instanceof Uint8Array);assert.equal(runtimeBytes.byteLength,runtimeIdentity.bytes);
 assert.equal(createHash('sha256').update(runtimeBytes).digest('hex'),runtimeIdentity.sha256,'Exact retained runtime JS required');
 const source=new TextDecoder('utf-8',{fatal:true}).decode(runtimeBytes);
 const anchors=['var thisProgram="./this.program";','function callMain(args=[]){var entryFunction=__emscripten_proxy_main;runtimeKeepalivePush();args.unshift(thisProgram);var argc=args.length;'];
 const locations=anchors.map(anchor=>{assert.equal(source.split(anchor).length-1,1,'Unique runtime argv anchor required');return {anchor,offset:source.indexOf(anchor)};});
 assert.ok(Array.isArray(expected)&&expected.every(x=>typeof x==='string'));assert.ok(!expected.includes('./this.program'));
 assert.deepEqual(headerArguments,expected,'Durable pre-run argv must be exact intended CLI');
 assert.deepEqual(reportedArguments,['./this.program',...expected],'Only one exact Emscripten argv0 prepend is admitted');
 return {runtime:runtimeIdentity,locations,operation:'callMain mutates the supplied arguments array by one unshift(thisProgram)',argv0:'./this.program',intendedArguments:[...expected],reportedArguments:[...reportedArguments],captureStatusUnchanged:true,scope:'Offline metadata interpretation only; both original runner failure and guest oracle failure remain retained.'};
}
