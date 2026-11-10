import copy,json,unittest
from review import ROOT,reconstruct
from codebank import decode,difference
def raw(compiled=0,tci=0,formed=False):
    w=[0]*2112;w[:5]=[0x4d33434f,1,2112,16,128];w[12]=64
    if not formed:return w
    w[5:8]=[1,compiled,tci];r=[0]*128;r[0:2]=[2 if compiled+tci else 1,1]
    def pair(i,n):r[i:i+2]=[n%2**32,n//2**32]
    for i,n in [(2,0x1000),(4,0x20000004),(6,0x123004),(8,2**64-1),(22,0x234000)]:pair(i,n)
    r[10:14]=[0x18c0c2b3,0xff020000,12,5]
    data=bytes.fromhex('83f900740701f083e901ebf4')+bytes(116)
    r[32:64]=[int.from_bytes(data[i:i+4],'little') for i in range(0,128,4)]
    if compiled+tci:
        for i,n in [(14,0x99),(16,0x2000),(18,0x20000004),(20,0x20000004),(24,0x234000),(26,0x234000),(64,0x80050033),(66,0x350eb0),(68,0xd01)]:pair(i,n)
        r[28:30]=[compiled,tci];r[70:72]=[0x18c0c2b3,0x101]
    w[64:192]=r;return w
def profile(c=0,t=0,f=1):return dict(zip(('formed','compiledEntries','tciEntries'),[f,c,t]))
class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        base=ROOT/'artifacts/m3b-bun-exposure-off-01';cls.capture=json.loads((base/'report.json').read_text())
        cls.original=[json.loads(s) for s in (base/'progress.jsonl').read_text().splitlines()]
    def rows(self,enabled=False):
        rows=copy.deepcopy(self.original)
        for i,r in enumerate(rows):
            r['codeRaw']=raw()
            if enabled:
                r['nativeStatus']=r['m3bRaw'][2]=63
                if i>=2:
                    r['codeRaw']=raw(i,1,True)
                    for at,n in [(16,1),(17,1),(20,i),(21,1),(22,i),(24,i),(29,1)]:r['m3bRaw'][at]=n
        return rows
    def reconstruct(self,rows,enabled=False):return reconstruct(rows,enabled,self.capture['graph']['text'],self.capture['objects']['text'])
    def test_complete_original_workload_and_empty_off(self):
        result,serial=self.reconstruct(self.rows());self.assertEqual(serial,self.capture['browserResult']['serial'])
        self.assertTrue(result['attributionAccepted']);self.assertEqual((result['gates'],result['results']),(69,12))
        self.assertEqual(result['lifetime']['code'],{'formed':0,'compiled':0,'tci':0,'records':[]})
        for new,old in zip(result['phases'],self.capture['summary']['phases']):self.assertEqual({k:v for k,v in new.items() if k!='code'},old)
    def test_enabled_generation_phase_partition(self):
        result,_=self.reconstruct(self.rows(True),True);self.assertTrue(result['attributionAccepted'])
        self.assertEqual(result['lifetime']['code']['compiled'],71)
        self.assertEqual(result['phases'][1]['code']['compiled'],1)
        self.assertEqual(result['phases'][1]['code']['records'][0]['generation'],'0x99')
    def test_zero_on_is_not_attribution_acceptance(self):
        rows=self.rows()
        for r in rows:r['nativeStatus']=r['m3bRaw'][2]=63
        result,_=self.reconstruct(rows,True);self.assertFalse(result['attributionAccepted'])
    def test_formation_to_entry_and_exact_bytes(self):
        a=decode(raw(formed=True),profile());b=decode(raw(10,3,True),profile(10,3));d=difference(a,b)
        self.assertEqual((d['compiled'],d['tci']),(10,3));self.assertEqual(d['records'][0]['bytesHex'],'83f900740701f083e901ebf4')
    def test_bank_corruptions(self):
        for at,value in [(5,17),(8,1),(9,1),(10,1),(11,1),(63,1),(95,1),(136,1),(92,9),(72,0),(76,129),(77,12),(84,0),(90,0x235000),(78,0),(99,1),(192,1)]:
            with self.subTest(at=at):
                w=raw(10,3,True);w[at]=value
                with self.assertRaises(ValueError):decode(w,profile(10,3))
    def test_immutable_generation_and_counts(self):
        a=decode(raw(10,3,True),profile(10,3));b=decode(raw(11,4,True),profile(11,4))
        for key in ['owner','translationPC','page0','flags','bytesHex','generation','code','firstCr3','cr0']:
            bad=copy.deepcopy(b);bad['records'][0][key]=0
            with self.assertRaises(ValueError):difference(a,bad)
        with self.assertRaises(ValueError):difference(b,a)
    def test_protocol_and_durable_raw_gate_corruptions(self):
        def wrong(rows):
            r=next(r for r in rows if r.get('gate',{}).get('event')=='result');r['gate']['value']='wrong';r['serialChunk']='DEFUSS_M1 '+json.dumps(r['gate'])+'\n'
        for mutate in [wrong,lambda r:r[5]['status'].update(running=True),lambda r:r[5]['m3aRaw'].__setitem__(12,1),lambda r:r[0].update(graph='wrong'),lambda r:r[5]['censusRaw'].__setitem__(3,1),lambda r:r[5]['boundaryRaw'].__setitem__(4,1),lambda r:r[5].update(serialChunk=''),lambda r:r[-1].update(gateAcks=68),lambda r:r.pop(),lambda r:r[5]['codeRaw'].__setitem__(9,1)]:
            rows=self.rows();mutate(rows)
            with self.assertRaises((ValueError,KeyError)):self.reconstruct(rows)
if __name__=='__main__':unittest.main()
