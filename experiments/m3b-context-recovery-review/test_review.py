"""Small synthetic corruption tests; no browser, SDK or historical trace replay."""
import copy
import unittest
from semantics import *
from trace import parse,flags,prelude,positive_window,global_guard_redispatches
from review import terminal

def tuple_words(kind=0):
    w=[0]*112
    for at,n in [(0,0x405000),(2,0x10000+kind*256),(4,123+kind),(6,0x20000+kind*256),(8,0x405000),(10,0x123000),(12,U64)]:w[at]=n&U32;w[at+1]=n>>32
    w[14]=0x18c0c2b3|(RF if kind==1 else 0);w[15]=0xff020000;w[16]=int(kind==0);w[17]=0x18c0c2b3;w[19]=0x200|(RF if kind==1 else 0)
    for i,at in enumerate(SEG_OFF):w[at+4]=[0,0xa0fb00,0xc0f300,0,0,0,0x8200,0x8900][i];w[90+i]=w[at+4]|(0xf0000 if i in (1,2) else 0)
    return w

def census_bank():
    w=[0]*2400;w[:10]=[0x4d334343,2,7,0,0,2400,4,32,592,112];w[10]=4;w[12]=1;w[13]=1
    s=32;w[s]=0x405000;w[s+2]=w[s+3]=1;w[s+4]=1;w[s+6]=1;w[s+8]=1;w[s+16]=1;w[s+20]=1;w[64:176]=tuple_words()
    for slot in range(1,4):w[32+592*slot+4]=slot+1
    return w

def dump():
    regs={n:word(i+1)for i,n in enumerate(REGS)}
    rows=[' '.join(n.upper().ljust(3)+'='+regs[n]for n in REGS[i:i+4])for i in range(0,16,4)]
    return ('Trace 0: 0x20000 [00000000/0000000000405000/18c0c2b3/ff020000] \n'+'\n'.join(rows)+'\nRIP=0000000000405000 RFL=00000202 [-------] CPL=3 II=0 A20=1 SMM=0 HLT=0\n'
      'ES =0000 0000000000000000 00000000 00000000\nCS =0033 0000000000000000 ffffffff 00affb00 DPL=3 CS64 [-RA]\nSS =002b 0000000000000000 ffffffff 00cff300 DPL=3 DS   [-WA]\nDS =0000 0000000000000000 00000000 00000000\nFS =0000 0000000000004500 00000000 00000000\nGS =0000 0000000000000000 00000000 00000000\nLDT=0000 0000000000000000 00000000 00008200 DPL=0 LDT\nTR =0040 fffffe0000000000 00004087 00008900 DPL=0 TSS64-avl\nGDT=     fffffe0000001000 0000007f\nIDT=     fffffe0000002000 00000fff\nCR0=80050033 CR2=0000000000000000 CR3=0000000001230000 CR4=00350eb0\nDR0=0000000000000000 DR1=0000000000000000 DR2=0000000000000000 DR3=0000000000000000 \nDR6=00000000ffff0ff0 DR7=0000000000000400\nCCS=0000000000000000 CCD=0000000000000000 CCO=EFLAGS\nEFER=0000000000000d01\n').encode()

