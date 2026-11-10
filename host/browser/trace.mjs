import {HotspotReader} from './hotspots.mjs';
import {resolveRuntimeSettings,runtimeFlags} from './runtime-settings.mjs';
import {readNativeGraphicsStats} from './graphics.mjs';
import {readMemoryStats} from './memory-diagnostics.mjs';
// Numeric counters only. Keep media data, guest text, key codes and filenames
// outside the trace. Device names are QEMU's guest hardware identifiers.
const fields = ['rd_bytes','wr_bytes','rd_operations','wr_operations','flush_operations',
  'rd_total_time_ns','wr_total_time_ns','flush_total_time_ns','failed_rd_operations','failed_wr_operations'];
export function blockCounters(devices) {
  return Object.fromEntries(devices.filter(d=>d.device).map(d=>[d.device,
    Object.fromEntries(fields.filter(f=>Number.isFinite(d.stats?.[f])).map(f=>[f,d.stats[f]]))]));
}

const stages = ['translateUs','translateCalls','emitUs','emitCalls','interpretUs','interpretCalls',
  'helperUs','helperCalls','emittedBytes','emittedGuestInstructions'];
export function tcgMonitor(mod,{helperBus=null,compatibility='default',runtimeSettings=resolveRuntimeSettings({compatibility})}={}) {
  let profile, times, jit, hotspots;
  let owned = false;
  let lightTargets=[],lightCleanupFailed=false;
  const disableLight=()=>{
    const failed=[];let error;
    for(const target of lightTargets){try{if(target.owned)target.abi.enable(0);}catch(e){failed.push(target);error??=e;}}
    lightTargets=failed;lightCleanupFailed=Boolean(error);if(error)throw error;
  };
  return {
    enableLight(){
      if(lightCleanupFailed)disableLight();
      if(!lightTargets.length){
        const candidates=[['graphics',mod.pcGraphicsABI?.(),readNativeGraphicsStats],['memory',mod.pcMemoryABI?.(),readMemoryStats]];
        try{
          for(const [name,abi,read] of candidates){
            const status=read(abi);if(!status.supported||status.readError)continue;
            const owned=!status.enabled;
            if(owned&&name==='memory'&&status.version===2){
              if(abi.sampling(256)!==1||abi.samplePeriod()!==256)throw Error('Cannot configure MMU diagnostic sampling');
            }
            lightTargets.push({name,abi,owned});if(owned)abi.enable(1);
          }
        }catch(error){try{disableLight();}catch{/* stop() retries all failed disables. */}throw error;}
      }
      return {graphics:lightTargets.some(t=>t.name==='graphics'),memory:lightTargets.some(t=>t.name==='memory')};
    },
    disableLight,
    enable() {
      if(owned)throw Error('TCG profiler already active');
      profile = Number(mod._defuss_profile(-1)) / 4;
      times = Number(mod._defuss_stage_stats(0)) / 4;
      jit=Number(mod._defuss_jit_time())/4;
      hotspots=new HotspotReader(mod,helperBus);
      const words = mod.pcProfileWords();
      if (Atomics.compareExchange(words,profile,0,1) !== 0) throw Error('TCG profiler already active');
      owned = true;
      mod._defuss46_settings(runtimeFlags(runtimeSettings,true));
      if(helperBus)Atomics.store(new Uint32Array(helperBus.buffer),0,1);
    },
    disable() {
      if (owned) {Atomics.store(mod.pcProfileWords(),profile,0);mod._defuss46_settings(runtimeFlags(runtimeSettings));
        if(helperBus)Atomics.store(new Uint32Array(helperBus.buffer),0,0);}
      owned = false;
    },
    read() {
      const graphicsABI=mod.pcGraphicsABI?.(),memoryABI=mod.pcMemoryABI?.();
      const values = {runtimeSettings,nativeUnwind:mod.pcUnwindStatus?.()??null,screenshotBatchingSupported:Boolean(mod.pcDisplayBatching?.()),screenshotSIMDSupported:Boolean(mod.pcDisplaySIMD?.()),rep32BatchingSupported:Boolean(mod.pcRep32Batching?.()),tciBatchMax:mod.pcTciBatchMax?.()??0,tbCacheFlushes:mod._defuss_cache_counter(0)>>>0,
        tbInvalidations:mod._defuss_cache_counter(1)>>>0,cirrusBulkCapabilities:graphicsABI?.bulk?.()??null,cirrusWideCapabilities:graphicsABI?.wide?.()??null,
        graphicsNative:readNativeGraphicsStats(graphicsABI),memory:readMemoryStats(memoryABI),
        graphics:mod.pcGraphicsStats?.()??null,...(mod.pcJitPool?{jitPool:mod.pcJitPool()}: {})};
      if (owned) {
        const words = mod.pcProfileWords();
        for (const [i,k] of stages.entries()) values[k]=Atomics.load(words,times+i);
        for (const [i,k] of ['sampledCompiled','sampledInterpreted','wasmInstalls'].entries())
          values[k]=Atomics.load(words,profile+i+1);
        values.jitCompileUs=Atomics.load(words,jit);values.jitInstantiateUs=Atomics.load(words,jit+1);
        for(const [i,k] of ['admissionChecks','heldInterpreted','heldInterpretUs','budgetInterpreted','budgetInterpretUs','repBatches','repElements'].entries())values[k]=mod._defuss46_stat(i)>>>0;
        values.hotspots=hotspots.read();
      }
      return values;
    }
  };
}

