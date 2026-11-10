#!/usr/bin/env python3
import copy
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('msg1_review', Path(__file__).with_name('review.py'))
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)


def bank(original=0, inline=0, fallback=0):
    return dict(schema=1, **dict(zip(r.FIELDS, map(str, [original, inline, fallback]))))


def fixture(enabled=True):
    common = dict(protocol='defuss-m1-v1', bun='1.4.4', revision='38afee6c84fcf48c0edb2466aa4b27d287a59c30',
                  arch='x64', heap=True, file=True, heapLength=4096, heapChecksum=7, pid=31, nonce='a'*36)
    prepared = dict(common, event='snapshot-prepared', ordinal=0, parameters=r.base.PARAMETERS, orders=r.base.ORDERS, hostMs=1)
    resumed = dict(common, event='resumed', ordinal=1, mode='cold', parameters=r.base.PARAMETERS, orders=r.base.ORDERS, hostMs=4)
    events = [prepared, resumed]; signals = [dict(byte=49, hostMs=2)]; original = inline = fallback = 0
    for i, planned in enumerate(r.base.gates(), 1):
        t = float(10*i)
        e = dict(common, **planned, seq=i, ordinal=1, mode='cold', hostMs=t,
                 signalHostMs=t+.1, pairedHostMs=t+.2, stopRequestHostMs=t+.3, stoppedHostMs=t+.4,
                 readCompleteHostMs=t+.5, ackHostMs=t+.6, contReplyHostMs=t+.7,
                 stoppedStatus=dict(running=False, status='paused'))
        original += 1
        if e['event'] == 'result' and e['name'] == 'sha256':
            if enabled: inline += 5
            else: original += 5; fallback += 5
        # Deliberate non-SHA interpreted counts are retained, not assumed zero.
        e['msg1'] = bank(original, inline, fallback)
        if e['event'] in ['initialized', 'maps']:
            text = '00400000-00401000 r-xp 00000000 00:00 1 /app\n'
            e.update(maps=text, mapsBytes=len(text.encode()), mapsSha256=hashlib.sha256(text.encode()).hexdigest())
            e['mapsArtifact'] = dict(path='fixture.maps', bytes=e['mapsBytes'], sha256=e['mapsSha256'])
        if e['event'] in ['result', 'gate-result']:e['guestMs'] = 1
        if e['event'] == 'result':e['value'] = r.base.EXPECTED[e['name']]
        if e['event'] in ['warmup-complete', 'complete']:e['values'] = r.base.EXPECTED
        events.append(e); signals.append(dict(byte=71, hostMs=e['signalHostMs']))
    rows = []; start = None; calibration = []
    for e in events[2:]:
        if e['event'] in ['warmup-start', 'start', 'gate-start']:start = e
        if e['event'] in ['warmup-complete', 'result']:
            observed = r.delta(start['msg1'], e['msg1'], enabled)
            rows.append(dict(name=e.get('name', 'warmup'), sample=e.get('sample'), iterations=e.get('iterations'),
                startSeq=start['seq'], endSeq=e['seq'], startAckHostMs=start['ackHostMs'], resultHostMs=e['hostMs'],
                guestMs=e.get('guestMs'), hostMs=e['hostMs']-start['ackHostMs'], resultToStopMs=e['stoppedHostMs']-e['hostMs'],
                counters=None, exposure=dict(begin=start['msg1'], end=e['msg1'], delta=observed)))
        if e['event'] == 'gate-result':
            calibration.append(dict(index=e['index'], hostMs=e['hostMs']-start['ackHostMs'], guestMs=e['guestMs']))
    experiment = dict(name='sha256msg1-v1', enabled=enabled)
    b = dict(schema=1, status='passed', timingEligible=False, captureCode=False, mode='baseline', snapshotMode='capture',
             experiment=experiment, events=events, gateAcks=69, signals=signals, warmup=rows[0], results=rows[1:],
             exposureInitialized=events[2]['msg1'], exposureComplete=events[-1]['msg1'], calibration=calibration,
             startup=dict(preparedHostMs=1, readyHostMs=3, resumedHostMs=4),
             ready=dict(mode='cold', snapshotSaved=True, readyMs=2, appSha256='a'*64, compatibilitySha256='b'*64))
    report = dict(schema=1, status='passed', timingEligible=False, captureCode=False, mode='baseline', snapshotMode='capture',
                  experiment=experiment, browserResult=b, manifest=dict(appSha256='a'*64, compatibilitySha256='b'*64),
                  transport=dict(publications=1), package='artifacts/synthetic-only', inputHashes={'fixture':'c'*64}, runtimeIdentity={'synthetic':True},
                  partialProgress=dict(path='progress.jsonl', rows=69, scope=r.PROGRESS_SCOPE))
    progress = [dict(protocol=r.OUTER, experiment=experiment, package=report['package'], inputs=report['inputHashes'],
                     runtimeIdentity=report['runtimeIdentity'], schema=1, kind='partial-progress-header', scope=r.PROGRESS_SCOPE)]
    for i,e in enumerate(events[2:]):
        progress.append(dict(sequence=i, event={k:v for k,v in e.items() if k not in {'ackHostMs','contReplyHostMs','mapsArtifact'}},schema=1,kind='stopped-gate'))
    serial = '\n'.join('DEFUSS_M1 '+json.dumps({k:v for k,v in e.items() if k not in r.HOST_FIELDS}) for e in events)+'\n'
    # Separate JSON files cannot share Python object aliases.
    return copy.deepcopy(report), serial, copy.deepcopy(progress)


