"""Independent Python arithmetic, native-bank and raw trace checks; no VM API."""
import json
import math
import re

U32=(1<<32)-1
U64=(1<<64)-1
RF=0x10000
SEG_MASK=0x00f0ff00
SEG_OFF=[28,33,38,43,48,53,64,69]
SEG_NAMES=['ES','CS','SS','DS','FS','GS','LDT','TR']
REGS='rax rbx rcx rdx rsi rdi rbp rsp r8 r9 r10 r11 r12 r13 r14 r15'.split()
M3A='published eligiblePublished compiledAttempts selectedEntries fallbackEntries invalidRedispatches staleInstanceMisses instanceInstalls instanceRetires invalidations flushes emittedWasmBytes importBytes descriptorBytes invalidMetadata generationExhaustions extraWorkerRejects watchPcMismatches injectedStaleInstances injectedInvalidDescriptors injectionRejects'.split()
M3B='predecodeAccepted formed cleanRetries entryRejects compiledEntries tciEntries BAttempts BRequested servicePaid debtErrors tciTargetReturns backedgeTciReturns IRRejected emittedOwners'.split()
WATCH='compiledEntries tciEntries BAttempts BRequested servicePaid predecodeAccepted IRRejected emittedOwners entryRejects cleanRetries backedgeTciReturns'.split()
SPECS=[('m3b_add32','fused','add32'),('m3b_add64','fused','add64'),('m3b_imul64','ir-retry','imul64'),('m3b_dynamic','ir-retry','dynamic'),('m3b_memory','predecode-reject','memory'),('m3b_insns32','fused','add32'),('m3b_insns33','predecode-reject','add32'),('m3b_bytes128','fused','add32-prefix'),('m3b_bytes129','predecode-reject','add32-prefix'),('m3b_page_end','ir-retry','add32'),('m3b_page_cross','predecode-reject','add32')]

def need(ok,why):
    if not ok: raise ValueError(why)
def eq(a,b,why):
    need(json.dumps(a,sort_keys=True,separators=(',',':'),allow_nan=False)==json.dumps(b,sort_keys=True,separators=(',',':'),allow_nan=False),why)
def integer(n,hi=U32): return type(n) is int and 0<=n<=hi
def number(n): return type(n) in (int,float) and math.isfinite(n) and n>=0
def bank(w,n):
    need(type(w) is list and len(w)==n and all(integer(v) for v in w),'Exact uint32 bank'); return w
def zero(w,why='Nonzero reserved/fault data'): need(not any(w),why)
def pair(w,i): return w[i]|w[i+1]<<32
def hx(n): return hex(n)
def word(n): return format(n&U64,'016x')

def reference():
    seed=0x4a72db913c60e58f; digest=0xcbf29ce484222325; checks=4; rows=[]
    def random():
        nonlocal seed
        seed=(seed^(seed<<13))&U64; seed^=seed>>7; seed=(seed^(seed<<17))&U64; return seed
    def one(model,count):
        nonlocal checks,digest
        r=[random() for _ in range(16)]; flags=0x202|(random()&0x8d5)
        if model in ('add64','imul64'): r[9]=count
        else: r[2]=(random()&0xffffffff00000000)|count
        if model=='dynamic': flags=(flags&~64)|(0 if count else 64)
        memory=random()&U32
        for _ in range(count):
            if model=='add64': r[10]=((r[10]^r[13])+17)&U64
            elif model=='imul64': r[10]=(r[10]*0xfffffffffffffff9+17)&U64
            elif model=='memory': memory=(memory+7)&U32
            else: r[0]=(((r[0]&U32)+53)^(r[3]&U32))&U32
        if count: r[9 if model in ('add64','imul64') else 2]=0
        if model=='add32-prefix': r[8]=0x7139ac4e0528b6df
        if model!='dynamic' or count: flags=0x246
        for v in [v for i,v in enumerate(r) if i!=7 and not(model=='memory' and i==4)]+[flags,memory]: digest=((digest^v)*0x100000001b3)&U64
        checks+=20
    def emit(p,phase,calls,bodies): rows.append(dict(seq=len(rows),program=p,phase=phase,calls=calls,bodies=bodies,checks=checks,digest=word(digest)))
    emit(-1,'layout',0,0)
    for p,(_,_,model) in enumerate(SPECS):
        for _ in range(4096): one(model,4)
        emit(p,'warm',4096,16384)
        for _ in range(64): one(model,0)
        emit(p,'side',64,0)
        for phase in ('body','direct-b'):
            for n in range(64): one(model,1+n%17)
            emit(p,phase,64,550)
    return rows,dict(schema=1,programs=11,gates=45,checks=checks,digest=word(digest))

