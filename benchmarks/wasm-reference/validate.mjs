import {IV,LIMITS,hex} from './reference.mjs';
import {compressionOracle,digestOracle,integerOracle} from './oracle.mjs';

function check(ok,message){if(!ok)throw Error(message);}
function equal(a,b,message){check(a.length===b.length&&a.every((v,i)=>v===b[i]),message);}
function generator(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;};}
export async function validateReference(api,{hashOracle,hashOracleName}={}) {
  if(!hashOracle){
    if(globalThis.crypto?.subtle){hashOracle=async bytes=>new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));hashOracleName='WebCrypto SHA-256 (validation only)';}
    else {hashOracle=digestOracle;hashOracleName='independent BigInt SHA-256';}
  }
  const started=performance.now(),random=generator(0x6d317761);
  const report={status:'running',seed:'0x6d317761',integerCases:0,compressionCases:0,digestCases:0,
    streamingPartitions:0,rejectedCases:0,contextStateCases:0,compressionOracle:'independent BigInt arithmetic',
    digestOracle:hashOracleName||'caller-supplied oracle',checks:[]};
  const {base,layout,raw,words,bytes,contextBytes}=api;
  const makeBytes=length=>Uint8Array.from({length},()=>random()&255);
  const integerCases=[[123,250000,1664525,1013904223],[0,0,0,0],[0xffffffff,1,0xffffffff,0xffffffff],
    [0x80000000,31,0x80000000,1],[17,0,123,456],[0,256,0,0xffffffff]];
  for(let i=0;i<200;i++)integerCases.push([random(),random()%4096,random(),random()]);
  for(const args of integerCases){
    const expected=integerOracle(...args);
    check((raw.ref_integer(...args)>>>0)===expected,'Raw integer recurrence mismatch');
    check(api.integerChecked(...args)===expected,'Checked integer recurrence mismatch');report.integerCases++;
  }
  report.checks.push('Exact u32 dependent recurrence, original workload parameters and arbitrary seeds/constants/counts');
  for(let i=0;i<72;i++){
    const state=Uint32Array.from({length:8},random),count=i<6?[0,1,2,3,16,17][i]:random()%18;
    const input=makeBytes(count*64),offset=[0,1,3,15,31,63,4095][i%7],at=layout.input+offset;
    const expected=compressionOracle(state,input);
    words.set(state,layout.state/4);bytes.set(input,at);
    raw.ref_sha256_compress(layout.state,at,count);
    equal(words.slice(layout.state/4,layout.state/4+8),expected,'Raw arbitrary-state compression mismatch');
    equal(bytes.slice(at,at+input.length),input,'Compression modified input');
    equal(api.compressCopied(state,input),expected,'Copy compression mismatch');
    report.compressionCases++;
  }
  const boundedInput=makeBytes(5*64),boundedState=Uint32Array.from({length:8},random);
  words.set(boundedState,layout.state/4);bytes.set(boundedInput,layout.input);
  const progress=api.compressResident(layout.state,layout.input,5,{maxBlocks:2});
  check(progress.blocksCompleted===2&&progress.blocksRemaining===3,'Incorrect bounded progress');
  equal(words.slice(layout.state/4,layout.state/4+8),compressionOracle(boundedState,boundedInput.slice(0,128)),'Partial state incorrect');
  // Cancellation means not issuing another bounded call: no hidden work exists.
  const cancelledState=words.slice(layout.state/4,layout.state/4+8);
  check(api.integerChecked(1,0,2,3)===1,'Independent call failed');
  equal(words.slice(layout.state/4,layout.state/4+8),cancelledState,'Cancelled compression continued');
  const resumed=api.compressResident(layout.state,layout.input+128,3,{maxBlocks:3});
  check(resumed.blocksRemaining===0,'Resume incomplete');
  equal(words.slice(layout.state/4,layout.state/4+8),compressionOracle(boundedState,boundedInput),'Resumed compression mismatch');
  report.checks.push('Arbitrary chaining states; zero/one/many blocks; unaligned and page-crossing bytes; bounded progress/cancel/resume');

  const empty=new Uint8Array(),abc=new TextEncoder().encode('abc');
  equal(digestOracle(empty),Uint8Array.from('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'.match(/../g),h=>parseInt(h,16)),'Independent empty oracle');
  equal(digestOracle(abc),Uint8Array.from('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'.match(/../g),h=>parseInt(h,16)),'Independent abc oracle');
  const cases=[empty,abc,...[1,2,3,7,31,55,56,57,63,64,65,119,120,127,128,129,4095,4096,4097,65535,65536,65537].map(makeBytes)];
  for(let i=0;i<32;i++)cases.push(makeBytes(random()%8193));
  const original=Uint8Array.from({length:65536},(_,i)=>(i*17+23)&255);cases.push(original);
  for(const input of cases){
    const expected=new Uint8Array(await hashOracle(input));
    bytes.set(input,layout.input);
    check(raw.ref_sha256_hash(layout.input,input.length,layout.digest)===0,'Raw hash status');
    equal(bytes.slice(layout.digest,layout.digest+32),expected,'Raw complete SHA mismatch');
    equal(api.hashCopied(input),expected,'Copy complete SHA mismatch');
    if(input.length<1024)equal(digestOracle(input),expected,'Independent BigInt complete hash mismatch');
    report.digestCases++;
  }
  report.originalSha256=hex(await hashOracle(original));
  const stream=async(input,parts,expected)=>{
    bytes.set(input,layout.input);api.initContext(layout.context);let at=0;
    api.updateContext(layout.context,layout.input,0);
    for(const part of parts){api.updateContext(layout.context,layout.input+at,part);at+=part;}
    check(at===input.length,'Bad partition fixture');api.updateContext(layout.context,layout.input+at,0);
    api.finalContext(layout.context,layout.digest);
    equal(bytes.slice(layout.digest,layout.digest+32),expected,'Streaming partition mismatch');report.streamingPartitions++;
  };
  for(let length=0;length<=9;length++){
    const input=makeBytes(length),expected=new Uint8Array(await hashOracle(input));
    for(let mask=0;mask<2**Math.max(0,length-1);mask++){
      const parts=[];let last=0;
      for(let at=1;at<length;at++)if(mask&(1<<(at-1))){parts.push(at-last);last=at;}
      parts.push(length-last);await stream(input,parts,expected);
    }
  }
  for(const length of [55,56,63,64,65,127,128,129,4095,4096,4097,65536]){
    const input=makeBytes(length),expected=new Uint8Array(await hashOracle(input));
    await stream(input,[length],expected);
    if(length<=129)await stream(input,Array(length).fill(1),expected);
    for(const mode of ['boundary','random']){
      const parts=[];let remaining=length,i=0;
      while(remaining){const n=Math.min(remaining,mode==='random'?1+random()%113:[1,54,1,7,1,1,63,64,65,4096][i++%10]);parts.push(n);remaining-=n;}
      await stream(input,parts,expected);
    }
  }
  report.checks.push('Complete hashes and incremental updates: padding boundaries, exhaustive short partitions, randomized long partitions and zero-length updates');

  const rejectWithoutMutation=fn=>{
    const before=bytes.slice();let rejected=false;
    try{fn();}catch(error){check(error instanceof RangeError,'Unexpected guard exception');rejected=true;}
    check(rejected,'Invalid input was accepted');equal(bytes,before,'Guard rejection mutated memory');report.rejectedCases++;
  };
  const end=base+api.capacity,s=layout.state,p=layout.input,c=layout.context,d=layout.digest;
  for(const fn of [
    ()=>api.compressResident(s+1,p,1),()=>api.compressResident(end-16,p,1),
    ()=>api.compressResident(s,end-63,1),()=>api.compressResident(s,p,0xffffffff),
    ()=>api.compressResident(s,s,1),()=>api.compressResident(s,s+16,1),
    ()=>api.compressResident(s,p,-1),()=>api.compressResident(s,p,1.5),
    ()=>api.compressResident(s,p,1,{maxBlocks:0}),()=>api.compressResident(s,p,1,{maxBlocks:1025}),
    ()=>api.compressResident(s,Number.MAX_SAFE_INTEGER,1),()=>api.compressResident(s,NaN,1),
    ()=>api.hashResident(p,64,p+1),()=>api.hashResident(p,LIMITS.hashBytes+1,d),
    ()=>api.hashResident(end,1,d),()=>api.hashResident(p,1,end-31),
    ()=>api.initContext(c+1),()=>api.updateContext(c,c,1),()=>api.finalContext(c,c),
    ()=>api.integerChecked(-1,1,2,3),()=>api.integerChecked(1,LIMITS.integerIterations+1,2,3),
    ()=>api.integerChecked(1,1,0x100000000,3),()=>api.integerChecked(1,NaN,2,3),
    ()=>api.compressCopied(new Uint32Array(7),new Uint8Array(64)),
    ()=>api.compressCopied(IV,new Uint8Array(65)),
    ()=>api.hashCopied(bytes.subarray(p,p+64)),
    ()=>api.compressCopied(words.subarray(s/4,s/4+8),new Uint8Array(64))
  ])rejectWithoutMutation(fn);
  if(typeof SharedArrayBuffer!=='undefined')rejectWithoutMutation(()=>api.hashCopied(new Uint8Array(new SharedArrayBuffer(64))));
  if(typeof structuredClone==='function'){
    const detachedBuffer=new ArrayBuffer(64),detachedView=new Uint8Array(detachedBuffer);
    structuredClone(detachedBuffer,{transfer:[detachedBuffer]});
    rejectWithoutMutation(()=>api.hashCopied(detachedView));
  }
  const resizable=new ArrayBuffer(64,{maxByteLength:128});
  if(resizable.resizable)rejectWithoutMutation(()=>api.hashCopied(new Uint8Array(resizable)));
  const zero=words.slice(s/4,s/4+8);api.compressResident(s,end,0);equal(words.slice(s/4,s/4+8),zero,'Zero blocks changed state');
  const mutableInput=makeBytes(64),mutableExpected=new Uint8Array(await hashOracle(mutableInput));
  const ownedDigest=api.hashCopied(mutableInput);mutableInput.fill(0);bytes.fill(0,layout.digest,layout.digest+32);
  equal(ownedDigest,mutableExpected,'Returned digest aliases mutable source/scratch data');
  report.checks.push('Overflow-safe bounds, alignment, service limits and alias guards reject before mutation; detached/shared/resizable inputs rejected where supported; returned copies own their bytes');

  api.initContext(c);api.finalContext(c,d);
  rejectWithoutMutation(()=>api.finalContext(c,d));rejectWithoutMutation(()=>api.updateContext(c,p,0));
  const view=new DataView(api.memory.buffer),totalAt=c+raw.ref_sha256_total_offset(),usedAt=c+raw.ref_sha256_used_offset();
  // Synthetic contexts isolate 64-bit bit-length encoding without hashing exabytes.
  for(const total of [(1n<<32n)-1n,1n<<32n,(1n<<61n)-1n]){
    api.initContext(c);const used=Number(total&63n);
    view.setBigUint64(totalAt,total,true);view.setUint32(usedAt,used,true);
    const padding=new Uint8Array(used>=56?128:64);padding[used]=0x80;
    let bits=total*8n;for(let i=0;i<8;i++){padding[padding.length-1-i]=Number(bits&255n);bits>>=8n;}
    const expectedState=compressionOracle(IV,padding),expected=new Uint8Array(32),ev=new DataView(expected.buffer);
    expectedState.forEach((word,i)=>ev.setUint32(i*4,word,false));
    api.finalContext(c,d);equal(bytes.slice(d,d+32),expected,'64-bit final length mismatch');report.contextStateCases++;
  }
  api.initContext(c);view.setBigUint64(totalAt,(1n<<61n)-1n,true);view.setUint32(usedAt,63,true);
  rejectWithoutMutation(()=>api.updateContext(c,p,1));
  api.initContext(c);view.setUint32(usedAt,64,true);rejectWithoutMutation(()=>api.updateContext(c,p,0));
  report.checks.push('Finalization lifecycle, malformed context, 64-bit length encoding and overflow without mutation');
  report.status='passed';report.seconds=(performance.now()-started)/1000;return report;
}
