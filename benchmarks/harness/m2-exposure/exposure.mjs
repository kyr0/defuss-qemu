// Exact stopped reads of the diagnostic MSG2 ABI. Never reset running counters.
export const exposureProtocol='defuss-m2-exposure-v1';
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
  if(row?.schema!==1)fail('Unknown MSG2 exposure schema');
  const values=bankFields.map(key=>uint(row[key]));
  if(values[2]>values[0])fail('Compiled fallback must be a subset of original helper entries');
  return values;
}
export function readExposure(mod){
  if(typeof mod._defuss_m2_msg2_counts!=='function')fail('Diagnostic MSG2 counter ABI required');
  const pointer=Number(mod._defuss_m2_msg2_counts(0));
  const memory=mod.pcProfileWords().buffer;
  if(!(memory instanceof SharedArrayBuffer)||!Number.isSafeInteger(pointer)||pointer<0||pointer%8||pointer+24>memory.byteLength)
    fail('Invalid diagnostic MSG2 shared-memory pointer');
  const words=new BigUint64Array(memory,pointer,3);
  const result={schema:1,...Object.fromEntries(bankFields.map((name,index)=>[name,String(Atomics.load(words,index))]))};
  validateExposure(result);return result;
}
export function exposureDelta(begin,end){
  const before=validateExposure(begin),after=validateExposure(end),delta=after.map((n,i)=>n-before[i]);
  if(delta.some(n=>n<0n))fail('MSG2 exposure counters decreased: reset or wrap');
  const [original,inline,fallback]=delta;
  if(fallback>original)fail('Phase fallback exceeds original helper entries');
  return {schema:1,...Object.fromEntries(bankFields.map((name,index)=>[name,String(delta[index])])),
    interpretedHelperEntries:String(original-fallback),allExecutions:String(original+inline)};
}
export function validateSelectedExposure(delta,enabled,{requireCompiled=false}={}){
  const [original,inline,fallback]=validateExposure(delta);
  if(delta.interpretedHelperEntries!==String(original-fallback)||delta.allExecutions!==String(original+inline))fail('Exposure partition differs');
  if(enabled&&fallback!==0n)fail('Enabled exact MSG2 used compiled fallback');
  if(!enabled&&inline!==0n)fail('Disabled MSG2 executed inline');
  if(requireCompiled&&(enabled?inline:fallback)===0n)fail('No selected compiled MSG2 exposure in SHA phase');
  return true;
}
