#!/usr/bin/env python3
"""Small independent replay corruption tests; no runtime, compiler or guest."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('msg1_review', HERE / 'review-isa.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def synthetic(enabled='on', cold=False, initial=0):
    locked = 65540 if enabled == 'on' else 65539
    d = dict(schema=1, status='passed', protocol=review.PROTOCOL, timingEligible=False,
             fixtureContract='msg1-isa-v1', exposureContract='exact-msg1-fixture-v1',
             expectedInstructionCounts=list(map(str, review.COUNTS)), enabled=enabled, cold=cold,
             node='test', settings=dict(hotLimit=65535 if cold else 1500, runtimeFlags=2,
               pressureAdmission=False, smp=1, ramMiB=512, tbMiB=128),
             inputHashes={'runtime': 'test'}, runtimeBuild={'path': 'test'},
             configuredStatus=65538 if enabled == 'on' else 65537, finalStatus=locked,
             executionCounts=True, lateConfigurationResult=-1,
             fixturePass='MSG1_FIXTURE_PASS checks=28672', faultPass=review.FAULT,
             signals=[71]*8, serialContract=review.SERIAL_CONTRACT.copy(), gates=[], stderr=[])
    cumulative = [initial, 0, 0]
    for index in range(8):
        row = dict(kind=index-1, stopped=True, status=locked,
                   pool=dict(charged=5000, limit=12000, linearMemoryBytes=2**31))
        if index:
            n = review.COUNTS[index-1]
            delta = [n, 0, 0] if cold else ([1500, n-1500, 0] if enabled == 'on' else [n, 0, n-1500])
            cumulative = [a+b for a,b in zip(cumulative, delta)]
            row['delta'] = list(map(str, delta))
            row['exposure'] = dict(contract='exact-msg1-fixture-v1', mode=index-1,
                expectedInstructions=str(n), observedInstructions=str(n),
                interpreted=str(delta[0]-delta[2]), compiledInline=str(delta[1]), compiledFallback=str(delta[2]))
        row['counters'] = list(map(str, cumulative))
        d['gates'].append(row)
    request = {k:copy.deepcopy(d[k]) for k in ('schema', 'protocol', 'timingEligible', 'fixtureContract',
        'exposureContract', 'expectedInstructionCounts', 'enabled', 'cold', 'node', 'settings', 'inputHashes', 'runtimeBuild')}
    request.update(status='running', entrypoint=review.ENTRY, gates=[], signals=[], stderr=[])
    lines = ['MSG1_FIXTURE_START', 'MSG1_GATE:-1']
    for mode in range(7):
        if mode == 6:
            lines.append(review.FAULT)
        lines += [f'MSG1_MODE_PASS:{mode} checks=4096', f'MSG1_GATE:{mode}']
    lines += ['MSG1_FIXTURE_PASS checks=28672', 'FIXTURE_PASS']
    return d, '\r\n'.join(lines)+'\r\n', request


class ReplayTests(unittest.TestCase):
    def test_matrix_and_large_exact_uint64(self):
        for enabled in ('on', 'off'):
            for cold in (False, True):
                with self.subTest(enabled=enabled, cold=cold):
                    result = review.replay(*synthetic(enabled, cold, 2**53+17))
                    self.assertEqual(result['totals']['observedInstructions'], '32768')
                    self.assertEqual(sum(int(result['totals'][k]) for k in
                                     ('interpreted','compiledInline','compiledFallback')),32768)

    def test_real_hot_on_raw_replay(self):
        path = review.ROOT / 'artifacts/m2-msg1-diagnostic-hot-on-01'
        result = review.replay(json.loads((path/'report.json').read_text()),
                               (path/'serial.log').read_text(), json.loads((path/'request.json').read_text()))
        self.assertEqual(result['totals'], dict(observedInstructions='32768', interpreted='12025',
                                               compiledInline='20743', compiledFallback='0'))

    def test_wrong_delta_or_missing_fault_warmups(self):
        for field in ('delta', 'counters'):
            d,s,q = synthetic()
            d['gates'][-1][field][0] = str(int(d['gates'][-1][field][0])-4096)
            with self.subTest(field=field), self.assertRaises(ValueError):
                review.replay(d,s,q)

    def test_self_consistent_extra_execution_rejected(self):
        d,s,q = synthetic()
        for gate in d['gates'][1:]:
            gate['counters'][0] = str(int(gate['counters'][0])+1)
        d['gates'][1]['delta'][0] = '1501'
        d['gates'][1]['exposure']['observedInstructions'] = '4097'
        d['gates'][1]['exposure']['interpreted'] = '1501'
        with self.assertRaisesRegex(ValueError, 'Exact instruction'):
            review.replay(d,s,q)

    def test_forbidden_boot_bank_cannot_hide_in_deltas(self):
        d,s,q = synthetic(initial=10)
        for gate in d['gates']:
            gate['counters'][2] = '1'
        with self.assertRaisesRegex(ValueError, 'Forbidden cumulative'):
            review.replay(d,s,q)

    def test_counter_syntax_and_subset(self):
        for bad in (['01','0','0'], [True,'0','0'], ['-1','0','0'], [str(2**64),'0','0'], ['0','0','1']):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                review.exact_counts(bad)

    def test_mode_markers_fault_order_and_duplicate(self):
        d,s,q = synthetic()
        for corrupted in (s.replace(review.FAULT, ''), s+'MSG2_GATE:0\n', s.replace('MSG1_GATE:2','MSG1_GATE:1'),
                          s+'FIXTURE_PASS\n', s+'Kernel panic\n'):
            with self.subTest(corrupted=corrupted[-40:]), self.assertRaises(ValueError):
                review.replay(d,corrupted,q)

    def test_request_and_final_mode_stop_rejections(self):
        for field, value in (('lateConfigurationResult',0),('timingEligible',True),('protocol','timing'),
                             ('signals',[71]*7),('finalStatus',65539),('executionCounts',False)):
            d,s,q = synthetic();d[field]=value
            with self.subTest(field=field), self.assertRaises(ValueError):
                review.replay(d,s,q)
        d,s,q=synthetic();d['gates'][4]['stopped']=False
        with self.assertRaises(ValueError):review.replay(d,s,q)
        d,s,q=synthetic();q['inputHashes']['runtime']='different'
        with self.assertRaises(ValueError):review.replay(d,s,q)

    def test_cold_cannot_claim_compiled_path(self):
        d,s,q=synthetic(cold=True)
        d['gates'][0]['counters']=['1','1','0']
        with self.assertRaisesRegex(ValueError,'Cold mode'):review.replay(d,s,q)

    def test_identity_omission_change_and_escape(self):
        with tempfile.TemporaryDirectory(prefix='msg1-review-',dir=review.ROOT/'tmp') as directory:
            root=Path(directory);(root/'input').write_text('original')
            e=review.Evidence(root);digest=e.retain('input')['sha256']
            e.inputs({'input':digest},['input'])
            with self.assertRaises(ValueError):e.inputs({},['input'])
            with self.assertRaises(ValueError):e.inside('../outside')
            (root/'input').write_text('changed')
            with self.assertRaises(ValueError):e.finish()


if __name__=='__main__':
    unittest.main(verbosity=2)
