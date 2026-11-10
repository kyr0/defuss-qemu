import {tcgMonitor} from '../../../host/browser/trace.mjs';
import {resolveRuntimeSettings} from '../../../host/browser/runtime-settings.mjs';
import {resetM1Profile,readM1Profile} from '../../../experiments/m1-profile/reader.mjs';

const cumulative32=['translateUs','translateCalls','emitUs','emitCalls','interpretUs','interpretCalls',
  'helperUs','helperCalls','emittedBytes','emittedGuestInstructions','sampledCompiled','sampledInterpreted',
  'wasmInstalls','jitCompileUs','jitInstantiateUs','admissionChecks','heldInterpreted','heldInterpretUs',
  'budgetInterpreted','budgetInterpretUs','repBatches','repElements','tbCacheFlushes','tbInvalidations'];
const inlineDefinitions={rnds2:['_defuss_inline_rnds2_counts',3]};
const inline=mod=>Object.fromEntries(Object.entries(inlineDefinitions).map(([name,[fn,count]])=>{
  if(typeof mod[fn]!=='function')return [name,{supported:false}];
  const pointer=Number(mod[fn](0)),words=new BigUint64Array(mod.pcProfileWords().buffer,pointer,count);
  return [name,{supported:true,raw:Array.from({length:count},(_,i)=>String(Atomics.load(words,i)))}];
}));
export function difference(before,after) {
  const delta={};for(const key of cumulative32)if(before[key]!==undefined&&after[key]!==undefined)delta[key]=(after[key]-before[key])>>>0;
  const a=before.memory?.counters,b=after.memory?.counters;
  if(a&&b)delta.memory=Object.fromEntries(Object.keys(b).map(key=>{
    if(a[key]===null||b[key]===null||b[key]<a[key])throw Error('MMU counter precision/reset mismatch');
    return [key,b[key]-a[key]];
  }));
  return delta;
}
export function phaseCounters(vm,mode,manifest,samplePeriod=257) {
  const mod=vm.module,hasM1=typeof mod._defuss_m1_abi==='function';
  if(mode!=='baseline'&&!hasM1)throw Error('Diagnostic control requires the M1 runtime ABI');
  if(mode==='baseline'&&hasM1)throw Error('Baseline must use retained runtime without the M1 ABI');
  if(hasM1)resetM1Profile(mod,false,samplePeriod);
  let active=null;
  return {
    begin(){
      if(active)throw Error('Overlapping counter phases');
      if(mode!=='profile-on')return;
      const monitor=tcgMonitor(mod,{helperBus:vm.helperBus,runtimeSettings:resolveRuntimeSettings({hotLimit:manifest.vm.hotLimit})});
      active={monitor};
      try{
        monitor.enable();monitor.enableLight();resetM1Profile(mod,true,samplePeriod);
        active.before=monitor.read();active.inlineBefore=inline(mod);
      }catch(error){
        try{resetM1Profile(mod,false,samplePeriod);}finally{monitor.disableLight();monitor.disable();active=null;}
        throw error;
      }
    },
    end(){
      if(mode!=='profile-on')return null;
      if(!active)throw Error('Counter phase was not started');
      const {monitor,before,inlineBefore}=active;
      try{
        const after=monitor.read(),profile=readM1Profile(mod),inlineAfter=inline(mod);
        const inlineDelta=Object.fromEntries(Object.keys(inlineBefore).map(name=>[name,
          inlineBefore[name].supported?inlineAfter[name].raw.map((x,i)=>String(BigInt(x)-BigInt(inlineBefore[name].raw[i]))):null]));
        return {before,after,delta:difference(before,after),profile,inline:{before:inlineBefore,after:inlineAfter,delta:inlineDelta,
          rnds2Words:['originalHelperEntries','compiledInlineExecutions','compiledHelperSubsetOfOriginalEntries']},
          scope:'Counters start while stopped before the start ACK and end while stopped after the result marker. Guest UART/control and stop-delivery tail are included; host stopped reading is excluded from the endpoint interval.',
          timing:'Existing microsecond timers overlap: helper and held/budget interpretation timing nest within execution; translation/emit and JIT compile/instantiate have their own scopes. Never sum these into exclusive wall time. PC, edge, helper and MMU counts measure exposure, not elapsed fractions.',
          memoryLimit:'Generic MMU counters exclude inline TLB hits and atomic/probe helpers. Sampled event-group counts are raw samples, not total memory traffic.',
          instructionLimit:'Helper family counts plus exposed inline counters are partial dynamic evidence, not a complete SSE/AVX instruction census. Top helper lists truncate to 40. No YMM absence claim follows.'};
      }finally{resetM1Profile(mod,false,samplePeriod);monitor.disableLight();monitor.disable();active=null;}
    },
    close(){if(active){active.monitor.disableLight();active.monitor.disable();active=null;}if(hasM1)resetM1Profile(mod,false,samplePeriod);},
  };
}
