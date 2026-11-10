"""Bounded independent parser and exact RF certificates for the frozen fixture."""
import re
from semantics import *

def segment(line,prefix):
    m=re.fullmatch(re.escape(prefix)+r'([0-9a-f]{4}) ([0-9a-f]{16}) ([0-9a-f]{8}) ([0-9a-f]{8})(.*)',line)
    need(m is not None,'Complete segment row'); selector,base,limit,f=map(lambda s:int(s,16),m.groups()[:4]); eq(f&0x00ffff00,f,'Printed flags mask'); suffix=''
    if f&0x8000:
        suffix=' DPL='+str((f>>13)&3)+' '
        if f&0x1000:
            if f&0x800: suffix+=('CS64' if f&0x200000 else 'CS32' if f&0x400000 else 'CS16')+' ['+('C' if f&0x400 else '-')+('R' if f&0x200 else '-')
            else: suffix+='DS   ['+('E' if f&0x400 else '-')+('W' if f&0x200 else '-')
            suffix+=('A' if f&0x100 else '-')+']'
        else: suffix+=['<hiword>','Reserved','LDT','Reserved','Reserved','Reserved','Reserved','Reserved','Reserved','TSS64-avl','Reserved','TSS64-busy','CallGate64','Reserved','IntGate64','TrapGate64'][(f>>8)&15]
    eq(m[5],suffix,'Exact numeric segment display'); return [selector,base,limit,f&SEG_MASK]

def context(lines):
    def one(prefix):
        found=[s for s in lines if s.startswith(prefix)]; need(len(found)==1,'Exact context row '+prefix); return found[0]
    m=re.fullmatch(r'CR0=([0-9a-f]{8}) CR2=([0-9a-f]{16}) CR3=([0-9a-f]{16}) CR4=([0-9a-f]{8})',one('CR0=')); need(m is not None,'Control row')
    result=dict(zip(['cr0','cr2','cr3','cr4'],[int(s,16) for s in m.groups()]))
    result['segments']={name:segment(one(prefix),prefix) for name,prefix in zip(SEG_NAMES,['ES =','CS =','SS =','DS =','FS =','GS =','LDT=','TR ='])}
    result['tables']={}
    for name in ('GDT','IDT'):
        m=re.fullmatch(name+r'=     ([0-9a-f]{16}) ([0-9a-f]{8})',one(name+'=')); need(m is not None,'Descriptor table'); result['tables'][name]=[int(s,16) for s in m.groups()]
    m=re.fullmatch(r'DR0=([0-9a-f]{16}) DR1=([0-9a-f]{16}) DR2=([0-9a-f]{16}) DR3=([0-9a-f]{16}) ',one('DR0=')); need(m is not None,'DR0..3'); dr={i:int(v,16) for i,v in enumerate(m.groups())}
    m=re.fullmatch(r'DR6=([0-9a-f]{16}) DR7=([0-9a-f]{16})',one('DR6=')); need(m is not None,'DR6..7'); dr.update({6:int(m[1],16),7:int(m[2],16)}); result['debug']=dr
    return result

