import {createWorkloads,type JobName,type Result} from './operations';

const emit=(value:Record<string,unknown>)=>console.log('BUN_BENCH '+JSON.stringify(value));
emit({event:'ready',bun:Bun.version,revision:Bun.revision,arch:process.arch,pid:process.pid});
const expected:Record<JobName,Result>=JSON.parse(process.env.BENCH_EXPECTED!);
try{
 const app=createWorkloads(),names=Object.keys(app.jobs) as JobName[];
 emit({event:'parameters',...app.parameters,batchRepetitions:20,samples:3,warmupCycles:10});
 emit({event:'warmup-start',cycles:10});
 for(let cycle=0;cycle<10;cycle++)for(const name of names){
  const value=await app.jobs[name]();
  if(value!==expected[name])throw Error('Warmup mismatch: '+name+' '+value);
 }
 emit({event:'warmup-complete',cycles:10});
 const orders=[names,[...names].reverse(),[...names.slice(1),names[0]]];
 for(let sample=0;sample<orders.length;sample++)for(const name of orders[sample]){
  emit({event:'start',name,sample,iterations:20});
  const begin=performance.now();let value:Result;
  for(let iteration=0;iteration<20;iteration++){
   value=await app.jobs[name]();
   if(value!==expected[name])throw Error('Result mismatch: '+name+' '+value);
  }
  emit({event:'result',name,sample,iterations:20,guestMs:performance.now()-begin,value:value!});
 }
 await app.stop();
 emit({event:'complete'});
}catch(error){emit({event:'failure',message:String(error instanceof Error?error.stack:error)});process.exit(1);}
