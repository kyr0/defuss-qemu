import {args as original} from '../m3b-fallthrough/guest.mjs';
export {protocol,settings as pressureSettings} from './guest-contract.mjs';
export const limits=Object.freeze({chunk:65536,pending:64*1024*1024,trace:0,serial:4*1024*1024,stderr:1024*1024,records:64});
export const argumentsFor=()=>[...original];
export const runtimeArguments=()=>({report:[...original],factory:[...original]});
