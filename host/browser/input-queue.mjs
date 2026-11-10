// Keep one input-send-event in flight. Only merge adjacent motion samples.
// A key/button transition is an ordering barrier and gets its own QMP sync.
export function inputQueue(send,observe,onError){
  const pending=[];
  let sending=false;
  function motionType(events){
    const type=events[0]?.type;
    return (type==='abs'||type==='rel') && events.length===2 &&
      events[1].type===type && events[0].data.axis==='x' && events[1].data.axis==='y'?type:null;
  }
  async function drain(){
    if(sending)return;
    sending=true;
    try{
      while(pending.length){
        const item=pending.shift(),start=performance.now();
        try{await send(item.events);}
        catch(e){onError(e);}
        observe('sent',{queuedMs:start-item.first,ageMs:start-item.latest,ackMs:performance.now()-start});
      }
    }finally{sending=false;}
  }
  return events=>{
    const now=performance.now(),type=motionType(events),last=pending.at(-1);
    const merged=Boolean(type && last?.type===type);
    if(merged){
      last.events=type==='abs'?events:events.map((event,i)=>({...event,data:{...event.data,
        value:event.data.value+last.events[i].data.value}}));
      last.latest=now;
    }else pending.push({events,type,first:now,latest:now});
    observe('arrival',{merged,depth:pending.length+Number(sending)});
    void drain();
  };
}
