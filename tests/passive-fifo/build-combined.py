#!/usr/bin/env python3
"""Fresh initramfs: exact retained pressure ELF then exact retained main ELF."""
import argparse,gzip,hashlib,json,os,stat,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packaging'))
from bun_app_package import unpack_cpio,write_cpio
def sha(data):return hashlib.sha256(data).hexdigest()
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--output',required=True);args=ap.parse_args();out=(ROOT/args.output).resolve();out.relative_to(ROOT/'artifacts');out.mkdir()
 builds={};entries={};inputs={}
 for kind,directory in [('pressure','artifacts/m3-region-pressure-fixture-01'),('main','artifacts/m3-region-fixture-02')]:
  base=ROOT/directory;raw=(base/'initramfs.cpio.gz').read_bytes();report=json.loads((base/'build-report.json').read_text());assert report['status']=='passed' and report['initramfsSha256']==sha(raw)
  content=unpack_cpio(gzip.decompress(raw));assert sha(content['fixture'][3])==report['binarySha256'];builds[kind]=report;entries[kind]=content
  for name in ['initramfs.cpio.gz','build-report.json']:inputs[directory+'/'+name]=sha((base/name).read_bytes())
 for name in ['tests/passive-fifo/build-combined.py','packaging/bun_app_package.py']:inputs[name]=sha((ROOT/name).read_bytes())
 left={k:v for k,v in entries['pressure'].items() if k not in {'init','fixture','TRAILER!!!'}}
 right={k:v for k,v in entries['main'].items() if k not in {'init','fixture','TRAILER!!!'}}
 assert left==right,'Retained initramfs bases differ'
 pressure=entries['pressure']['fixture'];content=entries['pressure'];del content['fixture']
 content['pressure-fixture']=pressure;content['main-fixture']=entries['main']['fixture']
 init=b'''#!/bin/busybox sh
export PATH=/bin:/sbin:/usr/bin:/usr/sbin
/bin/busybox --install -s /bin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
exec </dev/console >/dev/console 2>&1
/pressure-fixture || { echo PRESSURE_FAIL:combined-pressure-exit-$?; poweroff -f; while :; do sleep 1; done; }
/main-fixture || echo REGION_FAIL:combined-main-exit-$?
poweroff -f
while :; do sleep 1; done
'''
 content['init']=(stat.S_IFREG|0o755,0,0,init,0,0);content['TRAILER!!!']=(0,0,0,b'',0,0)
 write_cpio(content,out/'initramfs.cpio.gz');roundtrip=unpack_cpio(gzip.decompress((out/'initramfs.cpio.gz').read_bytes()))
 for kind in ['pressure','main']:assert sha(roundtrip[kind+'-fixture'][3])==builds[kind]['binarySha256']
 assert roundtrip['init'][3]==init
 report={'schema':1,'status':'passed','kind':'passive-fifo-combined-retained-elf-v1','inputs':inputs,'fixtures':builds,'initSha256':sha(init),'initramfsSha256':sha((out/'initramfs.cpio.gz').read_bytes()),'compiled':False,'scope':'Exact retained pressure and main ELF bytes; new init ordering only, same VM and pool lifetime. No guest execution by packager.'}
 with (out/'initramfs.cpio.gz').open('rb') as f:os.fsync(f.fileno())
 with (out/'build-report.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 for directory in [out,out.parent]:
  fd=os.open(directory,os.O_RDONLY)
  try:os.fsync(fd)
  finally:os.close(fd)
 print(out)
if __name__=='__main__':main()
