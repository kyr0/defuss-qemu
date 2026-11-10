import {args as baselineArgs} from '../m3b-fallthrough/guest.mjs';
export {protocol,pressureSettings} from './guest-contract.mjs';
// No execution tracing: the lifetime proof uses cumulative stopped native banks.
export const limits=Object.freeze({chunk:65536,pending:64*1024*1024,trace:0,serial:4*1024*1024,stderr:1024*1024,records:640});
export function argumentsFor(){
 if(baselineArgs.filter(x=>x==='tcg,tb-size=128').length!==1)throw Error('Exact inherited128MiB CLI anchor required');
 return baselineArgs.map(x=>x==='tcg,tb-size=128'?'tcg,tb-size=256':x);
}
export function runtimeArguments(){const a=argumentsFor();return {report:[...a],factory:[...a]};}
