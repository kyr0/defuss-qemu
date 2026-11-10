"""Small synthetic corruption fixtures. Never VM evidence or a guest replay."""
import copy
import unittest
from pressure import *
from review import controller_identity

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
    return dict(status=dict(running=False,status='prelaunch' if initial else 'paused'),captureErrors=[],m3aRaw=a,m3bRaw=b,censusRaw=c,boundaryRaw=boundary,nativeStatus=b[2],censusNativeStatus=c[2],pool=dict(limit=12000,charged=installs if charged is None else charged,linearMemoryBytes=512*1048576))

def with_jit(row,used=100000,flushes=0):
    return dict(row,jitError=None,jitStatus=dict(running=False,status='paused'),jitRaw={'human-readable-text':f'gen code size {used}/268368896\nTB count 1000\nTB flush count {flushes}\n'})

def scenario(enabled=True,reentry=True):
    rows=[dict(observation(enabled,initial=True,epoch=0),event='startup',hostMs=0)]
    def add_gate(stage,nodes,attempt,**kw):
        seq=sum(r['event']=='gate' for r in rows);time=len(rows)*2
        row=dict(with_jit(observation(enabled,**kw),100000+len(rows)*10,kw.get('flushes',0)),event='gate',seq=seq,gate=gate(stage,nodes,attempt),signalHostMs=time,readHostMs=time+1)
        if stage=='layout':row['layout']=copy.deepcopy(LAYOUT)
        rows.append(row)
    def ack(value):rows.append(dict(event='ack',seq=sum(r['event']=='gate' for r in rows)-1,ack=value,hostMs=len(rows)*2,watchEpoch=dict(m3a=4,m3b=4,census=4)))
    add_gate('layout',0,0,epoch=0,installs=4500)
    rows.append(dict(observation(enabled,compiled=0,tci=0,bodies=0,installs=4500),event='configured',seq=0,hostMs=len(rows)*2));ack('K')
    add_gate('warm',0,0);ack('K')
    add_gate('churn',64,0,installs=12000,retires=6000,charged=12000,churn=100);ack('R')
    add_gate('revisit',64,0,installs=12000,retires=6000,charged=12000,churn=100,tci=5,bodies=19);ack('K')
    attempts=2 if reentry else 16
    for attempt in range(1,attempts):
        add_gate('revisit',64,attempt,installs=12100 if reentry else 12000,retires=6000,charged=6100 if reentry else 12000,churn=100,compiled=24 if reentry else 20,tci=5+attempt,bodies=23+attempt if reentry else 19+attempt);ack('R' if reentry else 'K')
    final=copy.deepcopy(rows[-2]);[final.pop(k,None) for k in ('seq','gate','signalHostMs','readHostMs')];final.update(event='complete',hostMs=len(rows)*2,validation=completion(64,attempts));rows.append(final)
    return rows

def replay(rows,enabled=True):
    o=Lifetime(enabled,ELF)
    for row in rows:o.accept(row)
    return o

