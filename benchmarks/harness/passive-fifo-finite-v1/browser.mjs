import {readFifoPerformance} from '../../../experiments/passive-fifo/reader.mjs';
import {startBunApp} from './vm-adapter.mjs';
import {packRecord,unpackRecord,sha256} from '../../../packaging/bun-app/snapshots.mjs';
import {Protocol,prefix,protocol as protocolName,guestProtocol,parameters,names,warmupOrders} from './protocol.mjs';
import {phaseCounters} from '../m1/counters.mjs';
import {captureStoppedCode} from '../code/capture.mjs';

export async function run({manifest,packageURL,route,mode,snapshotMode,captureIdentity,timeoutMs,chunkBytes,samplePeriod=257,captureCode=false,startId}) {
  if(mode!=='baseline'||captureCode||manifest.observation)throw Error('Sustained timing must be uninstrumented');
  if(manifest.benchmark?.protocol!==guestProtocol||manifest.benchmark?.measurementProtocol!==protocolName)throw Error('Sustained package identity missing');
  if(!crossOriginIsolated)throw Error('Cross-origin isolation required');
  if(captureCode&&mode!=='profile-on')throw Error('Code capture requires enabled diagnostics');
  const origin=performance.now(),clock=()=>performance.now()-origin;
  const report={schema:1,protocol:protocolName,status:'running',horizon:{startId},mode,snapshotMode,captureCode,events:[],lifecycle:[],signals:[],results:[],warmups:[],calibration:[],console:'',gateAcks:0,
    clock:{source:'browser performance.now',start:'immediately before K write with guest stopped, followed by QMP cont',
      end:'immediately after parsing result JSON, before validation/pairing/stop',
      includes:'ACK queueing, QMP cont delivery/wakeup, guest work and result framing/serial delivery',
      excludes:'stopped counter reads/reset and start-gate wait; result-gate stop/read/ACK'},
    limits:['Uninstrumented finite-horizon timing includes startup, all20 prelude and32 subsequent batches, ACK gaps and stopped reads; no plateau is claimed.',
      'The stop/read protocol changes scheduling and warm-state behavior; compare only matched protocol controls.',
      'No exclusive CPU-time or kernel-wait decomposition is inferred from counts.'],startup:{}};
  globalThis.__defussM1Report=report;
  const protocol=new Protocol(snapshotMode,captureIdentity);
  let vm,counters,ready=false,closed=false,failed=false,pumping=false,marker=null,signal=null,tail='',timer,finish,reject;
  let phase=null,calibration=null;
  const done=new Promise((ok,bad)=>{finish=ok;reject=bad;});done.catch(()=>{});
  const fail=error=>{if(!failed){failed=true;report.failure=String(error.stack||error);reject(error);}};
  const pump=()=>{
    if(!ready||pumping||closed||failed||!marker||!signal)return;
    pumping=true;
    queueMicrotask(async()=>{
      try{
        const event=marker,pairedSignal=signal;
        event.pairedHostMs=clock();event.signalHostMs=pairedSignal.hostMs;
        event.stopRequestHostMs=clock();await vm.pause();event.stoppedHostMs=clock();
        if(event.event==='initialized')counters=phaseCounters(vm,mode,manifest,samplePeriod);
        if(['warmup-start','start'].includes(event.event)){
          if(phase)throw Error('Overlapping workload phases');
          counters.begin();phase={event};
        }
        if(['warmup-result','result'].includes(event.event)){
          if(!phase||event.name!==phase.event.name||event.sample!==phase.event.sample)throw Error('Mismatched phase boundary');
          const row={name:event.name??'warmup',sample:event.sample??null,iterations:event.iterations??null,
            startSeq:phase.event.seq,endSeq:event.seq,startAckHostMs:phase.event.ackHostMs,resultHostMs:event.hostMs,
            hostMs:event.hostMs-phase.event.ackHostMs,guestMs:event.guestMs??null,
            resultToStopMs:event.stoppedHostMs-event.hostMs,counters:counters.end()};
          if(row.hostMs<0)throw Error('Negative host phase interval');
          row.runtimeStats=vm.stats(); // Stopped observation, outside the timed endpoint.
          if(event.event==='result')report.results.push(row);else report.warmups.push(row);
          if(row.counters){
            row.counters.validForAttribution=!row.counters.profile.saturated&&row.counters.profile.rejectedWorkerObservations===0;
            if(!row.counters.validForAttribution)throw Error('Invalid M1 profile: saturation or unsupported worker observations');
          }
          if(captureCode){
            const captureStarted=clock();
            row.codeCapture=await captureStoppedCode({profile:row.counters.profile,
              registers:await vm.readRegisters(),readPhysical:vm.readPhysical});
            row.codeCapture.startedHostMs=captureStarted;row.codeCapture.completedHostMs=clock();
            row.codeCapture.timing='Stopped after counter collection and the timed result; extra pauses can affect later phases. This is code inspection, not a matched performance observation.';
          }
          phase=null;
        }
        if(event.event==='gate-start')calibration=event;
        if(event.event==='gate-result'){
          if(!calibration||calibration.index!==event.index)throw Error('Mismatched calibration');
          report.calibration.push({index:event.index,hostMs:event.hostMs-calibration.ackHostMs,guestMs:event.guestMs});calibration=null;
        }
        if(['initialized','maps'].includes(event.event)&&await sha256(new TextEncoder().encode(event.maps))!==event.mapsSha256)
          throw Error('Process maps hash mismatch');
        if(event.event==='complete'){protocol.finish();report.fifo=readFifoPerformance(vm.module,manifest.experiment.enabled);}
        event.readCompleteHostMs=clock();
        if(event.event==='complete')report.horizon.t1HostMs=event.readCompleteHostMs;event.stoppedReadMs=event.readCompleteHostMs-event.stoppedHostMs;
        marker=null;signal=null;
        event.ackHostMs=clock();vm.com1.write('K');await vm.resume();event.contReplyHostMs=clock();report.gateAcks++;
        if(event.event==='complete'){protocol.finish();finish();}
      }catch(error){fail(error);}finally{pumping=false;pump();}
    });
  };
  const store={
    async get(){const response=await fetch(route);if(response.status===404)return null;if(!response.ok)throw Error('Snapshot fetch');return unpackRecord(await response.arrayBuffer());},
    async putIfAbsent(_key,record){
      const packed=packRecord(record),digest=await sha256(packed);
      for(let offset=0;offset<packed.length;offset+=chunkBytes){
        const end=Math.min(offset+chunkBytes,packed.length),response=await fetch(route+'/chunk',{method:'POST',headers:{
          'X-Snapshot-Offset':String(offset),'X-Snapshot-Total':String(packed.length),'X-Snapshot-Sha256':digest},body:packed.subarray(offset,end)});
        if(!response.ok||(await response.json()).received!==end)throw Error('Snapshot chunk rejected');
      }
      const response=await fetch(route,{method:'POST'});if(!response.ok||(await response.json())!==true)throw Error('Snapshot durable publication');return true;
    },
    async delete(){throw Error('Invalid snapshot retained; automatic replacement disabled');},
  };
  try{
    timer=setTimeout(()=>fail(Error('M1 guest deadline exceeded')),timeoutMs);
    report.horizon.t0HostMs=clock();
    vm=await startBunApp({manifest,snapshotStore:store,
      runtimeUrl:new URL(packageURL+'/'+manifest.generation+'/runtime/qemu-system-x86_64.js',location.href).href,
      readAsset:async name=>{const response=await fetch(packageURL+'/'+name);if(!response.ok)throw Error(name);return response.arrayBuffer();},
      helperProfiling:mode==='profile-on',timeoutMs,
      onEvent:event=>{event.hostMs=clock();report.lifecycle.push(event);if(event.event==='error')fail(Error(event.reason));},
      onCom1:data=>{try{for(const byte of data){const entry={byte,hostMs:clock()};report.signals.push(entry);
        if(byte===49){if(snapshotMode!=='capture'||report.signals.length!==1)throw Error('Unexpected ready byte');continue;}
        if(byte!==71||signal)throw Error('Unexpected COM1 gate signal');signal=entry;pump();}}catch(error){fail(error);}},
      onConsole:text=>{try{report.console+=text;tail+=text;if(tail.length>4194304)throw Error('Unbounded guest console line');let newline;
        while((newline=tail.indexOf('\n'))>=0){const line=tail.slice(0,newline).replace(/\r$/,'');tail=tail.slice(newline+1);
          if(line.includes('Kernel panic')||line.includes('BUN_APP_FAILURE:'))throw Error(line);
          if(!line.startsWith(prefix))continue;const event=JSON.parse(line.slice(prefix.length));event.hostMs=clock();report.events.push(event);
          const kind=protocol.accept(event);
          if(kind==='gate'){if(marker)throw Error('Overlapping gate markers');marker=event;pump();}
          else report.startup[kind+'HostMs']=event.hostMs;
        }}catch(error){fail(error);}},
    });
    report.ready=await vm.ready;report.startup.readyHostMs=clock();ready=true;pump();
    await done;
    if(report.results.length!==parameters.samples*names.length||report.warmups.length!==warmupOrders.length*names.length||report.gateAcks!==protocol.plan.length)throw Error('Missing phase results/ACKs');
    report.experiment=manifest.experiment;
    report.status='passed';
  }catch(error){report.status='failed';report.failure=String(error.stack||error);}
  finally{
    closed=true;clearTimeout(timer);
    if(vm){
      let paused=false;
      try{await vm.pause();paused=true;}catch(error){report.status='failed';report.cleanupFailure='VM stop not confirmed; diagnostic reset skipped: '+error;}
      if(paused)try{counters?.close();}catch(error){report.status='failed';report.cleanupFailure=String(error);}
      await vm.stop().catch(error=>{report.status='failed';report.cleanupFailure??=String(error);});
    }
  }
  return report;
}
