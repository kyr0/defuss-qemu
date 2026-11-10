import {RingBuffer} from './ringbuf.mjs';
export const S={micEpoch:0,clock:1,demandUntil:2,playIn:3,playOut:4,playUnder:5,playDrop:6,
  micIn:7,guestIn:8,micUnder:9,micDrop:10,playDepth:11,micDepth:12,playPpm:13,micPpm:14,
  graph:15,playPeak:16,micPeak:17,playSource:18,guestRequest:19,playWarm:20,micWarm:21,playXruns:22,micXruns:23,instanceSeq:24,playOwner:25,micOwner:26,ownerConflicts:27,playEpoch:28,playSuspended:29};
export const quantum=256;
export function createAudioBus(rate,ms=30){
  if(!Number.isInteger(rate)||rate<8000||rate>192000||![20,30,40].includes(ms))throw Error('Unsupported audio rate or latency target');
  const target=Math.ceil(rate*ms/1000),capacity=target*4;
  const stats=new SharedArrayBuffer(Object.keys(S).length*4);Atomics.store(new Int32Array(stats),S.playEpoch,1);
  return {rate,target,play:RingBuffer.getStorageForCapacity(capacity*2,Int16Array),
    mic:RingBuffer.getStorageForCapacity(capacity*2,Int16Array),stats};
}
export const ring=sab=>new RingBuffer(sab,Int16Array);
export function audioStats(bus){
  if(!bus)return null;const a=new Int32Array(bus.stats),out={sampleRate:bus.rate,targetFrames:bus.target};
  for(const [k,i] of Object.entries(S))if(!['micEpoch','clock','demandUntil','instanceSeq','playOwner','micOwner','playEpoch'].includes(k)){
    const v=Atomics.load(a,i);out[k]=k.endsWith('Ppm')?v:v>>>0;
  }
  return out;
}
// The consumer owns every pop, including latency recovery. Piecewise-linear
// resampling corrects small clock drift; gross overruns discard old frames.
export class ElasticReader {
  constructor(queue,target,stats,direction){
    this.q=queue;this.target=target;this.stats=stats;this.play=direction==='play';
    this.buf=new Int16Array((quantum+4)*2);this.out=new Int16Array(quantum*2);
    this.reset();
  }
  reset(){this.saved=0;this.phase=0;this.ready=false;this.ppm=0;}
  discard(n){
    let left=Math.min(n,this.q.availableRead()>>>1);
    const discarded=left;
    while(left){const frames=Math.min(left,quantum);this.q.pop(this.buf,frames*2);left-=frames;}
    this.reset();return discarded;
  }
  read(n){
    const q=this.q,s=this.stats,target=this.target;
    let depth=q.availableRead()>>>1;
    if(depth>target*2.5){
      const lost=this.discard(depth-target);
      Atomics.add(s,this.play?S.playDrop:S.micDrop,lost);depth-=lost;
    }
    Atomics.store(s,this.play?S.playDepth:S.micDepth,depth);
    if(!this.ready && depth<target){this.out.fill(0,0,n*2);Atomics.add(s,this.play?S.playWarm:S.micWarm,n);return 0;}
    this.ready=true;
    // A full queue speeds consumption up to 0.5%. Smooth away quantum jitter.
    const desired=Math.max(-5000,Math.min(5000,(depth-target)*1500/target));
    this.ppm+=(desired-this.ppm)*0.02;
    Atomics.store(s,this.play?S.playPpm:S.micPpm,Math.round(this.ppm));
    const step=1+this.ppm/1e6,needed=Math.floor(this.phase+(n-1)*step)+2;
    const count=this.saved+(q.pop(this.buf,2*(needed-this.saved),2*this.saved)>>>1);
    let phase=this.phase,i=0;
    for(;i<n;i++){
      const j=Math.floor(phase);if(j+1>=count)break;
      const f=phase-j,k=2*j;
      this.out[2*i]=this.buf[k]+(this.buf[k+2]-this.buf[k])*f;
      this.out[2*i+1]=this.buf[k+1]+(this.buf[k+3]-this.buf[k+1])*f;
      phase+=step;
    }
    if(i<n){
      this.out.fill(0,i*2,n*2);Atomics.add(s,this.play?S.playUnder:S.micUnder,n-i);
      Atomics.add(s,this.play?S.playXruns:S.micXruns,1);this.reset();
    }else{
      const used=Math.floor(phase);this.phase=phase-used;this.saved=count-used;
      for(let j=0;j<2*this.saved;j++)this.buf[j]=this.buf[2*used+j];
    }
    return i;
  }
}
