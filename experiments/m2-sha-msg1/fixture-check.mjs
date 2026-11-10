import assert from 'node:assert/strict';

export const fixtureContract='msg1-isa-v1';
export const exposureContract='exact-msg1-fixture-v1';
export const fixtureSourceSha256='81aa84cb76008814a73b9e1179920074e7a91387c046a81ca8043b5335ac8dde';
export const expectedInstructionCounts=Object.freeze(['4096','4096','4096','4096','4096','4096','8192']);
export const faultPass='MSG1_FAULT_PASS warmup=4096 faults=1 state=ymm0-2,flags pc=exact address=exact sideEffect=once';

export function validateCumulative(values,{enabled,cold}){
  assert.equal(typeof enabled,'boolean');assert.equal(typeof cold,'boolean');
  assert.ok(Array.isArray(values)&&values.length===3,'Expected three MSG1 counter banks');
  const numbers=values.map(value=>{
    assert.equal(typeof value,'string');assert.match(value,/^(0|[1-9][0-9]*)$/,'Counter reset/wrap or noncanonical unsigned value');
    const n=BigInt(value);assert.ok(n<=0xffffffffffffffffn,'MSG1 counter exceeds uint64');return n;
  });
  const [original,inline,fallback]=numbers;
  assert.ok(fallback<=original,'Compiled fallback must be a subset of original helper entries');
  if(enabled)assert.equal(fallback,0n,'Enabled MSG1 entered compiled fallback');
  else assert.equal(inline,0n,'Disabled MSG1 entered compiled inline');
  if(cold)assert.deepEqual([inline,fallback],[0n,0n],'Cold fixture entered compiled MSG1');
  return numbers;
}

export function checkExposure(delta,{enabled,cold,mode}){
  assert.ok(Number.isInteger(mode)&&mode>=0&&mode<7,'Unknown MSG1 fixture mode');
  const [original,inline,fallback]=validateCumulative(delta,{enabled,cold});
  const expected=BigInt(expectedInstructionCounts[mode]);
  assert.equal(original+inline,expected,'Unexpected MSG1 execution count; omitted work, extra work or counted fault');
  if(!cold)assert.ok((enabled?inline:fallback)>0n,'No selected compiled MSG1 execution');
  return {contract:exposureContract,mode,expectedInstructions:String(expected),observedInstructions:String(original+inline),
    interpreted:String(original-fallback),compiledInline:String(inline),compiledFallback:String(fallback)};
}

export function checkSerial(serial){
  assert.ok(!serial.includes('FIXTURE_FAIL')&&!serial.includes('Kernel panic'),'Guest failure in raw serial');
  const expected=['MSG1_FIXTURE_START','MSG1_GATE:-1'];
  for(let mode=0;mode<7;mode++){
    if(mode===6)expected.push(faultPass);
    expected.push(`MSG1_MODE_PASS:${mode} checks=4096`,`MSG1_GATE:${mode}`);
  }
  expected.push('MSG1_FIXTURE_PASS checks=28672','FIXTURE_PASS');
  const actual=serial.split(/\r?\n/).filter(line=>/^(MSG[12]_|FIXTURE_)/.test(line));
  assert.deepEqual(actual,expected,'Raw MSG1 marker sequence differs');
  return {gates:8,modes:7,checkedInstructions:28672,faultWarmups:4096,faults:1,successfulInstructions:32768};
}
