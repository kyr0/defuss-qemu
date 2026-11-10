// Exact raw paused mutation contract; no guest or recovery pass is implied.
import assert from 'node:assert/strict';
import {decodeCensus} from '../m3b-context-accounting/census-reader.mjs';
import {stopped} from '../m3b-fallthrough/reader.mjs';
const pair=(w,i)=>BigInt(w[i])|(BigInt(w[i+1])<<32n);
const put=(w,i,n)=>{w[i]=Number(n&0xffffffffn);w[i+1]=Number(n>>32n);};
export function validateTypedMutation(before,after,record,{seq,pc,generation}){
 assert.ok(seq===1||seq===5);const requestID=seq===1?1:2,action=seq===1?'stale-instance':'invalid-descriptor',code=seq===1?1:2;
 assert.deepEqual(record,{requestID,action,slot:0,pc,generation,returnCode:1,nativeCalls:1});
 for(const row of [before,after]){stopped(row.status);assert.deepEqual(row.captureErrors,[]);}
 const pre=decodeCensus(before.censusRaw),post=decodeCensus(after.censusRaw);
 assert.equal(pre.apiRejects,0);assert.equal(pre.injection.rejects,0);assert.equal(post.apiRejects,0);assert.equal(post.injection.rejects,0);
 const watch=pre.watches[0],owner=watch.tuples.fusedNormal;
 assert.ok(watch.active&&watch.requireFused&&watch.counts.fusedNormal.compiled>0&&owner);
 assert.equal(owner.pc,pc);assert.equal(owner.generation,generation);assert.equal(pre.injection.requestID,requestID-1);
 assert.equal(pre.injection.requests,requestID-1);assert.equal(pre.injection.staleSuccesses,requestID-1);assert.equal(pre.injection.invalidSuccesses,0);
 const expected=[...before.censusRaw];expected[16]++;expected[seq===1?17:18]++;
 expected[20]=requestID;expected[21]=code;expected[22]=1;expected[23]=0;
 put(expected,24,BigInt(pc));put(expected,26,BigInt(generation));put(expected,28,BigInt(generation));
 expected[30]=owner.flags;expected[31]=owner.cflags;
 assert.deepEqual(after.censusRaw,expected,'Only exact typed injection evidence may change while paused');
 assert.equal(before.censusNativeStatus,7);assert.equal(after.censusNativeStatus,7);
 for(const key of ['m3bRaw','boundaryRaw','nativeStatus','pool','status'])assert.deepEqual(after[key],before[key],key);
 const a=[...before.m3aRaw];assert.equal(a.length,96);assert.ok(a[seq===1?34:35]<0xffffffff);a[seq===1?34:35]++;
 put(a,50,BigInt(pc));put(a,52,BigInt(generation));a[54]=code;
 assert.deepEqual(after.m3aRaw,a,'Only the existing exact action/PC/generation evidence may change');
 assert.equal(pair(after.censusRaw,28),BigInt(generation));
 return {requestID,action,pc,generation,mutations:1,scope:'Paused metadata injection only; subsequent exact recovery remains required.'};
}