def parse(raw,start):
    need(len(raw)<=128*1024*1024 and (not raw or raw.endswith(b'\n')),'Bounded complete trace window')
    text=raw.decode('ascii'); need(not re.search(r'[^\x09\x0a\x0d\x20-\x7e]',text),'Trace control byte')
    entries=[]; stops=[]; current=None; offset=start
    for line_num,full in enumerate(text.splitlines(keepends=True),1):
        line=full.rstrip('\r\n'); end=offset+len(full)
        if line.startswith('Trace'):
            need(current is None,'Interrupted CPU frame'); m=re.fullmatch(r'Trace ([0-9]+): (0x[0-9a-f]+) \[([0-9a-f]{8,16})/([0-9a-f]{16})/([0-9a-f]{8})/([0-9a-f]{8})\](?: .*)?',line); need(m is not None and m[1]=='0','Trace header/CPU')
            current=dict(index=len(entries),start=offset,pointer=int(m[2],16),csBase=int(m[3],16),pc=int(m[4],16),flags=int(m[5],16),cflags=int(m[6],16),gpr={},rows=0,lines=[line])
        elif line.startswith('Stopped execution of TB chain'):
            need(current is None,'Stop inside frame'); m=re.fullmatch(r'Stopped execution of TB chain before (0x[0-9a-f]+) \[([0-9a-f]{16})\](?: .*)?',line); need(m is not None,'Stopped record')
            stops.append(dict(start=offset,end=end,pointer=int(m[1],16),pc=int(m[2],16),precedingEntry=len(entries)-1 if entries else None))
        elif re.match(r'^(RAX|RSI|R8 |R12)=',line):
            need(current is not None and current['rows']<4 and 'cpu' not in current,'GPR row order'); found=list(re.finditer(r'(R(?:AX|BX|CX|DX|SI|DI|BP|SP|[89]|1[0-5])) ?=([0-9a-f]{16})',line))
            eq(' '.join(m[0] for m in found),line,'No GPR text tail'); eq([m[1].lower() for m in found],REGS[current['rows']*4:current['rows']*4+4],'Register order')
            current['gpr'].update({m[1].lower():int(m[2],16) for m in found}); current['rows']+=1; current['lines'].append(line)
        elif line.startswith('RIP='):
            need(current is not None and current['rows']==4 and 'cpu' not in current,'RIP row order'); m=re.fullmatch(r'RIP=([0-9a-f]{16}) RFL=([0-9a-f]{8}) \[([D-][O-][S-][Z-][A-][P-][C-])\] CPL=([0-3]) II=([01]) A20=([01]) SMM=([01]) HLT=([01])',line); need(m is not None,'RIP row')
            eq(int(m[1],16),current['pc'],'CPU/header PC'); current['rflags']=int(m[2],16); current['cpu']=[int(m[i]) for i in range(4,9)]; current['lines'].append(line)
        elif line.startswith('CCS='):
            need(current is not None and 'cpu' in current and 'cc' not in current,'Lazy flags order'); m=re.fullmatch(r'CCS=([0-9a-f]{16}) CCD=([0-9a-f]{16}) CCO=([A-Z0-9_]+|\[-?[0-9]+\])',line); need(m is not None,'Lazy flags'); current['cc']=[int(m[1],16),int(m[2],16),m[3]]; current['lines'].append(line)
        elif line.startswith('EFER='):
            need(current is not None and current['rows']==4 and 'cpu' in current and 'cc' in current,'Complete CPU frame'); m=re.fullmatch(r'EFER=([0-9a-f]{16})',line); need(m is not None,'EFER'); current['efer']=int(m[1],16); current['context']=context(current.pop('lines')); current.pop('rows'); current['end']=end; entries.append(current); current=None
        else:
            need(not re.match(r'^(EAX|EIP)=',line),'Unsupported 32-bit dump')
            if current is not None: current['lines'].append(line)
        offset=end
    need(current is None,'Incomplete final CPU frame'); return entries,stops

def flags(original,value,width,subtract=False):
    mask=(1<<width)-1; a=value&mask; r=(a-1)&mask if subtract else a; sign=1<<(width-1); f=0
    if subtract:
        if a==0: f|=1
        if (a^1^r)&16: f|=16
        if (a^1)&(a^r)&sign: f|=2048
    if r==0: f|=64
    if r&sign: f|=128
    if (r&255).bit_count()%2==0: f|=4
    return (original&~(0x8d5|RF))|f

def prelude(p):
    code=bytes.fromhex(p['codeHex']); limit=int(p['b'],16)-int(p['a'],16); at=0; moves=[]; count=0
    enc='rax rcx rdx rbx rsp rbp rsi rdi r8 r9 r10 r11 r12 r13 r14 r15'.split()
    while at<limit:
        count+=1; need(count<=32,'Prelude instruction bound')
        if code[at]==0x90: at+=1; continue
        if code[at] in (0x48,0x49) and at+10<=limit and 0xb8<=code[at+1]<=0xbf:
            moves.append((enc[code[at+1]-0xb8+(8 if code[at]==0x49 else 0)],int.from_bytes(code[at+2:at+10],'little'))); at+=10; continue
        if code[at:at+3]==bytes.fromhex('83f900'): width=32; counter='rcx'; at+=3; break
        if code[at:at+4]==bytes.fromhex('4983f900'): width=64; counter='r9'; at+=4; break
        raise ValueError('Unsupported exact A prelude')
    need(at+2==limit and code[at]==0x74,'CMP/JZ end'); need(int(p['a'],16)+limit+int.from_bytes(code[at+1:at+2],'little',signed=True)==int(p['side'],16),'JZ side')
    return width,counter,moves

def match_native(t,e):
    need(t is not None,'Recorded A has no native tuple'); eq([pair(t,0),pair(t,6),t[14],t[15],pair(t,26),t[19]],[e['pc'],e['pointer'],e['flags'],e['cflags'],e['efer'],e['rflags']&0x73300],'Recorded/native key')
    c=e['context']; eq([pair(t,20),pair(t,22),pair(t,24)],[c['cr0'],c['cr3'],c['cr4']],'Native controls')
    for name,at in zip(SEG_NAMES,SEG_OFF): eq([t[at],pair(t,at+1),t[at+3],t[at+4]],c['segments'][name],'Native segment '+name)
    eq([pair(t,58),t[60]],c['tables']['GDT'],'GDT'); eq([pair(t,61),t[63]],c['tables']['IDT'],'IDT')
    for i,v in c['debug'].items(): eq(pair(t,74+2*i),v,'Native debug register')

