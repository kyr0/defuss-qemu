import {maxDiskMiB} from './fat16.mjs';
const MiB=1048576;
const capacity=v=>v.fat+' · '+(v.freeBytes/MiB).toFixed(1)+' MiB free · '+v.clusterBytes/1024+' KiB clusters';
export function installDiskGrow(el,download,bootControls){
  let active=null,worker=null,locked=false;
  const selected=()=>active||el('disk').files[0];
  const say=text=>el('grow-status').textContent=text;
  function refresh(){
    const busy=Boolean(worker),off=busy||locked;
    el('disk').disabled=off;
    for(const id of ['grow-inspect','grow-run','grow-target'])el(id).disabled=off||!selected();
    el('grow-cancel').disabled=!busy||locked;
    for(const id of ['grow-download','grow-original'])el(id).disabled=off||!active;
    el('grow-active').textContent=active?'Selected for next boot: '+active.name:'';
  }
  function finish(){worker?.terminate();worker=null;refresh();bootControls();}
  function reset(){
    active=null;const file=selected();say('');
    if(file)el('grow-target').value=String(Math.min(maxDiskMiB,Math.max(16,Math.ceil(file.size/MiB)*2)));
    refresh();
  }
  function run(target){
    const file=selected();if(!file||worker||locked)return;
    try{
      worker=new Worker(new URL('./grow-worker.mjs',import.meta.url),{type:'module'});
      refresh();bootControls();say('Reading partition and FAT…');
      const current=worker;
      worker.onerror=e=>{if(worker!==current)return;say('Resize failed: '+e.message);finish();};
      worker.onmessage=({data})=>{
        if(worker!==current)return;
        if(data.stage){say(data.stage+(data.total?' · '+data.done+' / '+data.total:''));return;}
        if(data.error)say('Resize refused: '+data.error);
        else if(data.info)say((data.info.diskBytes/MiB).toFixed(1)+' MiB disk · '+capacity(data.info));
        else{
          const {image,before,after,files}=data.result;
          const name=file.name.replace(/\.[^.]+$/,'')+'-grown-'+target+'MiB-'+Date.now()+'.img';
          active=new File([image],name,{type:'application/octet-stream'});
          el('boot').value='c';
          say('Verified '+files+' files. '+capacity(before)+' → '+capacity(after)+'. Download the grown image to keep it.');
        }
        finish();
      };
      worker.postMessage({file,target});
    }catch(e){say('Resize failed: '+e.message);finish();}
  }
  el('disk').addEventListener('change',reset);
  el('grow-inspect').onclick=()=>run(null);
  el('grow-run').onclick=()=>run(el('grow-target').valueAsNumber);
  el('grow-cancel').onclick=()=>{finish();say('Cancelled. The selected disk is unchanged.');};
  el('grow-download').onclick=()=>{if(active)download(active,active.name);};
  el('grow-original').onclick=reset;
  refresh();
  return {get busy(){return Boolean(worker);},get source(){return selected();},lock(on){locked=on;refresh();}};
}
