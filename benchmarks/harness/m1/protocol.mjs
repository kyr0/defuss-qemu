export const protocol = 'defuss-m1-v1';
export const prefix = 'DEFUSS_M1 ';
export const names = ['integer', 'json', 'sha256', 'http'];
export const orders = [names, [...names].reverse(), [...names.slice(1), names[0]]];
export const parameters = Object.freeze({integerIterations:250000,jsonRecords:128,jsonRounds:8,
  shaBytes:65536,shaRounds:16,httpRequests:8,batchRepetitions:100,samples:3,warmupCycles:10,gatePairs:20});
export const expected = Object.freeze({integer:1526500379,json:133784,
  sha256:'022efbc5f459321b5cc989106e3d38a7a9f878ddda28663e409811af0cd5e19d',http:1392});
export const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function gatePlan() {
  const gates=[{event:'initialized'}];
  for(let index=0;index<parameters.gatePairs;index++)gates.push({event:'gate-start',index},{event:'gate-result',index});
  gates.push({event:'warmup-start'},{event:'warmup-complete'},{event:'maps',phase:'post-warmup'});
  for(let sample=0;sample<orders.length;sample++)for(const name of orders[sample])
    gates.push({event:'start',name,sample,iterations:parameters.batchRepetitions},{event:'result',name,sample,iterations:parameters.batchRepetitions});
  gates.push({event:'complete'});
  return gates;
}
export function checkIdentity(event) {
  if(event.protocol!==protocol || event.bun!=='1.4.4' || event.revision!=='38afee6c84fcf48c0edb2466aa4b27d287a59c30' ||
      event.arch!=='x64' || !Number.isSafeInteger(event.pid) || event.pid<1 ||
      typeof event.nonce!=='string' || !/^[a-f0-9-]{36}$/.test(event.nonce) ||
      event.heap!==true || event.file!==true || event.heapLength!==4096 ||
      !Number.isSafeInteger(event.heapChecksum) || event.heapChecksum<0 || event.heapChecksum>0xffffffff)
    throw Error('Invalid guest identity');
}
export function checkConfiguration(event) {
  if(!same(event.parameters,parameters)||!same(event.orders,orders))throw Error('Changed workload parameters/order');
}
export function checkMaps(event) {
  if(typeof event.maps!=='string'||!event.maps.length||event.maps.length>2097152||
      !/^[a-f0-9]{64}$/.test(event.mapsSha256)||event.mapsBytes!==new TextEncoder().encode(event.maps).length)
    throw Error('Invalid bounded process maps');
}
// Strict lifecycle/sequence validation is shared by browser and host unit tests.
// It accepts parsed records only; COM1 pairing and ACK ownership are independent.
export class Protocol {
  constructor(mode,captureIdentity=null) {this.mode=mode;this.captureIdentity=captureIdentity;this.plan=gatePlan();this.next=0;}
  accept(event) {
    if(event.event==='failure')throw Error('Guest failure: '+event.message);
    checkIdentity(event);
    if(event.event==='snapshot-prepared') {
      if(this.mode!=='capture'||this.prepared||this.resumed||event.ordinal!==0||event.seq!==undefined)
        throw Error('Unexpected snapshot preparation');
      checkConfiguration(event);this.prepared=event;return 'prepared';
    }
    if(event.event==='resumed') {
      const original=this.mode==='capture'?this.prepared:this.captureIdentity;
      if(this.resumed||this.next||!original||event.seq!==undefined||event.ordinal!==1||
          event.mode!==(this.mode==='capture'?'cold':'restored')||event.nonce!==original.nonce||event.heapChecksum!==original.heapChecksum)
        throw Error('Invalid snapshot continuation');
      checkConfiguration(event);this.resumed=event;return 'resumed';
    }
    const wanted=this.plan[this.next];
    if(!this.resumed||!wanted||event.seq!==this.next+1||event.ordinal!==1||event.mode!==this.resumed.mode||
        event.nonce!==this.resumed.nonce||event.heapChecksum!==this.resumed.heapChecksum||
        Object.entries(wanted).some(([key,value])=>event[key]!==value))throw Error('Unexpected gate sequence '+event.seq);
    if(event.event==='result'&&(event.value!==expected[event.name]||!Number.isFinite(event.guestMs)||event.guestMs<0))
      throw Error('Incorrect workload result');
    if(event.event==='gate-result'&&(!Number.isFinite(event.guestMs)||event.guestMs<0))throw Error('Invalid calibration clock');
    if(['warmup-complete','complete'].includes(event.event)&&!same(event.values,expected))throw Error('Incorrect final values');
    if(['initialized','maps'].includes(event.event))checkMaps(event);
    this.next++;return 'gate';
  }
  finish() {if(this.next!==this.plan.length)throw Error('Missing gates');return true;}
}
