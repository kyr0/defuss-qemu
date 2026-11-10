"""Synthetic independent integer/context/protocol corruption tests."""
import copy,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(1,str(ROOT/'experiments/m3b-alias-smc-review'))
sys.path.insert(2,str(ROOT/'experiments/m3b-fused-pressure-review'))
from contexts import *
PC=0x20000004
LAYOUT={'generated':['0x70000000','0x700bb800']}
P=dict(schema=1,rx='0x20000000',rw='0x21000000',a=hex(PC),b=hex(PC+5),back=hex(PC+10),side=hex(PC+12),end=hex(PC+13),pageBytes=4096,codeBytes=17,physicalFrame='0x123')
def put(w,i,n):w[i]=n&U32;w[i+1]=n>>32
def tuple_words(kind):
    w=[0]*112
    for i,n in [(0,PC),(2,0x10000+kind*256),(4,123+kind),(6,0x20000+kind*256),(8,PC),(10,0x123004),(12,U64)]:put(w,i,n)
    w[14]=0x18c0c2b3|(RF if kind==1 else 0);w[15]=0xff020000;w[16]=int(kind==0);w[17]=0x18c0c2b3;w[19]=0x200|(RF if kind==1 else 0)
    for i,at in enumerate(SEG_OFF):w[at+4]=[0,0xa0fb00,0xc0f300,0,0,0,0x8200,0x8900][i];w[90+i]=w[at+4]|(0xf0000 if i in (1,2) else 0)
    return w

def original_observation(enabled=True,initial=False,epoch=4,installs=4750,retires=0,charged=None,compiled=20,tci=1,rf=0,bodies=15,churn=0,flushes=0):
    a=[0]*96;b=[0]*128;c=[0]*2400;boundary=[0]*256
    a[:11]=[0x4d335231,1,1,0 if initial else 1,0,176,88,24,4,64,8];a[11]=epoch;a[12]=1 if initial else 3
    b[:13]=[0x4d334231,1,63 if enabled else 62,0,0,1,32,128,12,32,20,epoch,4]
    c[:10]=[0x4d334343,2,3 if initial else 7,0,0,2400,4,32,592,112];c[10]=epoch
    for i,v in {0:0x4d334253,1:1,6:256,7:64}.items():boundary[i]=v
    if initial:installs=retires=compiled=tci=rf=bodies=churn=0
    if not epoch:compiled=tci=rf=bodies=churn=0
    a[18]=a[19]=compiled+rf+churn;a[23]=installs;a[24]=retires;a[26]=flushes
    if epoch:
        for slot in range(4):
            begin=PC if slot==0 else int(LAYOUT['generated'][0],16) if slot==1 else 0;end=PC+1 if slot==0 else int(LAYOUT['generated'][1],16) if slot==1 else 0
            for w,at in [(a,64+8*slot),(b,32+20*slot)]:put(w,at,begin);put(w,at+2,end)
            a[71+8*slot]=int(bool(begin));count=compiled+rf if slot==0 else churn if slot==1 else 0;a[68+8*slot]=count
            if count:put(a,69+8*slot,begin)
            c[32+592*slot+4]=slot+1
        s=32;put(c,s,PC);c[s+2]=1;c[s+3]=int(enabled);c[13]=1;kind=0 if enabled else 2
        c[s+6]=c[12]=compiled+tci+rf;c[s+7]=rf;c[s+8+2*kind]=compiled;c[s+9+2*kind]=tci;c[s+10]=rf;c[s+20]=compiled+rf;c[s+21]=tci
        if compiled+tci:c[s+16]|=1<<kind;c[s+18]=kind;c[s+19]=int(tci>0);c[s+32+112*kind:s+32+112*(kind+1)]=tuple_words(kind)
        if rf:c[s+16]|=2;c[s+18]=1;c[s+19]=0;c[s+144:s+256]=tuple_words(1)
        if enabled and compiled+tci:
            for i,v in {16:1,17:1,20:compiled,21:tci,22:bodies,24:bodies,29:1,36:compiled,37:tci,38:bodies,40:bodies,41:1,43:1}.items():b[i]=v
            put(b,48,PC);put(b,50,123)
    return dict(status=dict(running=False,status='prelaunch' if initial else 'paused'),captureErrors=[],m3aRaw=a,m3bRaw=b,censusRaw=c,boundaryRaw=boundary,nativeStatus=b[2],censusNativeStatus=c[2],pool=dict(limit=12000,charged=installs if charged is None else charged,linearMemoryBytes=512*1048576))


P=dict(schema=1,rx='0x20000000',a='0x20000004',b='0x20000009',back='0x2000000e',side='0x20000010',end='0x20000011',physicalFrame='0x123',timer='ITIMER_VIRTUAL',timerUsec=10000,cases=8,codeHex=ADD)
def observation(enabled=True,seq=0,configured=True,initial=False):
 r=original_observation(enabled,initial,epoch=4 if configured else 0,installs=5000,compiled=seq*100,tci=seq*10,bodies=seq*90)
 r['m3aRaw'][72:80]=[0]*8;r['m3bRaw'][52:72]=[0]*20;return r
