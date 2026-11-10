// Untimed, forced-tier lowering diagnostic; not the full generated TB context.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const out='artifacts/rnds2-lanes-node-codegen-02';await mkdir(out);
if(process.env.NODE_OPTIONS)throw Error('NODE_OPTIONS override refused');
const u=n=>{const r=[];do{const b=n&127;n>>>=7;r.push(b|(n?128:0));}while(n);return r;};
const section=(n,b)=>[n,...u(b.length),...b],str=s=>[...u(s.length),...Array.from(s,c=>c.charCodeAt(0))];
const sha=b=>createHash('sha256').update(b).digest('hex'),inputs={};
const save=(n,x)=>writeFile(out+'/'+n,typeof x==='string'||x instanceof Uint8Array?x:JSON.stringify(x,null,2)+'\n',{flag:'wx'});
const driver=`import{readFile}from'node:fs/promises';
const m=new WebAssembly.Instance(new WebAssembly.Module(await readFile(process.argv[1]))).exports;
const v=new DataView(m.memory.buffer);v.setBigUint64(0,64n,true);v.setBigUint64(8,96n,true);v.setBigUint64(16,128n,true);v.setBigUint64(24,7n,true);v.setBigUint64(32,11n,true);
m.run(0n);const r=(x,n)=>(x>>>n)|(x<<(32-n)),t=((r(7,6)^r(7,11)^r(7,25))+11)>>>0;
const expected=[7,t,7,(t+(r(7,2)^r(7,13)^r(7,22)))>>>0],actual=Array.from({length:4},(_,i)=>v.getUint32(64+4*i,true));
if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Wrong state');console.error(JSON.stringify({status:'passed',actual,versions:process.versions}));`;
await save('driver.mjs',driver);
const results=[];
for(const kind of ['original','candidate']){
 const p='artifacts/rnds2-lanes-emitter-04/'+kind+'.body',body=await readFile(p);inputs[p]={sha256:sha(body),bytes:body.length};
 const locals=kind==='candidate'?[3,1,0x7f,19,0x7e,8,0x7f]:[2,1,0x7f,19,0x7e];
 const fn=[...locals,0x20,0,0x21,19,...body,0x0b]; // call-stack pointer is an unknown function parameter
 const bytes=Uint8Array.from([0,97,115,109,1,0,0,0,...section(1,[1,0x60,1,0x7e,0]),...section(3,[1,0]),...section(5,[1,7,1,1]),...section(7,[2,...str('run'),0,0,...str('memory'),2,0]),...section(10,[1,...u(fn.length),...fn])]);
 if(!WebAssembly.validate(bytes))throw Error('Invalid module');await save(kind+'.wasm',bytes);
 for(const [tier,flags]of [['baseline',['--liftoff-only']],['optimizing',['--no-liftoff']]]){
  const argv=['--print-wasm-code','--print-wasm-code-function-index=0','--no-wasm-lazy-compilation',...flags,'--input-type=module','-e',driver,out+'/'+kind+'.wasm'];
  const result=spawnSync(process.execPath,argv,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
  await save(kind+'-'+tier+'.stdout.log',result.stdout??'');await save(kind+'-'+tier+'.stderr.log',result.stderr??'');
  results.push({kind,tier,argv,returncode:result.status,error:result.error?.message});
  if(result.status!==0){await save('failure.json',{results});throw Error('Diagnostic failed');}
 }
}
const source=await readFile('experiments/rnds2-lanes/codegen-v2.mjs');inputs['experiments/rnds2-lanes/codegen-v2.mjs']={sha256:sha(source),bytes:source.length};
await save('report.json',{status:'passed',timingEligible:false,scope:'Actual Node/V8 forced-tier disassembly of extracted emitter body in a small memory64 module; no whole-TB native size, default tier or VM performance claim',node:process.execPath,versions:process.versions,inputs,results});
console.log(JSON.stringify({status:'passed',output:out}));
