import {readFile as readBytes} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative} from 'node:path';

export const runtimeContract=Object.freeze({
 buildReport:'artifacts/m3a-build-01/build-report.json',
 buildReportSha256:'86537d2bd206097fb36303a15b0563a96404aca24332c25ac2bc164d387d643c',
 sourceRecheck:'artifacts/m3a-build-01/source-recheck.json',
 sourceRecheckSha256:'078bb8264b4cfb52a32ad2aac29cbc8a2634b4859bf90a863a5ff340b4711099',
 sourceFingerprint:'b517b8d6c23d67db7e74fe4d2d5c4ff421693cb01b86c8666ffba006ca772d49',
 jsSha256:'a90d41c1b4149dde5783f7cf2f6ed40818bde2d85e93a040e271ab91d30ff0a6',
 wasmSha256:'6e3df17c9be813f979b9db2cf814d1e45d0a8c4d4327bf8191625ba72b75fd04',
});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifyRuntimeIdentity({root,runtime,readFile=readBytes}){
 const documents={},inputs={};
 for(const [name,expected] of [[runtimeContract.buildReport,runtimeContract.buildReportSha256],[runtimeContract.sourceRecheck,runtimeContract.sourceRecheckSha256]]){
  const bytes=await readFile(resolve(root,name)),actual=sha(bytes);
  if(actual!==expected)throw Error('Pressure runtime provenance identity mismatch: '+name);
  inputs[name]=actual;documents[name]=JSON.parse(bytes.toString('utf8'));
 }
 const build=documents[runtimeContract.buildReport],recheck=documents[runtimeContract.sourceRecheck];
 if(build.status!=='passed'||recheck.status!=='passed'||build.sourceFingerprint!==runtimeContract.sourceFingerprint||
   recheck.source.fingerprintBeforeBuild!==runtimeContract.sourceFingerprint||recheck.source.fingerprintAfterBuild!==runtimeContract.sourceFingerprint||
   !recheck.source.matches||recheck.buildReport.sha256!==runtimeContract.buildReportSha256)throw Error('Pressure runtime source binding mismatch');
 if(build.artifacts['runtime/x86_64/qemu-system-x86_64.js'].sha256!==runtimeContract.jsSha256||
   build.artifacts['runtime/x86_64/qemu-system-x86_64.wasm'].sha256!==runtimeContract.wasmSha256)throw Error('Pressure runtime binary contract mismatch');
 const artifacts=[];
 for(const [name,expected] of Object.entries(build.artifacts)){
  if(!name.startsWith('runtime/'))throw Error('Unexpected reviewed runtime artifact');
  const path=name.startsWith('runtime/x86_64/')?resolve(runtime,name.slice('runtime/x86_64/'.length)):resolve(dirname(runtime),name.slice('runtime/'.length));
  const bytes=await readFile(path),actual=sha(bytes),record=recheck.runtimeArtifacts[name];
  if(actual!==expected.sha256||bytes.length!==expected.bytes||!record?.matchesBuildReport||record.sha256!==actual||record.bytes!==bytes.length)throw Error('Pressure runtime artifact identity mismatch: '+name);
  inputs[relative(root,path)]=actual;artifacts.push({buildArtifact:name,path:relative(root,path),sha256:actual,bytes:bytes.length});
 }
 return {status:'verified',contract:runtimeContract,artifacts,inputs,
  scope:'Exact reviewed build report, post-build source-recheck and all seven runtime artifact bytes verified before browser startup. Full source fingerprint is bound to the retained post-build audit, not recomputed during this run.'};
}