class Tests(unittest.TestCase):
    def test_independent_guest_oracle_known_prefix(self):
        gates,final=reference();self.assertEqual(len(gates),45);self.assertEqual(gates[41],dict(seq=41,program=10,phase='warm',calls=4096,bodies=16384,checks=939524,digest='524ccf98343c1e9c'));self.assertEqual(final['checks'],943364)
    def test_strict_types(self):
        with self.assertRaises(ValueError):eq(False,0,'bool/integer')
        w=census_bank();w[11]=False
        with self.assertRaises(ValueError):census(w)
    def test_census_partition_and_sticky_fault(self):
        w=census_bank();self.assertEqual(census(w)['slots'][0]['total'],1)
        for i in [3,4,11,16,37,38,40,52,64+98]:
            bad=copy.deepcopy(w);bad[i]+=1
            with self.assertRaises(ValueError,msg=str(i)):census(bad)
        bad=copy.deepcopy(w);bad[1]=1
        with self.assertRaises(ValueError):census(bad)
    def test_segment_raw_representation_only(self):
        a=tuple_words();b=copy.deepcopy(a);b[91]&=~0xf0000;b[92]&=~0xf0000;tuple_check(b,0,0x405000);tuple_equal(a,b)
        for at in SEG_OFF:
            for bit in range(32):
                if SEG_MASK&(1<<bit):
                    c=copy.deepcopy(b);c[at+4]^=1<<bit;c[90+SEG_OFF.index(at)]^=1<<bit
                    with self.assertRaises(ValueError):tuple_equal(a,c)
            for off in range(4):
                c=copy.deepcopy(b);c[at+off]^=1
                with self.assertRaises(ValueError):tuple_equal(a,c)
    def test_trace_complete_context_and_offsets(self):
        raw=dump();entries,stops=parse(raw,123);self.assertEqual(entries[0]['start'],123);self.assertEqual(entries[0]['end'],123+len(raw));self.assertEqual(entries[0]['context']['segments']['CS'][3],0xa0fb00);self.assertEqual(stops,[])
        for bad in [raw[:-1],raw.replace(b'CR0=',b'XR0='),raw.replace(b' DPL=3 CS64 [-RA]',b' DPL=3 CS64 [--A]'),raw.replace(b'CR0=80050033',b'CR0=80050033\nCR0=80050033'),raw.replace(b'EFER=0000000000000d01\n',b'')]:
            with self.assertRaises(ValueError):parse(bad,0)
    def test_segment_trace_canonical_but_semantic_changes_visible(self):
        first=parse(dump(),0)[0][0]['context'];other=parse(dump().replace(b'00affb00',b'00a0fb00').replace(b'00cff300',b'00c0f300'),0)[0][0]['context'];self.assertEqual(first,other)
        changed=parse(dump().replace(b'CR3=0000000001230000',b'CR3=0000000001231000'),0)[0][0]['context'];self.assertNotEqual(first,changed)
    def test_flags_and_prelude(self):
        self.assertEqual(flags(0x10202,0,32),0x246);self.assertEqual(flags(0x10202,3,32),0x206);self.assertEqual(flags(0x10202,0,32,True),0x297);self.assertEqual(flags(0x10202,0x80000000,32,True),0xa16)
        p=dict(a='0x405000',b='0x405005',side='0x40500f',codeHex='83f900740a83c03531d083e901ebf1');self.assertEqual(prelude(p),(32,'rcx',[]));bad=dict(p,codeHex='83f900740b83c03531d083e901ebf1')
        with self.assertRaises(ValueError):prelude(bad)
    def test_exact_rf_routes_and_full_lazy_state_corruptions(self):
        base=parse(dump(),0)[0][0]; a=0x405000;b=a+5;side=a+15
        entries=[copy.deepcopy(base)for _ in range(4)]
        for i,e in enumerate(entries):e.update(index=i,start=100*i,end=100*i+90)
        high=0x1234567800000003
        entries[0].update(flags=0x18c1c2b3,rflags=0x10202,pointer=0x20100)
        entries[0]['gpr']['rcx']=high
        entries[1].update(pc=b,pointer=0x30000,gpr=copy.deepcopy(entries[0]['gpr']),rflags=0x206,cc=[0,high,'SUBL'])
        entries[2]=copy.deepcopy(entries[1]);entries[2].update(index=2,start=200,end=290,pointer=0x40000,flags=0x18c1c2b3,rflags=0x10206)
        entries[3]['gpr']=copy.deepcopy(entries[2]['gpr']);entries[3]['gpr']['rax']=((entries[2]['gpr']['rax']+53)&U32)^(entries[2]['gpr']['rdx']&U32);entries[3]['gpr']['rcx']=2;entries[3].update(rflags=0x202,cc=[1,high-1,'SUBL'])
        def nt(entry,kind):
            t=tuple_words(kind);t[6]=entry['pointer'];t[19]=entry['rflags']&0x73300;c=entry['context']
            for at,k in [(20,'cr0'),(22,'cr3'),(24,'cr4')]:t[at]=c[k]&U32;t[at+1]=c[k]>>32
            t[26]=0xd01
            for i,(name,at)in enumerate(zip(SEG_NAMES,SEG_OFF)):
                selector,basev,limit,f=c['segments'][name];t[at:at+5]=[selector,basev&U32,basev>>32,limit,f];t[90+i]=f
            for name,at in [('GDT',58),('IDT',61)]:v,limit=c['tables'][name];t[at:at+3]=[v&U32,v>>32,limit]
            for i,v in c['debug'].items():t[74+2*i:76+2*i]=[v&U32,v>>32]
            return t
        owner=nt(entries[3],0);rfowner=nt(entries[0],1)
        f={n:0 for n in WATCH};f.update(compiledEntries=1,generation=123,last=a)
        wf=dict(f,compiledEntries=8,predecodeAccepted=1,emittedOwners=1)
        slot=dict(tuples=[owner,rfowner,None,None],counts=[1,0,0,1,0,0,0,0],rf=1)
        pre=dict(a={n:0 for n in M3A},b={n:0 for n in M3B});post=dict(a=dict(pre['a']),b=dict(pre['b'],compiledEntries=1),c={'slots':[slot]},bw=[f],aw=[{},dict(selected=1)])
        warm=dict(c={'slots':[copy.deepcopy(slot)]},bw=[wf]);p=dict(a=hex(a),b=hex(b),back=hex(a+13),side=hex(side),codeHex='83f900740a83c03531d083e901ebf1');gate=dict(seq=3,phase='body',calls=1,bodies=1)
        stops=[dict(start=191,end=199,pc=b,pointer=0x30000,precedingEntry=1)]
        result=positive_window(entries,stops,p,gate,pre,post,warm);self.assertEqual(result['partition']['certifiedRfAtoBContinuations'],1);self.assertEqual(len(result['rfBCompletions']),1);self.assertEqual(result['partition']['logicalRouteSum'],1)
        for delta in (1,7):
            shifted=copy.deepcopy(post);shifted['b']['tciTargetReturns']=delta
            actual=positive_window(entries,stops,p,gate,pre,shifted,warm)
            self.assertEqual(actual['partition'],result['partition']);self.assertEqual(actual['certificates'],result['certificates']);self.assertEqual(actual['globalGuardRedispatches']['delta'],delta)
        for family,key in [('b','tciEntries'),('b','backedgeTciReturns'),('b','debtErrors')]:
            badpost=copy.deepcopy(post);badpost[family][key]+=1
            with self.assertRaises(ValueError):positive_window(entries,stops,p,gate,pre,badpost,warm)
        badpost=copy.deepcopy(post);badpost['bw'][0]['tciEntries']=1
        with self.assertRaises(ValueError):positive_window(entries,stops,p,gate,pre,badpost,warm)
        badpost=copy.deepcopy(post);badpost['bw'][0]['servicePaid']=1
        with self.assertRaises(ValueError):positive_window(entries,stops,p,gate,pre,badpost,warm)
        bad=copy.deepcopy(entries);bad[3]['cc'][1]&=U32
        with self.assertRaises(ValueError):positive_window(bad,stops,p,gate,pre,post,warm)
        badpost=copy.deepcopy(post);badpost['c']['slots'][0]['rf']+=1
        with self.assertRaises(ValueError):positive_window(entries,stops,p,gate,pre,badpost,warm)
        with self.assertRaises(ValueError):positive_window(entries,[],p,gate,pre,post,warm)
    def test_global_guard_exact_monotonic_scope(self):
        for before,after in [(0,0),(0,1),(7,14)]:
            r=global_guard_redispatches({'b':{'tciTargetReturns':before}},{'b':{'tciTargetReturns':after}})
            self.assertEqual(r['delta'],after-before);self.assertEqual(r['counter'],'tciTargetReturns');self.assertIn('no watched-owner attribution',r['scope'])
    def test_global_guard_corruptions(self):
        for before,after in [(1,0),(-1,0),(False,0),(0,True),(0,1.5),(0,float('inf')),(0,1<<53)]:
            with self.assertRaises(ValueError):global_guard_redispatches({'b':{'tciTargetReturns':before}},{'b':{'tciTargetReturns':after}})
    def test_terminal_only_complete_bounded_link_records(self):
        self.assertEqual(terminal(b'',17)['linkingRecords'],0)
        raw=b'Linking TBs 0x96c1140 index 1 -> 0x9766980\n';r=terminal(raw,100);self.assertEqual(r['bytes'],43);self.assertEqual(r['executionRecords'],0)
        for bad in [raw[:-1],raw+b'\n',raw+b'Trace 0: bad\n',raw.replace(b'index 1',b'index 2'),raw.replace(b'0x96c1140',b'0x0'),raw.replace(b'\n',b'\r\n'),raw.replace(b'0x9766980',b'0x10000000000000000'),raw*2000]:
            with self.assertRaises(ValueError):terminal(bad,0)


