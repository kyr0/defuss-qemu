// Input can wake a backed-off display poll without bypassing the active FPS
// limit or repeatedly replacing an earlier timer. Input dispatch is separate.
export class FrameScheduler {
  constructor(draw,{now=()=>performance.now(),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
    this.draw=draw;this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;
    this.timer=null;this.deadline=Infinity;this.lastStart=-Infinity;this.yieldUntil=-Infinity;this.drawing=false;
  }
  cancel(){
    if(this.timer!==null)this.clearTimer(this.timer);
    this.timer=null;this.deadline=Infinity;
  }
  schedule(delay,period){
    if(this.drawing)return;
    const now=this.now(),earliest=Math.max(this.lastStart+period,this.yieldUntil);
    const deadline=Math.max(now+delay,earliest);
    // Keep an earlier valid request, but honor a newly lowered FPS limit.
    if(this.timer!==null&&this.deadline<=deadline&&this.deadline>=earliest)return;
    this.cancel();this.deadline=deadline;this.arm();
  }
  arm(){
    this.timer=this.setTimer(()=>{
      this.timer=null;
      // Browser timer delays may be rounded down; preserve fractional periods.
      if(this.now()<this.deadline){this.arm();return;}
      this.deadline=Infinity;this.draw();
    },Math.ceil(Math.max(0,this.deadline-this.now())));
  }
  begin(){
    if(this.drawing)return false;
    this.cancel();this.drawing=true;this.lastStart=this.now();return true;
  }
  end(){this.drawing=false;this.yieldUntil=this.now()+8;}
}
