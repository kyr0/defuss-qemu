#!/usr/bin/env python3
"""Build a static Linux ordinary retirement fixture inside the pinned SDK."""
import argparse,gzip,hashlib,json,stat,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packaging'))
from bun_app_package import unpack_cpio,write_cpio,PINS,sha
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
output=(ROOT/args.output).resolve();output.relative_to(ROOT/'artifacts');output.mkdir()
sources=[Path(__file__),ROOT/'tests/regions-pressure/fixture.c',ROOT/'tests/regions-pressure/fixture.S']
source_hashes={}
for source in sources:
 data=source.read_bytes();(output/source.name).write_bytes(data)
 source_hashes[str(source.relative_to(ROOT))]=hashlib.sha256(data).hexdigest()
base=ROOT/'assets/bun/amd64/initramfs-virt'
assert sha(base)==PINS[base]
command=['gcc','-O2','-static','-fno-pie','-no-pie','-mno-red-zone','-fno-tree-vectorize','-fno-tree-slp-vectorize',str(output/'fixture.c'),str(output/'fixture.S'),'-o',str(output/'fixture')]
report={'schema':1,'status':'failed','command':command,'sources':source_hashes,'baseInitramfsSha256':sha(base)}
try:
 with (output/'build.log').open('x') as log:subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,check=True)
 entries=unpack_cpio(gzip.decompress(base.read_bytes()))
 init=b'''#!/bin/busybox sh
export PATH=/bin:/sbin:/usr/bin:/usr/sbin
/bin/busybox --install -s /bin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
exec </dev/console >/dev/console 2>&1
/fixture || echo PRESSURE_FAIL:guest-exit-$?
poweroff -f
while :; do sleep 1; done
'''
 entries['init']=(stat.S_IFREG|0o755,0,0,init,0,0)
 entries['fixture']=(stat.S_IFREG|0o755,0,0,(output/'fixture').read_bytes(),0,0)
 entries['TRAILER!!!']=(0,0,0,b'',0,0)
 write_cpio(entries,output/'initramfs.cpio.gz')
 report.update(status='passed',binarySha256=sha(output/'fixture'),initramfsSha256=sha(output/'initramfs.cpio.gz'))
finally:
 (output/'build-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':report['status'],'output':str(output)}))