from recovery import recovery_native,typed_mutation,expected_stage,projection,recovery_window

def paused_row(pc=0x405000,generation=123):
    a=[0]*96;a[:11]=[0x4d335231,1,1,1,0,176,88,24,4,64,8];a[11]=4;a[12]=3;a[18]=a[19]=1
    b=[0]*128
    for at,v in {0:0x4d334231,1:1,2:63,5:1,6:32,7:128,8:12,9:32,10:20,11:4,12:4,20:1}.items():b[at]=v
    c=census_bank();owner=tuple_words();owner[0]=owner[8]=pc;owner[4]=generation;c[64:176]=owner
    for words,at in [(a,64),(b,32)]:words[at]=pc;words[at+2]=pc+1
    a[68]=a[71]=1;a[69]=pc;b[36]=1;b[48]=pc;b[50]=generation
    c[32]=pc
    boundary=[0]*256
    for at,v in {0:0x4d334253,1:1,6:256,7:64}.items():boundary[at]=v
    return dict(status={'status':'paused','running':False},captureErrors=[],m3aRaw=a,m3bRaw=b,censusRaw=c,boundaryRaw=boundary,nativeStatus=63,censusNativeStatus=7,pool={'limit':12000,'charged':1,'linearMemoryBytes':1048576})

def install_injection(row,action,pc,generation,miss=0,reject=0,watch_reject=0):
    a,b,c=row['m3aRaw'],row['m3bRaw'],row['censusRaw'];a[34]=1;a[35]=int(action==2);a[22]=miss;a[50]=pc;a[52]=generation;a[54]=action;b[19]=reject;b[44]=watch_reject
    c[16:24]=[action,1,int(action==2),0,action,action,1,0];c[24]=pc;c[26]=c[28]=generation;c[30:32]=[0x18c0c2b3,0xff020000]
    return row