const limit = 900;
const round = n=>Math.round(n*100)/100;
function distribution(a) {
  if (!a.length) return null;
  a.sort((x,y)=>x-y);
  return {n:a.length,mean:round(a.reduce((x,y)=>x+y,0)/a.length),
    p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)};
}
function windowData() {
  return {captureMs:[],decodeMs:[],paintMs:[],captureIntervalMs:[],inputAckMs:[],
    changedFrames:0,dirtyRows:0,captures:0,inputBatches:0,inputOffered:0,motionMerged:0,inputDepthMax:0,inputQueueMs:[],inputLatestAgeMs:[],omittedTimings:0,
    longTasks:0,longTaskMs:0};
}
function observe(a,n,w) {
  if(a.length<256)a.push(round(n));else w.omittedTimings++;
}
function finish(w) {
  const out={...w};
  for(const [k,v] of Object.entries(w))if(Array.isArray(v))out[k]=distribution(v);
  return out;
}

// At most one QMP statistics request in flight. A stopped trace waits for it,
// samples the final boundary, then releases any opt-in profiler it enabled.
export class Recorder {
  constructor(pc, context) {
    this.pc=pc; this.context=context; this.running=false; this.bootLog=[]; this.phase=pc?'running':'page-ready';
    this.phaseChange(this.phase);
  }
  phaseChange(phase,category) {
    this.phase=phase;
    if(this.bootLog.length===64)this.bootLog.shift();
    this.bootLog.push({phase,pageMs:round(performance.now()),...(category?{category}:{})});
  }
  attach(pc,metadata) {
    this.pc=pc; this.metadata={...metadata};
    if(this.running){this.header.metadata=this.metadata;this.activateLight();}
    if(this.running&&this.header.deepRequested&&this.deepPC!==pc)this.deepReady=this.enableDeep();
    this.phaseChange('running');
  }
  updateMetadata(extra){
    this.metadata={...this.metadata,...extra};if(this.header)this.header.metadata=this.metadata;
  }
  async enableDeep(){
    const pc=this.pc;this.deepPC=pc;
    try{await pc.tcg.enable();this.header.deepTcg=true;}
    catch{this.header.deepTcg=false;this.header.deepUnavailable=true;}
  }
  activateLight(){
    const pc=this.pc;
    if(!pc?.tcg.enableLight||this.lightTargets.has(pc))return;
    this.lightTargets.add(pc);
    this.lightReady=this.lightReady.then(async()=>{
      try{this.header.lightDiagnostics=await pc.tcg.enableLight();}
      catch{this.header.lightDiagnosticsError=true;}
    });
  }
  async releaseProfilers(){
    let error;
    for(const pc of this.lightTargets){
      try{await pc.tcg.disableLight?.();}catch(e){this.header.lightDiagnosticsStopError=true;error??=e;}
    }
    try{await this.pc?.tcg.disable();}catch(e){error??=e;}
    this.cleanupPending=Boolean(error);if(error)throw error;
  }
  start(metadata,deep=false) {
    if(this.running||this.stopping)throw Error('Trace already running');
    this.metadata={...metadata};
    this.running=true;
    this.cleanupPending=false;
    this.started=performance.now(); this.lastFrame=null; this.previousDue=this.started;
    this.win=windowData(); this.samples=[];
    this.header={schema:'qemu-win9x-trace/1',release:'0.6.8',startedUtc:new Date().toISOString(),
      sampleTargetMs:1000,windowLimit:limit,deepRequested:deep,deepTcg:false,metadata:this.metadata,pageStartMs:round(this.started),droppedWindows:0};
    this.lightTargets=new Set();this.lightReady=Promise.resolve();this.activateLight();
    this.deepPC=null;this.deepReady=deep&&this.pc?this.enableDeep():null;
    this.observer=null;
    if(globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
      try {this.observer=new PerformanceObserver(list=>this.longTasks(list.getEntries()));
        this.observer.observe({type:'longtask'});} catch {this.observer=null;}
    }
    this.header.longTasksSupported=Boolean(this.observer);
    this.pending=this.tick();
  }
  longTasks(entries) {
    for(const e of entries){this.win.longTasks++;this.win.longTaskMs+=round(e.duration);}
  }
  frame(f,paintMs,at=performance.now()) {
    if(!this.running)return;
    const w=this.win;
    if(this.lastFrame!==null)observe(w.captureIntervalMs,at-this.lastFrame,w);
    this.lastFrame=at;w.captures++;
    observe(w.captureMs,f.captureMs,w);observe(w.decodeMs,f.decodeMs,w);observe(w.paintMs,paintMs,w);
    if(f.dirtyH){w.changedFrames++;w.dirtyRows+=f.dirtyH;}
  }
  inputArrival({merged,depth}){
    this.win.inputOffered++;if(merged)this.win.motionMerged++;
    this.win.inputDepthMax=Math.max(this.win.inputDepthMax,depth);
  }
  input(ms,queued,age) {
    if(this.running){this.win.inputBatches++;observe(this.win.inputAckMs,ms,this.win);
      if(queued!==undefined)observe(this.win.inputQueueMs,queued,this.win);
      if(age!==undefined)observe(this.win.inputLatestAgeMs,age,this.win);}
  }
  async snapshot(final=false) {
    const t=performance.now(),row={tMs:round(t-this.started),...this.context(),...finish(this.win),
      sampleLateMs:final?null:round(Math.max(0,t-this.previousDue)),phase:this.phase,tcg:null};
    this.win=windowData();
    row.block=null;row.blockReadMs=0;
    if(this.pc){
      try {await this.lightReady;await this.deepReady;row.tcg=await this.pc.tcg.read();if(row.tcg.hotspots){this.header.cpuHotspots=row.tcg.hotspots;delete row.tcg.hotspots;}}catch {row.tcgError=true;}
      const blockStart=performance.now();
      try {row.block=await this.pc.blockStats();}catch {row.blockError=true;}
      row.blockReadMs=round(performance.now()-blockStart);
      if(this.pc.storageStats){
        const storageStart=performance.now();
        try {row.storage=await this.pc.storageStats();}catch {row.storageError=true;}
        row.storageReadMs=round(performance.now()-storageStart);
      }
    }
    if(this.samples.length===limit){this.samples.shift();this.header.droppedWindows++;}
    this.samples.push(row);
  }
  async tick() {
    await this.snapshot();
    if(!this.running)return;
    this.previousDue=performance.now()+1000;
    this.timer=setTimeout(()=>{this.pending=this.tick();},1000);
  }
  async stop() {
    if(!this.running){
      if(this.stopping)return this.stopping;
      if(!this.cleanupPending)return;
      this.stopping=this.releaseProfilers();
      try{await this.stopping;}finally{this.stopping=null;}
      return;
    }
    this.running=false; clearTimeout(this.timer);
    this.stopping=(async()=>{
      try {
        if(this.observer){this.longTasks(this.observer.takeRecords());this.observer.disconnect();}
        await this.pending;await this.snapshot(true);
      }finally{
        try{await this.lightReady;await this.releaseProfilers();}
        finally{this.header.durationMs=round(performance.now()-this.started);}
      }
    })();
    try {await this.stopping;} finally {this.stopping=null;}
  }
  export() {
    const boot=[...this.bootLog];
    if(!this.header)return {schema:'qemu-win9x-trace/1',release:'0.6.8',state:'idle',
      phase:this.phase,boot,metadata:this.metadata??{},durationMs:0,samples:[]};
    return {...this.header,boot,phase:this.phase,durationMs:this.header.durationMs??round(performance.now()-this.started),
      state:this.running?'recording':this.stopping?'stopping':'stopped',samples:[...this.samples]};
  }
}
