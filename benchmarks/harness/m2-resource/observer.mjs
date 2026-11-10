export const fields=['attemptedModules','attemptedModuleBytes','attemptedImportVectorBytes','maxAttemptedModuleBytes',
  'compiledModules','instantiatedModules','instantiatedModuleBytes','instantiatedImportVectorBytes','maxInstantiatedModuleBytes','overflow'];
export function createResourceBus(){return {schema:1,buffer:new SharedArrayBuffer(fields.length*8)};}
export function readResourceBus(bus){
 if(bus.schema!==1||!(bus.buffer instanceof SharedArrayBuffer)||bus.buffer.byteLength!==80)throw Error('Invalid resource bus');
 const words=new BigUint64Array(bus.buffer),result={schema:1};
 for(let i=0;i<fields.length;i++){
  const n=Atomics.load(words,i);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Resource counter exceeds JSON integer precision');
  result[fields[i]]=Number(n);
 }
 if(result.overflow)throw Error('Resource counter overflow');
 if(result.compiledModules>result.attemptedModules||result.instantiatedModules>result.compiledModules)throw Error('Resource counter ordering');
 return result;
}
export function resourceDelta(begin,end){
 const result={schema:1};
 for(const field of fields){
  const n=end[field]-begin[field];if(!Number.isSafeInteger(n)||n<0)throw Error('Resource counters decreased: '+field);result[field]=n;
  if(field.startsWith('max'))delete result[field];
 }
 return result;
}