def positive_window(entries,stops,p,gate,pre,post,warm):
    need(entries,'Nonempty positive trace'); a,b,side=[int(p[k],16) for k in ('a','b','side')]; native=post['c']['slots'][0]; owner=native['tuples'][0]; prior=warm['c']['slots'][0]; f=post['bw'][0]; wf=warm['bw'][0]
    need(owner is not None and prior['tuples'][0] is not None,'Warm and measured fused owner'); tuple_equal(owner,prior['tuples'][0])
    if native['tuples'][1] and prior['tuples'][1]: tuple_equal(native['tuples'][1],prior['tuples'][1])
    need(pair(owner,8)==a and pair(owner,10)<512*1024*1024 and pair(owner,12)==U64,'Fused physical page'); eq([owner[14],owner[15]],[0x18c0c2b3,0xff020000],'Exact normal key'); eq(pair(owner,4),f['generation'],'Fused generation')
    eq([wf['predecodeAccepted'],wf['emittedOwners'],wf['IRRejected'],wf['cleanRetries']],[1,1,0,0],'One warm formed owner'); need(wf['compiledEntries']>0 and f['compiledEntries']>0,'Compiled exposure'); eq(f['generation'],wf['generation'],'Stable generation'); eq(f['tciEntries'],0,'Measured compiled tier')
    zero([f[n] for n in ('predecodeAccepted','IRRejected','emittedOwners','entryRejects','cleanRetries','backedgeTciReturns')]); zero(native['counts'][4:])
    for n in ('invalidRedispatches','staleInstanceMisses','instanceRetires','invalidations','flushes'): eq(post['a'][n],pre['a'][n],'Measured lifetime '+n)
    delta={n:post['b'][n]-pre['b'][n] for n in M3B}
    zero([delta[n] for n in ('predecodeAccepted','formed','cleanRetries','entryRejects','tciEntries','debtErrors','tciTargetReturns','backedgeTciReturns','IRRejected','emittedOwners')])
    for n in ('compiledEntries','BAttempts','BRequested','servicePaid'): eq(delta[n],f[n],'Exact global/watch delta')
    context0=entries[0]['context']; pointers={}; by={}
    for stop in stops: by.setdefault(stop['precedingEntry'],[]).append(stop)
    for e in entries:
        need(e['pc'] in (a,b,side),'Other/interior trace entry'); eq([e['csBase'],e['cflags'],e['efer'],e['flags']&~RF],[0,0xff020000,0xd01,0x18c0c2b3],'Exact trace key'); eq(e['cpu'],[3,0,1,0,0],'User mode'); eq(e['rflags']&0x20100,0,'TF/VM'); eq(bool(e['flags']&RF),bool(e['rflags']&RF),'RF key/state'); eq(e['context'],context0,'Full semantic recorded context')
        key=(e['pc'],e['flags']); need(key not in pointers or pointers[key]==e['pointer'],'Pointer changed for key'); pointers[key]=e['pointer']
        need(all(s['pc'] in (a,b,side) for s in by.get(e['index'],[])),'Foreign stop target')
        if e['pc']==a: match_native(native['tuples'][1 if e['flags']&RF else 0],e)
    def refused(e):
        rows=by.get(e['index'],[]); return len(rows)==1 and rows[0]['pc']==e['pc'] and rows[0]['pointer']==e['pointer']
    width,counter,moves=prelude(p); certificates=[]; refused_a=[]; certified_b={}; rf_a=0; normal_a=0
    for i,e in enumerate(entries):
        if e['pc']!=a: continue
        if not e['flags']&RF: normal_a+=1; continue
        rf_a+=1
        if by.get(e['index']): need(refused(e),'Exact RF A refusal'); refused_a.append(e['start']); continue
        need(i+1<len(entries),'RF A has no successor'); nxt=entries[i+1]; expected=dict(e['gpr']); expected.update(moves); value=expected[counter]&((1<<width)-1); target=side if value==0 else b
        eq([nxt['pc'],nxt['flags']],[target,0x18c0c2b3],'RF A target/clear'); eq(nxt['gpr'],expected,'RF A GPR'); eq(nxt['rflags'],flags(e['rflags'],value,width),'CMP flags'); eq(nxt['cc'],[0,expected[counter],'SUBL' if width==32 else 'SUBQ'],'CMP full lazy state')
        certificates.append(dict(offset=e['start'],successorOffset=nxt['start'],target=hx(target),transition='rf-a-to-side' if value==0 else 'rf-a-to-b'))
        if target==b: certified_b[nxt['index']]=e['start']
    eq(rf_a,native['rf'],'Every native RF A attempt printed'); need(normal_a<=sum(native['counts'][:2]),'Native normal coverage'); eq(rf_a,len(certificates)+len(refused_a),'All RF A classified')
    F,P=f['BAttempts'],f['BRequested']; D=gate['calls'] if gate['phase']=='direct-b' else 0; R=sum(c['transition']=='rf-a-to-b' for c in certificates)
    need(P<=F<=f['compiledEntries'],'Fused attempted routes'); eq(F+R+D,gate['bodies'],'All body routes'); eq(f['servicePaid'],F,'Service payments')
    rf_b=[]; refused_b=[]; unassigned={}; raw_code=bytes.fromhex(p['codeHex']); body=raw_code[b-a:int(p['back'],16)-a]
    for i,e in enumerate(entries):
        if not e['flags']&RF or e['pc']==a: continue
        eq(e['pc'],b,'RF only at A/B'); origin=i-1
        while origin>=0 and entries[origin]['pc']==b and entries[origin]['flags']&RF: origin-=1
        normal=entries[origin] if origin>=0 and entries[origin]['pc']==b and entries[origin]['flags']==0x18c0c2b3 else None
        cert=certified_b.get(normal['index']) if normal else None; first=origin if normal else origin+1; route=entries[first]['start']
        if cert is None:
            need(D+P>0,'No fixed CFG origin for RF B'); unassigned.setdefault(route,False)
        for retry in entries[first:i]: need(refused(retry),'Earlier B must be refused'); eq(retry['gpr'],e['gpr'],'Retry GPR'); eq(retry['rflags']&~RF,e['rflags']&~RF,'Retry flags')
        need(i+1<len(entries),'RF B unclosed'); nxt=entries[i+1]
        if by.get(e['index']):
            need(refused(e),'RF B exact refusal'); eq([nxt['pc'],nxt['flags'],nxt['gpr'],nxt['rflags']],[b,e['flags'],e['gpr'],e['rflags']],'Exact RF B retry'); refused_b.append(e['start']); continue
        expected=dict(e['gpr'])
        if body.hex()=='83c03531d083e901': bw=32; ctr='rcx'; expected['rax']=((expected['rax']+53)&U32)^(expected['rdx']&U32); expected['rcx']=(expected['rcx']-1)&U32
        elif body.hex()=='4d31ea4983c2114983e901': bw=64; ctr='r9'; expected['r10']=((expected['r10']^expected['r13'])+17)&U64; expected['r9']=(expected['r9']-1)&U64
        else: raise ValueError('Unsupported exact B body')
        eq([nxt['pc'],nxt['flags'],nxt['gpr']],[a,0x18c0c2b3,expected],'RF B exact GPR successor'); eq(nxt['rflags'],flags(e['rflags'],e['gpr'][ctr],bw,True),'SUB flags'); eq(nxt['cc'],[1,(e['gpr'][ctr]-1)&U64,'SUBL' if bw==32 else 'SUBQ'],'Full-width lazy SUB')
        if cert is None: need(not unassigned[route],'Duplicate D/P completion'); unassigned[route]=True
        rf_b.append(dict(offset=e['start'],successorOffset=nxt['start'],originCertificate=cert,unassignedRoute=None if cert is not None else route))
    need(len(unassigned)<=D+P and all(unassigned.values()),'Bounded complete fixed D/P routes')
    return dict(seq=gate['seq'],gate=gate,partition=dict(fusedBoundaryAttempts=F,completedFusedBodyRoutes=F-P,requestedOrdinaryBodyRoutes=P,certifiedRfAtoBContinuations=R,initialDirectBRoutes=D,logicalRouteSum=F+R+D,expectedGuestBodies=gate['bodies'],extraServiceTurns=F,ordinaryBSelectedAttempts=post['aw'][1]['selected']),certificates=certificates,refusedRfA=refused_a,rfBCompletions=rf_b,refusedRfB=refused_b,unassignedDpRoutes=sorted(unassigned),outerEntries=len(entries),recordedNormalA=normal_a,nativeNormalAttempts=sum(native['counts'][:2]),hiddenNormalAttempts=sum(native['counts'][:2])-normal_a,rfAttempts=rf_a,ownerGeneration=hx(f['generation']),nativeDelta=delta,windowAccepted=True,candidatePromotion=False)
