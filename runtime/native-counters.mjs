// Read optional cumulative uint64 native counters without exposing guest data.
// Wasm i64 results arrive as signed BigInt even when the C ABI uses uint64_t.
export function readNativeCounters(abi,{names,scope,count=false,versions=[1]}){
  const result={supported:false,source:null,version:null,enabled:null,scope,
    counters:null,counterPrecisionExceeded:false};
  try{
    if(typeof abi?.version!=='function')return result;
    const version=abi.version();
    if(!Number.isSafeInteger(version)||version<0)return result;
    result.version=version;result.source='native';
    if(!versions.includes(version)||typeof abi.stat!=='function'||typeof abi.enabled!=='function'||typeof abi.enable!=='function')return result;
    if(count&&(typeof abi.count!=='function'||abi.count()!==names.length))return result;
    result.supported=true;
    const enabled=abi.enabled();
    if(enabled===0||enabled===1)result.enabled=Boolean(enabled);else result.readError=true;
    result.counters=Object.fromEntries(names.map((name,index)=>{
      const raw=abi.stat(index);let value=null;
      if(typeof raw==='bigint'&&raw>=-(1n<<63n)&&raw<(1n<<64n)){
        const unsigned=BigInt.asUintN(64,raw);
        if(unsigned<=BigInt(Number.MAX_SAFE_INTEGER))value=Number(unsigned);
        else result.counterPrecisionExceeded=true;
      }else if(Number.isSafeInteger(raw)&&raw>=0)value=raw;
      else if(typeof raw==='number'&&Number.isFinite(raw)&&raw>Number.MAX_SAFE_INTEGER)result.counterPrecisionExceeded=true;
      else result.invalidCounters=true;
      return [name,value];
    }));
  }catch{result.readError=true;result.counters=null;}
  return result;
}
