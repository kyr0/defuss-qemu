#!/usr/bin/env python3
"""Build the standalone M1 wasm32 reference inside the project's pinned SDK."""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from build import SDK

EXPORTS = ['ref_abi_version','ref_memory_base','ref_memory_capacity','ref_integer',
           'ref_sha256_compress','ref_sha256_context_bytes','ref_sha256_total_offset',
           'ref_sha256_used_offset','ref_sha256_init','ref_sha256_update',
           'ref_sha256_final','ref_sha256_hash']


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--dry-run',action='store_true')
    args=parser.parse_args()
    output=args.output.resolve()
    if output.exists():parser.error('Use a fresh output directory')
    if not output.is_relative_to(ROOT):parser.error('Output must be inside defuss-vm')
    source=Path(__file__).with_name('kernels.c')
    command=['emcc',str(source),'-o',str(output/'references.wasm'),'-O3','-msimd128',
             '-fno-builtin','--no-entry','-sMEMORY64=0','-sSTANDALONE_WASM=1',
             '-sFILESYSTEM=0','-sASSERTIONS=0','-sALLOW_MEMORY_GROWTH=0',
             '-sINITIAL_MEMORY=16777216','-sSTACK_SIZE=65536',
             '-sEXPORTED_FUNCTIONS='+json.dumps(['_'+name for name in EXPORTS])]
    report={'schema':1,'status':'planned','sdk':SDK,'memoryModel':'standalone wasm32, fixed 16 MiB, unshared',
            'scope':'Component references, not a guest ABI or memory64 VM replacement',
            'command':command,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
            'buildScriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    if args.dry_run:print(json.dumps(report,indent=2));return
    if not shutil.which('emcc'):parser.error('Run inside the pinned SDK with scripts/sdk.py')
    output.mkdir(parents=True)
    report['emccVersion']=subprocess.check_output(['emcc','--version'],text=True).strip()
    started=time.monotonic()
    try:
        with (output/'compile.log').open('w') as log:
            subprocess.run(command,check=True,stdout=log,stderr=subprocess.STDOUT)
        wasm=output/'references.wasm'
        report.update(status='passed',seconds=time.monotonic()-started,wasmBytes=wasm.stat().st_size,
                      wasmSha256=hashlib.sha256(wasm.read_bytes()).hexdigest())
    except Exception as error:
        report.update(status='failed',seconds=time.monotonic()-started,failure=str(error));raise
    finally:(output/'build-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'output':str(output),'wasmBytes':report['wasmBytes']}))


if __name__=='__main__':main()
