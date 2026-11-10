import {readNativeCounters} from './native-counters.mjs';
export const memoryRegions=Object.freeze(['cirrusBanked','cirrusLinear','cirrusBlit','cirrusRegisters','other']);
export const memoryCounterNames=Object.freeze([
  'lookups','lookupBytes','readLookups','writeLookups','fetchLookups','crosspageLookups',
  'firstLevelMissPages','victimHitPages','fillRequests','resolvedPages','pageMmio','pageNotDirty',
  'pageWatchpoint','pageDiscardWrite','pageCheckAligned','alignmentChecksFailed','watchpointChecks','notdirtyWrites',
  'mmioReadDispatches','mmioWriteDispatches','mmioFetchDispatches','mmioReadBytes','mmioWriteBytes','mmioFetchBytes',
  ...['read','write','fetch'].flatMap(kind=>[1,2,4,8,16].map(width=>kind+'Width'+width)),
  ...memoryRegions.flatMap(region=>['ReadDispatches','ReadBytes','WriteDispatches','WriteBytes','FetchDispatches','FetchBytes'].map(kind=>region+kind))
]);
export const memoryScope='Generic MMU helper lookups, resolved-page flags and attempted MMIO dispatch fragments while enabled; excludes inline TLB fast paths and separate atomic/probe helpers. Flags/reasons overlap; counters do not identify guest APIs or completed accesses.';
export function readMemoryStats(abi){
  const result=readNativeCounters(abi,{names:memoryCounterNames,scope:memoryScope,count:true,versions:[1,2]});
  result.samplePeriod=null;result.samplingMode=null;
  if(!result.supported)return result;
  if(result.version===1){result.samplePeriod=1;result.samplingMode='exact';return result;}
  try{
    if(typeof abi.samplePeriod!=='function'||typeof abi.sampling!=='function'){
      result.supported=false;result.counters=null;return result;
    }
    const period=abi.samplePeriod();
    if(period!==1&&period!==256){result.supported=false;result.counters=null;return result;}
    result.samplePeriod=period;result.samplingMode=period===1?'exact':'pseudo-random-event-samples';
    result.scope=memoryScope+(period===1?' Exact event-group counters.':' Raw selected event-group counters at nominal 1/256; not estimated totals.');
  }catch{result.readError=true;result.counters=null;}
  return result;
}
