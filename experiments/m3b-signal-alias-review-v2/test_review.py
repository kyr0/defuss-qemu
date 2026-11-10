import copy,unittest
from review import ROOT,serial_records
from contexts import Contexts,gate,layout,flags,initial,ADD,SUB,U32

def put(w,at,n):w[at:at+2]=[n&U32,n>>32]
P=dict(schema=1,rx='0x20000000',rw='0x21000000',a='0x20000004',b='0x20000009',back='0x2000000e',side='0x20000010',end='0x20000011',physicalFrame='0x123',timer='ITIMER_VIRTUAL',timerUsec=10000,cases=8,codeHex=ADD)
def guest(seq,off=9):
 patches=max(0,seq-1);current=SUB if patches%2 else ADD;extra=dict(patches=patches,rxPagemap='0x8000000000000123',rwPagemap='0x8000000000000123',rxHex=current,rwHex=current);zeros=dict(gpr=['0x0']*16,rflags='0x0')
 if not seq:return dict(seq=0,stage='layout',case=-2,iterations=0,step=0,deliveries=0,initial=zeros,observed=copy.deepcopy(zeros),sample=None,**extra)
 n,step,seed=initial(seq-2,0x100000);after=copy.deepcopy(seed);after['gpr'][0]=hex(n*step&U32);after['gpr'][2]='0x0';after['rflags']='0x246';sample=None
 if seq>1:
  left=700001;sub=bool((seq-2)%2);acc=(-1 if sub else 1)*(n-left)*step&U32;ef=flags(left,0,True)
  if off in (4,14):ef=flags(left+1,1,True)
  if off==11:ef=flags(acc,step,sub);acc=(acc+(-step if sub else step))&U32
  regs=seed['gpr'].copy();regs[0]=hex(acc);regs[2]=hex(left);regs[7]=hex(0x100000-8);old=SUB if sub else ADD
  sample=dict(signo=26,code=128,error=0,pc=hex(0x20000000+off),gpr=regs,rflags=hex(ef|0x10000),beforeRxHex=old,beforeRwHex=old,afterRxHex=current,afterRwHex=current)
  after['gpr'][0]=hex((acc+(step if sub else -step)*(left-int(off==11)))&U32)
 return dict(seq=seq,stage='warm' if seq==1 else 'signal',case=seq-2,iterations=n,step=step,deliveries=int(seq>1),initial=seed,observed=after,sample=sample,**extra)
def native(enabled,seq,initial=False):
 a=[0]*96;b=[0]*128;c=[0]*2400;d=[0]*256;w=[0]*2112
 a[:13]=[0x4d335231,1,1,int(not initial),0,176,88,24,4,64,8,0,1 if initial else 3];a[18]=a[19]=seq*200;a[25]=seq
 b[:13]=[0x4d334231,1,63 if enabled else 62,0,0,1,32,128,12,32,20,0,4];c[:10]=[0x4d334343,2,3 if initial else 7,0,0,2400,4,32,592,112];d[:2]=[0x4d334253,1];d[6:8]=[256,64];w[:5]=[0x4d33434f,1,2112,16,128];w[12]=64
 if enabled:
  for i in range(seq):
   r=[0]*128;r[:2]=[2,i+1];r[10:14]=[0x18c0c2b3,0xff020000,12,5];r[28:30]=[100 if i==seq-1 else 150,3];r[70:72]=[0x18c0c2b3,0x101]
   for at,n in [(2,0x1000+256*i),(4,0x20000004),(6,0x123004),(8,2**64-1),(14,0x99+i),(16,0x2000+256*i),(18,0x20000004),(20,0x20000004),(22,0x234000),(24,0x234000),(26,0x234000),(64,0x80050033),(66,0x350eb0),(68,0xd01)]:put(r,at,n)
   data=bytes.fromhex((SUB if i%2 else ADD)[8:-2])+bytes(116);r[32:64]=[int.from_bytes(data[j:j+4],'little') for j in range(0,128,4)];w[64+128*i:192+128*i]=r;w[5]+=1;w[6]+=r[28];w[7]+=r[29]
  for at,n in [(16,w[5]),(17,w[5]),(20,w[6]),(21,w[7]),(22,w[6]),(24,w[6]),(29,w[5])]:b[at]=n
 return dict(status=dict(running=False,status='prelaunch' if initial else 'paused'),captureErrors=[],m3aRaw=a,m3bRaw=b,censusRaw=c,boundaryRaw=d,codeRaw=w,nativeStatus=b[2],censusNativeStatus=c[2],pool=dict(charged=5000,limit=12000,linearMemoryBytes=2147483648))
