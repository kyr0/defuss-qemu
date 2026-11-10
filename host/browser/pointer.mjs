// Canvas has zero padding. clientLeft/clientWidth exclude its CSS border.
// Endpoints of the displayed content map to QEMU's inclusive HID range.
export function absolutePosition(canvas,x,y) {
  const r=canvas.getBoundingClientRect();
  const axis=(client,start,border,extent)=>Math.round(32767*Math.max(0,Math.min(1,
    (client-start-border)/Math.max(1,extent-1))));
  return [axis(x,r.left,canvas.clientLeft,canvas.clientWidth),axis(y,r.top,canvas.clientTop,canvas.clientHeight)];
}
const buttonName=['left','middle','right'];
const btn=(button,down)=>({type:'btn',data:{button,down}});
const coords=(type,x,y)=>[{type,data:{axis:'x',value:x}},{type,data:{axis:'y',value:y}}];

export function installPointer(canvas,pc,send,output,preferTablet) {
  let absolute=false,dx=0,dy=0,position=null;
  const held=new Set();
  const locked=()=>document.pointerLockElement===canvas;
  function status(){
    canvas.dataset.pointer=absolute?'tablet':locked()?'captured':'relative';
    output.textContent=absolute?'USB tablet · aligned to canvas':
      locked()?'PS/2 captured · Esc to release':'PS/2 · click to capture, Esc to release';
  }
  function discard(){
    dx=0;dy=0;position=null;
  }
  function release(){
    discard();
    if(held.size)send([...held].map(b=>btn(b,false)));
    held.clear();
  }
  // QEMU promotes the tablet to current when the guest starts polling HID.
  // Until that happens, button events and relative axes belong to the PS/2 mouse.
  async function refresh(){
    try{
      const mice=await pc.qmp.send('query-mice');
      const next=Boolean(mice.find(m=>m.current)?.absolute);
      if(next!==absolute){
        release();absolute=next;if(absolute&&locked())document.exitPointerLock();
      }
      status();
    }catch{status();}
    setTimeout(refresh,1000);
  }
  status();if(preferTablet)void refresh();
  function flush(){
    if(absolute&&position){send(coords('abs',...position));position=null;}
    else if(locked()){
      const x=Math.trunc(dx),y=Math.trunc(dy);
      dx-=x;dy-=y;
      if(x||y)send(coords('rel',x,y));
    }
  }
  canvas.onpointermove=e=>{
    if(absolute)position=absolutePosition(canvas,e.clientX,e.clientY);
    else if(locked()){
      dx+=e.movementX*canvas.width/Math.max(1,canvas.clientWidth);
      dy+=e.movementY*canvas.height/Math.max(1,canvas.clientHeight);
    }else return;
    // inputQueue already bounds QMP to one in-flight batch and merges pending
    // motion. Dispatch now so idle input need not wait for a display frame.
    flush();
  };
  canvas.oncontextmenu=e=>e.preventDefault();
  canvas.onpointerdown=e=>{
    const b=buttonName[e.button];if(!b)return;
    e.preventDefault();canvas.focus();
    if(!absolute&&!locked()){
      try{
        if(!canvas.requestPointerLock)throw Error('Pointer Lock unavailable');
        canvas.requestPointerLock()?.catch(()=>{output.textContent='Pointer capture denied · click the canvas to retry';});
      }catch{output.textContent='Pointer capture unavailable in this browser';}
      return;
    }
    if(held.has(b))return;
    held.add(b);
    if(!locked())canvas.setPointerCapture(e.pointerId);
    const packet=absolute?coords('abs',...absolutePosition(canvas,e.clientX,e.clientY)):[];
    if(absolute)discard();else flush();
    send([...packet,btn(b,true)]);
  };
  canvas.onpointerup=e=>{
    const b=buttonName[e.button];
    if(!held.delete(b))return;
    e.preventDefault();
    const packet=absolute?coords('abs',...absolutePosition(canvas,e.clientX,e.clientY)):[];
    if(absolute)discard();else flush();
    send([...packet,btn(b,false)]);
  };
  canvas.addEventListener('blur',release);
  canvas.addEventListener('pointercancel',release);
  canvas.addEventListener('lostpointercapture',release);
  window.addEventListener('blur',release);
  document.addEventListener('pointerlockchange',()=>{if(!locked())release();status();});
}
