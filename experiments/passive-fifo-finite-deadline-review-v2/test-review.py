#!/usr/bin/env python3
"""Isolated deadline-v2 source tests; synthetic files only, no guest/build."""
import copy,importlib.util,json,os,subprocess,tempfile,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
s=importlib.util.spec_from_file_location('deadline_review',HERE/'review.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
def read(p):return json.loads(Path(p).read_text())
def write(p,x):Path(p).write_text(json.dumps(x,indent=2)+'\n')
class Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  result=subprocess.run(['node',str(HERE/'synthetic.mjs')],cwd=ROOT,capture_output=True,text=True,check=True);cls.fixture=json.loads(result.stdout);cls.path=Path(cls.fixture['scratch'])/'fixture.json';write(cls.path,cls.fixture)
 def audit(self,index=1):
  x=self.fixture['results'][index];return r.Review().campaign(x['campaign'],x['analysis'])
 def test_both_synthetic_deadlines_independently_match_JS(self):
  for i,timeout in enumerate([600000,1800000]):
   result=self.audit(i);self.assertEqual(result['executionPolicy']['timeoutMs'],timeout);self.assertTrue(result['selected']);self.assertFalse(result['confirmationPassed']);self.assertFalse(result['productPromotionEligible'])
 def test_JS_policy_corruption_and_unchanged_numerical_primitives(self):
  env={**os.environ,'DEADLINE_V2_TEST_FIXTURE':str(self.path)};x=subprocess.run(['node','--test','benchmarks/harness/passive-fifo-finite-deadline-v2/execution-policy.test.mjs'],cwd=ROOT,env=env,capture_output=True,text=True);(Path(self.fixture['scratch'])/'node-tests.log').write_text(x.stdout+x.stderr);self.assertEqual(x.returncode,0,x.stdout+x.stderr)
 def test_independent_policy_rejects_wrong_decision_step_or_confirmation(self):
  plan=read(ROOT/self.fixture['results'][1]['plan'])
  for mutate in [lambda p:p.__setitem__('kind','confirmation'),lambda p:p['executionPolicy'].__setitem__('timeoutMs',600000),lambda p:p['executionPolicy'].__setitem__('repetition',1),lambda p:p['steps'][0].__setitem__('timeoutMs',600000),lambda p:p.__setitem__('primaryUpperRatio',.96)]:
   p=copy.deepcopy(plan);mutate(p)
   with self.assertRaises((ValueError,KeyError)):r.Review().validate_plan(p)
 def test_child_report_timeout_and_unknown_attempt_remain_fail_closed(self):
  x=self.fixture['results'][1];directory=ROOT/x['campaign'];attempt=next((directory/'attempts').iterdir());path=attempt/'run/report.json';old=path.read_bytes();accepted=attempt/'accepted.json';old_accepted=accepted.read_bytes();raw=json.loads(old);raw['timeoutMs']=600000;write(path,raw);record=json.loads(old_accepted);record['reportSha256']=r.sha(path.read_bytes());write(accepted,record)
  try:
   with self.assertRaises(ValueError):self.audit()
  finally:path.write_bytes(old);accepted.write_bytes(old_accepted)
  orphan=directory/'attempts/orphan';orphan.mkdir()
  try:
   with self.assertRaisesRegex(ValueError,'orphan'):self.audit()
  finally:orphan.rmdir()
 def test_preexisting_measurement_sources_and_reviewer_freeze_unchanged(self):
  for name in ['artifacts/passive-fifo-finite-v1-source-01/manifest.json','artifacts/passive-fifo-finite-review-source-01/manifest.json']:
   for row in read(ROOT/name)['files']:
    self.assertEqual(r.sha((ROOT/row['path']).read_bytes()),row['sha256']);self.assertEqual(r.sha((ROOT/row['archive']).read_bytes()),row['sha256'])
  declared=read(ROOT/'artifacts/passive-fifo-timing-repetitions-01.json');self.assertEqual(r.sha((ROOT/declared['originalPlan']['path']).read_bytes()),declared['originalPlan']['sha256'])
 def test_synthetic_cli_cannot_publish_timing_acceptance(self):
  x=self.fixture['results'][1];out=ROOT/'artifacts'/('synthetic-deadline-review-rejection-'+Path(self.fixture['scratch']).name)
  p=subprocess.run(['python3','-B',str(HERE/'review.py'),'--campaign',x['campaign'],'--analysis',x['analysis'],'--prerequisites',str(self.path),'--output',str(out)],cwd=ROOT,capture_output=True,text=True)
  self.assertEqual(p.returncode,1);self.assertIn('synthetic/tmp',read(out/'review.json')['failure'])
if __name__=='__main__':unittest.main()
