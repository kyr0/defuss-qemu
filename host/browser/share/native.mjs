import {bounds} from './cache.mjs';
export async function openBridge(endpoint,allowWrites){
  const u=new URL(endpoint);
  if(u.protocol!=='ws:'||u.hostname!=='127.0.0.1'||u.pathname!=='/'||u.search||u.username||u.password||!/^#[\w-]{32,128}$/.test(u.hash))
    throw Error('Paste the loopback URL printed by the bridge');
  const capacity=128*1024,mailbox=new SharedArrayBuffer(32+capacity);
  const h=new Int32Array(mailbox,0,8),data=new Uint8Array(mailbox,32);
  const worker=new Worker(new URL('./bridge-io.mjs',import.meta.url),{type:'module'});
  let dead=false,info;
  try{info=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Bridge connection timed out')),10000);
    worker.onmessage=e=>{clearTimeout(timer);if(e.data.error){dead=true;reject(Error(e.data.error));}else resolve(e.data.info);};
    worker.onerror=()=>{dead=true;clearTimeout(timer);reject(Error('Bridge worker failed'));};
    worker.postMessage({init:true,mailbox,url:endpoint});
  });}catch(e){worker.terminate();throw e;}
  const writable=allowWrites&&info.writable;
  function request(op,at,buf){
    const n=buf?.length||0;bounds(info.size,at,n);
    if(dead)throw Error('Bridge disconnected; reconnect in a new VM');
    if(op===2&&!writable)throw Error('Read-only bridge');
    if(op===2)data.set(buf);
    h[1]=op;h[2]=n;h[3]=at>>>0;h[4]=Math.floor(at/4294967296);
    Atomics.store(h,0,1);worker.postMessage({io:true});
    if(Atomics.wait(h,0,1,12000)==='timed-out'||Atomics.load(h,0)!==0){
      dead=true;worker.terminate();throw Error('Bridge I/O failed; no write is retried');
    }
    if(op===1)buf.set(data.subarray(0,n));
  }
  function io(op,buf,at){
    bounds(info.size,at,buf.length);
    for(let i=0;i<buf.length;i+=capacity)request(op,at+i,buf.subarray(i,i+capacity));
    return buf.length;
  }
  return {type:'native',size:info.size,writable,read:(b,p)=>io(1,b,p),write:(b,p)=>io(2,b,p),
    flush(){if(writable)request(3,0);},close(){dead=true;worker.terminate();}};
}
