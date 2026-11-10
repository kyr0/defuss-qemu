import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile),root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const executable=resolve(root,'../native-build/lima/bin/limactl');
const limaHome='/Users/admin/.defuss-vm-lima';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function hostConditionIdentity(){
 const bytes=await readFile(executable);
 return {schema:1,executable,sha256:sha(bytes),bytes:bytes.length,environment:{LIMA_HOME:limaHome},arguments:['list','builder','--json'],
  expected:{name:'builder',status:'Stopped',memory:12884901888},rule:'Check before and after every fresh run; do not start compiler/build/other owned heavy work during the campaign.'};
}
export function validateHostStatus(status,configuration){
 assert.deepEqual(configuration.expected,{name:'builder',status:'Stopped',memory:12884901888});
 for(const [key,value] of Object.entries(configuration.expected))assert.equal(status[key],value,'Compiler VM host condition: '+key);
 assert.deepEqual(status.errors??[],[],'Compiler VM status errors');
}
export async function observeHostCondition(configuration){
 assert.deepEqual(configuration,await hostConditionIdentity(),'Host-condition executable/configuration changed');
 const startedUtc=new Date().toISOString();
 const {stdout,stderr}=await execute(configuration.executable,configuration.arguments,{env:{...process.env,...configuration.environment},timeout:15000,maxBuffer:1024*1024});
 const status=JSON.parse(stdout);const result={startedUtc,completedUtc:new Date().toISOString(),stdout,stderr,status};
 try{validateHostStatus(status,configuration);}catch(error){error.observation=result;throw error;}return result;
}
export async function hostMemory(){
 const result={utc:new Date().toISOString()};
 for(const [name,file,args] of [['vmStat','/usr/bin/vm_stat',[]],['swapUsage','/usr/sbin/sysctl',['-n','vm.swapusage']]]){
  try{const {stdout,stderr}=await execute(file,args,{timeout:10000,maxBuffer:1024*1024});result[name]={stdout,stderr};}
  catch(error){result[name]={error:String(error),stdout:error.stdout??'',stderr:error.stderr??''};}
 }
 return result;
}
