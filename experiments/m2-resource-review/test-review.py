#!/usr/bin/env python3
"""Small synthetic evidence tests. No browser, guest, build or performance run."""
import copy
import contextlib
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.dont_write_bytecode=True
SPEC=importlib.util.spec_from_file_location('resource_review',Path(__file__).with_name('review.py'))
r=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(r)
ROOT=r.ROOT
sha=lambda b:hashlib.sha256(b).hexdigest()

def dump(path,value):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,indent=2)+'\n');return sha(path.read_bytes())
def counter(n,size=64):
    return dict(schema=1,attemptedModules=n,compiledModules=n,instantiatedModules=n,attemptedModuleBytes=n*size,instantiatedModuleBytes=n*size,attemptedImportVectorBytes=8*n,instantiatedImportVectorBytes=8*n,maxAttemptedModuleBytes=size if n else 0,maxInstantiatedModuleBytes=size if n else 0,overflow=0)
def add_manifest(spec):
    digest=sha(r.canonical(spec));return dict(spec,generation=digest,compatibilitySha256=digest)
def snapshot(manifest):
    raw=b'Synthetic retained snapshot payload, never a VM snapshot.';compressed=gzip.compress(raw,mtime=0)
    m=dict(schema=1,encoding='gzip',appSha256=manifest['appSha256'],compatibilitySha256=manifest['compatibilitySha256'],createdUtc='2026-11-07T00:00:00Z',bytes=len(raw),sha256=sha(raw),compressedBytes=len(compressed),compressedSha256=sha(compressed))
    header=json.dumps(m).encode();return b'BWSNAP01'+struct.pack('<I',len(header))+header+compressed

