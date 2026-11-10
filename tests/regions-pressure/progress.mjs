import {open} from 'node:fs/promises';
import {dirname} from 'node:path';

export const progressScope='Partial stopped observations only; not acceptance evidence by itself and never resumable. Require a separate complete immutable report.';
export async function openProgress(path,header,{maxRows=206}={}){
 if(!Number.isInteger(maxRows)||maxRows<1||maxRows>206)throw Error('Invalid pressure progress bound');
 const file=await open(path,'wx',0o600);let count=0,closed=false,queue=Promise.resolve();
 const append=async value=>{
  const bytes=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>65536)throw Error('Pressure progress record exceeds64KiB');
  await file.writeFile(bytes);await file.sync();
 };
 try{
  await append({...header,schema:1,kind:'partial-progress-header',scope:progressScope});
  const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
 }catch(error){await file.close();throw error;}
 return {
  get count(){return count;},
  appendGate(record){
   queue=queue.then(async()=>{
    if(closed||count>=maxRows||record.sequence!==count)throw Error('Pressure progress sequence/bound rejected');
    if(record.row?.status?.running!==false||record.row?.status?.status!=='paused')throw Error('Pressure progress requires confirmed stopped gate');
    await append({...record,schema:1,kind:'stopped-gate'});count++;
   });return queue;
  },
  async close(){if(!closed){closed=true;await queue.catch(()=>{});await file.close();}},
 };
}
