import {IV,hex} from './reference.mjs';
import {compressionOracle,digestOracle} from './oracle.mjs';

const median=values=>{const sorted=values.slice().sort((a,b)=>a-b),m=sorted.length>>1;return sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2;};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
function check(ok,message){if(!ok)throw Error(message);}

// Same browser-compatible core is used by the Node wrapper and browser runner.
// Results are exploratory component timings; batches in one instance are nested.
export async function runBenchmarks(api,{samples=7,warmup=5,callsPerSample=10}={}) {
  for(const [name,value,min,max] of [['samples',samples,1,100],['warmup',warmup,0,100],['callsPerSample',callsPerSample,1,1000]])
    check(Number.isInteger(value)&&value>=min&&value<=max,'Invalid '+name);
  const {raw,words,bytes,layout}=api,stateIndex=layout.state/4;
  const input=Uint8Array.from({length:65536},(_,i)=>(i*17+23)&255);
  const expectedState=compressionOracle(IV,input),expectedDigest=digestOracle(input);
  let expectedInteger=123;for(let i=0;i<250000;i++)expectedInteger=(Math.imul(expectedInteger^i,1664525)+1013904223)>>>0;
  bytes.set(input,layout.input);
  let sink=0,lastInteger,hashStatus=0;
  const observe=value=>{sink=Math.imul(sink^(value>>>0),16777619)>>>0;};
  const integerRaw=()=>{lastInteger=raw.ref_integer(123,250000,1664525,1013904223)>>>0;observe(lastInteger);};
  const integerChecked=()=>{lastInteger=api.integerChecked(123,250000,1664525,1013904223);observe(lastInteger);};
  const compressionRaw=()=>{for(let i=0;i<16;i++){words.set(IV,stateIndex);raw.ref_sha256_compress(layout.state,layout.input,1024);observe(words[stateIndex]);}};
  const compressionChecked=()=>{for(let i=0;i<16;i++){words.set(IV,stateIndex);api.compressResident(layout.state,layout.input,1024);observe(words[stateIndex]);}};
  let copiedState,copiedDigest;
  const compressionCopy=()=>{for(let i=0;i<16;i++){copiedState=api.compressCopied(IV,input);observe(copiedState[0]);}};
  const hashRaw=()=>{for(let i=0;i<16;i++){hashStatus|=raw.ref_sha256_hash(layout.input,65536,layout.digest);observe(words[layout.digest/4]);}};
  const hashChecked=()=>{for(let i=0;i<16;i++){api.hashResident(layout.input,65536,layout.digest);observe(words[layout.digest/4]);}};
  const hashCopy=()=>{for(let i=0;i<16;i++){copiedDigest=api.hashCopied(input);observe(copiedDigest[0]);}};
  const checkInteger=()=>check(lastInteger===expectedInteger,'Measured integer result changed');
  const checkCompression=()=>check(same(words.slice(stateIndex,stateIndex+8),expectedState),'Compression result changed');
  const checkHash=()=>{check(hashStatus===0,'Raw hash rejected an operation');check(same(bytes.slice(layout.digest,layout.digest+32),expectedDigest),'Hash result changed');};
  const endpoints=[
    {name:'integer.raw',run:integerRaw,verify:checkInteger,kind:'original integer recurrence',interface:'prevalidated scalar arguments; one JS→WASM call per job'},
    {name:'integer.checked',run:integerChecked,verify:checkInteger,kind:'original integer recurrence',interface:'u32/range/service guards plus one JS→WASM call per job'},
    {name:'sha256.compression.raw',run:compressionRaw,verify:checkCompression,kind:'compression component, no padding',interface:'resident 64 KiB input; 32-byte IV reset and one raw call ×16'},
    {name:'sha256.compression.checked',run:compressionChecked,verify:checkCompression,kind:'compression component, no padding',interface:'resident input; IV reset, alignment/bounds/alias/service guards and call ×16'},
    {name:'sha256.compression.copy',run:compressionCopy,verify:()=>check(same(copiedState,expectedState),'Copied compression result changed'),kind:'compression component, no padding',interface:'input/state guards, 64 KiB input staging, state transfer, bounded call, allocated result copy ×16'},
    {name:'sha256.full.raw',run:hashRaw,verify:checkHash,kind:'original SHA input and 16 synchronous complete hashes',interface:'resident input; init/padding/finalization inside WASM, one raw call ×16'},
    {name:'sha256.full.checked',run:hashChecked,verify:checkHash,kind:'original SHA input and 16 synchronous complete hashes',interface:'resident input; bounds/alias/service guards and complete hash ×16'},
    {name:'sha256.full.copy',run:hashCopy,verify:()=>check(same(copiedDigest,expectedDigest),'Copied digest changed'),kind:'original SHA input and 16 synchronous complete hashes',interface:'input guards, 64 KiB staging, checked complete hash, allocated 32-byte digest copy ×16'},
    {name:'boundary.empty-compression',run:()=>{for(let i=0;i<16;i++)observe(api.compressResident(layout.state,layout.input,0).blocksCompleted);},verify:()=>{},kind:'empty-interface diagnostic',interface:'resident guards, zero-block WASM call, progress result ×16'},
    {name:'boundary.copy64k',run:()=>{for(let i=0;i<16;i++){bytes.set(input,layout.input);observe(bytes[layout.input+i]);}},verify:()=>check(same(bytes.slice(layout.input,layout.input+input.length),input),'Staged bytes changed'),kind:'copy-only diagnostic',interface:'64 KiB JS→WASM-memory copy ×16; no hashing'}
  ];
  const report={schema:1,status:'running',scope:'Standalone component references; not guest acceleration or a native-parity claim',
    engine:typeof navigator==='undefined'?'caller records Node/V8 version':navigator.userAgent,
    runtime:api.metadata,protocol:{samples,warmupJobsPerEndpoint:warmup,callsPerSample,
      sampleUnit:'nested batches in one warmed module instance; no independent-launch confidence interval',
      timing:'host monotonic performance.now; validation outside timing; no empty-interface subtraction',
      order:'rotate endpoint order by sample index; fixed order in warmup'},
    originalParameters:{integerIterations:250000,integerSeed:123,multiplier:1664525,increment:1013904223,shaBytes:65536,shaRounds:16,shaPattern:'(i*17+23)&255'},
    expected:{integer:expectedInteger,sha256:hex(expectedDigest),compressionState:Array.from(expectedState)},
    limitations:['Standalone wasm32 unshared memory differs from VM memory64/shared memory; ratios do not isolate VM-only overhead.',
      'Raw timings include JS→WASM calls, result observation, and compression IV resets; they are practical direct-call references, not hardware instruction lower bounds.',
      'Compression excludes padding, finalization, hexadecimal formatting, Bun/JSC allocation and guest kernel costs.',
      'Full hashing returns bytes; the original Bun job also creates crypto objects and hexadecimal strings.',
      'Bridge timings use owned standalone buffers, not guest page translation, faults, snapshots or an integrated Bun routine ABI.'],
    endpoints:endpoints.map(({name,kind,interface:boundary})=>({name,kind,interface:boundary})),observations:[]};
  // Validate every endpoint before measurements as well as its result after each batch.
  for(const endpoint of endpoints){endpoint.run();endpoint.verify();for(let i=0;i<warmup;i++)endpoint.run();endpoint.verify();}
  for(let sample=0;sample<samples;sample++){
    const order=endpoints.slice(sample%endpoints.length).concat(endpoints.slice(0,sample%endpoints.length));
    for(const endpoint of order){
      const start=performance.now();
      for(let call=0;call<callsPerSample;call++)endpoint.run();
      const end=performance.now();endpoint.verify();
      report.observations.push({sample,endpoint:endpoint.name,startedMs:start,finishedMs:end,elapsedMs:end-start,
        calls:callsPerSample,perJobMs:(end-start)/callsPerSample,observedSink:sink});
    }
    // A scheduling point between batches; excluded from every endpoint interval.
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  report.summary=Object.fromEntries(endpoints.map(({name})=>{
    const values=report.observations.filter(row=>row.endpoint===name).map(row=>row.perJobMs);
    return [name,{medianMs:median(values),minMs:Math.min(...values),maxMs:Math.max(...values),samples:values.length}];
  }));
  report.status='passed';report.observedSink=sink;return report;
}
