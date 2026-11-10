#!/usr/bin/env python3
"""Synthetic/historical oracle tests only; no passive guest acceptance evidence."""
import copy,gzip,hashlib,importlib.util,json,shutil,struct,subprocess,tempfile,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('independent_fifo',HERE/'review.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
sha=lambda b:hashlib.sha256(b).hexdigest()
def read(path):return json.loads(Path(path).read_text())
def write(path,value):Path(path).write_text(json.dumps(value,indent=2)+'\n')
def identity(path):data=Path(path).read_bytes();return dict(sha256=sha(data),bytes=len(data))

def heldout_fixtures(resource):
    """Build tiny retained-data fixtures, not a runnable VM image or real build."""
    directory=Path(tempfile.mkdtemp(prefix='fifo-heldout-review-',dir=ROOT/'tmp'))
    raw_resource=read(resource['control']);plan=read(ROOT/raw_resource['resourcePlan']['path']);proof=read(Path(plan['packages']['control']['path'])/'runtime-provenance.json')
    payload=(ROOT/'tests/accelerators/msg2-heldout.mjs').read_bytes();historical=read(ROOT/'artifacts/m2-heldout-off-capture-01/report.json')['result'];reports=[]
    modules=['tests/passive-fifo-heldout/'+x+'.mjs' for x in ('run','oracle','runtime-proof')]+['benchmarks/harness/passive-fifo-finite-v1/'+x+'.mjs' for x in ('vm-adapter','snapshot','attempt')]+['experiments/passive-fifo/reader.mjs','tests/accelerators/msg2-heldout.mjs','benchmarks/harness/code/physical.mjs']+['host/browser/'+x+'.mjs' for x in ('qmp','machine','hotspots','helper-names')]+['packaging/bun-app/'+x+'.mjs' for x in ('serial','snapshots','file-store')]
    for side,enabled in [('control',False),('candidate',True)]:
        old=plan['packages'][side]['manifest'];source=ROOT/plan['packages'][side]['path'];manifest=copy.deepcopy(old)
        manifest['benchmark']=dict(protocol='unchanged-msg2-heldout-payload',measurementProtocol='defuss-passive-fifo-heldout-v1');manifest['appSha256']=sha(payload);manifest['artifacts']['app.mjs']=dict(sha256=sha(payload),bytes=len(payload))
        value={k:v for k,v in manifest.items() if k not in ('generation','compatibilitySha256')};digest=sha(r.canonical(value));manifest['generation']=manifest['compatibilitySha256']=digest
        package=directory/(side+'-package');package.mkdir();write(package/'app.json',manifest);write(package/'runtime-provenance.json',proof)
        for name in r.pv.ARTIFACTS:
            target=package/digest/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(payload if name=='app.mjs' else (source/old['generation']/name).read_bytes())
        capture=None
        for mode in ('cold','restored'):
            output=directory/(side+'-'+mode);output.mkdir();result=copy.deepcopy(historical);result['mode']=mode
            if mode=='cold':
                data=b'SYNTHETIC SNAPSHOT NOT GUEST EVIDENCE';compressed=gzip.compress(data,mtime=0);metadata=dict(schema=1,encoding='gzip',appSha256=manifest['appSha256'],compatibilitySha256=digest,bytes=len(data),sha256=sha(data),compressedBytes=len(compressed),compressedSha256=sha(compressed));meta=json.dumps(metadata).encode();packed=b'BWSNAP01'+struct.pack('<I',len(meta))+meta+compressed
                snapshot=output/'snapshots'/manifest['appSha256']/(digest+'.snapshot');snapshot.parent.mkdir(parents=True);snapshot.write_bytes(packed);snap=identity(snapshot)
                names=['cache-miss','vm-started','snapshot-start','snapshot-captured','snapshot-saved','ready']
            else:names=['cache-hit','vm-started','ready']
            ready=dict(mode=mode,appSha256=manifest['appSha256'],compatibilitySha256=digest,readyMs=5,snapshotSaved=mode=='cold')
            if mode=='cold':ready['snapshotBytes']=metadata['compressedBytes']
            events=[dict(event=name,atMs=i) for i,name in enumerate(names)];events[-1].update(ready)
            if mode=='cold':events[-2]['metadata']=metadata;events[-3]['bytes']=metadata['bytes']
            else:events[0]['metadata']=metadata
            inputs=dict(proof['inputs'])
            for path in [ROOT/name for name in modules]+[package/'app.json',package/'runtime-provenance.json']+[package/digest/name for name in r.pv.ARTIFACTS]:inputs[str(path)]=sha(path.read_bytes())
            report=dict(schema=1,status='passed',synthetic=True,scope='Synthetic retained-data unit fixture; historical unchanged arithmetic payload is not passive guest evidence',protocol='defuss-passive-fifo-heldout-v1',timingEligible=False,node='synthetic-test-only',package=str(package),manifest=manifest,events=events,snapshotMode=mode,runnerSha256=sha((ROOT/'tests/passive-fifo-heldout/run.mjs').read_bytes()),fixtureSha256=sha(payload),runtimeProvenance=proof,inputs=inputs,ready=ready,snapshotIdentity=snap,snapshotMetadata=metadata,fifo=r.fifo_state(enabled),resultRecords=1,result=result,checkedDigests=384)
            if mode=='restored':report['restoreSource']=dict(path=str(capture.parent),reportSha256=sha(capture.read_bytes()));inputs[str(capture)]=sha(capture.read_bytes())
            path=output/'report.json';write(path,report);(output/'serial.log').write_text('MSG2_HELDOUT:'+json.dumps(result)+'\n');reports.append(str(path))
            if mode=='cold':capture=path
    return reports

class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result=subprocess.run(['node',str(HERE/'synthetic-resource.mjs')],cwd=ROOT,capture_output=True,text=True,check=True)
        cls.resource=json.loads(result.stdout);cls.heldout=heldout_fixtures(cls.resource)
    def resources(self):return r.Review().compare(self.resource['control'],self.resource['candidate'],self.resource['analysis'])
    def mutate_json(self,path,mutate,call):
        path=Path(path);raw=path.read_bytes();value=json.loads(raw);mutate(value);write(path,value)
        try:
            with self.assertRaises((ValueError,KeyError,TypeError)):call()
        finally:path.write_bytes(raw)
    def test_complete_resource_pair_and_every_partition(self):
        value=self.resources();self.assertEqual(value['status'],'passed');self.assertEqual(value['totalRatio'],1);self.assertEqual(len(value['runs'][0]['partition']['gaps']),52);self.assertFalse(value['timingEligible'])
    def test_resource_delta_and_published_partition_corruption(self):
        self.mutate_json(self.resource['control'],lambda v:v['browserResult']['warmups'][0]['resources']['delta'].__setitem__('instantiatedModuleBytes',999),self.resources)
        self.mutate_json(self.resource['analysis'],lambda v:v['inputs'][0]['partition']['gaps'][0].__setitem__('instantiatedModules',999),self.resources)
        self.mutate_json(self.resource['analysis'],lambda v:v['budget'].__setitem__('upperRatio',1.2),self.resources)
    def test_raw_serial_signal_and_snapshot_corruption(self):
        control=Path(self.resource['control']);serial=control.parent/'serial.log';old=serial.read_bytes();serial.write_bytes(old+b'BUN_APP_FAILURE:synthetic\n')
        try:
            with self.assertRaises(ValueError):self.resources()
        finally:serial.write_bytes(old)
        self.mutate_json(control,lambda v:v['browserResult']['signals'][1].__setitem__('byte',72),self.resources)
        value=read(control);m=value['manifest'];snapshot=ROOT/value['cache']/m['appSha256']/(m['compatibilitySha256']+'.snapshot');old=snapshot.read_bytes();snapshot.write_bytes(old[:-1]+bytes([old[-1]^1]))
        try:
            with self.assertRaises(ValueError):self.resources()
        finally:snapshot.write_bytes(old)
    def test_full_heldout_four_way_is_only_synthetic_oracle_validation(self):
        value=r.Review().heldout(*self.heldout);self.assertEqual(value['checkedDigests'],1536);self.assertFalse(value['timingEligible'])
    def test_heldout_oracle_effective_state_and_restore_link_corruption(self):
        self.mutate_json(self.heldout[0],lambda v:v['result']['results'][0].__setitem__('direct','0'*64),lambda:r.Review().heldout(*self.heldout))
        self.mutate_json(self.heldout[2],lambda v:v['fifo'].__setitem__('state',1),lambda:r.Review().heldout(*self.heldout))
        self.mutate_json(self.heldout[1],lambda v:v['restoreSource'].__setitem__('reportSha256','0'*64),lambda:r.Review().heldout(*self.heldout))
    def test_boolean_identity_substitutions_reject_even_when_values_compare_equal(self):
        self.mutate_json(self.heldout[2],lambda v:v['fifo'].__setitem__('enabled',1),lambda:r.Review().heldout(*self.heldout))
        self.mutate_json(self.heldout[2],lambda v:v['fifo'].__setitem__('effective',1),lambda:r.Review().heldout(*self.heldout))
        self.mutate_json(self.heldout[0],lambda v:v.__setitem__('schema',True),lambda:r.Review().heldout(*self.heldout))
        result=copy.deepcopy(read(self.heldout[0])['result']);result['results'][0]['inputUnchanged']=1
        with self.assertRaisesRegex(ValueError,'values/types'):r.heldout_oracle(result,'cold')

    def test_self_consistent_alternate_runtime_cannot_detach_from_reviewed_build(self):
        for kind in ('js','wasm'):
            run=subprocess.run(['node',str(HERE/'synthetic-resource.mjs'),kind],cwd=ROOT,capture_output=True,text=True,check=True);paths=json.loads(run.stdout)
            with self.assertRaisesRegex(ValueError,'production manifest/reviewed build identity'):
                r.Review().compare(paths['control'],paths['candidate'],paths['analysis'])

    def test_synthetic_data_cannot_enter_acceptance_cli(self):
        out=ROOT/'artifacts'/('synthetic-review-rejection-'+Path(tempfile.mkdtemp(dir=ROOT/'tmp')).name)
        completed=subprocess.run(['python3','-B',str(HERE/'review.py'),'heldout','--off-capture',self.heldout[0],'--off-restore',self.heldout[1],'--on-capture',self.heldout[2],'--on-restore',self.heldout[3],'--output',str(out)],cwd=ROOT,capture_output=True,text=True)
        self.assertEqual(completed.returncode,1);self.assertEqual(read(out/'review.json')['status'],'failed');self.assertIn('synthetic/tmp',read(out/'review.json')['failure'])

if __name__=='__main__':unittest.main()
