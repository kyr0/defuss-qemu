"""Small synthetic corruption tests; no browser, SDK or historical trace replay."""
import copy
import unittest
from semantics import *
from trace import parse,flags,prelude,positive_window
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
        bad=copy.deepcopy(entries);bad[3]['cc'][1]&=U32
        with self.assertRaises(ValueError):positive_window(bad,stops,p,gate,pre,post,warm)
        badpost=copy.deepcopy(post);badpost['c']['slots'][0]['rf']+=1
        with self.assertRaises(ValueError):positive_window(entries,stops,p,gate,pre,badpost,warm)
        with self.assertRaises(ValueError):positive_window(entries,[],p,gate,pre,post,warm)
    def test_terminal_only_complete_bounded_link_records(self):
        self.assertEqual(terminal(b'',17)['linkingRecords'],0)
        raw=b'Linking TBs 0x96c1140 index 1 -> 0x9766980\n';r=terminal(raw,100);self.assertEqual(r['bytes'],43);self.assertEqual(r['executionRecords'],0)
        for bad in [raw[:-1],raw+b'\n',raw+b'Trace 0: bad\n',raw.replace(b'index 1',b'index 2'),raw.replace(b'0x96c1140',b'0x0'),raw.replace(b'\n',b'\r\n'),raw.replace(b'0x9766980',b'0x10000000000000000'),raw*2000]:
            with self.assertRaises(ValueError):terminal(bad,0)

if __name__=='__main__':unittest.main()
