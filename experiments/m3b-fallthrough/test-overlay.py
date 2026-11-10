#!/usr/bin/env python3
"""Focused host contracts; no QEMU compilation, browser, package or guest.

Run only in an explicit test gap. Scratch is retained under project/tmp.
These tests do not close generated-code, Asyncify or machine-profile gates.
"""
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BASE = ROOT / 'artifacts/m3a-source-04/source'
spec = importlib.util.spec_from_file_location('m3b_prepare', HERE / 'prepare.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def function(text, name):
    match = re.search(r'^static[^\n]*\b' + re.escape(name) + r'\([^;{}]*\)\n\{.*?^\}',
                      text, re.S | re.M)
    if not match:
        raise AssertionError('Missing actual source function ' + name)
    return match[0]


class OverlayContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.patched = module.patch_files(BASE)

    def test_exact_pool_and_service_functions_unchanged(self):
        original = (BASE / 'tcg/wasm64.c').read_text()
        changed = self.patched[Path('tcg/wasm64.c')]
        for name in ['reserve_instance', 'remove_old_instances', 'check_gc_completion', 'trysleep']:
            self.assertEqual(function(original, name), function(changed, name), name)

    def test_budget_retains_slot_metadata_and_returns_cold_target_to_guard(self):
        target = self.patched[Path('tcg/wasm64/tcg-target.c.inc')]
        original = (BASE / 'tcg/wasm64/tcg-target.c.inc').read_text()
        self.assertEqual(function(target, 'tcg_out_goto_tb'), function(original, 'tcg_out_goto_tb'))
        self.assertIn('s->gen_tb->m3b_fused && which == 1', function(target, 'tcg_wasm_out_goto_tb'))
        runtime = self.patched[Path('tcg/wasm64.c')]
        self.assertEqual(runtime.count('return 0; /* outer guard BEFORE admission */'), 2)
        self.assertIn('m3b_tci_closing_slot(ptr)', runtime)
        self.assertIn('(m3_enabled() || m3b_fused(tb_ptr))', runtime)

    def test_runtime_helpers_follow_context_declaration(self):
        runtime = self.patched[Path('tcg/wasm64.c')]
        context = re.search(r'^static __thread struct WasmContext ctx = \{.*?^\};',
                            runtime, re.S | re.M)
        self.assertIsNotNone(context)
        head = runtime.index('#include "m3b-runtime-head.inc"')
        self.assertGreater(head, context.end())
        self.assertLess(head, runtime.index('m3b_tci_closing_slot(ptr)'))
        self.assertLess(head, runtime.index('m3b_fused(tb_ptr)) &&'))

    def test_failed_trial_cannot_append_second_slot_zero(self):
        translator = self.patched[Path('target/i386/tcg/translate.c')]
        self.assertIn('A partial trial may already own slot0', translator)
        self.assertIn('dc->base.is_jmp = DISAS_NORETURN;', translator)
        retry = self.patched[Path('accel/tcg/translate-all.c')]
        self.assertIn('*max_insns = m3b_original_max;', retry)
        self.assertIn('volatile bool m3b_retried = false;', retry)
        self.assertIn('(ret == -1 || ret == -2)', retry)
        self.assertIn('goto m3b_restart_translation;', retry)

    def test_lifecycle_guards_precede_mutation(self):
        qdev = self.patched[Path('hw/core/qdev.c')]
        begin = qdev.index('static void device_set_realized(')
        body = qdev[begin:]
        self.assertLess(body.index('defuss_m3b_mutation_allowed'), body.index('hotplug_handler_pre_plug'))
        backend = self.patched[Path('block/block-backend.c')]
        begin = backend.index('int blk_insert_bs(')
        body = backend[begin:]
        self.assertLess(body.index('defuss_m3b_mutation_allowed'), body.index('bdrv_ref(bs)'))
        self.assertIn('defuss_m3b_mutation_allowed(&error_fatal)', backend)
        apic = self.patched[Path('hw/intc/apic_common.c')]
        body = apic[apic.index('void apic_enable_vapic('):]
        self.assertLess(body.index('defuss_m3b_launch_allowed'), body.index('s->vapic_paddr = paddr'))

    def test_actual_service_helper(self):
        compiler = shlex.split(os.environ.get('CC', 'clang'))
        self.assertTrue(compiler, 'CC must name a compiler')
        compiler[0] = shutil.which(compiler[0])
        self.assertIsNotNone(compiler[0], 'A native compiler is required for this contract')
        sysroot = os.environ.get('SDKROOT')
        fallback = Path('/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk')
        if not sysroot and platform.system() == 'Darwin' and fallback.is_dir():
            sysroot = str(fallback)
        if sysroot:
            self.assertTrue(Path(sysroot).is_dir(), 'SDKROOT must be an existing SDK directory')
        scratch_root = ROOT / 'tmp'
        scratch_root.mkdir(exist_ok=True)
        scratch = Path(tempfile.mkdtemp(prefix='m3b-', dir=scratch_root))
        original = (BASE / 'tcg/wasm64.c').read_text()
        (scratch / 'original-trysleep.inc').write_text(
            '#define MAX_EXEC_NUM 50000\nstatic __thread int exec_cnt = MAX_EXEC_NUM;\n' +
            function(original, 'trysleep') + '\n')
        output = scratch / 'service-contract'
        command = compiler + ['-std=c11', '-Wall', '-Wextra', '-Werror', '-pthread',
                              '-fsanitize=address,undefined', '-fno-omit-frame-pointer']
        if sysroot:
            command += ['-isysroot', sysroot]
        command += ['-I', str(HERE), '-I', str(scratch),
                    str(HERE / 'test-service.c'), '-o', str(output)]
        print(json.dumps({'nativeCompileArgv': command, 'scratch': str(scratch)}), flush=True)
        subprocess.run(command, check=True)
        subprocess.run([str(output)], check=True)
        boundary_output = scratch / 'boundary-contract'
        boundary_command = command[:-3] + [str(HERE / 'test-boundary.c'), '-o', str(boundary_output)]
        print(json.dumps({'nativeCompileArgv': boundary_command, 'scratch': str(scratch)}), flush=True)
        subprocess.run(boundary_command, check=True)
        subprocess.run([str(boundary_output)], check=True)


if __name__ == '__main__':
    unittest.main()