def layout_check(layout):
    eq(layout['schema'],1,'Layout schema'); need(len(layout['programs'])==11,'Eleven programs'); occupied=[]
    for p,spec in zip(layout['programs'],SPECS):
        eq([p['name'],p['expectation']],list(spec[:2]),'Program identity')
        a,b,back,side,end=[int(p[k],16) for k in ('a','b','back','side','end')]
        need(0x100000<=a<b<back<side<end<=1<<32,'Static address extent')
        code=bytes.fromhex(p['codeHex']); need(len(code)==p['ownerBytes']==side-a<=160,'Owner bytes')
        j=back-a; need(code[j] in (0xeb,0xe9),'Closing direct jump'); n=2 if code[j]==0xeb else 5
        need(j+n==len(code) and len(code)+int.from_bytes(code[j+1:j+n],'little',signed=True)==0,'Closing jump A')
        need(all(end<=x or a>=y for x,y in occupied),'Disjoint programs'); occupied.append((a,end))
        need((a>>12 != (side-1)>>12)==(p['name']=='m3b_page_cross'),'Page shape')
        if p['name']=='m3b_page_end': need(side%4096==0,'Exact page end')
        if p['name'] in ('m3b_bytes128','m3b_bytes129'): need(len(code)==int(p['name'][-3:]),'Byte bound shape')

def native(row,enabled,initial=False):
    eq(row['captureErrors'],[],'Native read error'); eq(row['status'].get('running'),False,'Stopped'); eq(row['status']['status'],'prelaunch' if initial else 'paused','Stop state')
    a=bank(row['m3aRaw'],96); b=bank(row['m3bRaw'],128); idle=bank(row['boundaryRaw'],256)
    eq(a[:11],[0x4d335231,1,1,0 if initial else 1,0,176,88,24,4,64,8],'M3a header')
    zero(a[13:16]+a[37:40]+a[49:64]); ac=dict(zip(M3A,a[16:37])); need(ac['compiledAttempts']==ac['selectedEntries']+ac['fallbackEntries']+ac['invalidRedispatches'],'M3a attempt conservation'); need(ac['fallbackEntries']==sum(a[40:49]),'M3a fallback conservation')
    zero([ac[n] for n in ('invalidMetadata','generationExhaustions','extraWorkerRejects','watchPcMismatches','injectedStaleInstances','injectedInvalidDescriptors','injectionRejects')])
    expected={0:0x4d334231,1:1,2:63 if enabled else 62,3:0,4:0,5:1,6:32,7:128,8:12,9:32,10:20,12:4}
    for i,v in expected.items(): eq(b[i],v,'M3b header '+str(i))
    zero(b[13:16]+b[30:32]+b[112:]); bc=dict(zip(M3B,b[16:30])); zero([bc[n] for n in ('debtErrors','entryRejects')]); need(bc['BRequested']<=bc['BAttempts']==bc['servicePaid'],'Service conservation')
    if not enabled or initial: zero(b[16:30])
    want=[0]*256
    for i,v in {0:0x4d334253,1:1,6:256,7:64}.items(): want[i]=v
    eq(idle,want,'No boundary injection'); eq(row['nativeStatus'],b[2],'Native status')
    need(row['pool']['limit']==12000 and integer(row['pool']['charged'],12000) and integer(row['pool']['linearMemoryBytes'],1<<53) and row['pool']['linearMemoryBytes']>0,'Hard pool bound')
    aw=[]; bw=[]
    for slot in range(4):
        at=64+8*slot; need(a[at+7] in (0,1),'M3a watch state'); aw.append(dict(begin=pair(a,at),end=pair(a,at+2),selected=a[at+4],last=pair(a,at+5),enabled=bool(a[at+7])))
        at=32+20*slot; w=dict(zip(WATCH,b[at+4:at+15])); w.update(begin=pair(b,at),end=pair(b,at+2),last=pair(b,at+16),generation=pair(b,at+18)); eq(b[at+15],0,'Watch reserved')
        need(w['BRequested']<=w['BAttempts']==w['servicePaid'] and w['entryRejects']==0,'Watch service'); need(all(w[k]<=bc[k] for k in WATCH),'Watch/global relation')
        if w['compiledEntries']+w['tciEntries']: need(w['begin']<=w['last']<w['end'] and w['generation']>0,'Selected owner')
        else: zero([w['last'],w['generation']])
        if not enabled or w['begin']==w['end']: zero([w[k] for k in WATCH])
        bw.append(w)
    if initial: zero(list(ac.values())+a[40:49])
    c=census(row['censusRaw'],initial); eq(row['censusNativeStatus'],c['state'],'Census status')
    eq(a[11],b[11],'Watch epoch'); eq(a[11],c['epoch'],'Census epoch')
    return dict(a=ac,b=bc,aw=aw,bw=bw,c=c,epoch=a[11])

def tuple_check(t,kind,pc):
    bank(t,112); zero(t[98:]); eq(pair(t,0),pc,'Tuple current PC')
    need(all(pair(t,i)>0 for i in (2,4,6)),'Owner/code/generation'); eq(t[16],int(kind==0),'Tuple fused'); eq(t[19]&0x73300,t[19],'Control EFLAGS mask')
    eq(bool(t[14]&RF),kind==1,'TB RF'); eq(bool(t[19]&RF),kind==1,'Architectural RF')
    for i,at in enumerate(SEG_OFF): need(t[at]<=0xffff,'Selector width'); eq(t[at+4],t[90+i]&SEG_MASK,'Canonical segment/raw relation')

