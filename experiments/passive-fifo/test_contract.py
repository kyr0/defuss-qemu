#!/usr/bin/env python3
"""Source and sanitized native overlay checks; never builds QEMU or runs a guest."""
import hashlib
import importlib.util
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('fifo_prepare',HERE/'prepare.py')
prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(prepare)

def function(source,start,end):
    return source.split(start,1)[1].split(end,1)[0]

class SourceContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base=(ROOT/'engine/qemu/tcg/wasm64.c').read_text()
        cls.patched={v:prepare.patch_files(ROOT/'engine/qemu',v) for v in (False,True)}

    def test_original_reservation_and_yield_unchanged(self):
        for files in self.patched.values():
            source=files[Path('tcg/wasm64.c')]
            for start,end in [('static bool reserve_instance(void)','static wasm_tb_func get_instance_from_tb'),
                              ('static inline void trysleep(void)','static void init_wasm(void)')]:
                old=function(self.base,start,end).replace('static int thread_idx_max;\n\n','')
                self.assertEqual(old,function(source,start,end))
            self.assertEqual(source.count('emscripten_sleep('),self.base.count('emscripten_sleep('))
            self.assertEqual(source.count('FinalizationRegistry'),self.base.count('FinalizationRegistry'))
        for filename in ('head.inc','tail.inc','diagnostic.inc'):
            self.assertNotIn('emscripten_sleep',(HERE/filename).read_text())
            self.assertNotIn('setTimeout',(HERE/filename).read_text())

    def test_actual_null_function_post_admission_pre_reservation_site(self):
        for files in self.patched.values():
            source=files[Path('tcg/wasm64.c')]
            dispatcher=source.split('uintptr_t tcg_qemu_tb_exec(',1)[1]
            self.assertLess(dispatcher.index('get_instance_from_tb'),dispatcher.index('if (tb_func)'))
            self.assertLess(dispatcher.index('!inc_counter('),dispatcher.index('!fifo_reserve_instance(env)'))
            self.assertLess(dispatcher.index('->wasm_size)'),dispatcher.index('!fifo_reserve_instance(env)'))
            self.assertLess(dispatcher.index('!fifo_reserve_instance(env)'),dispatcher.index('instantiate_wasm('))
            fallback=function(source,'        } else if (!fifo_reserve_instance(env)) {','            record_interpretation(')
            for statement in ('remove_old_instances();','check_gc_completion();','tcg_qemu_tb_exec_tci(env, false)'):
                self.assertIn(statement,fallback)
            self.assertLess(source.index('static __thread unsigned instance_budget'),source.index('#include "fifo-head.inc"'))

    def test_frozen_constants_and_owning_worker_route(self):
        core=(HERE/'fifo-core.h').read_text()
        for name,value in [('CAP',12000),('SOFT',9000),('BATCH',256),('MIN_LIVE',512)]:
            self.assertIn(f'#define FIFO_{name} {value}u',core)
        diagnostic=(HERE/'diagnostic.inc').read_text()
        request=diagnostic.split('int defuss_fifo_request(uint32_t request)\n{',1)[1]
        self.assertNotIn('fifo_topology_profile(',request)
        self.assertNotIn('instance_pending_gc',request)
        self.assertNotIn('instance_done_gc',request)
        callback=function(diagnostic,'static void fifo_snapshot_on_owner','EMSCRIPTEN_KEEPALIVE uintptr_t')
        self.assertNotIn('check_gc_completion()',callback)
        self.assertNotIn('fifo_retire_records(',callback)
        self.assertIn('qatomic_store_release(&fifo_words[3],request)',callback)
        tail=(HERE/'tail.inc').read_text()
        worker=function(tail,'static void fifo_worker_init','static void fifo_before_reserve')
        self.assertLess(worker.index('object_ref(OBJECT(cpu))'),worker.index('qatomic_store_release(&fifo_owner,cpu)'))

    def test_fresh_output_and_manifest_publication(self):
        scratch_root=Path(os.environ.get('TMPDIR','')).resolve()
        self.assertTrue(scratch_root.is_relative_to(ROOT/'tmp'))
        work=Path(tempfile.mkdtemp(prefix='publication-',dir=scratch_root))
        source=work/'engine/qemu';(source/'tcg').mkdir(parents=True)
        (source/'tcg/wasm64.c').write_text('old source\n')
        output=work/'artifacts/fresh/source';manifest=output.parent/'source-fifo-overlay.json'
        output.parent.mkdir(parents=True);manifest.write_text('retained evidence\n')
        argv=['prepare.py','--source',str(source),'--output',str(output),'--variant','performance']
        with patch.object(prepare,'ROOT',work),patch.object(prepare,'EXPECTED',{}),patch.object(prepare,'patch_files',return_value={Path('tcg/wasm64.c'):'new source\n'}),patch('sys.argv',argv):
            with self.assertRaises(SystemExit):prepare.main()
            self.assertFalse(output.exists());self.assertEqual(manifest.read_text(),'retained evidence\n')
            manifest.unlink();prepare.main()
            result=json.loads(manifest.read_text());self.assertEqual(result['variant'],'performance')
            self.assertEqual((output/'tcg/wasm64.c').read_text(),'new source\n')
            self.assertEqual((source/'tcg/wasm64.c').read_text(),'old source\n')
            self.assertEqual(result['changes'][0]['after'],prepare.sha(output/'tcg/wasm64.c'))
            before=manifest.read_bytes()
            with self.assertRaises(SystemExit):prepare.main()
            self.assertEqual(before,manifest.read_bytes())

    def test_native_actual_overlay_and_pool_functions(self):
        scratch_root=Path(os.environ.get('TMPDIR','')).resolve()
        self.assertTrue(scratch_root.is_relative_to(ROOT/'tmp'),'Run through scripts/with-tmp.py')
        scratch=Path(tempfile.mkdtemp(prefix='fifo-',dir=scratch_root))
        headers=['cpu.h','qemu/coroutine.h','exec/cpu-common.h','hw/core/boards.h','system/runstate.h','hw/i386/pc.h']
        for name in headers:
            p=scratch/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('/* native fixture stand-in */\n')
        for name,dest in [('fifo-core.h','fifo-core.h'),('head.inc','fifo-head.inc'),('tail.inc','fifo-tail.inc'),('diagnostic.inc','fifo-diagnostic.inc')]:
            shutil.copyfile(HERE/name,scratch/dest)
        results=[]
        for diagnostic,files in self.patched.items():
            source=files[Path('tcg/wasm64.c')]
            pool='static __thread struct WasmInstanceInfo'+source.split('static __thread struct WasmInstanceInfo',1)[1].split('EM_JS_PRE(void, init_wasm_js,',1)[0]
            (scratch/'pool-under-test.inc').write_text(pool)
            executable=scratch/f'contract-{int(diagnostic)}'
            command=['clang','-std=gnu11','-O1','-g','-Wall','-Wextra','-Werror','-Wno-unused-function','-Wno-sign-compare',
                     '-fsanitize=address,undefined','-fno-omit-frame-pointer','-pthread',f'-DFIFO_DIAGNOSTIC={int(diagnostic)}',
                     '-I',str(scratch),str(HERE/'native-contract.c'),'-o',str(executable)]
            # Match the existing native fixture SDK workaround for this host's
            # default SDK .tbd architecture unsupported by its system linker.
            sysroot=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk')
            if platform.system()=='Darwin' and sysroot.exists():command[1:1]=['-isysroot',str(sysroot)]
            built=subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(built.returncode,0,built.stderr)
            run=subprocess.run([str(executable)],capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stdout+run.stderr)
            preprocessed=subprocess.run(['clang','-E',f'-DFIFO_DIAGNOSTIC={int(diagnostic)}','-I',str(scratch),str(HERE/'native-contract.c')],capture_output=True,text=True,check=True).stdout
            if not diagnostic:
                self.assertNotIn('fifo_counts[',preprocessed)
                self.assertNotIn('fifo_words[',preprocessed)
                self.assertNotIn('fifo_snapshot_on_owner(',preprocessed)
                self.assertNotIn('fifo_note(',preprocessed)
            results.append({'diagnostic':diagnostic,'command':command,'stdout':run.stdout,'sanitizers':['address','undefined'],'guestExecution':False})
        (scratch/'validation.json').write_text(json.dumps({'schema':1,'scope':'native stand-ins plus exact patched pool/overlay source','results':results},indent=2)+'\n')
        print('Retained native validation:',scratch/'validation.json')

if __name__=='__main__':unittest.main()
