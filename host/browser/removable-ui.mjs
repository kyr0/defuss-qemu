import {readMedium} from './removable.mjs';

export function installRemovableUI(el,report){
  const slots=['floppy','cdrom'];
  let pc,locked=false,check=0;
  const busy=new Set(),labels={floppy:null,cdrom:null};
  async function checkCd(){
    if(!pc)return;
    const request=++check;
    el('cd-device').textContent='Checking QEMU attachment…';
    try{
      const s=await pc.opticalStatus(),name=s.device==='ide0-cd1'?'Primary IDE slave':'Secondary IDE master';
      if(request!==check)return;
      el('cd-device').textContent=name+' · ATAPI · '+(s.inserted?'media attached ('+s.bytes+' bytes)':'empty')+
        (s.locked?' · guest locked':'')+(s.readBytes===null?'':' · '+s.readBytes+' bytes read')+'. Windows assigns the drive letter.';
    }catch(e){if(request===check)el('cd-device').textContent='Hardware check failed: '+e.message;}
  }
  el('check-cd').onclick=checkCd;
  function show(kind){
    el(kind).disabled=locked || busy.has(kind);
    el(kind+'-eject').disabled=el(kind).disabled || !labels[kind];
    el(kind+'-status').textContent=labels[kind] || 'Empty';
  }
  async function change(kind,file){
    if(locked || busy.has(kind))return;
    if(!pc){labels[kind]=file?.name??null;show(kind);return;}
    if(kind==='cdrom')check++;
    busy.add(kind);show(kind);
    try{
      const medium=await readMedium(kind,file);
      const result=await pc.changeMedium(kind,medium?.bytes??null);
      if(!result.inserted)labels[kind]=null;
      else if(result.changed)labels[kind]=medium.label;
      if(result.error)throw Error(result.error);
      el('error').textContent='';
    }catch(e){report(e);}
    finally{el(kind).value='';busy.delete(kind);show(kind);if(kind==='cdrom')void checkCd();}
  }
  for(const kind of slots){
    el(kind).onchange=()=>{const f=el(kind).files[0];if(f)void change(kind,f);};
    el(kind+'-eject').onclick=()=>{el(kind).value='';void change(kind,null);};
    show(kind);
  }
  return {
    lock(value){locked=value;for(const kind of slots)show(kind);},
    async initial(kind){
      const input=el(kind),file=input.files[0],medium=await readMedium(kind,file);
      if(input.files[0]===file){labels[kind]=medium?.label??null;show(kind);}
      return medium?.bytes??null;
    },
    attach(machine){pc=machine;for(const kind of slots)el(kind).value='';this.lock(false);el('check-cd').disabled=false;void checkCd();}
  };
}
