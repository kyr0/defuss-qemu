"""Small synthetic corruption fixtures. Never VM evidence or a guest replay."""
import copy
import unittest
import sys
from pathlib import Path
sys.path.insert(1,str(Path(__file__).resolve().parents[2]/"experiments/m3b-fused-pressure-review"))

from pressure import *
from suspension import decode

PC=0x403004
LAYOUT=dict(schema=1,sentinel=dict(a=hex(PC),b=hex(PC+5),back=hex(PC+10),side=hex(PC+12),end=hex(PC+13),ownerBytes=12,codeHex=CODE),generated=['0x10000000',hex(0x10000000+768000)],**{k:SETTINGS[k] for k in ('maxNodes','batch','iterations','retries','sleepNs')})
ELF=dict(schema=1,sentinel=LAYOUT['sentinel'])

def put(w,i,n):w[i]=n&U32;w[i+1]=n>>32
def tuple_words(kind):
    w=[0]*112
    for i,n in [(0,PC),(2,0x10000+kind*256),(4,123+kind),(6,0x20000+kind*256),(8,PC),(10,0x123004),(12,U64)]:put(w,i,n)
    w[14]=0x18c0c2b3|(RF if kind==1 else 0);w[15]=0xff020000;w[16]=int(kind==0);w[17]=0x18c0c2b3;w[19]=0x200|(RF if kind==1 else 0)
    for i,at in enumerate(SEG_OFF):w[at+4]=[0,0xa0fb00,0xc0f300,0,0,0,0x8200,0x8900][i];w[90+i]=w[at+4]|(0xf0000 if i in (1,2) else 0)
    return w

def observation(enabled=True,initial=False,epoch=4,installs=4750,retires=0,charged=None,compiled=20,tci=1,rf=0,bodies=15,churn=0,flushes=0):
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
    return dict(suspensionAbi=1,suspensionRaw=empty(),status=dict(running=False,status='prelaunch' if initial else 'paused'),captureErrors=[],m3aRaw=a,m3bRaw=b,censusRaw=c,boundaryRaw=boundary,nativeStatus=b[2],censusNativeStatus=c[2],pool=dict(limit=12000,charged=installs if charged is None else charged,linearMemoryBytes=512*1048576))

def with_jit(row,used=100000,flushes=0):
    return dict(row,jitError=None,jitStatus=dict(running=False,status='paused'),jitRaw={'human-readable-text':f'gen code size {used}/268368896\nTB count 1000\nTB flush count {flushes}\n'})

def empty():
    w=[0]*2624
    for k,v in {0:0x4d335357,1:1,2:2624,3:4,4:640,14:64}.items():w[k]=v
    return w

def episode():
    r=empty();r[5]=r[9]=1;r[10]=4;r[12]=0x4000;r[16]=0x5000;w=[0]*640
    for k,v in {0:1,1:2,2:1,3:1,4:0x12340,6:PC,8:0x20000,10:123,12:0x10000,14:1,16:0x6000,18:4,20:15,21:15,23:1,24:16,25:16,29:12000,30:6000}.items():w[k]=v
    for k in range(4):
        at=288+k*64
        for i,v in {0:k+1,1:[0,1,0,2][k],2:[1,0,2,0][k],3:1,4:0x12340,7:16,8:16,11:1,12:12000}.items():w[at+i]=v
    r[64:704]=w;return r