def guest(seq,off=9):
 zero=dict(gpr=['0x0']*16,rflags='0x0')
 if not seq:return dict(seq=0,stage='layout',case=-2,iterations=0,step=0,deliveries=0,initial=zero,observed=copy.deepcopy(zero),sample=None)
 n,step,seed=initial(seq-2,0x100000);after=copy.deepcopy(seed);after['gpr'][0]=hex(n*step&U32);after['gpr'][2]='0x0';after['rflags']='0x246';sample=None
 if seq>1:
  left=0 if off==16 else 123;acc=(n-left)*step&U32;ef=flags(left,0,True)
  if off in (4,14):ef=flags(left+1,1,True)
  if off==11:ef=flags(acc,step,False);acc=(acc+step)&U32
  regs=seed['gpr'].copy();regs[0]=hex(acc);regs[2]=hex(left);regs[7]=hex(0x100000-8);sample=dict(signo=26,code=128,error=0,pc=hex(0x20000000+off),gpr=regs,rflags=hex(ef|0x10000))
 return dict(seq=seq,stage='warm' if seq==1 else 'signal',case=seq-2,iterations=n,step=step,deliveries=int(seq>1),initial=seed,observed=after,sample=sample)
def scenario(enabled=True):
 rows=[]
 def add(r):
  t=len(rows)+1;r.update(dict(signalHostMs=t,readHostMs=t) if r['event']=='gate' else dict(hostMs=t));rows.append(r)
 def storage():return dict(jitError=None,jitStatus=dict(running=False,status='paused'),jitRaw={'human-readable-text':'gen code size 10000/134152192\nTB count 1000\nTB flush count 0\n'})
 add(dict(observation(enabled,0,False,True),event='startup',startupFailure=None,startupCpus=[{'cpu-index':0}]))
 for seq in range(10):
  r=dict(observation(enabled,seq,seq>0),**storage(),event='gate',seq=seq,gate=guest(seq))
  if not seq:r['layout']=copy.deepcopy(P)
  add(r)
  if not seq:add(dict(observation(enabled),event='configured',seq=0))
  add(dict(event='ack',seq=seq,ack='K',watchEpoch=dict(m3a=4,m3b=4,census=4)))
 add(dict(observation(enabled,9),**storage(),event='complete',validation=dict(calls=9,signals=8,contexts=8)));return rows
def replay(rows,enabled=True):
 o=Contexts(enabled)
 for r in rows:o.accept(r)
 return o
class Tests(unittest.TestCase):
 def test_complete_both_arms_and_each_boundary(self):
  for enabled in (False,True):
   o=replay(scenario(enabled),enabled);self.assertEqual(o.phase,'done');self.assertEqual(len(o.epochs),9);self.assertEqual(o.resets,[dict(seq=0,epoch=4)])
  for off in (4,7,9,11,14,16):gate(guest(2,off),P)
 def test_independent_flag_bit_cases(self):
  for a,b,sub,want in [(0xffffffff,1,False,0x257),(0x7fffffff,1,False,0xa96),(0,1,True,0x297),(0x80000000,1,True,0xa16),(0,0,True,0x246)]:self.assertEqual(flags(a,b,sub),want)
 def test_context_provenance_count_progress_and_resume_corruption(self):
  for mutate in [lambda g:g.update(deliveries=2),lambda g:g['sample'].update(code=0),lambda g:g['sample'].update(pc='0x20000005'),lambda g:g['sample']['gpr'].__setitem__(0,'0x0'),lambda g:g['sample']['gpr'].__setitem__(7,g['initial']['gpr'][7]),lambda g:g['sample']['gpr'].__setitem__(2,'0x100000000'),lambda g:g['observed']['gpr'].__setitem__(15,'0x0')]:
   g=guest(2);mutate(g)
   with self.assertRaises(ValueError):gate(g,P)
 def test_exact_RF_and_every_other_flag(self):
  for bit in (0x10000,0x100,0x200,1,4,16,64,128,2048):
   g=guest(2);g['sample']['rflags']=hex(int(g['sample']['rflags'],16)^bit)
   with self.assertRaises(ValueError):gate(g,P)
 def test_native_owner_epoch_payment_and_flush_corruption(self):
  for mutate in [lambda r:r['censusRaw'].__setitem__(32+32+4,124),lambda r:r['censusRaw'].__setitem__(32+32+10,0x124004),lambda r:r['m3bRaw'].__setitem__(40,181),lambda r:r['m3bRaw'].__setitem__(11,8),lambda r:r['jitRaw'].update({'human-readable-text':'gen code size 10000/134152192\nTB count 1000\nTB flush count 1\n'})]:
   rows=scenario();mutate(next(r for r in rows if r['event']=='gate' and r['seq']==2))
   with self.assertRaises(ValueError):replay(rows)
 def test_missing_ack_duplicate_config_and_raw_serial_corruption(self):
  rows=scenario();del rows[3]
  with self.assertRaises(ValueError):replay(rows)
  rows=scenario();rows.insert(6,copy.deepcopy(rows[2]))
  with self.assertRaises(ValueError):replay(rows)
  from review import serial_records
  self.assertEqual(serial_records(b'M3B_SIGNAL_PASS:{"calls":9}\n'),[('PASS',{'calls':9})])
  for b in (b'M3B_SIGNAL_FAIL:bad\n',b'M3B_SIGNAL_GATE:{"seq":0,"seq":1}\n',b'M3B_SIGNAL_OTHER:{}\n',b'M3B_SIGNAL_GATE:{"seq":NaN}\n'):
   with self.assertRaises(ValueError):serial_records(b)
if __name__=='__main__':unittest.main()
