// Exact stopped reads of the diagnostic MSG1 ABI. Never reset running counters.
export const exposureProtocol='defuss-m2-msg1-exposure-v1';
export const bankFields=Object.freeze(['originalHelperEntries','compiledInlineExecutions','compiledFallbackEntries']);
// Retained original M1 bundle/guest filesystem, also used by the failed v1
// timing screen. Runtime substitution must not silently change this workload.
export const unchangedGuest=Object.freeze({appSha256:'31d28add91e5a78aee775e57a365828f2b75843fc9bbd26b66bfe06e9d4717d5',
  initramfsSha256:'d54f7ed772e0249f6e6d52c7d795a9cd566a378555dbc7f7961aed830b3bd2c6'});
const fail=message=>{throw Error(message);};
const uint=value=>{
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value))fail('Exposure count is not an exact unsigned decimal string');
  const n=BigInt(value);if(n>0xffffffffffffffffn)fail('Exposure count exceeds uint64');return n;
};
export function validateExposure(row){
  if(row?.schema!==1)fail('Unknown MSG1 exposure schema');
  const values=bankFields.map(key=>uint(row[key]));
  if(values[2]>values[0])fail('Compiled fallback must be a subset of original helper entries');
  return values;
}
export function readExposure(mod){
  if(typeof mod._defuss_m2_msg1_counts!=='function')fail('Diagnostic MSG1 counter ABI required');
  const pointer=Number(mod._defuss_m2_msg1_counts(0));
  const memory=mod.pcProfileWords().buffer;
  if(!(memory instanceof SharedArrayBuffer)||!Number.isSafeInteger(pointer)||pointer<=0||pointer%8||pointer+24>memory.byteLength)
    fail('Invalid diagnostic MSG1 shared-memory pointer');
  const words=new BigUint64Array(memory,pointer,3);
  const result={schema:1,...Object.fromEntries(bankFields.map((name,index)=>[name,String(Atomics.load(words,index))]))};
  validateExposure(result);return result;
}
export function exposureDelta(begin,end){
  const before=validateExposure(begin),after=validateExposure(end),delta=after.map((n,i)=>n-before[i]);
  if(delta.some(n=>n<0n))fail('MSG1 exposure counters decreased: reset or wrap');
  const [original,inline,fallback]=delta;
  if(fallback>original)fail('Phase fallback exceeds original helper entries');
  return {schema:1,...Object.fromEntries(bankFields.map((name,index)=>[name,String(delta[index])])),
    interpretedHelperEntries:String(original-fallback),allExecutions:String(original+inline)};
}
export function validateSelectedExposure(delta,enabled,{requireCompiled=false}={}){
  const [original,inline,fallback]=validateExposure(delta);
  if(delta.interpretedHelperEntries!==String(original-fallback)||delta.allExecutions!==String(original+inline))fail('Exposure partition differs');
  if(enabled&&fallback!==0n)fail('Enabled exact MSG1 used compiled fallback');
  if(!enabled&&inline!==0n)fail('Disabled MSG1 executed inline');
  if(requireCompiled&&(enabled?inline:fallback)===0n)fail('No selected compiled MSG1 exposure in SHA phase');
  return true;
}

export function configureExposure(mod,enabled){
 if(typeof enabled!=='boolean')fail('MSG1 selected mode must be boolean');
 for(const key of ['_defuss_m2_msg1_config','_defuss_m2_msg1_status','_defuss_m2_msg1_counts'])if(typeof mod[key]!=='function')fail('Diagnostic MSG1 configuration ABI required');
 for(const key of ['_defuss_m2_msg2_config','_defuss_fifo_abi','_defuss_m3_region_abi','_defuss_m3_region_config','_defuss_m3_abi','_defuss_m1_abi'])if(typeof mod[key]==='function')fail('Combined or unrelated diagnostic runtime is forbidden');
 const before=mod._defuss_m2_msg1_status();if(before!==0x10000)fail('MSG1 must be initially unchosen');
 if(mod._defuss_m2_msg1_config(Number(enabled))!==0)fail('MSG1 one-time configuration rejected');
 const chosen=mod._defuss_m2_msg1_status();if(chosen!==(0x10000|(enabled?2:1)))fail('MSG1 chosen state differs');
 return {before,chosen,enabled,phase:'preRun-before-vCPU',diagnostic:true};
}
export function requirePaused(status){
 if(status?.running!==false||status.status!=='paused')fail('Exposure requires confirmed paused VM');return status;
}