def scenario(enabled=True):
 rows=[]
 def add(r):
  t=len(rows)+1;r.update(dict(readHostMs=t,signalHostMs=t) if r['event']=='gate' else dict(hostMs=t));rows.append(r)
 def storage():return dict(jitError=None,jitStatus=dict(running=False,status='paused'),jitRaw={'human-readable-text':'gen code size 10000/134152192\nTB count 1000\nTB flush count 0\n'})
 add(dict(native(enabled,0,True),event='startup',startupFailure=None,startupCpus=[{'cpu-index':0}]))
 for seq in range(10):
  r=dict(native(enabled,seq),**storage(),event='gate',seq=seq,gate=guest(seq))
  if not seq:r['layout']=copy.deepcopy(P)
  add(r);add(dict(event='ack',seq=seq,ack='K',watchEpoch=dict(m3a=0,m3b=0,census=0)))
 add(dict(native(enabled,9),**storage(),event='complete',validation=dict(calls=9,signals=8,contexts=8,patches=8)));return rows
def replay(rows,enabled=True):
 o=Contexts(enabled)
 for r in rows:o.accept(r)
 return o
class Tests(unittest.TestCase):
 def test_both_arms_and_all_active_boundaries(self):
  layout(P)
  for enabled in (False,True):
   o=replay(scenario(enabled),enabled);self.assertEqual(o.phase,'done');self.assertEqual(len(o.epochs),9);self.assertEqual(o.resets,[])
  for seq in (2,3):
   for off in (4,7,9,11,14):gate(guest(seq,off),P)
 def test_independent_flag_bits(self):
  for a,b,sub,want in [(0xffffffff,1,False,0x257),(0x7fffffff,1,False,0xa96),(0,1,True,0x297),(0x80000000,1,True,0xa16),(0,0,True,0x246)]:self.assertEqual(flags(a,b,sub),want)
 def test_guest_patch_alias_progress_and_return_corruption(self):
  for mutate in [lambda g:g.update(patches=2),lambda g:g.update(rxPagemap='0x8000000000000124'),lambda g:g.update(deliveries=0),lambda g:g['sample'].update(beforeRwHex=SUB),lambda g:g['sample'].update(afterRxHex=ADD),lambda g:g['sample'].update(pc='0x20000010'),lambda g:g['sample']['gpr'].__setitem__(2,'0xfff'),lambda g:g['sample']['gpr'].__setitem__(15,'0x0'),lambda g:g['observed']['gpr'].__setitem__(0,'0x0')]:
   g=guest(2);mutate(g)
   with self.assertRaises(ValueError):gate(g,P)
 def test_exact_RF_and_other_flags(self):
  for bit in (0x10000,0x100,0x200,1,4,16,64,128,2048):
   g=guest(2);g['sample']['rflags']=hex(int(g['sample']['rflags'],16)^bit)
   with self.assertRaises(ValueError):gate(g,P)
 def test_native_generation_bytes_page_payment_and_overflow(self):
  for mutate in [lambda r:r['codeRaw'].__setitem__(192+14,0x99),lambda r:r['codeRaw'].__setitem__(192+6,0x124004),lambda r:r['codeRaw'].__setitem__(192+33,0),lambda r:r['m3bRaw'].__setitem__(24,1),lambda r:r['codeRaw'].__setitem__(9,1),lambda r:r['m3bRaw'].__setitem__(11,4)]:
   rows=scenario();mutate(next(r for r in rows if r['event']=='gate' and r['seq']==2))
   with self.assertRaises(ValueError):replay(rows)
  rows=scenario();r=next(r for r in rows if r['event']=='gate' and r['seq']==3);r['codeRaw'][92]+=1;r['codeRaw'][6]+=1;r['m3bRaw'][20]+=1
  with self.assertRaises(ValueError):replay(rows)
 def test_ack_order_and_raw_guest_failure(self):
  rows=scenario();del rows[-2]
  with self.assertRaises(ValueError):replay(rows)
  rows=scenario();rows.insert(3,dict(event='configured',seq=0,hostMs=3))
  with self.assertRaises(ValueError):replay(rows)
  for raw in (b'M3B_SIGNAL_ALIAS_FAIL:bad\n',b'M3B_SIGNAL_ALIAS_UNKNOWN:{}\n'):
   with self.assertRaises(ValueError):serial_records(raw)
if __name__=='__main__':unittest.main()
