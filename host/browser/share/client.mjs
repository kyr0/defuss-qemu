export class StorageWorker {
  constructor(onError){
    this.worker=new Worker(new URL('./vm-worker.mjs',import.meta.url),{type:'module'});
    this.tasks=new Map();this.next=0;
    this.worker.onmessage=({data})=>{
      if(data.status){onError(data.status);return;}
      const task=this.tasks.get(data.id);if(!task)return;
      this.tasks.delete(data.id);if(data.error)task.reject(Error(data.error));else task.resolve(data.value);
    };
    this.worker.onerror=e=>{
      const err=Error(e.message||'Storage worker failed');this.failed=err;
      for(const t of this.tasks.values())t.reject(err);this.tasks.clear();onError(err);
    };
  }
  call(cmd,args={},transfer=[]){
    if(this.failed)return Promise.reject(this.failed);
    const id=++this.next;return new Promise((resolve,reject)=>{
      this.tasks.set(id,{resolve,reject});
      try{this.worker.postMessage({id,cmd,args},transfer);}catch(e){this.tasks.delete(id);reject(e);}
    });
  }
  async start(options,url){
    // Transfer ownership of local media instead of copying a large IDE image
    // a second time. An attempted restart reads fresh bytes from the inputs.
    const buffers=[...Object.values(options.roms),options.disk,options.floppy,options.cdrom]
      .filter(v=>v?.buffer instanceof ArrayBuffer).map(v=>v.buffer);
    const result=await this.call('start',{options,url},[...new Set(buffers)]);
    let rgba=null,width=0,height=0,ops=0,frameTransport=null;
    return {...result,
      frameTransportStats:()=>frameTransport,
      qmp:{send:(name,args)=>this.call('qmp',{name,args})},
      changeMedium:(kind,bytes)=>this.call('changeMedium',{kind,bytes},bytes?[bytes.buffer]:[]),
      events:events=>this.call('events',{events}),textScreen:()=>this.call('textScreen'),
      audioHardware:()=>this.call('audioHardware'),opticalStatus:()=>this.call('opticalStatus'),diskImage:options=>this.call('diskImage',options),blockStats:()=>this.call('blockStats'),ioOps:()=>ops,
      tcg:{enable:()=>this.call('tcgEnable'),disable:()=>this.call('tcgDisable'),read:()=>this.call('tcgRead'),
        enableLight:()=>this.call('tcgEnableLight'),disableLight:()=>this.call('tcgDisableLight')},
      storageStats:()=>this.call('storageStats'),
      frame:async({reuse=false}={})=>{
        const f=await this.call('frame');if(!f)return null;
        if(!rgba||width!==f.w||height!==f.h){width=f.w;height=f.h;rgba=new Uint8ClampedArray(width*height*4);}
        const {rows,...frame}=f;
        if(rows){try{rgba.set(rows,f.dirtyY*f.w*4);}finally{const buffer=rows.buffer;this.worker.postMessage({cmd:'recycleFrame',args:{buffer}},[buffer]);}}
        ops=f.ops;frameTransport=f.frameTransport;return {...frame,rgba:reuse?rgba:rgba.slice()};
      }
    };
  }
}