def tuple_equal(a,b,cross=False):
    for i in range(8 if cross else 0,112):
        if 90<=i<98 or cross and i==16: continue
        x,y=a[i],b[i]
        if cross and i in (14,17,19): x&=~RF; y&=~RF
        eq(x,y,'Native semantic tuple word '+str(i))

def census(raw,initial=False):
    w=bank(raw,2400); eq(w[:10],[0x4d334343,2,3 if initial else 7,0,0,2400,4,32,592,112],'ABI2 census header'); zero(w[11:12]+w[14:32],'API/injection evidence'); need(w[13]<=15,'Active mask')
    slots=[]; mask=0; total=0
    for slot in range(4):
        s=w[32+592*slot:32+592*(slot+1)]; pc=pair(s,0); need(s[2] in (0,1) and s[3] in (0,1) and s[4]<=w[10],'Slot config'); zero([s[5],s[17]]+s[24:32]+s[480:],'Sticky/first fault bank')
        if s[2]: need(0x100000<=pc<1<<32,'Watch PC'); mask|=1<<slot
        else: eq(pc,0,'Inactive PC'); zero([s[3]]+s[5:])
        need(s[6]==sum(s[8:16])==sum(s[20:24]),'Exact class/site partitions'); eq(s[20],sum(s[i] for i in (8,10,12,14)),'Compiled sites'); eq(s[7],s[10]+s[11],'RF partition'); zero(s[14:16])
        if s[3]: zero(s[12:14],'Ordinary normal owner under requireFused')
        tuples=[]; present=0
        for kind in range(4):
            t=s[32+112*kind:32+112*(kind+1)]
            if s[8+2*kind]+s[9+2*kind]: tuple_check(t,kind,pc); present|=1<<kind; tuples.append(t)
            else: zero(t); tuples.append(None)
        eq(s[16],present,'First tuple completeness'); observed=[t for t in tuples if t]
        for t in observed[1:]: tuple_equal(observed[0],t,True)
        if s[6]: need(s[18]<4 and s[19]<2 and s[8+2*s[18]+s[19]]>0,'Last observed kind/tier')
        else: zero([s[7],s[16],s[18],s[19]])
        slots.append(dict(raw=s,pc=pc,active=bool(s[2]),required=bool(s[3]),epoch=s[4],total=s[6],rf=s[7],counts=s[8:16],sites=s[20:24],tuples=tuples)); total+=s[6]
    eq(mask,w[13],'Active mask'); need(total<=w[12],'Cumulative attempt bound')
    if initial: zero(w[10:])
    return dict(raw=w,state=w[2],epoch=w[10],total=w[12],slots=slots)

def ranges(s,program,epoch,enabled,clear):
    eq(s['epoch'],epoch,'Expected watch epoch')
    for slot in range(4):
        start=int(program['a' if slot==0 else 'b'],16) if program and slot<2 else 0
        for w in (s['aw'][slot],s['bw'][slot]): eq([w['begin'],w['end']],[start,start+1 if start else 0],'Exact A/B watch')
        a,b,c=s['aw'][slot],s['bw'][slot],s['c']['slots'][slot]; eq(a['enabled'],bool(start),'Watch enabled'); eq(a['last'],start if a['selected'] else 0,'Selected PC')
        cp=int(program['a'],16) if program and slot==0 else 0
        eq([c['pc'],c['active'],c['required'],c['epoch']],[cp,bool(cp),bool(cp and enabled and program['expectation']=='fused'),epoch-3+slot if epoch else 0],'Census watch config')
        if cp: eq(c['sites'][0],a['selected'],'Every compiled A site'); eq(c['counts'][:2],[b['compiledEntries'],b['tciEntries']],'Every fused tier')
        else: eq(c['total'],0,'Inactive census')
        if clear: zero([a['selected'],b['last'],b['generation'],c['total']]+[b[n] for n in WATCH])

def basic_window(s,p,gate,enabled):
    a,b=s['aw'][:2]; f,fb=s['bw'][:2]; need(a['selected']>0,'Selected compiled A exposure'); zero([fb[n] for n in WATCH])
    if gate['phase'] in ('warm','direct-b'): need(b['selected']>0,'Distinct compiled B exposure')
    if not enabled: zero([f[n] for n in WATCH]); return
    if p['expectation']=='fused':
        need(f['compiledEntries']>0,'Actual fused compiled exposure')
        if gate['phase']=='warm': need(f['predecodeAccepted']>0 and f['emittedOwners']>0,'Warm fused generation')
    else:
        zero([f[n] for n in ('compiledEntries','tciEntries','emittedOwners','BAttempts','servicePaid')])
        if gate['phase']=='warm':
            v=[f[n] for n in ('predecodeAccepted','IRRejected','cleanRetries')]
            if p['expectation']=='ir-retry': need(all(n>0 for n in v),'IR retry exposure')
            else: zero(v,'Predecoder rejects shape')
