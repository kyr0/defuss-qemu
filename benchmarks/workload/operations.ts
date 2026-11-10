import {createHash} from 'node:crypto';

export type JobName = 'integer' | 'json' | 'sha256' | 'http';
export type Result = number | string;
export type Job = () => Result | Promise<Result>;
type RecordRow = {id:number;name:string;value:number;active:boolean;text:string};

/** A deterministic application workload, identical for both guest ISAs. */
export function createWorkloads() {
 const records:RecordRow[]=Array.from({length:128},(_,i)=>({id:i,name:'record-'+i,value:i*7,active:i%2===0,text:'abcdef0123456789'.repeat(4)}));
 const payload=JSON.stringify(records);
 const bytes=Buffer.alloc(65536);
 for(let i=0;i<bytes.length;i++)bytes[i]=(i*17+23)&255;
 const responseBody=JSON.stringify({ok:true,value:'benchmark-response-'.repeat(8)});
 const server=Bun.serve({port:0,hostname:'127.0.0.1',fetch:()=>new Response(responseBody,{headers:{'content-type':'application/json'}})});
 const jobs:Record<JobName,Job>={
  integer(){let x=123;for(let i=0;i<250000;i++)x=(Math.imul(x^i,1664525)+1013904223)>>>0;return x;},
  json(){let x=0;for(let i=0;i<8;i++){const o:RecordRow[]=JSON.parse(payload);x+=o[127].id+JSON.stringify(o).length;}return x;},
  sha256(){let x='';for(let i=0;i<16;i++)x=createHash('sha256').update(bytes).digest('hex');return x;},
  async http(){let n=0;for(let i=0;i<8;i++){const r=await fetch(server.url);const body=await r.text();if(body!==responseBody||r.status!==200)throw Error('HTTP correctness');n+=body.length;}return n;}
 };
 return {jobs,stop:()=>server.stop(true),parameters:{integerIterations:250000,jsonRecords:128,jsonRounds:8,shaBytes:65536,shaRounds:16,httpRequests:8}};
}
