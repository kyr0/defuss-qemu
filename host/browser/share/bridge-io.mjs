// This worker owns the asynchronous socket. Only the VM worker blocks on
// the shared mailbox. Each connection accepts exactly one outstanding request.
let ws,header,bytes,waiting=null,ready=false;
function fail(message){
  if(header){Atomics.store(header,0,-1);Atomics.notify(header,0);}
  postMessage({error:message});waiting=null;ws?.close();
}
onmessage=({data})=>{
  if(data.init){
    header=new Int32Array(data.mailbox,0,8);bytes=new Uint8Array(data.mailbox,32);
    const url=new URL(data.url),token=url.hash.slice(1);url.hash='';
    ws=new WebSocket(url);ws.binaryType='arraybuffer';
    ws.onopen=()=>ws.send(token);
    ws.onerror=()=>fail('Bridge unavailable');
    ws.onclose=()=>fail('Bridge disconnected');
    ws.onmessage=({data})=>{
      if(!ready){
        try{const info=JSON.parse(data);if(info.version!==1||!Number.isSafeInteger(info.size)||
          info.size<512||info.size>2**41||info.size%512||typeof info.writable!=='boolean')throw Error();
          ready=true;postMessage({info});}catch{fail('Invalid bridge handshake');}return;
      }
      const b=new Uint8Array(data);
      if(!waiting||b[0]!==0||b.length!==1+waiting.expected){fail('Block operation failed');return;}
      if(waiting.expected)bytes.set(b.subarray(1));
      waiting=null;Atomics.store(header,0,0);Atomics.notify(header,0);
    };
  }else if(data.io){
    if(!ready||waiting||ws.readyState!==WebSocket.OPEN){fail('Bridge unavailable');return;}
    const [,op,n,lo,hi]=header,packet=new Uint8Array(13+(op===2?n:0)),v=new DataView(packet.buffer);
    packet[0]=op;v.setUint32(1,lo,true);v.setUint32(5,hi,true);v.setUint32(9,n,true);
    if(op===2)packet.set(bytes.subarray(0,n),13);
    waiting={expected:op===1?n:0};ws.send(packet);
  }
};
