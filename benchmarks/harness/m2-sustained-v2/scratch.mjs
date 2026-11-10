import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export async function prepareScratch(output){
 const base=resolve(root,'tmp');await mkdir(base,{recursive:true});
 // Keep the unique suffix flat and short; this exact path shape was checked
 // with the benchmark Chrome157 binary on macOS before accepting the design.
 const directory=await mkdtemp(resolve(base,'s-'));
 for(const name of ['TMPDIR','TMP','TEMP'])process.env[name]=directory;
 const record={schema:1,createdUtc:new Date().toISOString(),pid:process.pid,directory,output:resolve(output),
  scope:'All Playwright profile/download and child temporary paths use this project-owned directory. Reports/checkpoints remain under artifacts. This metadata is retained; Playwright may clean its disposable browser files on close.'};
 await writeFile(resolve(directory,'run.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
 return {...record,projectRelative:relative(root,directory)};
}
