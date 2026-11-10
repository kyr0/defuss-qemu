#!/usr/bin/env python3
"""Expose atomic profiling and opt-in browser audio/helper bridges."""
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text()
def replace(old,new,also=()):
    global s
    if new in s or any(marker in s for marker in also):return
    if s.count(old)!=1:raise SystemExit('Unexpected Emscripten ABI: '+old[:90])
    s=s.replace(old,new)
def upsert_getter(name,new,legacy=()):
    global s
    marker=f'Module["{name}"]='
    count=s.count(marker)
    if count>1:raise SystemExit('Ambiguous '+name+' assignments')
    if count:
        known=next((value for value in (new,*legacy) if value in s),None)
        if known is None:raise SystemExit('Unknown '+name+' assignment')
        s=s.replace(known,new)
    else:
        if s.count(after)!=1:raise SystemExit('Unexpected '+name+' insertion anchor')
        s=s.replace(after,after+new)
    if s.count(marker)!=1 or s.count(new)!=1:raise SystemExit('Invalid '+name+' replacement')
before='function updateMemoryViews(){var b=wasmMemory.buffer;'
after=before+'Module["pcProfileWords"]=()=>HEAPU32;'
replace(before,after)
audio='Module["pcAudioABI"]=()=>({slot:wasmExports.defuss_audio_slot,get:getWasmTableEntry,set:setWasmTableEntry,pcm:()=>HEAP16});'
if audio not in s:s=s.replace(after,after+audio)
# main() is proxied into a pthread. The buses must reach every instance.
replace('{cmd:"load",handlers,wasmMemory,wasmModule}',
        '{cmd:"load",handlers,wasmMemory,wasmModule,pcAudioBus:Module.pcAudioBus}',
        ('pcAudioBus:Module.pcAudioBus,pcHelperBus:Module.pcHelperBus}', 'pcAudioBus:Module.pcAudioBus,pcHelperBus:Module.pcHelperBus,pcGraphicsBus:Module.pcGraphicsBus}'))
replace('startWorker=()=>{postMessage({cmd:"loaded"})',
        'startWorker=async()=>{if(msgData.pcAudioBus){const a=await import("../audio/backend.mjs");a.connectGuestPCM(Module,msgData.pcAudioBus);}postMessage({cmd:"loaded"})',
        ('startWorker=async()=>{Module.pcHelperBus=msgData.pcHelperBus;if(msgData.pcAudioBus)', 'startWorker=async()=>{Module.pcGraphicsBus=msgData.pcGraphicsBus;'))
helper_source=Path(__file__).with_name('helper-profile-runtime.js').read_text()
unwind_source=Path(__file__).with_name('native-unwind-runtime.js').read_text()
if 'function pcInitNativeUnwind(' not in s:
    replace('function instantiate_wasm(',unwind_source+'\nfunction instantiate_wasm(')
replace('wasmExports=instance.exports;wasmExports=Asyncify.instrumentWasmExports(wasmExports)',
        'wasmExports=instance.exports;pcInitNativeUnwind(wasmExports);wasmExports=Asyncify.instrumentWasmExports(wasmExports)')
replace('helper.u=()=>Asyncify.state!=Asyncify.State.Unwinding?1:0;',
        'helper.u=Module.pcNativeUnwindCheck||(()=>Asyncify.state!=Asyncify.State.Unwinding?1:0);')
begin='// PC_HELPER_RUNTIME_BEGIN'
end='// PC_HELPER_RUNTIME_END'
if begin in s:
    if s.count(begin)!=1 or s.count(end)!=1:raise SystemExit('Ambiguous helper runtime markers')
    a=s.index(begin);b=s.index(end,a)+len(end)
    s=s[:a]+helper_source.rstrip()+s[b:]
elif 'var pcHelperWrappers;' in s:
    old_end='  pcHelperWrappers.set(slot,wrapped);return wrapped;\n}'
    if s.count('var pcHelperWrappers;')!=1 or s.count(old_end)!=1:raise SystemExit('Unexpected legacy helper runtime')
    a=s.index('var pcHelperWrappers;');b=s.index(old_end,a)+len(old_end)
    s=s[:a]+helper_source.rstrip()+s[b:]
elif 'function pcProfileHelper(' not in s:
    replace('function instantiate_wasm(',helper_source+'\nfunction instantiate_wasm(')