class Tests(unittest.TestCase):
    def test_controller_is_bound_to_both_request_and_frozen_source(self):
        fixed=dict(sha256='a'*64,bytes=1234);controller_identity(dict(fixed),'a'*64,fixed)
        for copied,declared in [(dict(sha256='b'*64,bytes=1234),'b'*64),(dict(sha256='a'*64,bytes=1235),'a'*64),(dict(fixed),'b'*64),(dict(fixed),True),(dict(fixed,extra=1),'a'*64)]:
            with self.assertRaises(ValueError):controller_identity(copied,declared,fixed)
    def test_bounded_work_and_immutable_layout(self):
        self.assertEqual(layout(copy.deepcopy(LAYOUT)),LAYOUT);self.assertEqual(gate('churn',12000,0)['checks'],12010);self.assertEqual(completion(12000,16)['checks'],12026)
        for mutate in [lambda p:p.update(schema=True),lambda p:p['sentinel'].update(codeHex='90'*12),lambda p:p['sentinel'].update(a='0x0403004'),lambda p:p.update(retries=17),lambda p:p['generated'].__setitem__(1,'0x10000001')]:
            p=copy.deepcopy(LAYOUT);mutate(p)
            with self.assertRaises(ValueError):layout(p)
        for args in [('churn',65,0),('revisit',64,16),('layout',64,0),('warm',0,False)]:
            with self.assertRaises(ValueError):gate(*args)
    def test_independent_on_off_fifo_and_reentry(self):
        for enabled in (False,True):
            o=replay(scenario(enabled),enabled);self.assertEqual(o.status,'passed');self.assertEqual(o.seq,5);self.assertEqual(o.nodes,64);self.assertEqual(o.attempts,2);self.assertTrue(o.cap_fallback);self.assertEqual(o.retirement['seq'],2);self.assertEqual(o.reentry['seq'],4)
    def test_natural_gc_no_progress_is_incomplete(self):
        o=replay(scenario(reentry=False));self.assertEqual(o.status,'incomplete');self.assertEqual(o.attempts,16);self.assertIsNone(o.reentry)
    def test_warm_fifo_order_is_required(self):
        for mutate in [lambda r:r['m3aRaw'].__setitem__(23,6000),lambda r:r['m3aRaw'].__setitem__(24,1),lambda r:r['pool'].update(charged=4749)]:
            rows=scenario();warm=next(r for r in rows if r.get('gate',{}).get('stage')=='warm');mutate(warm)
            with self.assertRaises(ValueError):replay(rows)
    def test_first_retirement_size_full_pool_and_charge_bounds(self):
        for mutate in [lambda r:r['m3aRaw'].__setitem__(24,5999),lambda r:r['m3aRaw'].__setitem__(23,11999),lambda r:r['pool'].update(charged=12001),lambda r:r['pool'].update(charged=5999)]:
            rows=scenario();row=next(r for r in rows if r.get('gate',{}).get('stage')=='churn');mutate(row)
            with self.assertRaises(ValueError):replay(rows)
    def test_churn_cannot_reenter_or_reset_the_sentinel(self):
        for mutate in [lambda r:r['m3aRaw'].__setitem__(68,21),lambda r:r['censusRaw'].__setitem__(10,8),lambda r:r['m3bRaw'].__setitem__(36,21),lambda r:r['censusRaw'].__setitem__(64+91,0xa0fb00)]:
            rows=scenario();row=next(r for r in rows if r.get('gate',{}).get('stage')=='churn');mutate(row)
            with self.assertRaises(ValueError):replay(rows)
    def test_post_warm_flush_and_jit_corruption_fail(self):
        for transform in [lambda s:s.replace('TB flush count 0','TB flush count 1'),lambda s:s.replace('268368896','134217728'),lambda s:s+'TB count 1\n',lambda s:s.replace('gen code size','invalid size')]:
            rows=scenario();row=next(r for r in rows if r.get('gate',{}).get('stage')=='churn');row['jitRaw']['human-readable-text']=transform(row['jitRaw']['human-readable-text'])
            with self.assertRaises(ValueError):replay(rows)
        rows=scenario();row=next(r for r in rows if r.get('gate',{}).get('stage')=='churn');row['m3aRaw'][26]=1;row['jitRaw']['human-readable-text']=row['jitRaw']['human-readable-text'].replace('TB flush count 0','TB flush count 1')
        with self.assertRaisesRegex(ValueError,'No post-warm'):replay(rows)
    def test_reentry_requires_same_owner_generation_code_page_and_context(self):
        for at in (64+2,64+4,64+6,64+8,64+10,64+14,64+15,64+22,64+33,64+34,64+36,64+37,64+98):
            rows=scenario();row=next(r for r in rows if r.get('gate',{}).get('attempt')==1);row['censusRaw'][at]^=1
            with self.assertRaises(ValueError,msg=str(at)):replay(rows)
    def test_rf_compiled_attempts_cannot_substitute_for_fused_reentry(self):
        rows=scenario();index=next(i for i,r in enumerate(rows) if r.get('gate',{}).get('attempt')==1);old=rows[index]
        rows[index]=dict(with_jit(observation(installs=12100,retires=6000,charged=6100,compiled=20,tci=6,rf=4,bodies=24,churn=100),100000+index*10),**{k:old[k] for k in ('event','seq','gate','signalHostMs','readHostMs')})
        o=Lifetime(True,ELF)
        for row in rows[:index+1]:o.accept(row)
        self.assertIsNone(o.reentry);self.assertEqual(o.ack,'K')
        with self.assertRaises(ValueError):o.accept(rows[index+1])
    def test_fresh_install_is_not_proved_by_a_global_stale_miss(self):
        rows=scenario();row=next(r for r in rows if r.get('gate',{}).get('attempt')==1);row['m3aRaw'][23]=12000;row['m3aRaw'][22]=1
        with self.assertRaisesRegex(ValueError,'new installs'):replay(rows)
    def test_protocol_counts_clock_and_final_sentinel_are_exact(self):
        for mutate in [lambda rows:rows[1]['gate'].update(checks=3),lambda rows:rows[4].update(signalHostMs=0),lambda rows:rows[-1]['validation'].update(attempts=True),lambda rows:rows[-1]['m3aRaw'].__setitem__(68,25),lambda rows:rows[3].update(ack='R')]:
            rows=scenario();mutate(rows)
            with self.assertRaises(ValueError):replay(rows)
    def test_faulted_api_or_typed_injection_never_becomes_natural_evidence(self):
        for bank_name,at in [('censusRaw',3),('censusRaw',11),('censusRaw',16),('m3aRaw',34),('m3aRaw',35),('m3bRaw',25),('boundaryRaw',8)]:
            rows=scenario();rows[4][bank_name][at]=1
            with self.assertRaises(ValueError):replay(rows)

if __name__=='__main__':unittest.main()
