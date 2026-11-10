import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {captureStoppedCode, parsePagingRegisters, selectCodeCandidates} from './capture.mjs';

const ROOT = 0x100000n, TABLES = [ROOT, 0x101000n, 0x102000n, 0x103000n];
const registers = 'CR0=80010033 CR2=0000000000000000 CR3=0000000000100000 CR4=00000020\nEFER=0000000000000d00\n';
const key = (pc = 0x400000n, context = ROOT) => ({pc:'0x'+pc.toString(16), context:'0x'+context.toString(16), tier:'compiled', privilege:'user', flags:'0x0', cflags:'0x20000'});
const profile = (pcs = [{...key(), samplesEstimate:20}], edges = []) => ({abi:1, pcAddressingRevision:1, saturated:false, rejectedWorkerObservations:0, pcs, edges});

function memory() {
  const data = new Map(), reads = [];
  function put(address, bytes) { for (let index=0; index<bytes.length; index++) data.set(address+BigInt(index), bytes[index]); }
  function entry(address, value) { const bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigUint64(0,value,true);put(address,bytes); }
  function map(pc, physical, leaf = 1, leafExtra = 0n) {
    for (const [index,shift] of [39n,30n,21n,12n].entries()) {
      const level=4-index, address=TABLES[index]+((pc>>shift)&511n)*8n;
      if(level===leaf){entry(address, physical|7n|(leaf>1?128n:0n)|leafExtra);return address;}
      entry(address,TABLES[index+1]|7n);
    }
  }
  async function readPhysical(address,count) {
    assert.equal(typeof address,'number');assert.ok(Number.isSafeInteger(address));
    assert.ok(address>=0x100000&&address+count<=512*1024*1024);
    reads.push({address,count});
    return Uint8Array.from({length:count},(_,i)=>data.get(BigInt(address+i))??0);
  }
  return {put,entry,map,readPhysical,reads};
}
async function capture(mem, options={}) { return captureStoppedCode({profile:profile(),readPhysical:mem.readPhysical,registers,...options}); }

test('4K capture retains exact page-entry bytes, code bytes and independent SHA256',async()=>{
  const mem=memory(), input=Uint8Array.from({length:128},(_,i)=>(i*37+11)&255);
  mem.map(0x400000n,0x200000n);mem.put(0x200000n,input);
  const result=await capture(mem), row=result.rows[0];
  assert.equal(result.status,'captured');assert.equal(row.currentRawCr3Matches,true);
  assert.equal(row.hex,Buffer.from(input).toString('hex'));
  assert.equal(row.sha256,createHash('sha256').update(input).digest('hex'));
  assert.equal(row.walks[0].entries.length,4);assert.equal(row.walks[0].entries[0].hex,'0710100000000000');
  assert.equal(row.walks[0].pageSize,4096);assert.equal(result.physicalReads,5);assert.equal(result.physicalBytes,160);
});

test('cross-page read walks both mappings and preserves noncontiguous physical bytes',async()=>{
  const mem=memory(), pc=0x400ff0n;
  mem.map(pc,0x200000n);mem.map(pc+16n,0x300000n);
  mem.put(0x200ff0n,new Uint8Array(16).fill(17));mem.put(0x300000n,new Uint8Array(16).fill(34));
  const result=await capture(mem,{profile:profile([{...key(pc),samplesEstimate:1}]),bytesPerEntry:32});
  assert.equal(result.status,'captured');assert.equal(result.rows[0].walks.length,2);
  assert.deepEqual(result.rows[0].segments.map(row=>row.physicalAddress),['0x200ff0','0x300000']);
  assert.equal(result.rows[0].hex,'11'.repeat(16)+'22'.repeat(16));
});

