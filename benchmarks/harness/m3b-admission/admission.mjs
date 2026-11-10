import assert from 'node:assert/strict';
const stages=['translations','suppressed','noHost','formRejected','ramRejected','predecodeCalls'];
const shapes=['accepted','limit','truncated','opcode','prefix','memory','control','closure'];
const reasons=['profile','contexts','planOrAot','mode','blockedHflags','noPcrel','blockedCflags','noRamPage'];
export function decodeAdmission(w,m3b,initial=false){
 assert.ok(Array.isArray(w)&&w.length===128&&w.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff));
 assert.deepEqual(w.slice(0,4),[0x4d334241,1,128,0]);
 for(const i of [...Array.from({length:4},(_,i)=>4+i),11,14,15,22,23,...Array.from({length:6},(_,i)=>26+i),...Array.from({length:8},(_,i)=>40+i),...Array.from({length:8},(_,i)=>56+i),71,...Array.from({length:22},(_,i)=>74+i)])assert.equal(w[i],0,'Reserved admission word '+i);
 assert.equal(w[24],0,'Rejected predicate had no observed reason');assert.equal(w[25],0,'Invalid observer input');
 const counters=Object.fromEntries(stages.map((s,i)=>[s,w[16+i]])),decoder=Object.fromEntries(shapes.map((s,i)=>[s,w[32+i]])),rejections=Object.fromEntries(reasons.map((s,i)=>[s,w[48+i]]));
 assert.equal(w[16],w.slice(17,22).reduce((a,b)=>a+b,0),'Every translation reaches exactly one terminal admission stage');
 assert.equal(w[21],w.slice(32,40).reduce((a,b)=>a+b,0),'Every predecoder call has one result');
 assert.equal(w[32],m3b.predecodeAccepted,'Actual shape success matches original native trials');
 for(const n of Object.values(rejections))assert.ok(n<=w[19]);assert.ok(Object.values(rejections).reduce((a,b)=>a+b,0)>=w[19],'Every rejected formation has a reason');
 const pair=i=>'0x'+(BigInt(w[i])|(BigInt(w[i+1])<<32n)).toString(16);
 let lastRejection=null,lastDecode=null;
 if(w[19]){assert.ok(w[8]>0&&w[8]<=255);lastRejection={reasons:w[8],flags:w[9],cflags:w[10],pc:pair(12)};}else assert.ok([...w.slice(8,11),w[12],w[13]].every(n=>n===0));
 if(w[21]){
  assert.ok(w[68]>0&&w[68]<=128&&w[69]>0&&w[69]<=512&&w[70]<8);assert.ok(w[32+w[70]]>0);
  const bytes=w.slice(96).flatMap(n=>[n&255,(n>>>8)&255,(n>>>16)&255,n>>>24]);assert.ok(bytes.slice(w[68]).every(n=>n===0));
  lastDecode={pc:pair(64),flags:w[66],cflags:w[67],span:w[68],maxInstructions:w[69],result:shapes[w[70]],ramAddress:pair(72),bytesHex:bytes.slice(0,w[68]).map(n=>n.toString(16).padStart(2,'0')).join('')};
 }else assert.ok(w.slice(64).every(n=>n===0));
 if(initial)assert.ok(w.slice(4).every(n=>n===0));
 return {counters,decoder,rejections,lastRejection,lastDecode,scope:'Cumulative diagnostic translation-admission observations. Rejection reasons overlap; last bytes are one descriptive sample, not application-PC attribution or dynamic execution counts.'};
}
