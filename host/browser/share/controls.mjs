import {StorageWorker} from './client.mjs';
export function installStorageUI(el,report,download,resizeBusy=()=>false){
  let client=null,mount=null,host=null,locked=false,busy=false,review=null;
  const worker=()=>client??=new StorageWorker(report);
  function syncControls(){
    el('share-select').disabled=locked||busy||review!==null;
    el('share-panel').hidden=!mount;
    if(!locked)el('start').disabled=busy||review!==null||resizeBusy();
    el('share-writable').disabled=Boolean(mount);
    el('unmount-share').disabled=!mount||busy||locked;
    el('sync-preview').disabled=busy||review!==null||mount?.type!=='folder'||!mount.writable;
    el('sync-reselect').disabled=busy||review!==null||mount?.type!=='folder'||!mount.writable;
    el('sync-apply').disabled=busy||!review||review.some(r=>r.operation==='conflict')||
      !review.some(r=>['create','update','already applied'].includes(r.operation));
    el('sync-cancel').disabled=busy||!review;
    el('share-export').disabled=busy||mount?.type!=='folder';
    el('end-share').disabled=busy||!mount;
    el('restore-share').disabled=!el('saved-shares').value;
    el('forget-share').disabled=!el('saved-shares').value;
    el('share-status').textContent=mount?
      (mount.type==='folder'?'Folder snapshot':'Native bridge')+' · '+(mount.size/1048576).toFixed(1)+' MiB · '+
      (mount.writable?(mount.type==='folder'?'private writable overlay':'writes go to the selected backing'):'read-only'):'No secondary disk';
  }
  async function task(fn){
    if(busy)return;busy=true;if(!locked)el('start').disabled=true;syncControls();
    try{await fn();}catch(e){report(e);}
    finally{busy=false;if(!locked)el('start').disabled=false;syncControls();}
  }
  async function list(){
    const saved=await worker().call('list');el('saved-shares').replaceChildren(new Option('Select checkpoint',''));
    for(const s of saved)el('saved-shares').add(new Option(s.label+' · '+s.created,s.id));
  }
  function reset(){mount=null;host=null;review=null;el('share-plan').textContent='';}
  async function permission(h,mode){
    if(!h)throw Error('Reselect the original source folder');
    if(h.requestPermission&&await h.requestPermission({mode})!=='granted')throw Error('Folder permission denied');
  }
  function pick(){
    if(typeof showDirectoryPicker!=='function')throw Error('Directory selection requires a supported Chromium browser on localhost');
    return showDirectoryPicker({id:'win9x-storage',mode:'read'});
  }
  el('pick-share').onclick=()=>task(async()=>{
    const h=await pick();reset();
    mount=await worker().call('folder',{host:h,write:el('share-writable').checked});host=h;
    await list();el('saved-shares').value=mount.id;
  });
  el('list-shares').onclick=()=>task(list);
  el('saved-shares').onchange=syncControls;
  el('restore-share').onclick=()=>task(async()=>{
    const id=el('saved-shares').value;reset();const r=await worker().call('restore',{id,write:el('share-writable').checked});
    mount=r;
  });
  el('forget-share').onclick=()=>task(async()=>{
    const id=el('saved-shares').value;
    if(!confirm('Discard this private snapshot and its guest changes? Host files are kept.'))return;
    await worker().call('forget',{id});if(mount?.id===id)reset();await list();
  });
  el('connect-share').onclick=()=>task(async()=>{
    const endpoint=el('bridge-url').value;reset();
    mount=await worker().call('native',{endpoint,write:el('share-writable').checked});
    el('bridge-url').value='';
  });
  el('unmount-share').onclick=()=>task(async()=>{await worker().call('detach');reset();});
  el('sync-reselect').onclick=()=>task(async()=>{const h=await pick();host=h;el('share-plan').textContent='Source selected. Preview verifies its identity.';});
  el('sync-preview').onclick=()=>task(async()=>{
    if(!host)host=await pick();
    await permission(host,'read');review=await worker().call('preview',{host});
    el('share-plan').textContent=review.length?review.map(r=>r.operation+'  '+r.path).join('\n'):'No changes';
  });
  el('sync-cancel').onclick=()=>task(async()=>{
    await worker().call('cancel');review=null;el('share-plan').textContent='Preview closed';
  });
  el('sync-apply').onclick=()=>task(async()=>{
    await permission(host,'readwrite');
    try{
      const n=await worker().call('apply');review=null;el('share-plan').textContent=n+' host changes committed and verified';
    }catch(e){
      await worker().call('cancel');review=null;el('share-plan').textContent='Stopped. Run a fresh preview before retrying.';throw e;
    }
  });
  el('share-export').onclick=()=>task(async()=>{
    const raw=await worker().call('exportShare');download(new Blob([raw]),'win9x-folder-'+Date.now()+'.img');
  });
  el('end-share').onclick=()=>task(async()=>{
    if(!confirm('Stop this PC and reload? Download the primary IDE disk first if you need its changes. The secondary folder snapshot is retained.'))return;
    await worker().call('end');client.worker.terminate();client=null;mount=null;location.reload();
  });
  window.addEventListener('pagehide',()=>{if(mount&&client)client.call('end').catch(()=>{});});
  syncControls();
  return {
    refresh:syncControls,
    get selected(){return mount;},
    lock(value){locked=value;syncControls();},
    async start(options,url){if(review)throw Error('Close the write-back preview before boot');
      try{return await worker().start(options,url);}
      catch(e){if(!mount){client?.worker.terminate();client=null;}throw e;}}
  };
}
