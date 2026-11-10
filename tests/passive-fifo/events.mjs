import {open} from 'node:fs/promises';
import {dirname} from 'node:path';
export const eventLimits=Object.freeze({records:4096,bytes:2*1024*1024,recordBytes:65536});
// Diagnostic startup/failure evidence only; this log never establishes a gate.
export async function openEvents(path){
 const file=await open(path,'wx',0o600);let queue=Promise.resolve(),count=0,bytes=0,closed=false,failure=null;
 const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
 return {
  get count(){return count;},get bytes(){return bytes;},
  append(value){
   if(closed||failure)return Promise.reject(failure??Error('Event log closed'));
   let line;
   try{
    if(!value||typeof value.event!=='string')throw Error('Invalid diagnostic event');
    line=Buffer.from(JSON.stringify({...value,schema:1,sequence:count,utc:new Date().toISOString()})+'\n');
    if(count>=eventLimits.records||line.length>eventLimits.recordBytes||bytes+line.length>eventLimits.bytes)throw Error('Diagnostic event log bound exceeded');
   }catch(e){failure=e;return Promise.reject(e);}
   count++;bytes+=line.length;
   queue=queue.then(async()=>{await file.writeFile(line);await file.sync();});
   return queue;
  },
  async close(){if(!closed){closed=true;try{await queue;if(failure)throw failure;}finally{await file.close();}}}
 };
}
export function validateEvents(bytes,metadata){
 if(bytes.length!==metadata.bytes||bytes.length>eventLimits.bytes)throw Error('Diagnostic event byte bound differs');
 const rows=bytes.toString().trim().split('\n').map(JSON.parse);
 if(rows.length!==metadata.records||rows.length>eventLimits.records||rows[0]?.event!=='runner-start')throw Error('Invalid diagnostic event sequence');
 for(let i=0;i<rows.length;i++){
  const row=rows[i];if(row.sequence!==i||row.schema!==1||typeof row.utc!=='string'||Buffer.byteLength(JSON.stringify(row)+'\n')>eventLimits.recordBytes)throw Error('Invalid diagnostic event row');
  if(['pageerror','page-crash','runtime-abort','host-deadline','startup-deadline'].includes(row.event))throw Error('Fatal diagnostic event retained');
 }
 if(rows.filter(r=>r.event==='first-stopped-gate').length!==1)throw Error('Missing first stopped gate event');
 return {status:'passed',records:rows.length};
}
