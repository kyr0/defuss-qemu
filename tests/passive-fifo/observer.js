// DEFUSS_FIFO_ASYNC_OBSERVER_BEGIN
// Diagnostic JS only. No function/module/instance references are retained.
var fifoObsWords, fifoObsRawState, fifoObsOwner=false, fifoObsDone=0, fifoObsNext=0;
var fifoObsObjects=new Map(),fifoObsSlots=new Map(),fifoObsEpisodes=new Map();
function fifoObsFail(code){if(fifoObsWords)Atomics.store(fifoObsWords,3,code);throw Error('FIFO observer failure '+code);}
function fifoObsAdd(index){const old=Atomics.add(fifoObsWords,index,1);if(old===0xffffffff)fifoObsFail(1);return old+1;}
function fifoObsInit(pointer){
 const bus=Module.pcFifoObserverBus;
 if(!bus||bus.schema!==1||!(bus.buffer instanceof SharedArrayBuffer)||bus.buffer.byteLength!==(128+16384*12)*4)throw Error('Missing FIFO observer bus');
 fifoObsWords=new Uint32Array(bus.buffer);fifoObsDone=bigintToI53Checked(pointer);
 if(typeof fifoObsRawState!=='function')fifoObsFail(19);
 fifoObsNativeAddress();
 if(!Number.isSafeInteger(fifoObsDone)||fifoObsDone<0||fifoObsDone+4>HEAP8.buffer.byteLength||fifoObsDone%4)fifoObsFail(2);
 if(Atomics.add(fifoObsWords,2,1)!==0)fifoObsFail(3);
 fifoObsOwner=true;Atomics.store(fifoObsWords,33,fifoObsDone);
}
function fifoObsNativeAddress(){
 const address=Atomics.load(fifoObsWords,49);
 if(!address||address%4||address+64*4>HEAP8.buffer.byteLength)fifoObsFail(21);
 return address;
}
function fifoObsDoneValue(){return new DataView(HEAP8.buffer).getInt32(fifoObsDone,true);}
function fifoObsTrace(kind,key,id,slot){
 if(![1,2].includes(Atomics.load(fifoObsWords,15)))return;
 const row=Atomics.load(fifoObsWords,16);if(row>=16384){Atomics.store(fifoObsWords,31,1);fifoObsFail(4);}
 const values=[kind,Asyncify.state,Number(key),id,Number(slot),fifoObsDoneValue(),
  Atomics.load(fifoObsWords,6),Atomics.load(fifoObsWords,7),Atomics.load(fifoObsWords,5),
  Atomics.load(fifoObsWords,46),Atomics.load(fifoObsWords,8),fifoObsRawState()];
 if(values.some(v=>!Number.isSafeInteger(v)||v<0||v>0xffffffff))fifoObsFail(5);
 for(let i=0;i<12;i++)Atomics.store(fifoObsWords,128+row*12+i,values[i]);
 Atomics.store(fifoObsWords,16,row+1);
}
function fifoObsRegister(){
 if(!fifoObsOwner)fifoObsFail(6);
 fifoObsCloseGroup();
 if(++fifoObsNext>0xffffffff||fifoObsObjects.size>=12000)fifoObsFail(7);
 const token={fifoObserver:1,id:fifoObsNext};fifoObsObjects.set(token.id,{state:'registered'});fifoObsAdd(4);return token;
}
function fifoObsInstall(index){
 if(!fifoObsOwner)return;
 const slot=Number(index),id=fifoObsNext,entry=fifoObsObjects.get(id);
 if(!Number.isSafeInteger(slot)||slot<0||slot>0xffffffff||fifoObsSlots.has(slot)||entry?.state!=='registered')fifoObsFail(8);
 if(Asyncify.state!==Asyncify.State.Normal||fifoObsRawState()!==0){fifoObsAdd(13);fifoObsFail(9);}
 entry.state='live';entry.slot=slot;fifoObsSlots.set(slot,id);fifoObsAdd(5);fifoObsAdd(14);
 fifoObsTrace(6,0,id,slot);
}
function fifoObsRemove(index){
 if(!fifoObsOwner)return;
 const slot=Number(index),id=fifoObsSlots.get(slot),entry=fifoObsObjects.get(id);
 if(!id||entry?.state!=='live'||entry.slot!==slot){fifoObsAdd(21);fifoObsFail(10);}
 if(Asyncify.state!==Asyncify.State.Normal||fifoObsRawState()!==0){fifoObsAdd(12);fifoObsFail(11);}
 if(Atomics.load(fifoObsWords,32)&&Atomics.load(fifoObsWords,15)===0)Atomics.store(fifoObsWords,15,1);
 if(!Atomics.load(fifoObsWords,42))Atomics.store(fifoObsWords,43,Atomics.load(fifoObsWords,5));
 fifoObsAdd(42);
 entry.state='retired';fifoObsSlots.delete(slot);fifoObsAdd(6);Atomics.sub(fifoObsWords,14,1);
 fifoObsTrace(5,0,id,slot);
}
function fifoObsDelivered(token){
 fifoObsCloseGroup();
 const entry=fifoObsObjects.get(token?.id);
 if(!fifoObsOwner||token?.fifoObserver!==1||entry?.state!=='retired'){if(fifoObsOwner)fifoObsAdd(21);fifoObsFail(12);}
 fifoObsAdd(7);fifoObsTrace(7,0,token.id,entry.slot);fifoObsObjects.delete(token.id);
 return 'tbinstance';
}
function fifoObsTransition(kind,key,route){
 if(!fifoObsOwner)return;
 fifoObsCloseGroup();
 key=Number(key);if(!Number.isSafeInteger(key)||key<=0||key>0xffffffff)fifoObsFail(13);
 fifoObsAdd(({1:8,2:9,3:10,4:11})[kind]);
 let episode=fifoObsEpisodes.get(key);
 if(kind===1){
  if(episode||fifoObsEpisodes.size>=64)fifoObsFail(14);
  episode={id:fifoObsAdd(18),state:1,route,removes:Atomics.load(fifoObsWords,6),installs:Atomics.load(fifoObsWords,5),delivered:Atomics.load(fifoObsWords,7),done:fifoObsDoneValue()};
  fifoObsEpisodes.set(key,episode);Atomics.store(fifoObsWords,38,fifoObsEpisodes.size);
  if(Atomics.load(fifoObsWords,15)===1&&!Atomics.load(fifoObsWords,17)){Atomics.store(fifoObsWords,17,episode.id);Atomics.store(fifoObsWords,47,Atomics.load(fifoObsWords,46));}
 }else if(!episode){fifoObsFail(15);}
 else if(kind===3){if(episode.state!==1)fifoObsFail(16);episode.state=3;}
 else if(kind===2){if(episode.state!==3)fifoObsFail(17);episode.state=2;}
 else if(kind===4){if(episode.state!==2)fifoObsFail(18);episode.state=4;}
 fifoObsTrace(kind,key,episode.id,route);
 if(kind===4){
  fifoObsAdd(19);fifoObsEpisodes.delete(key);Atomics.store(fifoObsWords,38,fifoObsEpisodes.size);
  if(episode.id===Atomics.load(fifoObsWords,17)){
   const removes=Atomics.load(fifoObsWords,6),installs=Atomics.load(fifoObsWords,5),delivered=Atomics.load(fifoObsWords,7),done=fifoObsDoneValue();
   const values=[episode.done,done,episode.delivered,delivered,episode.removes,removes,episode.installs,installs];
   for(let i=0;i<8;i++)Atomics.store(fifoObsWords,23+i,values[i]);
   if(removes!==episode.removes||installs!==episode.installs||episode.done+delivered-episode.delivered!==done)fifoObsAdd(20);
   Atomics.store(fifoObsWords,15,2); // Continue trace through next owner snapshot.
  }
 }
}
function fifoObsNormal(){
 if(!fifoObsOwner)return;
 fifoObsCloseGroup();
 fifoObsAdd(Asyncify.state===Asyncify.State.Normal?35:36);
 // Called by the native owner snapshot before its synchronous TLS copy. No
 // callback/yield can intervene on this same worker before publication.
 const native=fifoObsNativeAddress(),words=new Uint32Array(HEAP8.buffer,native,64);
 const request=Atomics.load(words,2),completed=Atomics.load(words,3);
 if(request>completed&&request!==Atomics.load(fifoObsWords,63)){
  if(Atomics.load(fifoObsWords,15)===2){fifoObsTrace(8,0,request,0);fifoObsAdd(45);Atomics.store(fifoObsWords,48,Atomics.load(fifoObsWords,46));Atomics.store(fifoObsWords,15,3);}
  Atomics.store(fifoObsWords,34,Asyncify.state);
  Atomics.store(fifoObsWords,37,fifoObsDoneValue());
  for(let i=0;i<63;i++)Atomics.store(fifoObsWords,64+i,Atomics.load(fifoObsWords,i));
  Atomics.store(fifoObsWords,127,request);Atomics.store(fifoObsWords,63,request);
 }
}
function fifoObsCloseGroup(){
 const count=Atomics.load(fifoObsWords,42);if(!count)return;
 const installed=Atomics.load(fifoObsWords,43);
 if(count===256){
  if(installed-Atomics.load(fifoObsWords,41)<256){fifoObsAdd(44);fifoObsFail(20);}
  Atomics.store(fifoObsWords,41,installed);fifoObsAdd(39);
 }else if(count===6000)fifoObsAdd(40);
 else fifoObsFail(21);
 Atomics.store(fifoObsWords,42,0);
}
// DEFUSS_FIFO_ASYNC_OBSERVER_END