class RecoveryTests(unittest.TestCase):
    def test_exact_stage_matrix(self):
        self.assertEqual(expected_stage(True,'gate',1),dict(stale=0,invalid=0,staleMiss=0,fusedReject=0,watchReject=0))
        self.assertEqual(expected_stage(True,'injection',1),dict(stale=1,invalid=0,staleMiss=0,fusedReject=0,watchReject=0))
        self.assertEqual(expected_stage(True,'gate',5),dict(stale=1,invalid=0,staleMiss=1,fusedReject=0,watchReject=0))
        self.assertEqual(expected_stage(True,'configured',5),dict(stale=1,invalid=1,staleMiss=1,fusedReject=0,watchReject=0))
        self.assertEqual(expected_stage(True,'gate',6),dict(stale=1,invalid=1,staleMiss=1,fusedReject=1,watchReject=1))
        self.assertEqual(expected_stage(True,'configured',6),dict(stale=1,invalid=1,staleMiss=1,fusedReject=1,watchReject=0))
        self.assertEqual(expected_stage(False,'complete',44),dict(stale=0,invalid=0,staleMiss=0,fusedReject=0,watchReject=0))
        for args in [(True,'injection',2),(True,'gate',True),(1,'gate',1),(True,'startup',1)]:
            with self.assertRaises(ValueError):expected_stage(*args)
    def test_raw_stage_allowances_preserve_original_evidence(self):
        row=paused_row();original=copy.deepcopy(row);self.assertEqual(recovery_native(row,True,'gate',1)['injection']['requests'],0);self.assertEqual(row,original)
        for stage,seq,action,miss,reject,watch in [('injection',1,1,0,0,0),('gate',5,1,1,0,0),('injection',5,2,1,0,0),('gate',6,2,1,1,1),('configured',6,2,1,1,0),('complete',44,2,1,1,0)]:
            row=install_injection(paused_row(),action,0x405000,123,miss,reject,watch);before=copy.deepcopy(row);decoded=recovery_native(row,True,stage,seq);self.assertEqual(row,before);self.assertEqual(decoded['b']['entryRejects'],reject);self.assertEqual(decoded['bw'][0]['entryRejects'],watch);self.assertEqual(decoded['c']['raw'],row['censusRaw'])
            for key,at in [('m3aRaw',21),('m3aRaw',34),('m3bRaw',19),('m3bRaw',64),('censusRaw',3),('censusRaw',19),('censusRaw',22),('censusRaw',28),('censusRaw',30)]:
                bad=copy.deepcopy(row);bad[key][at]+=1
                with self.assertRaises(ValueError,msg=str((stage,seq,key,at))):recovery_native(bad,True,stage,seq)
    def test_two_exact_raw_mutations_and_unrelated_change_rejection(self):
        for seq,pc,generation in [(1,0x405000,123),(5,0x406000,456)]:
            before=paused_row(pc,generation)
            if seq==5:install_injection(before,1,0x405000,123,1)
            action=1 if seq==1 else 2;after=copy.deepcopy(before);install_injection(after,action,pc,generation,int(seq==5));record=dict(requestID=action,action='stale-instance'if seq==1 else'invalid-descriptor',slot=0,pc=hex(pc),generation=hex(generation),returnCode=1,nativeCalls=1)
            old=copy.deepcopy((before,after));actual=typed_mutation(before,after,record,seq,pc,generation);self.assertEqual(actual['mutations'],1);self.assertEqual((before,after),old)
            for key,at in [('m3aRaw',23),('m3aRaw',50),('m3bRaw',20),('censusRaw',12),('censusRaw',20),('censusRaw',32+20),('boundaryRaw',8)]:
                bad=copy.deepcopy(after);bad[key][at]+=1
                with self.assertRaises(ValueError,msg=str((seq,key,at))):typed_mutation(before,bad,record,seq,pc,generation)
            for key,value in [('nativeCalls',2),('returnCode',-1),('slot',1),('requestID',False)]:
                bad=dict(record);bad[key]=value
                with self.assertRaises(ValueError):typed_mutation(before,after,bad,seq,pc,generation)
    def test_old_owner_projection_is_exact_and_rejects_orphans(self):
        entry=parse(dump(),0)[0][0];entry.update(index=1,start=100,end=190);pc=entry['pc'];code=entry['pointer'];owner=tuple_words();owner[6]=code;context=entry['context']
        for at,key in [(20,'cr0'),(22,'cr3'),(24,'cr4')]:owner[at]=context[key]&U32;owner[at+1]=context[key]>>32
        owner[26]=entry['efer']
        for i,(name,at)in enumerate(zip(SEG_NAMES,SEG_OFF)):
            selector,basev,limit,f=context['segments'][name];owner[at:at+5]=[selector,basev&U32,basev>>32,limit,f];owner[90+i]=f
        for name,at in [('GDT',58),('IDT',61)]:value,limit=context['tables'][name];owner[at:at+3]=[value&U32,value>>32,limit]
        for i,value in context['debug'].items():owner[74+2*i:76+2*i]=[value&U32,value>>32]
        warm={'c':{'slots':[{'tuples':[owner,None,None,None]}]}};p={'a':hex(pc)};gate={'program':1,'seq':6};stop=dict(start=191,end=199,pc=pc,pointer=code,precedingEntry=1)
        entries,stops,cert=projection([entry],[stop],p,gate,warm);self.assertEqual((entries,stops),([],[]));self.assertEqual(cert['kind'],'outer-old-owner-refusal')
        for extra in [dict(stop,pc=pc+5,start=200,end=209),dict(stop,pointer=code+8,start=200,end=209)]:
            with self.assertRaises(ValueError):projection([entry],[stop,extra],p,gate,warm)
        previous=copy.deepcopy(entry);previous.update(index=0,pc=pc+5,pointer=0x30000,start=0,end=90);hidden=dict(stop,precedingEntry=0);e,s,c=projection([previous],[hidden],p,gate,warm);self.assertEqual(e,[previous]);self.assertEqual(s,[]);self.assertEqual(c['kind'],'hidden-chain-old-owner-refusal')
        for seq in (7,8):
            with self.assertRaises(ValueError):projection([previous],[hidden],p,dict(gate,seq=seq),warm)
            with self.assertRaises(ValueError):projection([entry],[],p,dict(gate,seq=seq),warm)



