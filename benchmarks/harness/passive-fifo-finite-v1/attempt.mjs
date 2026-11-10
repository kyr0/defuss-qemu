// Durable evidence boundary: absence of a marker is not proof that execution never began.
import assert from 'node:assert/strict';
import {open,readFile,lstat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function durableNew(path,value){const file=await open(path,'wx');try{await file.writeFile(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');await file.sync();}finally{await file.close();}const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}}
export async function beginAttempt(output){const marker={schema:1,id:randomUUID(),state:'browser-entry-armed',utc:new Date().toISOString(),scope:'Durably recorded before browser entry; if t0 is lost or unknown this attempt is not replaceable.'};await durableNew(resolve(output,'execution-start.json'),marker);return marker;}
export async function certifyPreStartFailure(output,reportBytes){const report=JSON.parse(reportBytes);assert.equal(report.status,'failed');assert.equal(report.executionBoundary?.started,false);await assert.rejects(lstat(resolve(output,'execution-start.json')),error=>error.code==='ENOENT');await durableNew(resolve(output,'pre-start-failure.json'),{schema:1,state:'proven-pre-start-failure',reportSha256:sha(reportBytes)});}
export async function provenPreStartFailure(output){
 try{await lstat(resolve(output,'execution-start.json'));return false;}catch(e){if(e.code!=='ENOENT')throw e;}
 try{const certificate=JSON.parse(await readFile(resolve(output,'pre-start-failure.json'))),bytes=await readFile(resolve(output,'report.json')),r=JSON.parse(bytes);
  return certificate.schema===1&&certificate.state==='proven-pre-start-failure'&&certificate.reportSha256===sha(bytes)&&r.status==='failed'&&r.executionBoundary?.started===false&&!r.browserResult;
 }catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return false;throw e;}
}
export async function validateStartedReport(output,report){const markerBytes=await readFile(resolve(output,'execution-start.json')),marker=JSON.parse(markerBytes);assert.equal(report.executionBoundary.recordSha256,sha(markerBytes),'Durable start record changed');assert.equal(marker.schema,1);assert.equal(marker.state,'browser-entry-armed');assert.equal(report.executionBoundary.started,true);assert.equal(report.executionBoundary.id,marker.id);assert.equal(report.browserResult.horizon.startId,marker.id);return marker;}
