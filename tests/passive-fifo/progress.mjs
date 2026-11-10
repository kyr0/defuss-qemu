// Isolated combined-fixture adaptation of the retained pressure recorder.
import {open} from 'node:fs/promises';
import {dirname} from 'node:path';
export const progressScope='Partial stopped observations only; not acceptance or resumable. Require a separate complete immutable report.';
export async function openProgress(path,header){
 const file=await open(path,'wx',0o600);let count=0,closed=false,queue=Promise.resolve();
 const append=async value=>{const bytes=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>65536)throw Error('Progress record exceeds64KiB');await file.writeFile(bytes);await file.sync();};
 try{await append({...header,schema:1,kind:'partial-progress-header',scope:progressScope});const h=await open(dirname(path),'r');try{await h.sync();}finally{await h.close();}}catch(e){await file.close();throw e;}
 return {get count(){return count;},appendGate(record){queue=queue.then(async()=>{
  if(closed||count>=223||record.sequence!==count)throw Error('Progress sequence/bound rejected');
  if(record.row?.status?.running!==false||record.row.status.status!=='paused')throw Error('Progress requires stopped gate');
  await append({...record,schema:1,kind:'stopped-gate'});count++;
 });return queue;},async close(){if(!closed){closed=true;await queue.catch(()=>{});await file.close();}}};
}