for(const [level,size,pc,base] of [[2,2*1024*1024,0x432100n,0x400000n],[3,1024*1024*1024,0x123450n,0n]]) {
  test(size+'-byte huge page handles PAT and exact offset within bounded RAM',async()=>{
    const mem=memory(), physical=base+(pc&BigInt(size-1));
    mem.map(pc,base,level,0x1000n);mem.put(physical,new Uint8Array(16).fill(level));
    const result=await capture(mem,{profile:profile([{...key(pc),samplesEstimate:1}]),bytesPerEntry:16});
    assert.equal(result.status,'captured');assert.equal(result.rows[0].walks[0].pageSize,size);
    assert.equal(result.rows[0].segments[0].physicalAddress,'0x'+physical.toString(16));
    assert.equal(result.rows[0].walks[0].entries.length,5-level);
  });
}

test('candidate selection includes top edge pair, deduplicates PC/raw-CR3, and keeps exact large ranks',()=>{
  const a=key(0x400000n), b=key(0x500000n), c=key(0x600000n), otherContext=key(0x400000n,0x110000n);
  const p=profile([{...a,samplesEstimate:'9007199254740993'}, {...c,samplesEstimate:'9007199254740992'}, {...otherContext,samplesEstimate:4}],
    [{from:a,to:b,samplesEstimate:10}]);
  const rows=selectCodeCandidates(p,4);
  assert.deepEqual(rows.map(row=>[row.pc,row.context]),[[a.pc,a.context],[b.pc,b.context],[c.pc,c.context],[a.pc,otherContext.context]]);
  assert.deepEqual(rows[0].selection.map(row=>row.kind),['pc','edge-from']);
  assert.equal(selectCodeCandidates(p,1).length,1);
});

test('interpreted/kernel keys and edges are not read',async()=>{
  const mem=memory(), result=await capture(mem,{profile:profile([
    {...key(),privilege:'kernel',samplesEstimate:100}, {...key(),tier:'interpreted',samplesEstimate:100}],
    [{from:{...key(),privilege:'kernel'},to:key(),samplesEstimate:100}])});
  assert.equal(result.status,'no-candidates');assert.equal(mem.reads.length,0);
});

test('raw CR3 PCID and cache bits are masked only with recorded paging mode',async()=>{
  const mem=memory();mem.map(0x400000n,0x200000n);
  const pcid=await capture(mem,{registers:registers.replace('CR4=00000020','CR4=00020020'),profile:profile([{...key(0x400000n,ROOT|0x123n),samplesEstimate:1}])});
  assert.equal(pcid.status,'captured');assert.equal(pcid.rows[0].currentRawCr3Matches,false);
  const reserved=await capture(mem,{profile:profile([{...key(0x400000n,ROOT|1n),samplesEstimate:1}])});
  assert.equal(reserved.rows[0].error.code,'invalid-cr3');
  const cacheBits=await capture(mem,{profile:profile([{...key(0x400000n,ROOT|0x18n),samplesEstimate:1}])});
  assert.equal(cacheBits.status,'captured');
});

for(const [name,text,code] of [
  ['LA57',registers.replace('CR4=00000020','CR4=00001020'),'unsupported-mode'],
  ['paging disabled',registers.replace('CR0=80010033','CR0=00010033'),'unsupported-mode'],
  ['protected mode disabled',registers.replace('CR0=80010033','CR0=80010032'),'unsupported-mode'],
  ['PAE disabled',registers.replace('CR4=00000020','CR4=00000000'),'unsupported-mode'],
  ['long mode inactive',registers.replace('0000000000000d00','0000000000000900'),'unsupported-mode'],
  ['missing EFER',registers.split('EFER=')[0],'invalid-registers'],
  ['duplicate CR3',registers+'CR3=100000\n','invalid-registers'],
  ['register overflow',registers.replace('CR3=0000000000100000','CR3=10000000000000000'),'invalid-integer'],
]) test(name+' rejects global mode before physical reads',async()=>{
  const mem=memory(), result=await capture(mem,{registers:text});
  assert.equal(result.status,'unresolved');assert.equal(result.error.code,code);assert.equal(mem.reads.length,0);
});

test('register parser ignores XCR0 and retains exact hexadecimal raw CR3',()=>{
  assert.equal(parsePagingRegisters(registers+'XCR0=00000007\n').CR3,ROOT);
});

