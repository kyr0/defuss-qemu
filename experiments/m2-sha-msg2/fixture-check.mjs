import assert from 'node:assert/strict';

export function checkExposure(delta,{enabled,cold}){
  assert.ok(Array.isArray(delta)&&delta.length===3,'Expected three MSG2 counter deltas');
  const values=delta.map(value=>{
    assert.equal(typeof value,'string');assert.match(value,/^(0|[1-9][0-9]*)$/,'Counter reset/wrap or invalid exact value');
    const result=BigInt(value);assert.ok(result<=0xffffffffffffffffn);return result;
  });
  const [original,inline,fallback]=values;
  assert.ok(original>=fallback,'Compiled fallback must be a subset of original-helper entries');
  assert.ok(original+inline>=4096n,'Missing fixture instruction observations');
  if(cold){assert.equal(inline,0n,'Cold fixture entered inline code');assert.equal(fallback,0n,'Cold fixture entered compiled fallback');}
  else if(enabled){assert.ok(inline>0n,'No compiled MSG2 inline execution');assert.equal(fallback,0n,'Enabled exact MSG2 unexpectedly fell back');}
  else {assert.equal(inline,0n,'Disabled MSG2 executed inline');assert.ok(fallback>0n,'No compiled MSG2 fallback execution');}
  return true;
}
