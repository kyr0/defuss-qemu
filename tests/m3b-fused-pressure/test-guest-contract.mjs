// Synthetic protocol/layout checks plus preservation of the original workload.
// No guest, native runtime or generated-code execution is implied.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pressureSettings as settings,validatePressureLayout,expectedPressureGate,expectedPressurePass,sentinelCodeHex} from './guest-contract.mjs';
const layout=()=>({schema:1,sentinel:{a:'0x402004',b:'0x402009',back:'0x40200e',side:'0x402010',end:'0x402011',ownerBytes:12,codeHex:sentinelCodeHex},generated:['0x700000','0x7bb800'],...Object.fromEntries(['maxNodes','batch','iterations','retries','sleepNs'].map(k=>[k,settings[k]]))});

test('exact ELF sentinel and fixed generated mapping have a bounded distinct layout',()=>{
 const value=layout(),before=structuredClone(value);assert.equal(validatePressureLayout(value),value);assert.deepEqual(value,before);
 for(const corrupt of [x=>x.schema=true,x=>x.extra=0,x=>delete x.sentinel.end,x=>x.sentinel.ownerBytes='12',x=>x.sentinel.b='0x402008',x=>x.sentinel.back='0x40200d',x=>x.sentinel.side='0x402011',x=>x.sentinel.end='0x402012',x=>x.sentinel.codeHex=sentinelCodeHex.slice(2),x=>x.generated[0]='0x0700000',x=>x.generated[1]='0x7bb801',x=>x.maxNodes=11999,x=>x.retries=17,x=>x.sleepNs=true]){const bad=layout();corrupt(bad);assert.throws(()=>validatePressureLayout(bad));}
});
test('page containment, static PC bounds, mapping alignment and overlap are enforced',()=>{
 for(const mutate of [
  x=>{for(const key of ['a','b','back','side','end'])x.sentinel[key]='0x'+(BigInt(x.sentinel[key])+1n).toString(16);},
  x=>{for(const key of ['a','b','back','side','end'])x.sentinel[key]='0x'+(BigInt(x.sentinel[key])+0x100000000n).toString(16);},
  x=>x.generated=['0x402000','0x4bd800'],
  x=>x.generated=['0x700001','0x7bb801'],
  x=>x.generated=['0x7ffffff44000','0x800000000000'],
 ]){const bad=layout();mutate(bad);assert.throws(()=>validatePressureLayout(bad));}
});
test('unchanged layout/warm checks and all188 bounded churn batches are exact',()=>{
 assert.deepEqual(expectedPressureGate({stage:'layout',nodes:0,attempt:0}),{stage:'layout',nodes:0,attempt:0,checks:2});
 assert.deepEqual(expectedPressureGate({stage:'warm',nodes:0,attempt:0}),{stage:'warm',nodes:0,attempt:0,checks:10});
 let batches=0;for(let nodes=64;;nodes=Math.min(nodes+64,12000)){assert.deepEqual(expectedPressureGate({stage:'churn',nodes,attempt:0}),{stage:'churn',nodes,attempt:0,checks:10+nodes});batches++;if(nodes===12000)break;}
 assert.equal(batches,188);assert.equal(12000%64,32);
});
test('sixteen original revisits and final arithmetic counts are bounded independently of success',()=>{
 for(let attempt=0;attempt<16;attempt++)assert.deepEqual(expectedPressureGate({stage:'revisit',nodes:6912,attempt}),{stage:'revisit',nodes:6912,attempt,checks:11+6912+attempt});
 // Use a legal observed64-function batch for the host protocol.
 for(let attempts=1;attempts<=16;attempts++)assert.deepEqual(expectedPressurePass({nodes:6912,attempts}),{checks:10+6912+attempts,nodes:6912,attempts});
});
test('boolean/coerced fields, unknown work, invalid batches and excess retries reject',()=>{
 for(const row of [{stage:'layout',nodes:0,attempt:false},{stage:'warm',nodes:64,attempt:0},{stage:'churn',nodes:63,attempt:0},{stage:'churn',nodes:12001,attempt:0},{stage:'churn',nodes:64,attempt:1},{stage:'revisit',nodes:64,attempt:16},{stage:'revisit',nodes:'64',attempt:0},{stage:'anything',nodes:0,attempt:0},{stage:'layout',nodes:0,attempt:0,checks:2}])assert.throws(()=>expectedPressureGate(row));
 for(const row of [{nodes:0,attempts:1},{nodes:63,attempts:1},{nodes:64,attempts:0},{nodes:64,attempts:17},{nodes:64,attempts:true},{nodes:64,attempts:1,checks:75}])assert.throws(()=>expectedPressurePass(row));
});
test('new C source preserves the old generated loops, arbitrary-step oracle and bounded workload',async()=>{
 const old=await readFile(new URL('../regions-pressure/fixture.c',import.meta.url),'utf8'),fresh=await readFile(new URL('./fixture.c',import.meta.url),'utf8');
 const slice=(text,start,end)=>{const a=text.indexOf(start);assert.ok(a>=0);const b=text.indexOf(end,a);assert.ok(b>a);return text.slice(a,b);};
 assert.equal(slice(fresh,'enum { NODES=','extern uint32_t'),slice(old,'enum { NODES=','extern uint32_t'));
 assert.equal(slice(fresh,'static void sentinel(void){','int main(void){'),slice(old,'static void sentinel(void){','int main(void){'));
 assert.equal(slice(fresh,' const size_t bytes=',' printf("M3B_PRESSURE_LAYOUT:'),slice(old,' const size_t bytes=',' printf("PRESSURE_LAYOUT:'));
 const tail=text=>text.slice(text.indexOf(' if(gate("layout"')).replaceAll('M3B_PRESSURE_','PRESSURE_');assert.equal(tail(fresh),tail(old));
});
