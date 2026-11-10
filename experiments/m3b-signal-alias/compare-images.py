"""Retain exact rebuilt-guest differences without claiming binary identity."""
import gzip,hashlib,json,os,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packaging'))
from bun_app_package import unpack_cpio

def ident(p):
 b=p.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def main():
 old=ROOT/'artifacts/m3b-signal-alias-fixture-01';new=ROOT/'artifacts/m3b-signal-alias-v2-fixture-01';out=ROOT/'artifacts/m3b-signal-alias-v2-image-comparison-01';out.mkdir()
 inputs={str(p.relative_to(ROOT)):ident(p) for base in (old,new) for p in [base/n for n in ('fixture.c','fixture.S','fixture','initramfs.cpio.gz','build-report.json')]}
 for p in [Path(__file__),ROOT/'packaging/bun_app_package.py']:inputs[str(p.relative_to(ROOT))]=ident(p)
 for name in ('fixture.c','fixture.S'):assert (old/name).read_bytes()==(new/name).read_bytes()
 a=(old/'fixture').read_bytes();b=(new/'fixture').read_bytes();assert len(a)==len(b)
 phoff=struct.unpack_from('<Q',a,32)[0];phsize,phnum=struct.unpack_from('<HH',a,54);assert (phsize,)==(56,)
 loads=[]
 for i in range(phnum):
  h=struct.unpack_from('<IIQQQQQQ',a,phoff+i*56);assert h==struct.unpack_from('<IIQQQQQQ',b,phoff+i*56)
  if h[0]==1:
   assert a[h[2]:h[2]+h[5]]==b[h[2]:h[2]+h[5]];loads.append({'virtualAddress':hex(h[3]),'bytes':h[5],'sha256':hashlib.sha256(a[h[2]:h[2]+h[5]]).hexdigest()})
 shoff=struct.unpack_from('<Q',a,40)[0];size,count,index=struct.unpack_from('<HHH',a,58);assert size==64
 sections=[struct.unpack_from('<IIQQQQIIQQ',a,shoff+i*64) for i in range(count)];assert a[shoff:shoff+count*64]==b[shoff:shoff+count*64]
 h=sections[index];names=a[h[4]:h[4]+h[5]];strings=next(s for s in sections if names[s[0]:].split(b'\0',1)[0]==b'.strtab');start,end=strings[4],strings[4]+strings[5]
 assert strings[2]&2==0 and a[:start]==b[:start] and a[end:]==b[end:]
 left=a[start:end].split(b'\0');right=b[start:end].split(b'\0');assert len(left)==len(right);differences=[{'old':x.decode(),'new':y.decode()} for x,y in zip(left,right) if x!=y]
 assert differences and all(x['old'].startswith('cc') and x['old'].endswith('.o') and x['new'].startswith('cc') and x['new'].endswith('.o') for x in differences)
 ca=unpack_cpio(gzip.decompress((old/'initramfs.cpio.gz').read_bytes()));cb=unpack_cpio(gzip.decompress((new/'initramfs.cpio.gz').read_bytes()));assert ca.keys()==cb.keys();changed=[n for n in ca if ca[n]!=cb[n]];assert changed==['fixture']
 report={'status':'passed','inputs':inputs,'guestSourcesByteIdentical':True,'guestElfByteIdentical':False,'initramfsByteIdentical':False,'allLoadableSegmentsByteIdentical':True,'loadableSegments':loads,'onlyElfDifference':'Non-allocated .strtab compiler temporary object filename strings','stringDifferences':differences,'changedCpioEntries':changed,'timingEligible':False}
 with (out/'report.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 fd=os.open(out,os.O_RDONLY);os.fsync(fd);os.close(fd);print(json.dumps({'status':'passed','differences':differences}))
if __name__=='__main__':main()