def fixture():
    scratch=Path(tempfile.mkdtemp(prefix='resource-independent-',dir=ROOT/'tmp'))
    dump(scratch/'scope.json',dict(scope='Synthetic reviewer testing only; all fixture files retained; no guest execution.'))
    source='''// pcGraphicsBus:Module.pcGraphicsBus}
// startWorker=async()=>{Module.pcGraphicsBus=
function instantiate_wasm(wasm_begin,wasm_size,import_vec_begin,import_vec_size,timing){
const wasm=HEAP8.subarray(wasm_begin,wasm_begin+wasm_size);const helper={};
const mod=new WebAssembly.Module(wasm);
const inst=new WebAssembly.Instance(mod,{env:{memory:wasmMemory},helper});
return inst.exports.start();}'''
    data={name:('synthetic '+name).encode() for name in r.pv.ARTIFACTS};data['runtime/qemu-system-x86_64.js']=source.encode()
    artifacts={name:dict(sha256=sha(b),bytes=len(b)) for name,b in data.items()}
    spec=dict(schema=1,os='linux',architecture='amd64',bunVersion='1.4.4',image='oven/bun@sha256:b14d4eb5d84af31d532380ad42fbc8243936bbe23e2b85c5f740efbd845fe6f2',vm=r.pv.VM,snapshot=dict(enabled=True,protocol='com1-ready-v1',readyByte=49,readyMode='manual'),benchmark=dict(protocol=r.pv.PROTOCOL),artifacts=artifacts,appSha256=artifacts['app.mjs']['sha256'])
    packages={};observed=[]
    def write_package(path,manifest,files):
        for name,b in files.items():
            p=path/manifest['generation']/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
        return dump(path/'app.json',manifest)
    for enabled in (False,True):
        side='candidate' if enabled else 'control';production=scratch/(side+'-production');derived_path=scratch/(side+'-observed')
        p=add_manifest(dict(spec,experiment=dict(name='sha256msg2-v1',enabled=enabled)));digest=write_package(production,p,data)
        packages[side]=dict(path=str(production.relative_to(ROOT)),manifest=p,manifestSha256=digest)
        derived,d=r.derive(source,(ROOT/'benchmarks/harness/m2-resource-v2/observer.js').read_text())
        dd=dict(data);dd['runtime/qemu-system-x86_64.js']=derived.encode();art=copy.deepcopy(artifacts);art['runtime/qemu-system-x86_64.js']=dict(sha256=sha(derived.encode()),bytes=len(derived.encode()))
        m=add_manifest(dict(spec,artifacts=art,experiment=p['experiment'],observation=dict(name=r.PACKAGE_OBSERVATION,diagnostic=True,productionJsSha256=sha(source.encode()),wasmSha256=artifacts['runtime/qemu-system-x86_64.wasm']['sha256'])))
        write_package(derived_path,m,dd)
        d.update(production=str(production),productionManifestSha256=digest,wasmSha256=artifacts['runtime/qemu-system-x86_64.wasm']['sha256'],experiment=p['experiment'],compatibilitySha256=m['compatibilitySha256']);dump(derived_path/'derivation.json',d)
        observed.append((enabled,derived_path,m,d))
    # The real frozen plan supplies the exact preregistration and stopped-VM tool
    # identity. Synthetic payloads and pair paths are substituted consistently.
    plan=json.loads((ROOT/'artifacts/m2-sustained-v2-exploration-plan-01.json').read_text());plan['packages']=packages;plan['inputs']=[]
    for step in plan['steps']:step['package']=packages['candidate' if step['enabled'] else 'control']['path']
    plan_path=scratch/'plan.json';plan_sha=dump(plan_path,plan)
    required=set(r.pv.CRITICAL_INPUTS)
    for name in ('m1','m2','m2-sustained-v2','m2-resource-v2','code'):
        required.update(str(p.relative_to(ROOT)) for p in (ROOT/'benchmarks/harness'/name).rglob('*') if p.is_file() and p.suffix in ('.mjs','.js','.ts','.json'))
    input_hashes={name:sha((ROOT/name).read_bytes()) for name in required}
    records=[]
    for enabled,directory,manifest,derivation in observed:
        out=scratch/('on' if enabled else 'off');out.mkdir();size=68 if enabled else 64
        ident=dict(protocol=r.pv.PROTOCOL,bun='1.4.4',revision='38afee6c84fcf48c0edb2466aa4b27d287a59c30',arch='x64',pid=1,nonce='11111111-1111-1111-1111-'+('2' if enabled else '1')*12,heap=True,file=True,heapLength=4096,heapChecksum=17,ordinal=1,mode='cold')
        prepared=dict(ident,event='snapshot-prepared',ordinal=0,parameters=r.pv.PARAMETERS,orders=r.pv.ORDERS,warmupOrders=r.pv.WARMUP_ORDERS,hostMs=0)
        resumed=dict(ident,event='resumed',parameters=r.pv.PARAMETERS,orders=r.pv.ORDERS,warmupOrders=r.pv.WARMUP_ORDERS,hostMs=1)
        events=[prepared,resumed];warmups=[];results=[];calibration=[];n=10
        maps='00400000-00500000 r-xp 00000000 00:01 1 /usr/local/bin/bun\n'
        for index,gate in enumerate(r.pv.gates()):
            t=10+index*10;e=dict(ident,**gate,seq=index+1,hostMs=t,signalHostMs=t,pairedHostMs=t+1,stopRequestHostMs=t+2,stoppedHostMs=t+3,readCompleteHostMs=t+4,ackHostMs=t+5,contReplyHostMs=t+6)
            if e['event'] in ('initialized','maps'):
                name=e['event']+'.maps';(out/name).write_text(maps);e.update(mapsBytes=len(maps),mapsSha256=sha(maps.encode()),mapsArtifact=dict(path=name,bytes=len(maps),sha256=sha(maps.encode())))
            if e['event'] in ('warmup-complete','complete'):e['values']=r.pv.EXPECTED
            if e['event'] in ('warmup-start','start'):start=e
            if e['event'] in ('warmup-result','result'):
                e.update(value=r.pv.EXPECTED[e['name']],guestMs=1);begin=counter(n+1,size);n+=3;end=counter(n,size)
                row=dict(name=e['name'],sample=e['sample'],iterations=100,startSeq=start['seq'],endSeq=e['seq'],startAckHostMs=start['ackHostMs'],resultHostMs=t,hostMs=t-start['ackHostMs'],guestMs=1,resultToStopMs=3,counters=None,runtimeStats=dict(jitPool=dict(charged=11400,limit=12000,linearMemoryBytes=2147483648)),resources=dict(begin=begin,end=end,delta=r.delta(begin,end)))
                (results if e['event']=='result' else warmups).append(row)
            if e['event']=='gate-start':gate_start=e
            if e['event']=='gate-result':
                e['guestMs']=0;calibration.append(dict(index=e['index'],hostMs=t-gate_start['ackHostMs'],guestMs=0))
            events.append(e)
        b=dict(status='passed',timingEligible=False,observation=r.OBSERVATION,mode='baseline',snapshotMode='capture',captureCode=False,events=events,warmups=warmups,results=results,calibration=calibration,signals=[dict(byte=49,hostMs=0)]+[dict(byte=71,hostMs=e['signalHostMs']) for e in events if 'seq' in e],gateAcks=148,startup=dict(preparedHostMs=0,readyHostMs=1,resumedHostMs=1),ready=dict(readyMs=1,mode='cold',snapshotSaved=True,appSha256=manifest['appSha256'],compatibilitySha256=manifest['compatibilitySha256']),experiment=manifest['experiment'],msg2Status=0x10004 if enabled else 0x10003,resourcesInitialized=counter(10,size),resourcesComplete=counter(n+1,size))
        status=dict(plan['hostCondition']['expected'],errors=[]);check=dict(startedUtc='2026-11-07T00:00:00Z',completedUtc='2026-11-07T00:00:01Z',stdout=json.dumps(status),stderr='',status=status)
        raw=dict(schema=1,status='passed',protocol=r.OUTER,observation=r.OBSERVATION,timingEligible=False,mode='baseline',snapshotMode='capture',captureCode=False,samplePeriod=257,pageErrors=[],serverErrors=[],executionConfiguration=dict(aotEnabled=False,planDisabled=True),browser='synthetic-validator-fixture',host=dict(platform='synthetic',arch='synthetic',release='synthetic',logicalCPUs=1,totalMemoryBytes=1),manifest=manifest,package=str(directory.relative_to(ROOT)),derivation=derivation,experiment=manifest['experiment'],browserResult=b,transport=dict(publications=1),hostCondition=dict(configuration=plan['hostCondition'],before=check,after=dict(check,startedUtc='2026-11-07T00:10:00Z',completedUtc='2026-11-07T00:10:01Z')),timingPlan=dict(path=str(plan_path.relative_to(ROOT)),sha256=plan_sha),inputHashes=dict(input_hashes),servedHashes={})
        for p in [plan_path,directory/'app.json',directory/'derivation.json']:
            raw['inputHashes'][str(p.relative_to(ROOT))]=sha(p.read_bytes())
        for name in r.pv.ARTIFACTS:
            p=directory/manifest['generation']/name;raw['inputHashes'][str(p.relative_to(ROOT))]=raw['servedHashes'][str(p.relative_to(ROOT))]=sha(p.read_bytes())
        for name in ('benchmarks/harness/m2-resource-v2/browser.mjs','benchmarks/harness/m2-resource-v2/vm-adapter.mjs','benchmarks/harness/m2-resource-v2/observer.mjs','benchmarks/harness/m2-sustained-v2/protocol.mjs'):
            raw['servedHashes'][name]=input_hashes[name]
        cache=out/'cache';snap=cache/manifest['appSha256']/(manifest['compatibilitySha256']+'.snapshot');snap.parent.mkdir(parents=True);snap.write_bytes(snapshot(manifest));raw['cache']=str(cache.relative_to(ROOT));raw['snapshot']=dict(sha256=sha(snap.read_bytes()),bytes=snap.stat().st_size)
        raw_events=[]
        for e in events:
            value={k:v for k,v in e.items() if k not in r.HOST_FIELDS}
            if 'mapsArtifact' in e:value['maps']=maps
            raw_events.append(value)
        (out/'serial.log').write_text(''.join(r.pv.PREFIX+json.dumps(e)+'\n' for e in raw_events))
        path=out/'report.json';digest=dump(path,raw);records.append(dict(path=path,raw=raw,snapshot=snap,digest=digest,size=size))
    # Independently closed-form totals:10 initial +52 gaps +104 phase modules
    # +1 tail. Every workload has eight measured phases of two modules each.
    expected=dict(schema=1,status='passed',kind=r.OBSERVATION,timingEligible=False,productPromotionEligible=False,workloadProtocol=r.pv.PROTOCOL,timingPlan=dict(path=str(plan_path.relative_to(ROOT)),sha256=plan_sha),totalRatio=68/64,maximumModuleRatio=68/64,phases={name:dict(controlBytes=16*64,candidateBytes=16*68,ratio=68/64) for name in r.pv.NAMES},budget=dict(metric='Cumulative successfully instantiated module input bytes from VM start through complete stopped gate',upperRatio=1.10,observedWithinBudget=True))
    inputs=[]
    for rec in records:
        b=rec['raw']['browserResult'];assert b['resourcesComplete']==counter(167,rec['size'])
        def phases(rows):return [dict(name=row['name'],sample=row['sample'],schema=1,attemptedModules=2,compiledModules=2,instantiatedModules=2,attemptedModuleBytes=2*rec['size'],instantiatedModuleBytes=2*rec['size'],attemptedImportVectorBytes=16,instantiatedImportVectorBytes=16,overflow=0) for row in rows]
        inputs.append(dict(path=str(rec['path']),sha256=rec['digest'],nonce=b['events'][0]['nonce'],total=counter(167,rec['size']),warmups=phases(b['warmups']),phases=phases(b['results'])))
    expected['inputs']=inputs;analysis=scratch/'analysis.json';dump(analysis,expected)
    return dict(scratch=scratch,records=records,analysis=analysis,plan=plan_path)

