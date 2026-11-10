// Keep guest pixels sharp and preserve aspect ratio. Prefer integral CSS
// magnification in fullscreen when the source fits at native size.
export function fitPixels(w,h,availableW,availableH,upscale){
  if(!(w>0&&h>0&&availableW>0&&availableH>0))return 1;
  const fit=Math.min(availableW/w,availableH/h);
  return fit>=1?(upscale?Math.max(1,Math.floor(fit)):1):fit;
}
export function installFullscreen(canvas,shell,button,status){
  const viewport=shell.querySelector('.screen-viewport');let pending=0;
  function layout(){
    pending=0;const full=document.fullscreenElement===shell;
    const scale=fitPixels(canvas.width,canvas.height,viewport.clientWidth,full?viewport.clientHeight:Infinity,full);
    canvas.style.width=(canvas.width*scale)+'px';canvas.style.height=(canvas.height*scale)+'px';
    canvas.style.imageRendering='pixelated';canvas.getContext('2d').imageSmoothingEnabled=false;
    button.textContent=full?'Exit fullscreen':'Fullscreen';button.setAttribute('aria-pressed',String(full));
  }
  const schedule=()=>{if(!pending)pending=requestAnimationFrame(layout);};
  const resize=new ResizeObserver(schedule);resize.observe(viewport);
  const mode=new MutationObserver(schedule);mode.observe(canvas,{attributes:true,attributeFilter:['width','height']});
  document.addEventListener('fullscreenchange',()=>{status.textContent='';schedule();canvas.focus({preventScroll:true});});
  button.disabled=!document.fullscreenEnabled||!shell.requestFullscreen;
  if(button.disabled)status.textContent='Fullscreen unavailable in this browser context';
  button.onclick=async()=>{
    button.disabled=true;status.textContent='';
    try{if(document.fullscreenElement===shell)await document.exitFullscreen();else await shell.requestFullscreen();}
    catch(e){status.textContent='Fullscreen unavailable: '+e.message;}
    finally{button.disabled=false;schedule();canvas.focus({preventScroll:true});}
  };
  schedule();
  window.addEventListener('pagehide',()=>{resize.disconnect();mode.disconnect();cancelAnimationFrame(pending);},{once:true});
}
