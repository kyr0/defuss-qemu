import copy
import json
import unittest
from pathlib import Path
from review import ROOT,reconstruct,bank,delta

BASE=ROOT/'artifacts/m3b-bun-exposure-off-01'

class ReconstructionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report=json.loads((BASE/'report.json').read_text())
        cls.rows=[json.loads(line) for line in (BASE/'progress.jsonl').read_text().splitlines()]

    def reconstruct(self,rows,enabled=False):
        return reconstruct(rows,enabled,self.report['graph']['text'],self.report['objects']['text'])

    def test_actual_disabled_raw_reconstruction(self):
        result,serial=self.reconstruct(self.rows)
        for key,value in result.items():self.assertEqual(value,self.report['summary'][key])
        self.assertEqual(serial,(BASE/'serial.log').read_bytes().decode('utf-8'))
        self.assertIn('\r\n',serial)

    def test_enabled_partition(self):
        rows=copy.deepcopy(self.rows)
        for i,row in enumerate(rows):
            row['nativeStatus']=row['m3bRaw'][2]=63
            for index in [20,22,24]:row['m3bRaw'][index]=i
        result,_=self.reconstruct(rows,True)
        self.assertEqual(result['phases'][1]['m3b']['compiledEntries'],1)

    def test_negative_mutations(self):
        def wrong_result(rows):
            row=next(x for x in rows if x.get('gate',{}).get('event')=='result')
            row['gate']['value']='corrupted'
            row['serialChunk']='DEFUSS_M1 '+json.dumps(row['gate'])+'\n'
        changes={
            'guest-result':wrong_result,
            'running':lambda r:r[5]['status'].update(running=True),
            'unlocked-configuration':lambda r:r[5]['m3aRaw'].__setitem__(12,1),
            'graph':lambda r:r[0].update(graph='changed'),
            'counter-reset':lambda r:r[50]['m3aRaw'].__setitem__(16,0),
            'off-fusion':lambda r:r[5]['m3bRaw'].__setitem__(20,1),
            'service':lambda r:r[5]['m3bRaw'].__setitem__(22,1),
            'fault':lambda r:r[5]['censusRaw'].__setitem__(3,1),
            'control':lambda r:r[5]['boundaryRaw'].__setitem__(4,1),
            'no-raw-gate':lambda r:r[5].update(serialChunk=''),
            'missing-ack':lambda r:r[-1].update(gateAcks=68),
            'partial':lambda r:r.pop(),
            'extra-row':lambda r:r.append(copy.deepcopy(r[-1])),
        }
        for name,mutate in changes.items():
            with self.subTest(name=name):
                rows=copy.deepcopy(self.rows);mutate(rows)
                with self.assertRaises((ValueError,KeyError)):self.reconstruct(rows)

    def test_delta_rejects_bad_numbers(self):
        for a,b in [({'a':3},{'a':2}),({'a':0},{'a':1.5}),({'a':0},{'b':1})]:
            with self.assertRaises(ValueError):delta(a,b)

if __name__=='__main__':unittest.main()
