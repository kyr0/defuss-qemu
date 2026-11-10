import {ElasticReader,S,ring,quantum} from './pcm.mjs';
class GuestAudio extends AudioWorkletProcessor {
  constructor(options){
    super();const bus=options.processorOptions;
    this.s=new Int32Array(bus.stats);this.play=new ElasticReader(ring(bus.play),bus.target,this.s,'play');
    this.mic=ring(bus.mic);this.input=new Int16Array(quantum*2);this.clock=0;this.epoch=Atomics.load(this.s,S.playEpoch);
  }
  process(inputs,outputs){
    const left=outputs[0]?.[0],right=outputs[0]?.[1];if(!left||!right)return true;
    const s=this.s,m0=inputs[0]?.[0],m1=inputs[0]?.[1]||m0;
    const epoch=Atomics.load(s,S.playEpoch);
    if(this.epoch!==epoch){this.play.discard(this.play.q.availableRead()>>>1);this.epoch=epoch;}
    let peak=0,micPeak=0;const capturing=(Atomics.load(s,S.micEpoch)&1)&&m0&&
      ((Atomics.load(s,S.demandUntil)-this.clock)|0)>0;
    for(let off=0;off<left.length;off+=quantum){
      const n=Math.min(quantum,left.length-off),got=this.play.read(n);
      Atomics.add(s,S.playOut,got);
      for(let i=0;i<n;i++){
        const a=this.play.out[i*2],b=this.play.out[i*2+1];
        left[off+i]=a/32768;right[off+i]=b/32768;peak=Math.max(peak,Math.abs(a),Math.abs(b));
        if(capturing){
          const x=Math.max(-32768,Math.min(32767,Math.round(m0[off+i]*32768)));
          const y=Math.max(-32768,Math.min(32767,Math.round(m1[off+i]*32768)));
          this.input[2*i]=x;this.input[2*i+1]=y;micPeak=Math.max(micPeak,Math.abs(x),Math.abs(y));
        }
      }
      if(capturing){
        const written=this.mic.push(this.input,n*2)>>>1;
        Atomics.add(s,S.micIn,written);Atomics.add(s,S.micDrop,n-written);
      }
    }
    if(peak>Atomics.load(s,S.playPeak))Atomics.store(s,S.playPeak,peak);
    if(micPeak>Atomics.load(s,S.micPeak))Atomics.store(s,S.micPeak,micPeak);
    this.clock=(this.clock+left.length)|0;Atomics.store(s,S.clock,this.clock);
    Atomics.add(s,S.graph,left.length);return true;
  }
}
registerProcessor('win9x-audio',GuestAudio);
