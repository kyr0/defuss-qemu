#!/usr/bin/env python3
"""Prepare a fresh passive-FIFO experiment source tree; never modify engine/."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
EXPECTED={
 'tcg/wasm64.c':'5e29482b963cb949ca2cb322dd850fe1d4fcf1df181384ddd4da086b4c62cf05',
 'tcg/wasm64.h':'5992820ddbdd57d6f6483922cd53f21846a77dff5c91014cb61ab1adf6541583',
 'accel/tcg/translate-all.c':'d2f006f95a64916df20b605fa1ca05de516776b59073e3ed215d76a23b7305fa',
 'accel/tcg/wasm-plan.inc':'2a967cc6cffc5b50168d845e8f3b048659513f125ce2c5a561758747473224f9',
 'accel/tcg/wasm-aot.inc':'52c017d6aae09e6c756ade698119ec7788eddb0a7f2553f74ee16900542a7adc',
}
def sha_bytes(data):return hashlib.sha256(data).hexdigest()
def sha(path):return sha_bytes(path.read_bytes())
def replace(text,old,new,count=1):
 if text.count(old)!=count:raise RuntimeError(f'Anchor mismatch: {text.count(old)} != {count}: {old[:100]}')
 return text.replace(old,new)

def patch_files(source,diagnostic):
 for name,expected in EXPECTED.items():
  if sha(source/name)!=expected:raise RuntimeError('Unreviewed base source: '+name)
 outputs={}
 p=Path('tcg/wasm64.h');s=(source/p).read_text()
 s=replace(s,'bool wasm44_single_ctx(void);','bool wasm44_single_ctx(void);\nbool defuss_fifo_dynamic_profile(void);')
 outputs[p]=s
 p=Path('accel/tcg/translate-all.c');s=(source/p).read_text()
 s=replace(s,'#include "wasm-plan.inc"\n','#include "wasm-plan.inc"\n\n'
  'bool defuss_fifo_dynamic_profile(void)\n{\n'
  '    return qatomic_read(&plan_table) == NULL && !qatomic_read(&plan_mode) &&\n'
  '        !qatomic_read(&aot_mode) && !qatomic_read(&aot_active);\n}\n')
 outputs[p]=s
 p=Path('tcg/wasm64.c');s=(source/p).read_text()
 s=replace(s,'static uint32_t pressure_stats[7];','static uint32_t pressure_stats[7];\n'
  f'#define FIFO_DIAGNOSTIC {int(diagnostic)}\n#include "fifo-head.inc"')
 s=replace(s,'static int thread_idx_max;\n\nstatic void init_wasm(void)','static void init_wasm(void)')
 s=replace(s,'static void init_wasm(void)\n{','static void init_wasm(void)\n{\n'
  '    fifo_lock(&fifo_configuration,fifo_load,fifo_cas);')
 s=replace(s,'        initdone = true;','        initdone = true;\n        fifo_worker_init(env);')
 s=replace(s,'    instances_end  = (instances_end + 1) % INSTANCES_BUF_MAX;',
  '    instances_end  = (instances_end + 1) % INSTANCES_BUF_MAX;\n    fifo_installed();')
 loop='''    for (int i = 0; i < num; i++) {
        EM_ASM({ removeFunction($0); }, instances[instances_begin].tb_func);
        instances[instances_begin].tb_ptr = NULL;
        instances_begin = (instances_begin + 1) % INSTANCES_BUF_MAX;
    }
    instance_pending_gc += num;'''
 s=replace(s,loop,'''    if (num) {
        FIFO_NOTE(FIFO_EMERGENCY_BATCHES,1);
        FIFO_NOTE(FIFO_EMERGENCY_RETIRED,num);
    }
    fifo_retire_records(num);''')
 s=replace(s,'static void remove_old_instances(void)\n{',
  'static void fifo_retire_records(unsigned num)\n{\n'+loop.replace('int i = 0','unsigned i = 0')+
  '\n#if FIFO_DIAGNOSTIC\n    fifo_peaks();\n#endif\n}\n\nstatic void remove_old_instances(void)\n{')
 s=replace(s,'    if (elm->tb_ptr != tb_ptr) {','    if (elm->tb_ptr != tb_ptr) {\n        FIFO_NOTE(FIFO_RETIRED_ENTRY_MISSES,1);')
 s=replace(s,'    if (instance_done_gc > 0) {','    if (instance_done_gc > 0) {\n        FIFO_NOTE(FIFO_GC_CONSUMED,instance_done_gc);')
 s=replace(s,'EM_JS_PRE(void, init_wasm_js,',' #include "fifo-tail.inc"\n\nEM_JS_PRE(void, init_wasm_js,')
 s=replace(s,'        } else if (!reserve_instance()) {','        } else if (!fifo_reserve_instance(env)) {\n'
  '            FIFO_NOTE(FIFO_RESERVATION_FAILURES,1);\n            FIFO_NOTE(FIFO_CAPACITY_TCI,1);\n            FIFO_NOTE(FIFO_INTERPRETED_CALLS,1);')
 s=replace(s,'        } else if (!inc_counter(ctx.tb_ptr, &held)) {',
  '        } else if (!inc_counter(ctx.tb_ptr, &held)) {\n'
  '            FIFO_NOTE(FIFO_INTERPRETED_CALLS,1);\n            if (held) { FIFO_NOTE(FIFO_ADMISSION_HELD,1); }')
 s=replace(s,'            res = call_wasm_tb(tb_func, &ctx);',
  '            FIFO_NOTE(FIFO_COMPILED_CALLS,1);\n            res = call_wasm_tb(tb_func, &ctx);',2)
 s=replace(s,'            wasm44_promoted(header->plan_id);',
  '            wasm44_promoted(header->plan_id);\n'
  '            FIFO_NOTE(FIFO_WASM_INPUT_BYTES,header->wasm_size);\n            FIFO_NOTE(FIFO_IMPORT_BYTES,header->import_size);')
 outputs[p]=s
 return outputs

def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument('--source',type=Path,default=ROOT/'engine/qemu')
 ap.add_argument('--output',type=Path,required=True)
 ap.add_argument('--variant',choices=['performance','diagnostic'],required=True)
 ap.add_argument('--check',action='store_true');args=ap.parse_args()
 source=args.source.resolve();output=args.output.resolve()
 if not output.is_relative_to(ROOT/'artifacts'):raise SystemExit('Output must be inside project artifacts')
 patched=patch_files(source,args.variant=='diagnostic')
 if args.check:
  print(json.dumps({'status':'passed-source-anchors','variant':args.variant,'files':{str(p):sha_bytes(s.encode()) for p,s in patched.items()},'runtimeExecution':False},indent=2));return
 path=output.parent/(output.name+'-fifo-overlay.json')
 if output.exists() or path.exists() or source==output or source in output.parents or output in source.parents:raise SystemExit('Choose a fresh separate output tree and manifest')
 output.parent.mkdir(parents=True,exist_ok=True);shutil.copytree(source,output,symlinks=True)
 for name,expected in EXPECTED.items():
  if sha(output/name)!=expected:raise RuntimeError('Source changed while copying: '+name)
 changes=[]
 for p,s in patched.items():
  (output/p).write_text(s);changes.append({'path':str(p),'before':sha(source/p),'after':sha(output/p)})
 for name,destination in [('fifo-core.h','fifo-core.h'),('head.inc','fifo-head.inc'),('tail.inc','fifo-tail.inc'),('diagnostic.inc','fifo-diagnostic.inc')]:
  p=Path('tcg')/destination;shutil.copyfile(HERE/name,output/p);changes.append({'path':str(p),'before':None,'after':sha(output/p)})
 manifest={'schema':1,'kind':'passive-fifo-v1','variant':args.variant,'source':str(source),'output':str(output),
  'defaultEnabled':False,'diagnostic':args.variant=='diagnostic','newYield':False,'forceGC':False,
  'constants':{'soft':9000,'batch':256,'newInstalls':256,'minimumLive':512,'cap':12000},
  'changes':changes,'generatorSha256':sha(Path(__file__)),'validatedGuest':'none'}
 with path.open('x') as handle:
  handle.write(json.dumps(manifest,indent=2)+'\n');handle.flush();os.fsync(handle.fileno())
 directory=os.open(path.parent,os.O_RDONLY)
 try:os.fsync(directory)
 finally:os.close(directory)
 print(path)
if __name__=='__main__':main()