else:raise SystemExit('Unknown helper runtime; refuse to leave stale instrumentation')
replace('var helper={};helper.u=', 'var helper={};const pcSignatures=pcHelperSignatures(wasm);helper.u=')
old_helper='helper[i]=pcProfileHelper(wasmTable.get(idx),Number(idx))'
new_helper='helper[i]=pcProfileHelper(wasmTable.get(idx),Number(idx),pcSignatures?.[i])'
replace(old_helper if old_helper in s else 'helper[i]=wasmTable.get(idx)',new_helper)
replace('pcAudioBus:Module.pcAudioBus}', 'pcAudioBus:Module.pcAudioBus,pcHelperBus:Module.pcHelperBus}',
        ('pcAudioBus:Module.pcAudioBus,pcHelperBus:Module.pcHelperBus,pcGraphicsBus:Module.pcGraphicsBus}',))
replace('startWorker=async()=>{if(msgData.pcAudioBus)',
        'startWorker=async()=>{Module.pcHelperBus=msgData.pcHelperBus;if(msgData.pcAudioBus)',
        ('startWorker=async()=>{Module.pcGraphicsBus=msgData.pcGraphicsBus;',))
replace('inst_gc_registry.register(inst,"tbinstance")','inst_gc_registry.register(inst.exports.start,"tbinstance")')
pool='Module["pcJitPool"]=()=>({charged:wasmExports.defuss62_pool(0),limit:wasmExports.defuss62_pool(1),linearMemoryBytes:wasmMemory.buffer.byteLength});'
if pool not in s:s=s.replace(after,after+pool)
batch='Module["pcTciBatchMax"]=()=>wasmExports.defuss63_fast?32:0;'
if batch not in s:s=s.replace(after,after+batch)
rep='Module["pcRep32Batching"]=()=>wasmExports.defuss64_rep32?.()===1;'
if rep not in s:s=s.replace(after,after+rep)
display='Module["pcDisplayBatching"]=()=>wasmExports.defuss65_display?.()===1;'
if display not in s:s=s.replace(after,after+display)
simd='Module["pcDisplaySIMD"]=()=>wasmExports.defuss66_display_simd?.()===1;'
if simd not in s:s=s.replace(after,after+simd)

graphics_v67='Module["pcGraphicsABI"]=()=>({slot:wasmExports.defuss67_graphics_slot,get:getWasmTableEntry,set:setWasmTableEntry,bulk:()=>wasmExports.defuss67_cirrus_bulk?.()??0});'
graphics='Module["pcGraphicsABI"]=()=>({slot:wasmExports.defuss67_graphics_slot,get:getWasmTableEntry,set:setWasmTableEntry,bulk:wasmExports.defuss67_cirrus_bulk,version:wasmExports.defuss68_graphics_version,enable:wasmExports.defuss68_graphics_enable,enabled:wasmExports.defuss68_graphics_enabled,stat:wasmExports.defuss68_graphics_stat,wide:wasmExports.defuss68_cirrus_wide});'
upsert_getter('pcGraphicsABI',graphics,(graphics_v67,))
memory_v1='Module["pcMemoryABI"]=()=>({version:wasmExports.defuss68_memory_abi,count:wasmExports.defuss68_memory_count,enable:wasmExports.defuss68_memory_enable,enabled:wasmExports.defuss68_memory_enabled,stat:wasmExports.defuss68_memory_stat});'
memory='Module["pcMemoryABI"]=()=>({version:wasmExports.defuss68_memory_abi,count:wasmExports.defuss68_memory_count,enable:wasmExports.defuss68_memory_enable,enabled:wasmExports.defuss68_memory_enabled,stat:wasmExports.defuss68_memory_stat,samplePeriod:wasmExports.defuss68_memory_sample_period,sampling:wasmExports.defuss68_memory_set_sample_period});'
upsert_getter('pcMemoryABI',memory,(memory_v1,))
replace('pcAudioBus:Module.pcAudioBus,pcHelperBus:Module.pcHelperBus}',
        'pcAudioBus:Module.pcAudioBus,pcHelperBus:Module.pcHelperBus,pcGraphicsBus:Module.pcGraphicsBus}')
replace('startWorker=async()=>{Module.pcHelperBus=',
        'startWorker=async()=>{Module.pcGraphicsBus=msgData.pcGraphicsBus;if(msgData.pcGraphicsBus){const g=await import("../graphics.mjs");g.connectGraphicsCounters(Module,msgData.pcGraphicsBus);}Module.pcHelperBus=')
p.write_text(s)