class ReplayTests(unittest.TestCase):
    def test_uint64_and_boolean_identity(self):
        observed = r.delta(bank(2**53+9, 2**53+3), bank(2**53+14, 2**53+16), True, True)
        self.assertEqual(observed['allExecutions'], '18')
        self.assertEqual(observed['interpretedHelperEntries'], '5')
        for bad in [dict(bank(),schema=True),dict(bank(),originalHelperEntries='01'),bank(2**64),bank(0,0,1)]:
            with self.assertRaises(ValueError):r.bank(bad)
        for a,b in [(True,1),(False,0),({'x':True},{'x':1})]:
            with self.assertRaises(ValueError):r.same(a,b,'typed')
        r.same(13,13.0,'JSON clock numbers')

    def test_complete_protocol_and_conservation_both_modes(self):
        for enabled in [False, True]:
            report,serial,progress=fixture(enabled)
            nonce,part=r.protocol_evidence(report,serial,progress,enabled)
            self.assertEqual(nonce,'a'*36);self.assertEqual(len(part['phases']),13)
            for key in r.FIELDS:self.assertEqual(int(part['total'][key]),sum(int(row[key]) for row in [part['boot'],*part['gaps'],*part['phases'],part['tail']]))
            self.assertGreater(int(part['total']['originalHelperEntries']),0)

    def test_raw_progress_and_guest_corruption(self):
        changes=[lambda x:x[0]['browserResult']['events'][0].update(heap=1),
                 lambda x:x[0]['browserResult']['ready'].update(snapshotSaved=1),
                 lambda x:x[0]['transport'].update(publications=True),
                 lambda x:x[0].update(deadlineExceeded=0),
                 lambda x:x[2][0].pop('inputs'), lambda x:x[2][1].update(schema=True),
                 lambda x:x[2][-1]['event']['msg1'].update(compiledInlineExecutions='999999'),
                 lambda x:x[0]['browserResult']['results'][0].update(startSeq=1),
                 lambda x:x[0]['browserResult']['results'][0].update(sample=False),
                 lambda x:x[0]['browserResult']['results'][0].update(iterations=True),
                 lambda x:x[0]['browserResult']['warmup'].update(sample=0),
                 lambda x:x[0]['browserResult']['warmup'].update(iterations=100),
                 lambda x:x[0]['browserResult']['warmup'].update(guestMs=0),
                 lambda x:x[0].update(schema=True)]
        for i,change in enumerate(changes):
            with self.subTest(i=i),self.assertRaises((ValueError,KeyError)):
                x=list(fixture());change(x);r.protocol_evidence(*x,True)
        report,serial,progress=fixture()
        for bad in [serial.replace('"nonce": "'+'a'*36+'", ','',1),serial+'BUN_APP_FAILURE tail\n',serial+'Kernel panic\n',serial+serial.splitlines()[0]+'\n']:
            with self.assertRaises(ValueError):r.protocol_evidence(report,bad,progress,True)

    def test_partition_boot_gap_reset_and_selected_sha(self):
        for enabled in [False,True]:
            b=fixture(enabled)[0]['browserResult']
            for change in [lambda x:x['exposureInitialized'].update(compiledInlineExecutions='1' if not enabled else '0',compiledFallbackEntries='1' if enabled else '0'),
                           lambda x:x['results'][0]['exposure']['begin'].update(originalHelperEntries='0'),
                           lambda x:x['results'][0]['exposure']['delta'].update(allExecutions='999')]:
                with self.assertRaises(ValueError):
                    modified=copy.deepcopy(b);change(modified);r.partition(modified,enabled)
        with self.assertRaises(ValueError):r.delta(bank(),bank(3),True,True)
        with self.assertRaises(ValueError):r.delta(bank(),bank(3,1),False)

    def test_strict_json(self):
        for data in ['{"a":1,"a":2}','{"x":NaN}','{"x":Infinity}']:
            with self.assertRaises(ValueError):r.parse(data)

    def test_snapshot_identity_and_expansion(self):
        parent=r.ROOT/'tmp';parent.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='msg1-exposure-review-',dir=parent) as directory:
            path=Path(directory)/'tiny.snapshot';raw=b'bounded snapshot\n'*17;compressed=gzip.compress(raw)
            manifest=dict(appSha256='a'*64,compatibilitySha256='b'*64)
            metadata=dict(schema=1,encoding='gzip',**manifest,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),
                          compressedBytes=len(compressed),compressedSha256=hashlib.sha256(compressed).hexdigest())
            def write(m,payload=compressed):
                header=json.dumps(m).encode();path.write_bytes(b'BWSNAP01'+struct.pack('<I',len(header))+header+payload)
            write(metadata);self.assertEqual(r.snapshot_envelope(path,manifest),metadata)
            for modified in [dict(metadata,sha256='f'*64),dict(metadata,bytes=1),dict(metadata,appSha256='c'*64)]:
                write(modified)
                with self.assertRaises(ValueError):r.snapshot_envelope(path,manifest)


if __name__=='__main__':unittest.main()
