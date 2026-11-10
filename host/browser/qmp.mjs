// Extracted unchanged from the validated QMP transport in win9x.mjs.
import {serialInput} from './machine.mjs';
const utf8 = new TextEncoder();
export class Qmp {
  constructor(){this.input=serialInput();this.inflight=new Map();this.next=0;this.tail='';this.decoder=new TextDecoder();
    this.greeting=new Promise(resolve=>{this.greet=resolve;});}
  accept(bytes){
    this.tail+=this.decoder.decode(new Uint8Array(bytes),{stream:true});let pos;
    while((pos=this.tail.indexOf('\n'))>=0){
      const line=this.tail.slice(0,pos).trim();this.tail=this.tail.slice(pos+1);
      if(!line||!line.startsWith('{'))continue;
      const msg=JSON.parse(line);
      if(msg.QMP)this.greet(msg);
      const req=this.inflight.get(msg.id);
      if(req){clearTimeout(req.timeout);this.inflight.delete(msg.id);
        if(msg.error)req.reject(Error(msg.error.class+': '+msg.error.desc));else req.resolve(msg.return);}
    }
  }
  send(execute,args){
    const id=++this.next;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.inflight.delete(id);reject(Error('QMP timeout: '+execute));},30000);
      this.inflight.set(id,{resolve,reject,timeout});
      this.input.push(utf8.encode(JSON.stringify({execute,arguments:args,id})+'\n'));
    });
  }
}