def exact_tuple(entry,generation,code=None):
    t=tuple_words();t[4]=generation;t[6]=entry['pointer'] if code is None else code;t[19]=entry['rflags']&0x73300;c=entry['context']
    for at,k in [(20,'cr0'),(22,'cr3'),(24,'cr4')]:t[at]=c[k]&U32;t[at+1]=c[k]>>32
    t[26]=entry['efer']
    for i,(name,at)in enumerate(zip(SEG_NAMES,SEG_OFF)):
        selector,basev,limit,f=c['segments'][name];t[at:at+5]=[selector,basev&U32,basev>>32,limit,f];t[90+i]=f
    for name,at in [('GDT',58),('IDT',61)]:v,limit=c['tables'][name];t[at:at+3]=[v&U32,v>>32,limit]
    for i,v in c['debug'].items():t[74+2*i:76+2*i]=[v&U32,v>>32]
    return t

def fresh_side_case():
    # NON-EVIDENCE component fixture: one synthetic side-only invocation.
    # Full real64-call gate identity is independently enforced by the driver.
    old=parse(dump(),0)[0][0];old.update(index=0,start=0,end=90)
    entry=copy.deepcopy(old);entry.update(index=1,start=100,end=190,pointer=0x20200)
    side=copy.deepcopy(entry);side.update(index=2,start=200,end=290,pc=0x40500f,pointer=0x30000)
    stop=dict(start=91,end=99,pc=old['pc'],pointer=old['pointer'],precedingEntry=0)
    oldtuple=exact_tuple(old,123);owner=exact_tuple(entry,125)
    f={n:0 for n in WATCH};f.update(tciEntries=1,generation=125,last=0x405000,predecodeAccepted=1,emittedOwners=1,entryRejects=1)
    wf={n:0 for n in WATCH};wf.update(compiledEntries=8,generation=123,last=0x405000,predecodeAccepted=1,emittedOwners=1)
    a={n:0 for n in M3A};a.update(compiledAttempts=8,selectedEntries=8,staleInstanceMisses=1,injectedStaleInstances=1)
    b={n:0 for n in M3B};b.update(compiledEntries=8,predecodeAccepted=1,formed=1,emittedOwners=1)
    injection=dict(raw=[2,1,1,0,2,2,1,0,0x405000,0,123,0,123,0,0x18c0c2b3,0xff020000],pc=0x405000,expectedGeneration=123)
    warm=dict(a=dict(a),b=dict(b),c=dict(total=10,slots=[dict(tuples=[oldtuple,None,None,None],counts=[8,0,0,0,0,0,0,0])]),bw=[wf])
    pre=dict(a=dict(a,injectedInvalidDescriptors=1),b=dict(b),c=dict(total=10),injection=copy.deepcopy(injection))
    post=dict(a=dict(pre['a']),b=dict(b,tciEntries=1,entryRejects=1,predecodeAccepted=2,formed=2,emittedOwners=2),c=dict(total=11,slots=[dict(tuples=[owner,None,None,None],counts=[0,1,0,0,0,0,0,0],sites=[0,1,0,0],rf=0,total=1)]),bw=[f,{n:0 for n in WATCH}],aw=[dict(selected=0),dict(selected=0)],injection=copy.deepcopy(injection))
    p=dict(a='0x405000',b='0x405005',back='0x40500d',side='0x40500f',codeHex='83f900740a83c03531d083e901ebf1');gate=dict(seq=6,program=1,phase='side',calls=1,bodies=0)
    return [old,entry,side],[stop],p,gate,pre,post,warm

