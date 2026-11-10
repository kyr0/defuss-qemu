"""Separate Python reconstruction of declared guest XSAVE seed/state bytes."""
import struct

def need(ok,why):
    if not ok:raise ValueError(why)

def caps(c):
    need(set(c)==set('schema mask size ymmOffset pkruOffset bndregsOffset bndcsrOffset patterns'.split()),'Exact component map')
    need(c['schema']==1 and c['patterns']==2 and c['mask'] in (7,31,519,543),'Supported complete user XCR0')
    m=c['mask'];need(c['size']==(2696 if m&512 else 1088 if m&24 else 832),'Standard area size')
    need(c['ymmOffset']==576 and c['pkruOffset']==(2688 if m&512 else 0),'YMM/PKRU layout')
    need(c['bndregsOffset']==(960 if m&24 else 0) and c['bndcsrOffset']==(1024 if m&24 else 0),'MPX layout')
    return c

def seed(c,p):
    caps(c);need(type(p) is int and p in (0,1),'Seed pattern');b=bytearray(c['size'])
    struct.pack_into('<H',b,0,0x037f+p*0x400);b[4]=255;struct.pack_into('<I',b,24,0x1f80+p*0x2000)
    for i in range(8):struct.pack_into('<QH',b,32+i*16,0x8000000000000000|((i+1)*0x01020304050607+p),0x3ff0+i)
    for i in range(256):b[160+i]=(i*73+29+p*101)&255;b[c['ymmOffset']+i]=((i+256)*73+29+p*101)&255
    if c['bndregsOffset']:
        for i in range(8):struct.pack_into('<Q',b,c['bndregsOffset']+i*8,0x0102030405060708*(i+1)+p)
        struct.pack_into('<Q',b,c['bndcsrOffset']+8,0x100000+p*4096)
    struct.pack_into('<Q',b,512,c['mask'])
    if c['pkruOffset']:struct.pack_into('<I',b,c['pkruOffset'],0xaaaaaaa8 if p else 0x55555554)
    return bytes(b)

def compare(actual,c,p):
    expected=seed(c,p);need(type(actual) is bytes and len(actual)==len(expected),'Exact area bytes')
    intervals=[(0,5),(8,28),(160,416),(512,528),(576,832)]+[(32+i*16,42+i*16) for i in range(8)]
    if c['bndregsOffset']:intervals.extend([(960,1024),(1024,1040)])
    if c['pkruOffset']:intervals.append((2688,2692))
    for a,b in intervals:need(actual[a:b]==expected[a:b],f'Architectural bytes {a}:{b}')
    need(struct.unpack_from('<H',actual,6)[0]&0x7ff==0,'FOP defined bits')
    mxcsr,mask=struct.unpack_from('<II',actual,24);need(mask!=0 and mxcsr&~mask==0,'MXCSR mask');return mask

def state(row,c,gate):
    caps(c);need(set(row)=={'seq','invocations','samples'} and row['seq']==gate['seq'],'Exact state event')
    need((gate['checks']-4)%20==0,'Original check count');n=(gate['checks']-4)//20
    need(0<=n<=47168 and row['invocations']==n and len(row['samples'])==2,'Invocation count')
    for p,s in enumerate(row['samples']):
        need(set(s)=={'pattern','invocation','before','after'} and s['pattern']==p,'Ordered samples')
        need(s['invocation']==(n-1+p if n else 0),'Latest sample ordinals')
        banks=[]
        for key in ('before','after'):
            text=s[key];need(type(text) is str and len(text)==c['size']*2 and all(x in '0123456789abcdef' for x in text),'Canonical hex')
            b=bytes.fromhex(text);banks.append(b)
        if n:need(compare(banks[0],c,p)==compare(banks[1],c,p),'Same MXCSR mask')
        else:need(not any(banks[0]+banks[1]),'Initial empty samples')
    return {'seq':gate['seq'],'invocations':n,'patterns':2 if n else 0,'mask':c['mask']}