class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.f=fixture();print('retained fixture:',cls.f['scratch'])
    def test_exact_partitions_and_counter_corruptions(self):
        b=self.f['records'][0]['raw']['browserResult'];p=r.partition(b)
        self.assertEqual(p['complete']['instantiatedModuleBytes'],167*64);self.assertEqual(len(p['gaps']),52)
        for field,value in [('schema',True),('overflow',1),('compiledModules',9),('maxAttemptedModuleBytes',65),('instantiatedModules',True),('attemptedModuleBytes',2**53)]:
            bad=counter(10);bad[field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):r.counters(bad)
        bad=copy.deepcopy(b);bad['results'][0]['resources']['delta']['instantiatedModuleBytes']+=1
        with self.assertRaises(ValueError):r.partition(bad)
        bad=copy.deepcopy(b);bad['resourcesComplete']=counter(1)
        with self.assertRaises(ValueError):r.partition(bad)
    def test_derivation_requires_exact_anchors(self):
        src='function instantiate_wasm('+'const mod=new WebAssembly.Module(wasm);'+'const inst=new WebAssembly.Instance(mod,{env:{memory:wasmMemory},helper});'+'pcGraphicsBus:Module.pcGraphicsBus}'+'startWorker=async()=>{Module.pcGraphicsBus='
        output,proof=r.derive(src,'observer');self.assertEqual(len(proof['anchors']),5);self.assertIn('pcResourceCompiled()',output)
        for bad in (src+'const mod=new WebAssembly.Module(wasm);',src.replace('instantiate_wasm','wrong'),src+'DEFUSS_M2_RESOURCE_OBSERVER_BEGIN'):
            with self.assertRaises(ValueError):r.derive(bad,'observer')
    def test_full_pair_and_evidence_corruptions(self):
        off,on=self.f['records'];review=lambda:r.Review().compare(str(off['path']),str(on['path']),str(self.f['analysis']))
        result=review();self.assertEqual(result['status'],'passed');self.assertEqual(result['totalRatio'],1.0625)
        original=off['path'].read_bytes()
        mutations=[lambda x:x['browserResult']['signals'][1].update(byte=49),lambda x:x['browserResult']['results'][0]['resources']['delta'].update(instantiatedModuleBytes=1),lambda x:x['inputHashes'].pop('benchmarks/harness/m2-resource-v2/observer.js'),lambda x:x['hostCondition']['after']['status'].update(status='Running'),lambda x:x['browserResult'].update(timingEligible=True),lambda x:x['manifest']['vm'].update(hotLimit=10)]
        for mutate in mutations:
            raw=copy.deepcopy(off['raw']);mutate(raw);dump(off['path'],raw)
            with self.assertRaises(ValueError):review()
            off['path'].write_bytes(original)
        serial=off['path'].parent/'serial.log';saved=serial.read_bytes();serial.write_bytes(saved+b'Kernel panic\n')
        with self.assertRaises(ValueError):review()
        serial.write_bytes(saved)
        snapshot_path=off['snapshot'];saved=snapshot_path.read_bytes();snapshot_path.write_bytes(saved[:-1]+b'!')
        with self.assertRaises(ValueError):review()
        snapshot_path.write_bytes(saved)
        proposed=json.loads(self.f['analysis'].read_text());saved=self.f['analysis'].read_bytes();proposed['budget']['observedWithinBudget']=False;dump(self.f['analysis'],proposed)
        with self.assertRaises(ValueError):review()
        self.f['analysis'].write_bytes(saved)
    def test_snapshot_inner_identity_and_bounds(self):
        rec=self.f['records'][0];path=self.f['scratch']/'snapshot-corruption';raw=snapshot(rec['raw']['manifest']);path.write_bytes(raw)
        self.assertGreater(r.snapshot_envelope(path,rec['raw']['manifest'])['bytes'],0)
        n=struct.unpack('<I',raw[8:12])[0];meta=json.loads(raw[12:12+n]);meta['sha256']='0'*64;m=json.dumps(meta).encode();path.write_bytes(raw[:8]+struct.pack('<I',len(m))+m+raw[12+n:])
        with self.assertRaises(ValueError):r.snapshot_envelope(path,rec['raw']['manifest'])
        path.write_bytes(b'BWSNAP01'+struct.pack('<I',16385))
        with self.assertRaises(ValueError):r.snapshot_envelope(path,rec['raw']['manifest'])
    def test_final_rehash_failure_is_failed(self):
        base=Path(tempfile.mkdtemp(prefix='resource-main-status-',dir=ROOT/'tmp'));output=base/'artifacts'/'result'
        class Changed:
            def __init__(self,*args):self.inventory={'changed':dict(sha256='0'*64)}
            def compare(self,*args):return dict(status='passed')
            def hash(self,*args):raise ValueError('Input changed during final rehash')
        with patch.object(r,'ROOT',base),patch.object(r,'Review',Changed),patch.object(sys,'argv',['review.py','--control','a','--candidate','b','--analysis','c','--output',str(output)]),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(r.main(),1)
        self.assertEqual(json.loads((output/'review.json').read_text())['status'],'failed')

if __name__=='__main__':unittest.main()