for(const [name,level,entryValue,expected] of [
  ['nonpresent',4,0n,'not-present'],['supervisor at root',4,TABLES[1]|3n,'supervisor'],
  ['NX at root',4,TABLES[1]|7n|(1n<<63n),'nonexecutable'],
  ['PML4 reserved PS',4,TABLES[1]|135n,'reserved-page-size'],
  ['supervisor at leaf',1,0x200003n,'supervisor'],
  ['NX leaf',1,0x200007n|(1n<<63n),'nonexecutable'],
  ['low table address',4,0x80007n,'outside-ram'],
  ['high table address',4,0x40000007n,'outside-ram'],
  ['low final address',1,0x80007n,'outside-ram'],
  ['high final address',1,0x20000007n,'outside-ram'],
]) test(name+' is unresolved without unsafe physical reads',async()=>{
  const mem=memory(),pc=0x400000n;mem.map(pc,0x200000n);
  const index=4-level,shift=[39n,30n,21n,12n][index];mem.entry(TABLES[index]+((pc>>shift)&511n)*8n,entryValue);
  const result=await capture(mem);assert.equal(result.rows[0].status,'unresolved');assert.equal(result.rows[0].error.code,expected);
  assert.equal(result.rows[0].sha256,undefined);assert.equal(result.rows[0].walks[0].entries.length<=4,true);
});

test('NX with NXE disabled is reserved and is not treated as executable',async()=>{
  const mem=memory();mem.map(0x400000n,0x200000n,1,1n<<63n);
  const result=await capture(mem,{registers:registers.replace('0000000000000d00','0000000000000500')});
  assert.equal(result.rows[0].error.code,'reserved-nx');
});

for(const level of [2,3]) test('huge-page level '+level+' rejects reserved physical alignment',async()=>{
  const mem=memory();mem.map(0x400000n,0x2000n,level);
  const result=await capture(mem);assert.equal(result.rows[0].error.code,'reserved-alignment');
});

test('noncanonical and overflowing addresses reject before reads',async()=>{
  for(const [pc,code] of [[0x800000000000n,'noncanonical'],[0xfffffffffffffff0n,'address-overflow']]){
    const mem=memory(),result=await capture(mem,{profile:profile([{...key(pc),samplesEstimate:1}])});
    assert.equal(result.rows[0].error.code,code);assert.equal(mem.reads.length,0);
  }
});

test('cross-page failure retains the first segment but never hashes incomplete code as complete',async()=>{
  const mem=memory(),pc=0x400ff0n;mem.map(pc,0x200000n);
  const result=await capture(mem,{profile:profile([{...key(pc),samplesEstimate:1}]),bytesPerEntry:32});
  assert.equal(result.status,'partial');assert.equal(result.rows[0].error.code,'not-present');
  assert.equal(result.rows[0].segments.length,1);assert.equal(result.rows[0].hex,undefined);assert.equal(result.rows[0].sha256,undefined);
});

test('short reads and transport errors become unresolved rows',async()=>{
  for(const [reader,code] of [[async()=>new Uint8Array(7),'short-read'],[async()=>{throw Error('QMP failure');},'read-failed']]){
    const result=await captureStoppedCode({profile:profile(),registers,readPhysical:reader});
    assert.equal(result.rows[0].error.code,code);
  }
});

test('invalid bounds and profiles fail before reads',async()=>{
  for(const options of [{ramBytes:1024*1024*1024},{maxEntries:17},{bytesPerEntry:257},{bytesPerEntry:0},
    {profile:{...profile(),saturated:true}},{profile:{...profile(),rejectedWorkerObservations:1}},
    {profile:{...profile(),pcAddressingRevision:0}},{profile:{...profile(),pcs:new Array(1025)}}]){
    const mem=memory(), result=await capture(mem,options);assert.equal(result.status,'unresolved');assert.equal(mem.reads.length,0);
  }
});