class RecoveryTierTests(unittest.TestCase):
    def test_fresh_tci_is_honest_and_global_routing_adds_no_body(self):
        args=fresh_side_case();r=recovery_window(*args);self.assertEqual(r['partition']['logicalRouteSum'],0);self.assertEqual(r['recovery']['observedCompiled'],0);self.assertEqual(r['recovery']['observedTci'],1);self.assertFalse(r['recovery']['freshCompiledObserved']);self.assertEqual(r['rejectionCertificate']['kind'],'outer-old-owner-refusal')
        changed=copy.deepcopy(args);changed[5]['b']['tciTargetReturns']=7;got=recovery_window(*changed);self.assertEqual(got['partition'],r['partition']);self.assertEqual(got['globalGuardRedispatches']['delta'],7)
    def test_fresh_owner_and_mutation_recovery_guards(self):
        cases=[lambda x:x[5]['c']['slots'][0]['tuples'][0].__setitem__(4,123),lambda x:x[5]['c']['slots'][0]['tuples'][0].__setitem__(6,0x20000),lambda x:x[5]['c']['slots'][0]['tuples'][0].__setitem__(22,12345),lambda x:x[5]['b'].__setitem__('entryRejects',2),lambda x:x[5]['b'].__setitem__('formed',3),lambda x:x[5]['a'].__setitem__('invalidRedispatches',1),lambda x:x[5]['a'].__setitem__('invalidations',1),lambda x:x[5]['bw'][0].__setitem__('servicePaid',1),lambda x:x[5]['injection']['raw'].__setitem__(0,3)]
        for mutate in cases:
            args=fresh_side_case();mutate(args)
            with self.assertRaises(ValueError):recovery_window(*args)
        args=fresh_side_case();args[1].append(dict(args[1][0],pc=0x405005,start=92,end=98))
        with self.assertRaises(ValueError):recovery_window(*args)



