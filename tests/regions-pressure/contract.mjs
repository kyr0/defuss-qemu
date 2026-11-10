import {validateTranslationBuffer} from './jit.mjs';
export const settings=Object.freeze({fixtureRevision:3,tbMiB:256,guestRamMiB:512,hotLimit:1500,flags:3,admission:true,rep16:true,instanceLimit:12000,
 maxNodes:12000,batch:64,iterations:100000,retries:16,sleepNs:1000000000,timeoutMs:1200000});
export function pressureState(layout){
 for(const name of ['maxNodes','batch','iterations','retries','sleepNs'])if(layout?.[name]!==settings[name])throw Error('Unexpected guest bound: '+name);
 if(BigInt(layout.sentinel[1])<=BigInt(layout.sentinel[0])||BigInt(layout.generated[1])-BigInt(layout.generated[0])!==768000n)throw Error('Invalid pressure code ranges');
 return {phase:'new',layout,nodes:0,attempts:0,capFallbackObserved:false};
}
export function acceptGate(state,row){
 const {stage,nodes,attempt,checks,counters,pool,status}=row,c=counters.counters;
 if(status.running||status.status!=='paused')throw Error('Pressure snapshot requires stopped VM');
 if(!Number.isSafeInteger(pool.charged)||pool.charged<0||pool.charged>12000||pool.limit!==12000)throw Error('Pressure pool cap/accounting changed');
 if(!counters.enabled||!counters.started||counters.saturated||['watchPcMismatches','injectionRejects','invalidMetadata','generationExhaustions','extraWorkerRejects','injectedStaleInstances','injectedInvalidDescriptors'].some(k=>c[k]!==0))throw Error('Invalid pressure diagnostic state');
 const jit=validateTranslationBuffer(row);row.jit=jit;
 if(state.previousJit&&jit.capacityBytes!==state.previousJit.capacityBytes)throw Error('Translation-buffer capacity changed');
 if(state.warm&&c.flushes!==state.warm.counters.counters.flushes)throw Error('Global TB flush invalidates sentinel ring-order proof');
 if(state.previousJit&&jit.flushCount===state.previousJit.flushCount&&jit.usedBytes<state.previousJit.usedBytes)throw Error('Translation-buffer use decreased without global flush');
 state.previousJit=jit;
 if(stage==='layout'&&state.phase==='new'){
  if(nodes!==0||attempt!==0||checks!==2)throw Error('Invalid layout gate');state.phase='layout';return 'K';
 }
 if(stage==='warm'&&state.phase==='layout'){
  if(nodes!==0||attempt!==0||checks!==10||c.instanceRetires!==0||c.instanceInstalls>=6000||pool.charged!==c.instanceInstalls||counters.watches[0].selectedEntries===0||BigInt(counters.watches[0].lastSelectedPC)!==BigInt(state.layout.sentinel[0]))throw Error('Cannot establish sentinel in first6000 ring slots');
  state.warm=row;state.phase='churn';return 'K';
 }
 if(stage==='churn'&&state.phase==='churn'){
  if(nodes!==Math.min(state.nodes+64,12000)||attempt!==0||checks!==10+nodes||counters.watches[1].selectedEntries===0)throw Error('Invalid bounded churn/exposure');
  state.nodes=nodes;
  if(c.instanceRetires===6000){state.retirement=row;state.phase='revisit';return 'R';}
  if(c.instanceRetires!==0||nodes===12000)throw Error('Did not observe exactly the first6000-slot retirement');return 'K';
 }
 if(stage==='revisit'&&state.phase==='revisit'){
  if(nodes!==state.nodes||attempt!==state.attempts||attempt>=16||checks!==10+nodes+attempt+1||c.instanceRetires!==6000)throw Error('Invalid bounded sentinel revisit');
  state.attempts++;
  const selected=counters.watches[0].selectedEntries;
  if(selected===0&&pool.charged===12000)state.capFallbackObserved=true;
  if(selected>0){
   if(BigInt(counters.watches[0].lastSelectedPC)!==BigInt(state.layout.sentinel[0])||c.instanceInstalls<=state.retirement.counters.counters.instanceInstalls||c.instanceInstalls<=12000)throw Error('No fresh selected sentinel installation after retirement');
   state.reinstantiated=row;state.phase='complete';return 'R';
  }
  if(state.attempts===16)state.phase='incomplete';return 'K';
 }
 throw Error('Unexpected pressure gate order: '+stage);
}
export function finishPressure(state,validation){
 if(!['complete','incomplete'].includes(state.phase)||validation.nodes!==state.nodes||validation.attempts!==state.attempts||validation.checks!==10+state.nodes+state.attempts)throw Error('Incomplete pressure guest evidence');
 return state.phase==='complete'?'passed':'incomplete';
}
