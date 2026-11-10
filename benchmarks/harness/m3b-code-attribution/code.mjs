import assert from 'node:assert/strict';
const pair=(w,i)=>'0x'+(BigInt(w[i])|(BigInt(w[i+1])<<32n)).toString(16);
const zero=w=>assert.ok(w.every(n=>n===0),'Reserved or inactive words');
export function decodeCode(w,b,initial=false){
 assert.ok(Array.isArray(w)&&w.length===2112&&w.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff));assert.deepEqual(w.slice(0,5),[0x4d33434f,1,2112,16,128]);assert.equal(w[12],64);zero(w.slice(8,12));zero(w.slice(13,64));assert.ok(w[5]<=16);assert.equal(w[5],b.formed);assert.equal(w[6],b.compiledEntries);assert.equal(w[7],b.tciEntries);
 const records=[];let compiled=0,tci=0;
 for(let i=0;i<16;i++){
  const r=w.slice(64+i*128,64+(i+1)*128);
  if(i>=w[5]){zero(r);continue;}
  assert.ok([1,2].includes(r[0]));assert.equal(r[1],i+1);assert.equal(r[30],0);assert.equal(r[31],0);zero(r.slice(72));
  const row={slot:r[1],status:r[0]===1?'formed':'entered',owner:pair(r,2),translationPC:pair(r,4),page0:pair(r,6),page1:pair(r,8),flags:r[10],cflags:r[11],bytes:r[12],bOffset:r[13],generation:pair(r,14),code:pair(r,16),firstPC:pair(r,18),lastPC:pair(r,20),formationCr3:pair(r,22),firstCr3:pair(r,24),lastCr3:pair(r,26),compiled:r[28],tci:r[29],cr0:pair(r,64),cr4:pair(r,66),efer:pair(r,68),hflags:r[70],hflags2:r[71]};
  const pc=BigInt(row.translationPC),physical=BigInt(row.page0);assert.ok(BigInt(row.owner)>0n&&pc>=0x10000n&&pc<(1n<<47n));assert.equal(row.page1,'0xffffffffffffffff');assert.ok(physical>=1048576n&&physical<512n*1048576n);assert.equal(pc&4095n,physical&4095n);assert.ok(row.bytes>0&&row.bytes<=128&&row.bOffset>0&&row.bOffset<row.bytes&&Number(pc&4095n)+row.bytes<=4096);
  const bytes=r.slice(32,64).flatMap(n=>[n&255,n>>>8&255,n>>>16&255,n>>>24]);zero(bytes.slice(row.bytes));row.bytesHex=Buffer.from(bytes.slice(0,row.bytes)).toString('hex');
  if(r[0]===1){zero(r.slice(14,22));zero(r.slice(24,30));zero(r.slice(64,72));}
  else{assert.ok(BigInt(row.generation)>0n&&BigInt(row.code)>0n&&row.compiled+row.tci>0);assert.equal(row.firstPC,row.translationPC);assert.equal(row.lastPC,row.firstPC);assert.equal(row.firstCr3,row.lastCr3);}
  compiled+=row.compiled;tci+=row.tci;records.push(row);
 }
 assert.equal(compiled,w[6]);assert.equal(tci,w[7]);if(initial){assert.equal(w[5],0);zero(w.slice(5,12));}
 return {formed:w[5],compiled,tci,records};
}
const formation=['slot','owner','translationPC','page0','page1','flags','cflags','bytes','bOffset','formationCr3','bytesHex'];
const firstEntry=['generation','code','firstPC','firstCr3','cr0','cr4','efer','hflags','hflags2'];
export function codeDelta(before,after){
 assert.ok(after.formed>=before.formed&&after.compiled>=before.compiled&&after.tci>=before.tci);
 const records=after.records.map((r,i)=>{
  const old=before.records[i];if(old){for(const k of formation)assert.deepEqual(r[k],old[k],'Immutable formation '+k);if(old.status==='entered'){assert.equal(r.status,'entered');for(const k of firstEntry)assert.deepEqual(r[k],old[k],'Immutable entered identity '+k);}}
  const compiled=r.compiled-(old?.compiled??0),tci=r.tci-(old?.tci??0);assert.ok(compiled>=0&&tci>=0);return {...r,compiled,tci};
 });
 const compiled=after.compiled-before.compiled,tci=after.tci-before.tci;assert.equal(records.reduce((n,r)=>n+r.compiled,0),compiled);assert.equal(records.reduce((n,r)=>n+r.tci,0),tci);return {compiled,tci,records};
}
