#!/usr/bin/env python3
"""Build/package the isolated MSG2 ISA guest inside the pinned Linux SDK."""
import argparse
import gzip
import importlib.util
import json
from pathlib import Path
import shutil
import stat
import subprocess

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('bun_app_package',ROOT/'packaging/bun_app_package.py')
package=importlib.util.module_from_spec(spec);spec.loader.exec_module(package)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    output=args.output.resolve()
    if output.exists():parser.error('Use a fresh output directory')
    output.mkdir(parents=True)
    source=output/'guest-fixture.c';shutil.copyfile(HERE/'guest-fixture.c',source)
    base=ROOT/'assets/bun/amd64/initramfs-virt';assert package.sha(base)==package.PINS[base]
    command=['gcc','-O2','-static','-mavx2','-msha','-mno-red-zone','-fno-tree-vectorize','-fno-tree-slp-vectorize',str(source),'-o',str(output/'fixture')]
    report={'schema':1,'status':'running','command':command,'modes':7,'checksPerMode':4096,'totalChecks':28672,
            'memoryFault':{'warmup':4096,'faults':1,'source':'cross-page PROT_NONE','checks':['exact PC','exact fault address','SEGV_ACCERR','saved/restored YMM0-2','flags','preceding side effect once']},
            'inputHashes':{str(p.relative_to(ROOT)):package.sha(p) for p in [HERE/'guest-fixture.c',Path(__file__),ROOT/'packaging/bun_app_package.py',base]},
            'scope':'ISA fixture with original instruction bytes; not the unchanged Bun performance workload'}
    try:
        with (output/'compile.log').open('x') as log:subprocess.run(command,check=True,stdout=log,stderr=subprocess.STDOUT)
        entries=package.unpack_cpio(gzip.decompress(base.read_bytes()))
        init=b'''#!/bin/busybox sh
export PATH=/bin:/sbin:/usr/bin:/usr/sbin
/bin/busybox --install -s /bin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
exec </dev/console >/dev/console 2>&1
/fixture || echo FIXTURE_FAIL:exit-$?
poweroff -f
while :; do sleep 1; done
'''
        entries['init']=(stat.S_IFREG|0o755,0,0,init,0,0)
        entries['fixture']=(stat.S_IFREG|0o755,0,0,(output/'fixture').read_bytes(),0,0)
        entries['TRAILER!!!']=(0,0,0,b'',0,0)
        package.write_cpio(entries,output/'initramfs.cpio.gz')
        report.update(status='passed',binarySha256=package.sha(output/'fixture'),initramfsSha256=package.sha(output/'initramfs.cpio.gz'))
    except Exception as error:report.update(status='failed',failure=str(error));raise
    finally:
        with (output/'build-report.json').open('x') as stream:json.dump(report,stream,indent=2);stream.write('\n')
    print(json.dumps({'status':report['status'],'output':str(output)}))


if __name__=='__main__':main()