def scenario(enabled=True,observed=True):
    rows=[dict(observation(enabled,initial=True,epoch=0),event='startup',hostMs=0)]
    def add(stage,nodes,attempt,obs=False,**kw):
        seq=sum(r['event']=='gate' for r in rows);time=len(rows)*2
        r=dict(with_jit(observation(enabled,**kw),100000+len(rows)*10),event='gate',seq=seq,gate=gate(stage,nodes,attempt),signalHostMs=time,readHostMs=time+1)
        if obs:r['suspensionRaw']=episode()
        if stage=='layout':r['layout']=copy.deepcopy(LAYOUT)
        rows.append(r)
    def ack(x):rows.append(dict(event='ack',seq=sum(r['event']=='gate' for r in rows)-1,ack=x,hostMs=len(rows)*2,watchEpoch=dict(m3a=4,m3b=4,census=4)))
    add('layout',0,0,epoch=0,installs=4500);rows.append(dict(observation(enabled,compiled=0,tci=0,bodies=0,installs=4500),event='configured',seq=0,hostMs=len(rows)*2));ack('K')
    add('prefill',64,0,installs=7000,compiled=0,tci=0,bodies=0,churn=20);ack('R')
    add('warm',64,0,installs=7001,churn=20);ack('K')
    add('churn',128,0,installs=12000,retires=6000,churn=100);ack('R')
    for attempt in range(16):
        add('revisit',128,attempt,obs=enabled and observed,installs=12000,retires=6000,churn=100,compiled=21+attempt,bodies=16+attempt);ack('K')
    final=copy.deepcopy(rows[-2]);[final.pop(k,None) for k in ('seq','gate','signalHostMs','readHostMs')];final.update(event='complete',hostMs=len(rows)*2,validation=completion(128,16));rows.append(final);return rows

def replay(rows,enabled=True):
    o=Lifetime(enabled,ELF)
    for r in rows:o.accept(r)
    return o

class Tests(unittest.TestCase):
    def test_positive_and_incomplete(self):
        for enabled in (False,True):
            o=replay(scenario(enabled),enabled);self.assertEqual(o.status,'passed');self.assertEqual(o.attempts,16);self.assertEqual(len(o.episodes),int(enabled))
        self.assertEqual(replay(scenario(observed=False)).status,'incomplete')
    def test_corrupt_bank(self):
        decode(episode(),True);decode(empty(),False)
        for at in [0,1,2,3,4,5,6,7,9,10,11,14,15,18,64,65,66,67,78,79,82,83,84,85,87,88,89,90,91,92,93,96,224,352,353,354,355,356,358,359,360,361,363,364,365,608,704]:
            with self.subTest(at=at):
                r=episode();r[at]+=1
                with self.assertRaises(ValueError):decode(r,True)
        with self.assertRaises(ValueError):decode(episode(),False)
    def test_wrong_identity_cannot_qualify(self):
        for at in (2,8,10,12):
            rows=scenario()
            for r in rows:
                w=r.get('suspensionRaw')
                if w and w[5]:w[64+at]=0 if at==2 else w[64+at]+1
            self.assertEqual(replay(rows).status,'incomplete')
    def test_protocol_mutations(self):
        for seq,action in [(1,lambda r:r['m3aRaw'].__setitem__(23,6999)),(2,lambda r:r['gate'].__setitem__('nodes',0)),(3,lambda r:r['m3aRaw'].__setitem__(24,5999)),(4,lambda r:r['censusRaw'].__setitem__(10,8)),(5,lambda r:r['suspensionRaw'].__setitem__(96,1))]:
            rows=scenario();action(next(r for r in rows if r['event']=='gate' and r['seq']==seq))
            with self.assertRaises(ValueError):replay(rows)
        for value in (0,1,15,17,True):
            with self.assertRaises(ValueError):completion(128,value)
    def test_serial_protocol_rejects_fatal_unknown_duplicate_json(self):
        from review import serial_records
        self.assertEqual(serial_records(b'noise\r\nM3S_PRESSURE_GATE:{"stage":"layout"}\r\n'),[('GATE',{'stage':'layout'})])
        for value in [b'M3S_PRESSURE_FAIL:bad\n',b'M3S_PRESSURE_UNKNOWN:{}\n',b'M3S_PRESSURE_GATE:{"a":1,"a":2}\n',b'Kernel panic\n',b'M3S_PRESSURE_GATE:{"x":NaN}\n']:
            with self.assertRaises(ValueError):serial_records(value)
if __name__=='__main__':unittest.main()
