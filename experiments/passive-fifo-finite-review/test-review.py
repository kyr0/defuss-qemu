#!/usr/bin/env python3
"""Synthetic validator/corruption tests only. No live workload or build."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
s=importlib.util.spec_from_file_location('finite_review',HERE/'review.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
def read(path):return json.loads(Path(path).read_text())
def write(path,value):Path(path).write_text(json.dumps(value,indent=2)+'\n')
class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run=subprocess.run(['node',str(HERE/'synthetic.mjs')],cwd=ROOT,capture_output=True,text=True,check=True)
        cls.fixture=json.loads(run.stdout);cls.pilot=cls.fixture['exploration'];cls.confirmation=cls.fixture['confirmation']
        cls.directory=ROOT/cls.pilot['directory'];cls.analysis=ROOT/cls.pilot['analysis'];cls.attempt=cls.directory/'attempts/pair-01-off';cls.report=cls.attempt/'run/report.json'
    def review(self,kind='exploration'):
        item=self.fixture[kind];return r.Review().campaign(item['directory'],item['analysis'])
    def mutate(self,path,fn,check,rehash_report=False):
        path=Path(path);old=path.read_bytes();record=self.attempt/'accepted.json';old_record=record.read_bytes();value=json.loads(old);fn(value);write(path,value)
        if rehash_report:
            accepted=read(record);accepted['reportSha256']=r.sha(path.read_bytes());write(record,accepted)
        try:
            with self.assertRaises((ValueError,KeyError,FileNotFoundError,TypeError)):check()
        finally:path.write_bytes(old);record.write_bytes(old_record)
    def test_full_synthetic_pilot_and_independent_fresh_confirmation(self):
        pilot=self.review();confirmed=self.review('confirmation')
        self.assertTrue(pilot['selected']);self.assertEqual(pilot['confirmationPlanning']['requiredPairs'],8);self.assertTrue(confirmed['confirmationPassed']);self.assertFalse(confirmed['productPromotionEligible'])
        for pair in pilot['pairs']:
            for side in ('control','candidate'):
                vm=pair[side];self.assertEqual(len(vm['partition']['gapMs']),51);self.assertEqual(len(vm['warmups'])+len(vm['measured']),52)
                self.assertAlmostEqual(vm['phaseSum'],sum(vm[name] for name in r.pv.NAMES));self.assertAlmostEqual(vm['fullHorizon'],vm['partition']['totalMs'])
    def test_integral_elapsed_with_fractional_endpoint_json_is_valid(self):
        browser=copy.deepcopy(read(self.report)['browserResult'])
        for event in browser['events']:
            for key in r.v.HOST_FIELDS:
                if key in event and type(event[key]) in (int,float):event[key]+=0.25
        for row in browser['warmups']+browser['results']:
            row['startAckHostMs']+=0.25;row['resultHostMs']+=0.25
            self.assertEqual(type(row['hostMs']),int)
        browser['horizon']['t0HostMs']+=0.25;browser['horizon']['t1HostMs']+=0.25;browser['startup']['readyHostMs']+=0.25
        value=r.horizon(browser);self.assertEqual(value['phaseSum'],260);self.assertEqual(value['fullHorizon'],1484)

    def test_all_five_secondary_guards_and_drift_never_censors(self):
        pilot=self.review();pairs=copy.deepcopy(pilot['pairs'])
        for pair in pairs:
            for side in ('control','candidate'):
                for drift in pair[side]['drift'].values():drift['withinBound']=False
        data=r.aggregate(pilot['plan'],pairs);self.assertTrue(data['selected']);self.assertFalse(data['driftWithinDescriptiveBand'])
        for name in r.SECONDARY:
            changed=copy.deepcopy(pairs)
            for pair in changed:pair['candidate'][name]=pair['control'][name]*1.11
            self.assertFalse(r.aggregate(pilot['plan'],changed)['selected'])
    def test_boundary_and_gap_changes_cannot_disappear(self):
        self.mutate(self.report,lambda x:x['browserResult']['horizon'].__setitem__('t0HostMs',1),self.review,True)
        self.mutate(self.report,lambda x:x['browserResult']['horizon'].__setitem__('t1HostMs',1483),self.review,True)
        self.mutate(self.analysis,lambda x:x['pairs'][0]['control']['partition']['gapMs'].__setitem__(0,0),self.review)
        self.mutate(self.analysis,lambda x:x['pairs'][0]['control']['phaseSplit']['byWorkload']['integer'].__setitem__('preludeMs',1),self.review)
    def test_gate_raw_serial_map_and_snapshot_corruption(self):
        self.mutate(self.report,lambda x:x['browserResult']['signals'][1].__setitem__('byte',72),self.review,True)
        self.mutate(self.report,lambda x:x['browserResult']['results'].__setitem__(0,x['browserResult']['warmups'][0]),self.review,True)
        raw=read(self.report);m=raw['manifest'];snapshot=ROOT/raw['cache']/m['appSha256']/(m['compatibilitySha256']+'.snapshot')
        for path in [self.report.parent/'serial.log',self.report.parent/'maps.maps',snapshot]:
            old=path.read_bytes();path.write_bytes(old+b'BUN_APP_FAILURE:synthetic-corruption\n')
            try:
                with self.assertRaises(ValueError):self.review()
            finally:path.write_bytes(old)
    def test_unknown_or_poststart_attempt_cannot_be_excluded(self):
        accepted=self.attempt/'accepted.json';saved=accepted.read_bytes();accepted.rename(self.attempt/'accepted-test-backup')
        try:
            with self.assertRaisesRegex(ValueError,'Post-start'):self.review()
        finally:(self.attempt/'accepted-test-backup').rename(accepted)
        orphan=self.directory/'attempts/orphan';orphan.mkdir()
        try:
            with self.assertRaisesRegex(ValueError,'orphan'):self.review()
        finally:orphan.rmdir()
        halt=self.directory/'invalid-completed-observation.json';write(halt,{'synthetic':True})
        try:
            with self.assertRaisesRegex(ValueError,'permanently invalidated'):self.review()
        finally:halt.unlink()
    def test_only_hashed_proven_prestart_failure_can_be_retained(self):
        folder=self.directory/'attempts/pair-01-off-prestart';run=folder/'run';run.mkdir(parents=True)
        request=read(self.attempt/'request.json');request['utc']='2026-11-07T00:01:30Z';request['cache']=str((run/'snapshots').relative_to(ROOT));request['command'][7]=str(run.relative_to(ROOT));write(folder/'request.json',request)
        write(folder/'exit.json',dict(code=1,signal=None,error=None,utc='2026-11-07T00:01:31Z'))
        write(run/'report.json',dict(status='failed',executionBoundary=dict(started=False),synthetic=True));write(run/'pre-start-failure.json',dict(schema=1,state='proven-pre-start-failure',reportSha256=r.sha((run/'report.json').read_bytes())))
        saved=self.analysis.read_bytes();published=json.loads(saved);published['retainedPreStartFailures']=[str(folder)];write(self.analysis,published)
        try:
            self.assertEqual(self.review()['retainedPreStartFailures'],[str(folder)])
            for change in [lambda x:x['executionBoundary'].__setitem__('started',0),lambda x:x.__setitem__('browserResult',{})]:
                raw=read(run/'report.json');change(raw);write(run/'report.json',raw)
                certificate=read(run/'pre-start-failure.json');certificate['reportSha256']=r.sha((run/'report.json').read_bytes());write(run/'pre-start-failure.json',certificate)
                with self.assertRaises(ValueError):self.review()
                write(run/'report.json',dict(status='failed',executionBoundary=dict(started=False),synthetic=True))
        finally:
            self.analysis.write_bytes(saved)
            for path in run.iterdir():path.unlink()
            run.rmdir()
            for path in folder.iterdir():path.unlink()
            folder.rmdir()
    def test_fixed_rules_types_frozen_plan_and_attempt_order(self):
        plan=read(self.directory/'plan.json')
        for fn in [lambda x:x.__setitem__('primary','sha256'),lambda x:x.__setitem__('bootstrapDraws',5000),lambda x:x['steps'][0].__setitem__('enabled',0),lambda x:x['bootstrapRule'].__setitem__('secondaryOneSidedAlpha',.01)]:
            changed=copy.deepcopy(plan);fn(changed)
            with self.assertRaises(ValueError):r.Review().validate_plan(changed)
        self.mutate(self.directory/'frozen.json',lambda x:x['plan'].__setitem__('pairs',8),self.review)
        self.mutate(self.report,lambda x:x['browserResult']['fifo'].__setitem__('effective',0),self.review,True)
        self.mutate(self.report,lambda x:x['browserResult']['ready'].__setitem__('snapshotSaved',1),self.review,True)
        self.mutate(self.report,lambda x:x.__setitem__('deadlineExceeded',0),self.review,True)
        self.mutate(self.attempt/'spawned.json',lambda x:x.__setitem__('utc','2026-11-07T01:00:00Z'),self.review)
    def test_stats_and_planning_corruption_are_independently_rejected(self):
        self.mutate(self.analysis,lambda x:x['confirmationPlanning'].__setitem__('requiredPairs',6),self.review)
        cp=ROOT/self.confirmation['analysis'];self.mutate(cp,lambda x:x['endpoints']['phaseSum']['interval'].__setitem__('alpha',.01),lambda:self.review('confirmation'))
        endpoints={name:dict(ratios=[.5,.8,1.2,2]) for name in r.ENDPOINTS};planned=r.planning(endpoints,read(self.directory/'plan.json'));self.assertGreater(planned['requiredPairs'],32);self.assertFalse(planned['feasible'])
    def test_diagnostic_prerequisite_semantics_and_hashed_ledger(self):
        # This tiny report is retained under tmp and explicitly test-only; it
        # does not claim that any actual diagnostic guest completed.
        folder=Path(tempfile.mkdtemp(prefix='finite-prereq-test-',dir=ROOT/'tmp'))
        plan=read(self.directory/'plan.json');packages=plan['packages']
        source=str((HERE/'review.py').relative_to(ROOT));audit='artifacts/passive-fifo-diagnostic-build-01/source-recheck.json'
        inventory={name:dict(sha256=r.sha((ROOT/name).read_bytes()),bytes=(ROOT/name).stat().st_size) for name in [source,audit]}
        rows=[]
        for enabled in (False,True):
            rows.append(dict(enabled=enabled,mainFaults=384,mainChecks=414168,
                pressureAfterWarm=dict(softBatches=2 if enabled else 0,softRetired=512 if enabled else 0,gcConsumed=256,emergencyRetired=0 if enabled else 6000),
                finalCounters=dict(accountingErrors=0,softBatches=2 if enabled else 0,softRetired=512 if enabled else 0),finalPool=dict(charged=100,live=90,pending=10,done=3),
                trace=dict(rows=10,episode=1,pendingEpisodes=1),mainExposure=dict(compiledCalls=0)))
        path=folder/'diagnostic-unit-data.json';record=dict(schema=1,status='passed',kind='passive-fifo-combined-independent-replay',createdUtc='2026-11-06T00:00:00Z',testOnly=True,scope='Unit fixture only; no diagnostic guest was executed',runs=rows,inventory=inventory,reviewerSha256=inventory[source]['sha256']);write(path,record)
        item=lambda:dict(path=str(path.relative_to(ROOT)),sha256=r.sha(path.read_bytes()))
        self.assertEqual(r.Review().prerequisite_review('diagnostic',item(),packages)['runs'][1]['trace']['pendingEpisodes'],1)
        for fn in [lambda x:x.__setitem__('status','failed'),lambda x:x['runs'][1]['pressureAfterWarm'].__setitem__('softBatches',1),lambda x:x['runs'][0]['pressureAfterWarm'].__setitem__('emergencyRetired',5999),lambda x:x['runs'][1]['trace'].__setitem__('pendingEpisodes',65),lambda x:x['runs'][1].__setitem__('mainFaults',383),lambda x:x['runs'][1]['finalPool'].__setitem__('live',89),lambda x:x.__setitem__('reviewerSha256','0'*64)]:
            changed=copy.deepcopy(record);fn(changed);write(path,changed)
            with self.assertRaises(ValueError):r.Review().prerequisite_review('diagnostic',item(),packages)
        write(path,record)
        ledger=folder/'ledger.json';write(ledger,dict(schema=1,experiment='passive-fifo-v1',protocol=r.OUTER,createdUtc='2026-11-06T00:01:00Z',packages={side:dict(manifestSha256=packages[side]['manifestSha256']) for side in packages},reviews={'diagnostic':item()}))
        identity=dict(sha256=r.sha(ledger.read_bytes()),bytes=ledger.stat().st_size);relative=str(ledger.relative_to(ROOT));plan['inputs'].append(relative)
        with self.assertRaisesRegex(ValueError,'required independent prerequisite roles'):r.Review().prerequisites(relative,plan,dict(files={relative:identity}))
        plan['inputs'].remove(relative)
        with self.assertRaisesRegex(ValueError,'not frozen before timing'):r.Review().prerequisites(relative,plan,dict(files={relative:identity}))

    def test_durable_new_publication_and_cli_rejects_synthetic_tmp(self):
        folder=Path(tempfile.mkdtemp(prefix='finite-durable-',dir=ROOT/'tmp'));path=folder/'review.json';r.durable_json(path,dict(synthetic=True,status='unit-fixture'));self.assertTrue(read(path)['synthetic'])
        with self.assertRaises(FileExistsError):r.durable_json(path,{})
        output=ROOT/'artifacts'/('synthetic-finite-rejection-'+folder.name)
        completed=subprocess.run(['python3','-B',str(HERE/'review.py'),'--campaign',self.pilot['directory'],'--analysis',self.pilot['analysis'],'--prerequisites',str(path),'--output',str(output)],cwd=ROOT,capture_output=True,text=True)
        self.assertEqual(completed.returncode,1);self.assertIn('synthetic/tmp',read(output/'review.json')['failure'])
if __name__=='__main__':unittest.main()
