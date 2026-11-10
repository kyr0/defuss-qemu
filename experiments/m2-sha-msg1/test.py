#!/usr/bin/env python3
"""Lightweight host C + real emitted WASM tests; does not build QEMU or boot a VM."""
import argparse
import datetime
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import hashlib
import os
import sys

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def function(text, name):
    match = re.search(r'^static [^\n]*\b' + name + r'\([^\{]*\n\{', text, re.M)
    if not match:
        raise ValueError('Missing source function ' + name)
    end = text.index('\n}', match.end()) + 2
    return text[match.start():end] + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cc', default='clang')
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ROOT/'artifacts'): parser.error('Retain test results under project artifacts/')
    if output.exists(): parser.error('Use a fresh output directory')
    output.mkdir(parents=True)
    backend = (ROOT / 'engine/qemu/tcg/wasm64/tcg-target.c.inc').read_text()
    helper_path = ROOT / 'engine/qemu/target/i386/ops_sse.h'
    helper = helper_path.read_text()
    start = helper.index('void helper_sha256msg1(Reg *d, Reg *a, Reg *b)\n{')
    oracle = re.search(r'^#define SHA256_MSGS0.*$', helper, re.M)[0] + '\n' + helper[start:helper.index('\n}', start)+2] + '\n'
    report = {'schema': 1, 'status': 'running', 'scope': 'Host fixture and exact emitted WASM, not integrated guest acceptance',
              'inputs': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in
                         [Path(__file__), HERE/'native-fixture.c', HERE/'lowering.c.inc', HERE/'config.c.inc', HERE/'test-emitted.mjs', HERE/'prepare.py', helper_path, ROOT/'engine/qemu/tcg/wasm64/tcg-target.c.inc']}, 'runs': []}
    try:
        spec = importlib.util.spec_from_file_location('msg1_prepare', HERE/'prepare.py')
        prepare = importlib.util.module_from_spec(spec); spec.loader.exec_module(prepare)
        for mode in ['switch', 'diagnostic']:
            changes=prepare.changes(ROOT/'engine/qemu',mode)
            assert ('target/i386/ops_sse.h' in map(str,changes)) == (mode=='diagnostic')
        scratch = ROOT/'tmp'
        if scratch.is_symlink(): raise ValueError('Project tmp must not be a symlink')
        scratch.mkdir(exist_ok=True)
        work = Path(tempfile.mkdtemp(prefix='msg1-host-', dir=scratch))
        environment = dict(os.environ, TMPDIR=str(work), TMP=str(work), TEMP=str(work), PYTHONDONTWRITEBYTECODE='1')
        report['scratch'] = {'path': str(work.relative_to(ROOT)), 'retained': True}
        report['startedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        for name in ['lowering.c.inc','config.c.inc','native-fixture.c']:
            shutil.copyfile(HERE/name,work/name)
        (work/'emscripten.h').write_text('#define EMSCRIPTEN_KEEPALIVE\n')
        enum = re.search(r'typedef enum \{\n    OPC_UNREACHABLE.*?\} WasmInsn;', backend, re.S)
        if not enum: raise ValueError('Missing backend opcode enum')
        (work/'generated-qemu.h').write_text(enum[0]+'\n'+ '\n'.join(re.findall(r'^#define (?:REG_LOCAL_BASE|TMP32_LOCAL_0_IDX|TMP64_LOCAL_[01]_IDX) .*$',backend,re.M))+'\n'+
            '#define REG_IDX(r) (REG_LOCAL_BASE + (r))\n#define TCG_REG_R0 0\n#define TCG_REG_CALL_STACK 15\n#define dh_typecode_void 0\n#define dh_typecode_ptr 6\n#define TCG_CALL_NO_RETURN 8\n')
        (work/'generated-address.inc').write_text(function(backend,'tcg_wasm_out_norm_ptr')+function(backend,'push_arg_i64'))
        (work/'generated-oracle.inc').write_text(oracle)
        def execute(label, command):
            (output/(label+'.command.json')).write_text(json.dumps(command,indent=2)+'\n')
            completed = subprocess.run(command,env=environment,capture_output=True,text=True)
            (output/(label+'.stdout.log')).write_text(completed.stdout)
            (output/(label+'.stderr.log')).write_text(completed.stderr)
            completed.check_returncode()
            return completed.stdout
        for width in ['64','32']:
            command=[args.cc,'-std=gnu11','-O2','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-pthread','-I',str(work)]
            sdk=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk')
            if sdk.exists(): command+=['-isysroot',str(sdk)]
            if width=='32': command+=['-DWASM64_MEMORY64_2=1']
            binary=work/('fixture-'+width);command += [str(work/'native-fixture.c'),'-o',str(binary)]
            execute('compile-'+width,command)
            body=output/('msg1-memory'+width+'.body');cases=work/('cases-'+width+'.bin')
            native=execute('native-'+width,[str(binary),str(body),str(cases)]).strip()
            result=json.loads(execute('wasm-'+width,['node',str(HERE/'test-emitted.mjs'),str(body),str(cases),width,str(output/('msg1-memory'+width+'.wasm'))]))
            report['runs'].append({'native':native,'wasm':result,'command':command,
                'caseData':{'path':str(cases.relative_to(ROOT)),'sha256':hashlib.sha256(cases.read_bytes()).hexdigest(),'bytes':cases.stat().st_size}})
        for path, expected in report['inputs'].items():
            assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==expected, 'Source changed during tests'
        report.update(status='passed',sourceUnchanged=True,sanitizers=['address','undefined'])
    except Exception as error:
        report.update(status='failed',failure=str(error));raise
    finally:
        with (output/'report.json').open('x') as stream:json.dump(report,stream,indent=2);stream.write('\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
