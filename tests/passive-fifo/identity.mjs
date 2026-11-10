import {readFile} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {sha,deriveObserver} from './derive.mjs';
export async function verifyIdentity({root,bindingPath,runtime,fixturePath,fixture}){
 const inputs={},get=async path=>{const bytes=await readFile(path);inputs[relative(root,path)]=sha(bytes);return bytes;};
 const binding=JSON.parse(await get(bindingPath));
 if(binding.schema!==1||binding.kind!=='passive-fifo-diagnostic-runtime-binding-v1'||binding.status!=='verified'||binding.variant!=='diagnostic'||binding.freezeSha256!=='0b0007d3c3ccc9732a0a66c308b3f6db31ff27f15d4efc189579051f503fed27')throw Error('Wrong reviewed policy binding');
 for(const [name,expected]of Object.entries(binding.inputs))if(sha(await get(resolve(root,name)))!==expected)throw Error('Policy provenance bytes differ: '+name);
 const build=JSON.parse(await get(resolve(root,binding.buildReport)));
 const auditBytes=await get(resolve(root,binding.sourceRecheck)),audit=JSON.parse(auditBytes);
 if(binding.sourceRecheckSha256!=='798e2d6a9c9ad48a3ebb7266c6308a984cb8bd4e5aea35ab30bc51f1940e6766'||sha(auditBytes)!==binding.sourceRecheckSha256||audit.kind!=='passive-fifo-postbuild-audit'||audit.variant!=='diagnostic'||audit.status!=='passed'||audit.sourceFingerprint!==binding.sourceFingerprint||audit.buildReport.sha256!==inputs[binding.buildReport])throw Error('Authoritative source audit mismatch');
 if(build.status!=='passed'||build.sourceFingerprint!==binding.sourceFingerprint||binding.sourceFingerprint!=='a212205ce5c8cbdd83dcf66ce8396ec3cdaa436037a77969963395f6e2b2a97c')throw Error('Build/source fingerprint mismatch');
 const expectedArtifacts=['runtime/audio/backend.mjs','runtime/audio/pcm.mjs','runtime/audio/ringbuf.mjs','runtime/graphics.mjs','runtime/native-counters.mjs','runtime/x86_64/qemu-system-x86_64.js','runtime/x86_64/qemu-system-x86_64.wasm'].sort();
 const boundNames=binding.runtime.map(r=>r.path.slice(r.path.indexOf('/runtime/')+1)).sort();
 if(JSON.stringify(Object.keys(build.artifacts).sort())!==JSON.stringify(expectedArtifacts)||JSON.stringify(boundNames)!==JSON.stringify(expectedArtifacts)||JSON.stringify(audit.runtimeArtifacts)!==JSON.stringify(build.artifacts))throw Error('Incomplete/duplicate runtime binding');
 for(const row of binding.runtime){
  const name=row.path.slice(row.path.indexOf('/runtime/')+1),expected=build.artifacts[name];
  if(!expected||expected.sha256!==row.sha256||expected.bytes!==row.bytes)throw Error('Runtime binding differs from build');
  const path=name.startsWith('runtime/x86_64/')?resolve(runtime,name.slice(15)):resolve(dirname(runtime),name.slice(8)),bytes=await get(path);
  if(sha(bytes)!==row.sha256||bytes.length!==row.bytes)throw Error('Actual runtime bytes differ');
 }
 const imageBuild=JSON.parse(await get(resolve(fixturePath,'build-report.json'))),image=await get(resolve(fixturePath,'initramfs.cpio.gz'));
 if(imageBuild.status!=='passed'||sha(image)!==imageBuild.initramfsSha256)throw Error('Fixture image hash mismatch');
 if(fixture==='combined'){
  if(imageBuild.kind!=='passive-fifo-combined-retained-elf-v1'||imageBuild.compiled!==false)throw Error('Wrong combined image');
  for(const [name,expected]of Object.entries(imageBuild.inputs))if(sha(await get(resolve(root,name)))!==expected)throw Error('Combined image input differs');
  for(const [kind,dir]of [['main','tests/regions'],['pressure','tests/regions-pressure']])for(const name of ['build.py','fixture.c','fixture.S'])if(sha(await get(resolve(root,dir,name)))!==imageBuild.fixtures[kind].sources[dir+'/'+name])throw Error('Combined retained source mismatch');
 }else{
  const dir=fixture==='main'?'tests/regions':'tests/regions-pressure';
  for(const name of ['build.py','fixture.c','fixture.S'])if(sha(await get(resolve(root,dir,name)))!==imageBuild.sources[dir+'/'+name])throw Error('Retained image/source mismatch');
 }
 const js=await get(resolve(runtime,'qemu-system-x86_64.js')),derived=await deriveObserver(js.toString());
 return {binding,inputs,derived,fixtureBuild:imageBuild};
}
