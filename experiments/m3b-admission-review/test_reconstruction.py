import copy,json,unittest
from pathlib import Path
from review import ROOT,reconstruct
class ReconstructionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path=ROOT/'artifacts/m3b-bun-exposure-off-01';cls.report=json.loads((path/'report.json').read_text());cls.rows=[json.loads(x) for x in (path/'progress.jsonl').read_text().splitlines()]
        for i,row in enumerate(cls.rows):
            w=[0]*128;w[:3]=[0x4d334241,1,128]
            if i:w[16]=1;w[18]=1
            row['admissionRaw']=w
    def run_rows(self,rows):return reconstruct(rows,False,self.report['graph']['text'],self.report['objects']['text'])
    def test_original_results_with_synthetic_observer(self):
        summary,serial=self.run_rows(self.rows);self.assertEqual(summary['gates'],69);self.assertEqual(summary['results'],12);self.assertEqual(summary['lifetime']['admission']['counters']['translations'],1)
        self.assertEqual(serial,self.report['browserResult']['serial'])
        for phase,old in zip(summary['phases'],self.report['summary']['phases']):
            self.assertEqual({k:v for k,v in phase.items() if k!='admission'},old)
            self.assertTrue(all(v==0 for family in phase['admission'].values() for v in family.values()))
    def test_missing_observer_activity(self):
        rows=copy.deepcopy(self.rows)
        for row in rows:row['admissionRaw'][16]=row['admissionRaw'][18]=0
        with self.assertRaises(ValueError):self.run_rows(rows)
    def test_new_bank_reset(self):
        rows=copy.deepcopy(self.rows);rows[5]['admissionRaw'][16]=rows[5]['admissionRaw'][18]=0
        with self.assertRaises(ValueError):self.run_rows(rows)
if __name__=='__main__':unittest.main()
