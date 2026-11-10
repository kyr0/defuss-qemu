import {createAudioBus,audioStats,S} from './pcm.mjs';
export function installAudioUI(el,report){
  let ctx,node,gain,bus,card='off',live=false,stream,source,micRequest=0,pending=false,meter=0,micFailure='';
  const say=t=>el('sound-status').textContent=t;
  const hasInput=()=>card==='ac97'||card==='dual';
  function controls(){
    el('mic-start').disabled=!live||!hasInput()||Boolean(stream)||pending;
    el('mic-stop').disabled=!stream&&!pending;
    el('audio-resume').disabled=!ctx;el('mute').disabled=!ctx;
    el('audio-sink').disabled=!ctx||!ctx.setSinkId;
    el('pick-sink').disabled=!ctx?.setSinkId||!navigator.mediaDevices?.selectAudioOutput;
    el('mic-device').disabled=!live||!hasInput()||pending||Boolean(stream);
  }
  function stopMic(){
    ++micRequest;pending=false;
    if(bus){const s=new Int32Array(bus.stats);if(Atomics.load(s,S.micEpoch)&1)Atomics.add(s,S.micEpoch,1);}
    source?.disconnect();source=null;stream?.getTracks().forEach(t=>t.stop());stream=null;controls();
  }
  async function close(){
    stopMic();clearInterval(meter);el('sound-meter').textContent='';say('Audio off');const old=ctx;ctx=null;node?.disconnect();gain?.disconnect();node=gain=bus=null;
    live=false;card='off';controls();if(old&&old.state!=='closed')await old.close();
  }
  async function devices(){
    if(!navigator.mediaDevices?.enumerateDevices)return;
    const list=await navigator.mediaDevices.enumerateDevices();
    for(const [id,kind] of [['mic-device','audioinput'],['audio-sink','audiooutput']]){
      const select=el(id),before=select.value;
      select.replaceChildren(new Option('System default',''));
      for(const d of list.filter(x=>x.kind===kind&&x.deviceId&&x.deviceId!=='default'))
        select.add(new Option(d.label||kind+' '+select.length,d.deviceId));
      select.value=[...select.options].some(o=>o.value===before)?before:'';
    }
  }
  el('audio-devices').onclick=()=>devices().catch(report);
  el('audio-sink').onchange=async()=>{try{await ctx.setSinkId(el('audio-sink').value);}
    catch(e){el('audio-sink').value=ctx.sinkId||'';report(e);}};
  el('pick-sink').onclick=async()=>{try{
    const selected=await navigator.mediaDevices.selectAudioOutput();await ctx.setSinkId(selected.deviceId);
    await devices();el('audio-sink').value=selected.deviceId;
  }catch(e){report(e);}};
  el('audio-resume').onclick=()=>ctx?.resume().catch(report);
  el('mute').onchange=()=>{if(gain)gain.gain.value=el('mute').checked?0:1;};
  el('mic-stop').onclick=()=>{stopMic();say('Microphone off');};
  el('mic-start').onclick=async()=>{
    if(!live||!hasInput()||pending||stream)return;
    const token=++micRequest;pending=true;controls();let media;
    try{
      const id=el('mic-device').value;
      media=await navigator.mediaDevices.getUserMedia({video:false,audio:{
        ...(id?{deviceId:{exact:id}}:{}),echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      if(token!==micRequest){media.getTracks().forEach(t=>t.stop());return;}
      source=ctx.createMediaStreamSource(media);source.connect(node);stream=media;
      const s=new Int32Array(bus.stats);Atomics.add(s,S.micEpoch,1);
      stream.getAudioTracks()[0].addEventListener('ended',()=>{if(stream===media){stopMic();say('Microphone disconnected');}});
      if(micFailure&&el('error').textContent===micFailure)el('error').textContent='';micFailure='';
      say('Microphone enabled for guest recording');void devices().catch(report);
    }catch(e){
      if(token===micRequest){stopMic();media?.getTracks().forEach(t=>t.stop());micFailure=String(e);report(e);say('Microphone unavailable');}
    }finally{if(token===micRequest)pending=false;controls();}
  };
  controls();window.addEventListener('pagehide',()=>{void close().catch(()=>{});});
  return {
    async prepare(kind,target){
      if(kind==='off')return null;
      if(!globalThis.crossOriginIsolated||typeof AudioContext!=='function')throw Error('Audio requires Web Audio and a cross-origin-isolated local server');
      card=kind;
      try{
        ctx=new AudioContext({latencyHint:'interactive'});
        // Start the resume in the boot click itself; a suspended context can be resumed later.
        void ctx.resume().catch(report);
        bus=createAudioBus(ctx.sampleRate,target);
        await ctx.audioWorklet.addModule(new URL('./worklet.mjs',import.meta.url));
        node=new AudioWorkletNode(ctx,'win9x-audio',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:bus});
        node.onprocessorerror=()=>{live=false;stopMic();report(Error('AudioWorklet failed'));say('Audio processor stopped');};
        gain=ctx.createGain();gain.gain.value=el('mute').checked?0:1;node.connect(gain).connect(ctx.destination);
        const synchronize=()=>{
          if(!ctx||!bus)return;
          const s=new Int32Array(bus.stats),on=ctx.state==='running'?1:0;
          if((Atomics.load(s,S.playEpoch)&1)!==on)Atomics.add(s,S.playEpoch,1);
          say('Audio '+ctx.state+' · '+ctx.sampleRate+' Hz');
        };
        ctx.onstatechange=synchronize;synchronize();
        controls();meter=setInterval(()=>{
          if(document.hidden||!bus)return;
          const a=audioStats(bus),ms=Math.round(1000*a.playDepth/a.sampleRate);
          el('sound-meter').textContent='Playback queue '+ms+' ms · '+a.playXruns+' underruns · '+a.playDrop+' dropped frames'+
            (hasInput()?' · capture '+a.micXruns+' underruns / '+a.micDrop+' dropped frames':'');
        },1000);return bus;
      }catch(e){await close();throw e;}
    },
    running(){live=true;controls();if(ctx)say('Audio '+ctx.state+' · '+ctx.sampleRate+' Hz · '+card);},
    close, stats(){return bus?{card,...audioStats(bus),contextState:ctx.state,
      baseLatencyMs:Number.isFinite(ctx.baseLatency)?Math.round(ctx.baseLatency*1000):null,outputLatencyMs:Number.isFinite(ctx.outputLatency)?Math.round(ctx.outputLatency*1000):null}:null;}
  };
}
