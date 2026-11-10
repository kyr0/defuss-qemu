import {openSync,closeSync,readSync,writeSync,readFileSync,fsyncSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {createWorkloads,type JobName,type Result} from '../../workload/operations';
import {protocol,prefix,parameters,orders,expected} from './protocol.mjs';

declare const bunWasm: {snapshotReady(): 'cold'|'restored'|'disabled'};
if(process.platform!=='linux'||process.arch!=='x64'||Bun.version!=='1.4.4'||
    Bun.revision!=='38afee6c84fcf48c0edb2466aa4b27d287a59c30')throw Error('M1 requires pinned Linux amd64 Bun');
const nonce=randomUUID(),heap=new Uint32Array(4096);
for(let i=0;i<heap.length;i++)heap[i]=(Math.imul(i,0x9e3779b1)+nonce.charCodeAt(i%nonce.length))>>>0;
const checksum=()=>{let n=0x811c9dc5;for(const x of heap)n=Math.imul(n^x,0x01000193)>>>0;return n;};
const heapChecksum=checksum(),sentinel=JSON.stringify({protocol,nonce,heapChecksum,ordinal:0});
const sentinelPath='/tmp/defuss-m1-'+nonce;
function writeAll(fd:number,bytes:Uint8Array){let offset=0;while(offset<bytes.length){const n=writeSync(fd,bytes,offset,bytes.length-offset);if(n<=0)throw Error('Short write');offset+=n;}}
const file=openSync(sentinelPath,'wx',0o600);try{writeAll(file,Buffer.from(sentinel));fsyncSync(file);}finally{closeSync(file);}
let ordinal=0,sequence=0,mode='cold';
const identity=()=>({protocol,nonce,bun:Bun.version,revision:Bun.revision,arch:process.arch,pid:process.pid,
  heapLength:heap.length,heapChecksum,heap:true,file:true,ordinal,mode});
function verified(){if(checksum()!==heapChecksum||readFileSync(sentinelPath,'utf8')!==sentinel)throw Error('Snapshot heap/file mismatch');}
function emit(fields:Record<string,unknown>){writeAll(1,Buffer.from(prefix+JSON.stringify({...identity(),...fields})+'\n'));}
function maps(){const raw=readFileSync('/proc/self/maps');if(raw.length>2097152)throw Error('Process maps exceed bound');return {maps:raw.toString(),mapsBytes:raw.length,mapsSha256:createHash('sha256').update(raw).digest('hex')};}
function gate(fd:number,fields:Record<string,unknown>){emit({...fields,seq:++sequence});writeAll(fd,Buffer.from('G'));const ack=Buffer.alloc(1);if(readSync(fd,ack,0,1,null)!==1||ack[0]!==75)throw Error('Invalid COM1 gate ACK');}
function check(name:JobName,value:Result){if(value!==expected[name])throw Error('Incorrect '+name+' result: '+value);return value;}
const workload=createWorkloads();
try{
  verified();emit({event:'snapshot-prepared',parameters,orders});
  if(process.env.BUN_WASM_SNAPSHOT!=='1'||typeof bunWasm==='undefined')throw Error('Missing snapshot wrapper');
  mode=bunWasm.snapshotReady();if(!['cold','restored'].includes(mode))throw Error('Missing snapshot ACK');
  verified();ordinal++;emit({event:'resumed',parameters,orders});
  const fd=openSync('/dev/ttyS0','r+');
  try{
    gate(fd,{event:'initialized',...maps()});
    for(let index=0;index<parameters.gatePairs;index++){gate(fd,{event:'gate-start',index});const began=performance.now();gate(fd,{event:'gate-result',index,guestMs:performance.now()-began});}
    gate(fd,{event:'warmup-start'});
    for(let cycle=0;cycle<parameters.warmupCycles;cycle++)for(const name of orders[0])check(name as JobName,await workload.jobs[name as JobName]());
    gate(fd,{event:'warmup-complete',values:expected});
    // Mapping reads and their hashing/serial output are outside warmup and all
    // measured batch gates. Anonymous code remains anonymous/JIT-unknown.
    gate(fd,{event:'maps',phase:'post-warmup',...maps()});
    for(let sample=0;sample<orders.length;sample++)for(const name of orders[sample]){
      gate(fd,{event:'start',name,sample,iterations:parameters.batchRepetitions});
      const began=performance.now();let value:Result=expected[name];
      for(let i=0;i<parameters.batchRepetitions;i++)value=check(name as JobName,await workload.jobs[name as JobName]());
      gate(fd,{event:'result',name,sample,iterations:parameters.batchRepetitions,value,guestMs:performance.now()-began});
    }
    await workload.stop();verified();gate(fd,{event:'complete',values:expected});
    const extra=Buffer.alloc(1);readSync(fd,extra,0,1,null);throw Error('Unexpected input after completion');
  }finally{closeSync(fd);}
}catch(error){emit({event:'failure',message:String(error instanceof Error?error.stack:error)});process.exit(1);}
