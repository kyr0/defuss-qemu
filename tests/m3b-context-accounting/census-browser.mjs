// Browser-safe native transport. No typed bank decode before durable capture.
import {stopped} from '../m3b-fallthrough/reader.mjs';
const check=(ok,message)=>{if(!ok)throw Error(message);};
export const censusAbi=Object.freeze({version:1,words:2400,slots:4});
export function requireCensusBinding(binding){
 check(binding?.schema===1&&binding.kind==='m3b-differential-runtime-binding-v1'&&binding.status==='passed'&&binding.timingEligible===false,'Passed diagnostic runtime binding required');
 check(binding.variant==='m3b-context-census-v1','Exact census runtime variant required');
 check(Array.isArray(binding.diagnosticExtensions)&&binding.diagnosticExtensions.length===2&&binding.diagnosticExtensions[0]==='context-entry-census-v1'&&binding.diagnosticExtensions[1]==='generation-specific-injection-v1','Exact census extension identities required');
 const a=binding.censusAbi;check(a&&Object.keys(a).sort().join(',')==='slots,version,words'&&a.version===1&&a.words===2400&&a.slots===4,'Exact census ABI declaration required');
}
export function configureCensus(mod,binding){
 requireCensusBinding(binding);check(mod._defuss_m3cc_abi?.()===1,'Native census ABI missing');check(mod._defuss_m3cc_status?.()===0,'Configure census exactly once');
 const result=mod._defuss_m3cc_configure(1);check(result===0&&mod._defuss_m3cc_status()===3,'Census pre-run selection rejected');
 return {enabled:true,phase:'preRun-before-vCPU',returnCode:result,status:3,abi:censusAbi};
}
export function readCensusRaw(mod,status,{initial=false}={}){
 check(typeof initial==='boolean','Exact initial-state boolean required');stopped(status,initial);check(mod._defuss_m3cc_abi?.()===1,'Native census ABI missing');
 const mem=mod.pcProfileWords?.()??mod.HEAPU32;check(mem instanceof Uint32Array&&mem.byteOffset===0,'Whole linear uint32 memory required');
 const pointer=Number(mod._defuss_m3cc_data());check(Number.isSafeInteger(pointer)&&pointer>0&&pointer%4===0&&pointer+9600<=mem.byteLength,'Stopped bounded census pointer required');
 return {nativeStatus:mod._defuss_m3cc_status(),raw:Array.from(mem.slice(pointer/4,pointer/4+2400))};
}
export function watchCensus(mod,{slot,pc,requireFused,nextEpoch},status){
 stopped(status);check(Number.isInteger(slot)&&slot>=0&&slot<4&&typeof pc==='bigint'&&typeof requireFused==='boolean','Exact census watch arguments required');
 check(pc===0n||pc>=0x100000n&&pc<0x100000000n,'Census PC bound');check(pc!==0n||!requireFused,'Disabled slot cannot require fusion');check(Number.isInteger(nextEpoch)&&nextEpoch>0&&nextEpoch<=0xffffffff,'Census reset epoch bound');
 const result=mod._defuss_m3cc_watch(slot,pc,requireFused?1:0,nextEpoch);check(result===0,'Stopped census watch rejected');return {slot,pc:'0x'+pc.toString(16),requireFused,nextEpoch,returnCode:result};
}
