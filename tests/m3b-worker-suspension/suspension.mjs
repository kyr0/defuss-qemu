import assert from 'node:assert/strict';
const uint=n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
const pair=(w,i)=>BigInt(w[i])|(BigInt(w[i+1])<<32n),hex=n=>'0x'+n.toString(16);
const zero=w=>assert.ok(w.every(n=>n===0),'Reserved or unused observer words');
export function decodeSuspension(raw,{enabled}){
 assert.equal(typeof enabled,'boolean');assert.ok(Array.isArray(raw)&&raw.length===2624&&raw.every(uint));
 assert.deepEqual(raw.slice(0,5),[0x4d335357,1,2624,4,640]);assert.equal(raw[14],64);
 const count=raw[5];assert.ok(count<=4);assert.equal(raw[6],0,'Candidate must be complete at a guest gate');assert.equal(raw[7],0,'Sticky native/JS observation error');
 assert.equal(raw[9],count);assert.equal(raw[10],4*count);zero([raw[11],raw[15],...raw.slice(18,64)]);
 if(!enabled){assert.equal(count,0);assert.equal(raw[8],0);}
 if(count){for(const i of [12,16]){assert.ok(pair(raw,i)>0n&&pair(raw,i)%4n===0n);}}
 else zero([...raw.slice(12,14),...raw.slice(16,18)]);
 const slots=[];
 for(let i=0;i<4;i++){
  const w=raw.slice(64+i*640,64+(i+1)*640);if(i>=count){zero(w);continue;}
  assert.equal(w[0],i+1);assert.equal(w[1],2);assert.ok(w[2]<=1);assert.ok([1,2].includes(w[3]));
  for(const at of [4,6,8,10,12,16])assert.ok(pair(w,at)>0n);assert.equal(pair(w,16)%4n,0n);
  assert.equal(w[14],1);assert.equal(w[15],0);assert.equal(w[18],4);zero([w[19],w[28],w[31],...w.slice(544)]);
  assert.equal(w[20],w[21]);assert.equal(w[24],w[20]+1);assert.equal(w[25],w[21]+1);assert.equal(w[26],w[22]+(w[3]===2?1:0));assert.equal(w[27],0);assert.equal(w[23],1);
  assert.equal(w[29],12000);assert.ok(w[30]<=12000);
  const before=w.slice(32,160),after=w.slice(160,288);assert.deepEqual(after,before,'Exact native state across service suspension');
  for(const state of [before,after])zero([...state.slice(62,64),...state.slice(104)]);
  const events=[];
  for(let k=0;k<4;k++){
   const e=w.slice(288+k*64,288+(k+1)*64);assert.deepEqual(e.slice(0,4),[k+1,[0,1,0,2][k],[1,0,2,0][k],1]);
   assert.equal(pair(e,4),pair(w,4),'Actual pthread owns every transition');assert.equal(e[6],0);assert.deepEqual(e.slice(7,10),w.slice(24,27));
   assert.ok(e[10]<=2);assert.equal(e[11],i+1);assert.equal(e[12],12000,'Capacity remains charged until original sleep returns');zero(e.slice(13));events.push(e);
  }
  slots.push({token:i+1,compiled:!!w[2],debtBefore:w[3],worker:hex(pair(w,4)),pc:hex(pair(w,6)),code:hex(pair(w,8)),generation:hex(pair(w,10)),owner:hex(pair(w,12)),Bbefore:w[20],Bafter:w[24],paidBefore:w[21],paidAfter:w[25],requestedBefore:w[22],requestedAfter:w[26],poolBefore:w[29],poolAfter:w[30],stateBefore:before,stateAfter:after,events,raw:w});
 }
 return {count,completed:raw[9],events:raw[10],overflow:raw[8],slots};
}
