export const settings=Object.freeze({hotLimit:1500,flags:3,guestRamMiB:512,instanceLimit:12000,tbMiB:256,timeoutMs:1200000,startupTimeoutMs:120000,maxNodes:12000,batch:64,retries:16});
export const mainOrder=Object.freeze([-1,0,5,6,7,11,14,15,1,10,16,17,2,12,3,13,4]);
export function validateMainOracle(report){
 const {runs,inLoop,signals}=report.interrupts??{};
 if(!Number.isInteger(runs)||runs<1||runs>128||!Number.isInteger(inLoop)||!Number.isInteger(signals)||inLoop<3||inLoop>signals)throw Error('Invalid interrupt oracle');
 const stages=[0,5,6,7,1,2,3],names=['state-flags-simd','state-after-stale-instance-gate','state-after-invalid-descriptor-gate','state-after-replacement-rewarm','precise-faults-cross-page','alias-and-active-smc','interrupt-continuation'],checks=[204576,204960,205344,217632,218022,410089,410101+runs];
 if(report.results?.length!==7||report.gates?.length!==17||report.gates.some((g,i)=>g.stage!==mainOrder[i]))throw Error('Incomplete main gate/result sequence');
 for(let i=0;i<7;i++)if(report.results[i].stage!==stages[i]||report.results[i].name!==names[i]||report.results[i].checks!==checks[i])throw Error('Retained guest result oracle differs at '+i);
 if(report.validation?.checks!==414167+runs||report.validation.faults!==384||report.validation.stages!==8)throw Error('Retained guest final oracle differs');
}
export function observerBus(){
 const buffer=new SharedArrayBuffer((128+16384*12)*4),words=new Uint32Array(buffer);words[0]=0x464f4231;words[1]=1;
 return {schema:1,buffer};
}
export function publishObserverNative(bus,nativeAddress){
 const address=Number(nativeAddress);
 if(!Number.isSafeInteger(address)||address<=0||address>0xffffffff||address%4)throw Error('Invalid native bank address');
 if(bus?.schema!==1||!(bus.buffer instanceof SharedArrayBuffer)||bus.buffer.byteLength!==(128+16384*12)*4)throw Error('Invalid observer bus');
 // A scalar property assigned after worker postMessage would remain stale in
 // structured clones. The shared word is release-published before vCPU start.
 if(Atomics.compareExchange(new Uint32Array(bus.buffer),49,0,address)!==0)throw Error('Native bank address already published');
 return address;
}
export function observerSnapshot(bus,native){
 const words=new Uint32Array(bus.buffer),id=native.sequence;
 if(Atomics.load(words,63)!==id||Atomics.load(words,127)!==id)throw Error('Missing same-owner observer epoch');
 const raw=Array.from({length:64},(_,i)=>Atomics.load(words,64+i));
 if(Atomics.load(words,63)!==id||raw[63]!==id)throw Error('Observer epoch changed');
 if(raw[0]!==0x464f4231||raw[1]!==1||raw[2]!==1||raw[3]||raw[12]||raw[13]||raw[20]||raw[21]||raw[31]||raw[34]!==0||raw[42]||raw[44])throw Error('Invalid owner observer state');
 const c=native.counters;
 if(raw[4]!==c.installs||raw[5]!==c.installs||raw[6]!==c.softRetired+c.emergencyRetired||raw[14]!==native.live||raw[7]!==c.gcConsumed+native.done||raw[37]!==native.done||raw[39]!==c.softBatches||raw[40]!==c.emergencyBatches)throw Error('Native/observer exact epoch accounting differs');
 if(c.softRetired!==c.softBatches*256||native.charged!==c.installs-c.gcConsumed||native.pending!==c.softRetired+c.emergencyRetired-c.gcConsumed)throw Error('FIFO lifecycle conservation differs');
 return {sequence:id,raw,registered:raw[4],installs:raw[5],removes:raw[6],delivered:raw[7],unwinds:raw[8],rewinds:raw[9],stoppedUnwinds:raw[10],stoppedRewinds:raw[11],live:raw[14],tracePhase:raw[15],traceRows:raw[16],episode:raw[17],matchedEpisodes:raw[19],mutationViolations:raw[20],done:raw[37],scope:'Same owning-worker epoch captured before native snapshot without an intervening yield; delivered = consumed + done.'};
}
export function readTrace(bus){
 const words=new Uint32Array(bus.buffer),count=Atomics.load(words,16);
 if(count>16384||Atomics.load(words,31)||Atomics.load(words,3))throw Error('Observer trace failed/overflowed');
 return {phase:Atomics.load(words,15),episode:Atomics.load(words,17),episodeStartHostPhase:Atomics.load(words,47),closingHostPhase:Atomics.load(words,48),pendingEpisodes:Atomics.load(words,38),rows:Array.from({length:count},(_,r)=>Array.from({length:12},(_,c)=>Atomics.load(words,128+r*12+c))),columns:['kind','jsState','asyncifyData','installationOrEpisodeId','slotOrRoute','done','removes','delivered','installs','hostPhase','unwinds','rawNativeState'],scope:'Bounded trace from first armed retirement through one subsequent complete matching Asyncify episode and next coherent owner snapshot. HostPhase0 running,1 stopping,2 stopped/snapshot,3 resuming. A snapshot wake may perturb scheduling; this is not proof of eviction of a suspended instance. Other transitions are cumulative counters, not a full trace.'};
}
export function validateSnapshot(snapshot,enabled,prior){
 const c=snapshot.counters;
 if(snapshot.enabled!==enabled||snapshot.activePolicy!==enabled||snapshot.rejectionReasonBits!==(enabled?0:1<<14)||c.accountingErrors||c.policyRejections||c.asyncifyRejections)throw Error('Policy eligibility/rejection gate failed');
 if(enabled&&!c.policyEligibleAttempts)throw Error('Policy requested on without actual eligible attempts');
 if(!enabled&&(c.softBatches||c.softRetired||c.policyEligibleAttempts||c.softChecks))throw Error('Disabled policy mutated soft state');
 if(c.softRetired!==c.softBatches*256||snapshot.charged!==c.installs-c.gcConsumed||snapshot.pending!==c.softRetired+c.emergencyRetired-c.gcConsumed)throw Error('Native lifecycle totals differ');
 if(prior)for(const key of Object.keys(c))if(c[key]<prior.counters[key])throw Error('Cumulative counter decreased: '+key);
}
export function pressureState(layout){
 if(layout.maxNodes!==12000||layout.batch!==64||layout.iterations!==100000||layout.retries!==16||layout.sleepNs!==1000000000||BigInt(layout.generated[1])-BigInt(layout.generated[0])!==768000n)throw Error('Pressure guest identity/bounds differ');
 return {phase:'new',layout,nodes:0,attempts:0};
}
export function acceptPressure(state,row,enabled){
 const {stage,nodes,attempt,checks,snapshot,observer}=row,c=snapshot.counters;
 if(stage==='layout'&&state.phase==='new'&&nodes===0&&attempt===0&&checks===2){state.phase='layout';return 'K';}
 if(stage==='warm'&&state.phase==='layout'&&nodes===0&&attempt===0&&checks===10){state.phase='churn';state.warm=row;return 'K';}
 if(stage==='churn'&&state.phase==='churn'){
  if(nodes!==Math.min(state.nodes+64,12000)||attempt!==0||checks!==10+nodes)throw Error('Invalid bounded churn');state.nodes=nodes;
  const warm=state.warm.snapshot.counters;
  const retirement=enabled?c.softBatches-warm.softBatches>=2&&c.gcConsumed-warm.gcConsumed>=256:c.emergencyRetired>warm.emergencyRetired;
  // Complete a genuine observed suspension episode after retirement before
  // ending churn; otherwise later sentinel calls alone may create no demand.
  if(retirement&&observer.tracePhase===3){state.retirement=row;state.phase='revisit';return 'R';}
  if(nodes===12000){state.phase='revisit';state.incompleteReason='Bounded churn did not establish retirement, delivered-GC consumption and closed Asyncify episode';return 'R';}
  return 'K';
 }
 if(stage==='revisit'&&state.phase==='revisit'){
  if(nodes!==state.nodes||attempt!==state.attempts||attempt>=16||checks!==10+nodes+attempt+1)throw Error('Invalid bounded revisit');state.attempts++;
  if(state.retirement&&c.gcConsumed>state.warm.snapshot.counters.gcConsumed&&observer.tracePhase===3){state.phase='complete';return 'R';}
  if(state.attempts===16)state.phase='incomplete';return 'K';
 }
 throw Error('Unexpected pressure gate order');
}
export function finishPressure(state,result){
 if(!['complete','incomplete'].includes(state.phase)||result.nodes!==state.nodes||result.attempts!==state.attempts||result.checks!==10+state.nodes+state.attempts)throw Error('Incomplete pressure oracle');
 return state.phase==='complete'?'passed':'incomplete';
}
