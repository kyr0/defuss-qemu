// Browser-safe, single-call adapter. The host must persist the request first
// and retain raw paused observations both before and after this call.
import {stopped} from '../m3b-fallthrough/reader.mjs';
const require=(value,message)=>{if(!value)throw Error(message);};
export function injectTyped(mod,{requestID,action,slot,pc,generation},status){
 stopped(status);
 require(Number.isInteger(requestID)&&requestID>=1&&requestID<=32,'Bounded injection request ID');
 require(action==='stale-instance'||action==='invalid-descriptor','Known typed injection action');
 require(Number.isInteger(slot)&&slot>=0&&slot<4,'Bounded injection watch');
 require(typeof pc==='bigint'&&pc>=0x100000n&&pc<0x100000000n,'Exact supported guest PC');
 require(typeof generation==='bigint'&&generation>0n&&generation<(1n<<64n),'Exact nonzero owner generation');
 require(mod._defuss_m3cc_abi?.()===2&&mod._defuss_m3cc_status?.()===7,'Locked native census ABI');
 require(typeof mod._defuss_m3cc_inject==='function','Typed native API missing');
 const returnCode=mod._defuss_m3cc_inject(requestID,action==='stale-instance'?1:2,slot,pc,generation);
 // Do not throw on native refusal: let the caller persist its raw result and
 // stopped after-bank before the independent host oracle refuses the capture.
 return {requestID,action,slot,pc:'0x'+pc.toString(16),generation:'0x'+generation.toString(16),returnCode,nativeCalls:1};
}
