"""Synthetic independent-language alias tests; never actual VM evidence."""
import copy,sys,unittest
from pathlib import Path
sys.path.insert(1,str(Path(__file__).resolve().parents[2]/'experiments/m3b-fused-pressure-review'))
from alias import *
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

def observation(enabled=True,epoch=4,phase=0,work=False,invalidations=0,initial=False):
 r=original_observation(enabled,initial=initial,epoch=epoch,installs=5000,compiled=100 if work else 0,tci=10 if work else 0,bodies=90 if work else 0);a,b,c=r['m3aRaw'],r['m3bRaw'],r['censusRaw'];completed=phase+int(work)
 a[72:80]=[0]*8;b[52:72]=[0]*20;a[18]=a[19]=100*completed;a[25]=invalidations;c[12]=110*completed
 if enabled:b[16]=b[17]=b[29]=completed;b[20]=100*completed;b[21]=10*completed;b[22]=b[24]=90*completed
 if epoch:
  for i in range(4):c[32+592*i+4]=epoch-3+i
 if work:
  kind=0 if enabled else 2;owner_phase=phase if enabled else 0;at=32+32+112*kind
  put(c,at+2,0x10000+owner_phase*4096+kind*256);put(c,at+4,123+owner_phase+kind);put(c,at+6,0x20000+owner_phase*4096+kind*256)
  if enabled:put(b,50,123+phase)
 return r

def guest_gate(seq):
 sub=seq in (2,3)
 return dict(seq=seq,stage=STAGES[seq],checks=[0,8,8,16,16,24][seq],patches=[0,0,1,1,2,2][seq],rxPagemap='0xa080000000000123',rwPagemap='0xa080000000000123',rxHex=SUB if sub else ADD,rwHex=SUB if sub else ADD,values=values(sub) if seq%2 else [])
def scenario(enabled=True):
 rows=[]
 def add(r):
  t=len(rows)+1;r.update(dict(signalHostMs=t,readHostMs=t) if r['event']=='gate' else dict(hostMs=t));rows.append(r)
 def storage():return dict(jitError=None,jitStatus=dict(running=False,status='paused'),jitRaw={'human-readable-text':f'gen code size {10000+len(rows)}/134152192\nTB count 1000\nTB flush count 0\n'})
 add(dict(observation(enabled,initial=True,epoch=0),event='startup',startupFailure=None,startupCpus=[{'cpu-index':0}]))
 epoch=phase=0
 for seq in range(6):
  r=dict(observation(enabled,epoch,phase,seq>0,seq//2),**storage(),event='gate',seq=seq,gate=guest_gate(seq))
  if seq==0:r['layout']=copy.deepcopy(P)
  add(r)
  if seq%2==0:
   phase=seq//2;epoch+=4;add(dict(observation(enabled,epoch,phase,False,seq//2),event='configured',seq=seq))
  add(dict(event='ack',seq=seq,ack='K',watchEpoch=dict(m3a=epoch,m3b=epoch,census=epoch)))
 add(dict(observation(enabled,12,2,True,2),**storage(),event='complete',validation=dict(checks=24,calls=24,patches=2)));return rows

def replay(rows,enabled=True):
 o=Alias(enabled)
 for r in rows:o.accept(r)
 return o
class Tests(unittest.TestCase):
 def test_raw_serial_rejects_duplicate_unknown_or_failed_records(self):
  from review import serial_records
  self.assertEqual(serial_records(b'boot\r\nM3B_ALIAS_PASS:{"checks":24}\r\n'),[('PASS',{'checks':24})])
  for raw in (b'M3B_ALIAS_PASS:{"checks":24,"checks":0}\n',b'M3B_ALIAS_OTHER:{}\n',b'M3B_ALIAS_FAIL:bad\n',b'M3B_ALIAS_GATE:{"seq":NaN}\n',b'M3B_ALIAS_GATE:{\n'):
   with self.assertRaises(ValueError):serial_records(raw)
 def test_protocol_requires_complete_order_and_exact_service_payment(self):
  for change in ('missing','duplicate','ack','service'):
   rows=scenario()
   if change=='missing':del rows[2]
   elif change=='duplicate':rows.insert(2,copy.deepcopy(rows[1]))
   elif change=='ack':next(r for r in rows if r['event']=='ack')['ack']='X'
   else:next(r for r in rows if r['event']=='gate' and r['seq']==1)['m3bRaw'][40]+=1
   with self.assertRaises(ValueError):replay(rows)
 def test_three_epochs_with_ordinary_A_reuse_and_fused_replacement(self):
  for enabled in (False,True):
   o=replay(scenario(enabled),enabled);self.assertEqual(o.phase,'done');self.assertEqual(len(o.epochs),3);self.assertEqual(o.resets,[dict(seq=0,epoch=4),dict(seq=2,epoch=8),dict(seq=4,epoch=12)])
   self.assertEqual(len(set(pair(x['tuple'],4) for x in o.epochs)),3 if enabled else 1)
 def test_physical_and_byte_corruption(self):
  for mutate in [lambda r:r.update(rxPagemap='0xa080000000000124'),lambda r:r.update(rwPagemap='0x2080000000000123'),lambda r:r.update(rxHex=ADD),lambda r:r.update(values=values(False)),lambda r:r.update(patches=0)]:
   g=guest_gate(3);mutate(g)
   with self.assertRaises(ValueError):gate(g,P)
 def test_stale_fused_owner_or_wrong_page(self):
  for at,value in [(32+32+4,123),(32+32+2,0x10000),(32+32+6,0x20000),(32+32+10,0x124004)]:
   rows=scenario();next(r for r in rows if r['event']=='gate' and r['seq']==3)['censusRaw'][at]=value
   with self.assertRaises(ValueError):replay(rows)
 def test_patch_window_is_quiescent_and_invalidates_normally(self):
  for mutate in [lambda r:r['m3aRaw'].__setitem__(25,0),lambda r:r['m3aRaw'].__setitem__(68,101),lambda r:r['censusRaw'].__setitem__(38,111)]:
   rows=scenario();mutate(next(r for r in rows if r['event']=='gate' and r['seq']==2))
   with self.assertRaises(ValueError):replay(rows)
 def test_only_declared_watch_epochs_and_no_global_flush(self):
  rows=scenario();next(r for r in rows if r['event']=='ack' and r['seq']==1)['watchEpoch']['census']=8
  with self.assertRaises(ValueError):replay(rows)
  rows=scenario();next(r for r in rows if r['event']=='gate' and r['seq']==3)['jitRaw']['human-readable-text']='gen code size 10000/134152192\nTB count 1000\nTB flush count 1\n'
  with self.assertRaises(ValueError):replay(rows)
if __name__=='__main__':unittest.main()