class RecoverySummaryTests(unittest.TestCase):
    def test_driver_mutation_summary_keeps_exact_gate_sequence(self):
        from review import mutation_summary
        for seq,action in [(1,'stale-instance'),(5,'invalid-descriptor')]:
            proof=dict(requestID=1 if seq==1 else 2,action=action,pc='0x405000',generation='0x7b',mutations=1)
            expected=dict(seq=seq,**proof,scope='Paused metadata injection only; subsequent exact recovery remains required.')
            self.assertEqual(mutation_summary(seq,proof),expected);self.assertNotIn('seq',proof)
        for seq in [True,0,2,6]:
            with self.assertRaises(ValueError):mutation_summary(seq,proof)
    def test_latest_typed_identity_cannot_drift_at_later_stops(self):
        from recovery import same_injection
        original=install_injection(paused_row(),1,0x405000,123,1);first=recovery_native(original,True,'gate',5)
        same_injection(first,recovery_native(copy.deepcopy(original),True,'gate',5))
        for c_at,a_at in [(24,50),(26,52)]:
            changed=copy.deepcopy(original);changed['censusRaw'][c_at]+=1;changed['m3aRaw'][a_at]+=1
            if c_at==26:changed['censusRaw'][28]+=1
            # Individually valid stage banks still cannot alter the latest
            # typed target/generation outside the declared paused mutation.
            last=recovery_native(changed,True,'gate',5)
            with self.assertRaises(ValueError):same_injection(first,last)

if __name__=='__main__':unittest.main()
