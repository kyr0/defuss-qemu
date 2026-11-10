// Host read/configuration API for the separate passive-fifo-v1 experiment.
// Diagnostic snapshots execute on the owning stopped vCPU; never read main-thread TLS.
export const fifoAbi=1;
export const fifoMagic=0x46494631;
export const counterNames=Object.freeze(['installs','softBatches','softRetired','emergencyBatches','emergencyRetired','gcConsumed','reservationFailures','retiredEntryMisses','admissionHeld','capacityTci','policyEligibleAttempts','policyRejections','pendingGuards','asyncifyRejections','accountingErrors','wasmInputBytes','importBytes','compiledCalls','interpretedCalls','softChecks','snapshots','pendingPeak','chargedPeak','livePeak']);
export const reasonNames=Object.freeze(['x86FullSystem','pcMachine','bootCpu','oneCpu','maxOneCpu','oneContext','firstWorker','onlyWorker','defaultBudget','noHotplug','noPlanAot','notCoroutine','currentOwner','asyncifyNonNormal','disabled','accountingFault']);
const states=new WeakMap();
const fail=(message,observation)=>{const error=new Error(message);if(observation)error.observation=observation;return error;};
function api(mod){
 for(const name of ['abi','configure','status','diagnostic','state','rejections','data','request'])if(typeof mod['_defuss_fifo_'+name]!=='function')throw Error('Missing FIFO API: '+name);
 if(mod._defuss_fifo_abi()!==fifoAbi)throw Error('Unsupported FIFO ABI');
 const diagnostic=mod._defuss_fifo_diagnostic();if(diagnostic!==0&&diagnostic!==1)throw Error('Invalid FIFO diagnostic marker');return Boolean(diagnostic);
}
export function configureFifo(mod,enabled,{diagnostic=false}={}){
 if(typeof enabled!=='boolean'||typeof diagnostic!=='boolean')throw Error('Explicit FIFO mode and artifact kind required');
 if(api(mod)!==diagnostic)throw Error('Wrong FIFO artifact kind');
 if(states.get(mod)?.configured||mod._defuss_fifo_status()!==0)throw Error('FIFO must be configured exactly once before vCPU startup');
 if(mod._defuss_fifo_state()!==0||mod._defuss_fifo_rejections()!==0)throw Error('FIFO execution preceded configuration');
 if(mod._defuss_fifo_configure(enabled?1:0)!==0)throw Error('Native FIFO configuration rejected');
 const status=mod._defuss_fifo_status();if(status!==(enabled?5:4))throw Error('FIFO chosen mode readback differs');
 states.set(mod,{configured:true,enabled,sequence:0,inFlight:false,poisoned:false});
 return {abi:fifoAbi,enabled,diagnostic,status,phase:'preRun-before-vCPU'};
}
export function readFifoPerformance(mod,enabled){
 if(typeof enabled!=='boolean'||api(mod))throw Error('Performance FIFO read requires explicit mode and diagnostic-free artifact');
 const status=mod._defuss_fifo_status(),state=mod._defuss_fifo_state(),rejections=mod._defuss_fifo_rejections();
 if(status!==(enabled?7:6))throw Error('Performance FIFO mode is not locked as chosen');
 if(state!==(enabled?3:0)||rejections!==0)throw Error('Performance FIFO policy was ineffective, rejected or faulted');
 if(BigInt(mod._defuss_fifo_data())!==0n)throw Error('Performance artifact exposes diagnostic storage');
 return {abi:fifoAbi,enabled,diagnostic:false,status,state,rejections,effective:enabled};
}
function memoryWords(mod){
 const pointer=mod._defuss_fifo_data();if(typeof pointer!=='number'&&typeof pointer!=='bigint')throw Error('Invalid FIFO snapshot pointer type');
 const address=Number(pointer);if(!Number.isSafeInteger(address)||address<=0||address%4!==0)throw Error('Invalid FIFO snapshot pointer');
 const buffer=mod.HEAPU8?.buffer??mod.pcProfileWords?.().buffer;
 if(!(buffer instanceof SharedArrayBuffer)||address+256>buffer.byteLength)throw Error('FIFO snapshot requires bounded shared linear memory');
 return new Uint32Array(buffer,address,64);
}
export function decodeFifoSnapshot(raw,sequence,enabled){
 if(!Array.isArray(raw)||raw.length!==64||raw.some(x=>!Number.isInteger(x)||x<0||x>0xffffffff))throw Error('Invalid64word FIFO snapshot');
 const observation={sequence,raw};
 if(raw[0]!==fifoMagic||raw[1]!==fifoAbi||raw[2]!==sequence||raw[3]!==sequence)throw fail('FIFO snapshot identity/sequence differs',observation);
 const status=raw[4]|0;if(status!==0)throw fail('Native FIFO snapshot rejected: '+status,{...observation,status});
 if(raw[5]!==(enabled?7:6)||raw[6]!==0||raw[7]!==0||raw[14]!==1||raw[15]!==0)throw fail('FIFO snapshot mode/owner/diagnostic/saturation differs',observation);
 const [charged,live,pending,done,budget,demand]=raw.slice(8,14);
 if(budget!==12000||charged>budget||charged!==live+pending||done>pending||demand>256)throw fail('FIFO owning-worker accounting invariant failed',observation);
 if(raw[40]>1||raw[41]>0xffff||raw.slice(42).some(Boolean))throw fail('FIFO eligibility/reserved layout differs',observation);
 const activePolicy=Boolean(raw[40]),rejectionReasons=reasonNames.filter((_,i)=>raw[41]&(1<<i));
 if(activePolicy!==Boolean(enabled&&raw[41]===0))throw fail('FIFO effective-policy snapshot is inconsistent',observation);
 const counters=Object.fromEntries(counterNames.map((name,i)=>[name,raw[16+i]]));
 if(Boolean(raw[41]&(1<<14))===enabled)throw fail('FIFO disabled reason differs from configured mode',observation);
 if((raw[41]&(1<<15))||counters.accountingErrors!==0)throw fail('FIFO latched accounting fault rejects snapshot',observation);
 if(counters.pendingPeak<pending||counters.chargedPeak<charged||counters.livePeak<live||counters.pendingPeak>budget||counters.chargedPeak>budget||counters.livePeak>budget)throw fail('FIFO peak accounting bounds differ',observation);
 return {abi:fifoAbi,sequence,status,enabled,locked:true,diagnostic:true,cpuIndex:0,threadIndex:0,charged,live,pending,done,budget,demand,counters,activePolicy,rejectionReasonBits:raw[41],rejectionReasons,
  scope:'Fresh stopped owning-vCPU TLS snapshot; cumulative counters and observed pool accounting, not time or native resident memory.'};
}
export async function readFifoSnapshot(mod,{enabled,queryStatus,timeoutMs=10000,pollMs=5}={}){
 if(typeof enabled!=='boolean'||typeof queryStatus!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000||!Number.isInteger(pollMs)||pollMs<1||pollMs>100)throw Error('Invalid FIFO snapshot request options');
 if(!api(mod))throw Error('Diagnostic FIFO artifact required');
 const state=states.get(mod)??{configured:false,enabled,sequence:0,inFlight:false,poisoned:false};states.set(mod,state);
 if(state.enabled!==enabled||state.inFlight||state.poisoned)throw Error('FIFO snapshot mode/concurrency/previous failure rejected');
 state.inFlight=true;let timer,sequence;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('FIFO snapshot deadline exceeded',{sequence,timeoutMs})),timeoutMs);});
 const operation=(async()=>{
  const before=await queryStatus();if(before?.running!==false||before.status!=='paused')throw Error('FIFO request requires confirmed paused VM');
  if(state.poisoned)throw Error('FIFO request expired before native queueing');
  const words=memoryWords(mod),requested=Atomics.load(words,2),completed=Atomics.load(words,3);
  if(requested!==completed)throw Error('Another FIFO snapshot is still pending');
  sequence=Math.max(state.sequence,requested,completed)+1;if(sequence>0xffffffff)throw Error('FIFO request sequence exhausted');state.sequence=sequence;
  const queued=mod._defuss_fifo_request(sequence);if(queued!==0)throw fail('Native FIFO request rejected: '+queued,{sequence,nativeResult:queued});
  for(;;){
   if(state.poisoned)throw Error('FIFO request expired');
   const done=Atomics.load(words,3),request=Atomics.load(words,2);
   if(request!==sequence||done>sequence)throw Error('FIFO snapshot request/completion was replaced');
   if(done===sequence)break;
   await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
  const raw=Array.from({length:64},(_,i)=>Atomics.load(words,i));
  if(Atomics.load(words,3)!==sequence||Atomics.load(words,2)!==sequence)throw Error('FIFO snapshot changed while copying');
  const snapshot=decodeFifoSnapshot(raw,sequence,enabled);
  const after=await queryStatus();if(after?.running!==false||after.status!=='paused')throw fail('FIFO snapshot ended outside paused VM',{sequence,after});
  if(state.poisoned)throw Error('FIFO snapshot expired before final status');
  return {...snapshot,queryStatusBefore:before,queryStatusAfter:after};
 })();
 try{return await Promise.race([operation,deadline]);}
 catch(error){state.poisoned=true;throw error;}
 finally{clearTimeout(timer);state.inFlight=false;}
}
