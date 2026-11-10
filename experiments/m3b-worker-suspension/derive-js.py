#!/usr/bin/env python3
"""Deterministically derive an observed JS sibling; never edit native build output."""
import argparse,hashlib,json,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent
REPLACEMENTS={
 'pcInitNativeUnwind(wasmExports);wasmExports=Asyncify.instrumentWasmExports(wasmExports)':
 'pcInitNativeUnwind(wasmExports);pcM3sInit(wasmExports);wasmExports=Asyncify.instrumentWasmExports(wasmExports)',
 '__emscripten_thread_init(msgData.pthread_ptr,0,0,1,0,0);PThread.threadInitTLS();':
 '__emscripten_thread_init(msgData.pthread_ptr,0,0,1,0,0);Module.pcM3sWorker=msgData.pthread_ptr;PThread.threadInitTLS();',
 'runAndAbortIfError(()=>_asyncify_start_unwind(Asyncify.currData))':
 'runAndAbortIfError(()=>pcM3sTransition(1,()=>_asyncify_start_unwind(Asyncify.currData)))',
 'runAndAbortIfError(_asyncify_stop_unwind)':
 'runAndAbortIfError(()=>pcM3sTransition(2,_asyncify_stop_unwind))',
 'runAndAbortIfError(()=>_asyncify_start_rewind(Asyncify.currData))':
 'runAndAbortIfError(()=>pcM3sTransition(3,()=>_asyncify_start_rewind(Asyncify.currData)))',
 'runAndAbortIfError(_asyncify_stop_rewind)':
 'runAndAbortIfError(()=>pcM3sTransition(4,_asyncify_stop_rewind))',
}
def derive(text,observer):
 assert 'function pcM3sInit(' not in text
 for old,new in REPLACEMENTS.items():
  assert text.count(old)==1,'Original generated glue anchor '+old
  text=text.replace(old,new)
 anchor='function instantiate_wasm('
 assert text.count(anchor)==1
 return text.replace(anchor,observer+'\n'+anchor)
def ident(p):
 b=p.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def main():
 p=argparse.ArgumentParser();p.add_argument('--runtime',required=True);p.add_argument('--output',required=True);a=p.parse_args();source=ROOT/a.runtime;out=ROOT/a.output;assert source.resolve().is_relative_to(ROOT/'artifacts') and out.resolve().is_relative_to(ROOT/'artifacts') and not out.exists()
 before=ident(source);observer=HERE/'observer.js';derived=derive(source.read_text(),observer.read_text());out.mkdir()
 def write(name,b):
  with (out/name).open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 write(source.name,derived.encode());write('observer.js',observer.read_bytes());write('derive-js.py',Path(__file__).read_bytes())
 assert ident(source)==before
 report={'schema':1,'status':'derived','original':{'path':a.runtime,**before},'derived':{'path':str((out/source.name).relative_to(ROOT)),**ident(out/source.name)},'observer':{'path':str(observer.relative_to(ROOT)),**ident(observer)},'tool':{'path':str(Path(__file__).relative_to(ROOT)),**ident(Path(__file__))},'replacements':REPLACEMENTS,'timingEligible':False,'scope':'Six exact glue anchors plus observer declaration. Original native JS/WASM unchanged; live observer/native validation pending.'}
 write('derivation.json',(json.dumps(report,indent=2)+'\n').encode());print(json.dumps({'status':'derived','replacements':len(REPLACEMENTS)}))
if __name__=='__main__':main()
