import unittest,json,copy
from pathlib import Path
import review
class ReconstructionTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  root=review.ROOT/'artifacts/m3b-xstate-v2-off-01';cls.r=json.loads((root/'report.json').read_bytes());cls.rows=[json.loads(x) for x in (root/'progress.jsonl').read_bytes().splitlines()];cls.serial=(root/'serial.log').read_bytes().decode()
  reference=review.s.reference();review.s.reference=lambda:copy.deepcopy(reference)
 def test_actual_off(self):
  summary,serial=review.reconstruct(self.rows,False,self.r['layout'],self.r['xstateCaps']);self.assertEqual(serial,self.serial);self.assertEqual(summary['states'],self.r['xstateObservations']);self.assertEqual(summary['checks'],943364)
 def test_capture_corruptions(self):
  gates=[i for i,r in enumerate(self.rows) if r['observation']['event']=='gate'];i=gates[1]
  def mutate_byte(r):
   row=r[i]['observation']['xstate']['samples'][0];data=bytearray.fromhex(row['after']);data[576]^=1;row['after']=data.hex()
  edits=[lambda r:r.pop(),lambda r:r[1].update(record=999),lambda r:r[i]['observation']['status'].update(running=True),lambda r:r[i]['observation']['gate'].update(checks=0),lambda r:r[i]['observation']['xstate'].update(invocations=0),mutate_byte,lambda r:r[i]['observation']['m3b']['raw'].__setitem__(24,1),lambda r:r[i]['observation'].update(serialChunk=''),lambda r:r[i+1]['observation'].update(program=10),lambda r:r[i+2]['observation'].update(seq=999)]
  for n,edit in enumerate(edits):
   with self.subTest(corruption=n):
    rows=copy.deepcopy(self.rows);edit(rows)
    with self.assertRaises((ValueError,KeyError,IndexError)):review.reconstruct(rows,False,self.r['layout'],self.r['xstateCaps'])
if __name__=='__main__':unittest.main()
