#!/usr/bin/env python3
"""Independent retained-resource evidence audit; never a performance/promotion decision."""
import argparse
import copy
import datetime as dt
import gzip
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import struct
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
DEPENDENCY = ROOT/'experiments/m2-sha-msg2/review-sustained-v2.py'
DEPENDENCY_SHA256 = 'b9bd8abf7d9048172e58e7c6f0bf1a1835ed0c5cc2490a5ff015014a63086be8'
if hashlib.sha256(DEPENDENCY.read_bytes()).hexdigest() != DEPENDENCY_SHA256:
    raise ValueError('Frozen independent sustained protocol reviewer changed')
spec = importlib.util.spec_from_file_location('frozen_independent_sustained', DEPENDENCY)
pv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)
require, canonical = pv.require, pv.canonical

def same(actual,expected,label):
    def exact(a,b):
        if type(a) is not type(b):return False
        if isinstance(b,dict):return set(a)==set(b) and all(exact(a[key],value) for key,value in b.items())
        if isinstance(b,list):return len(a)==len(b) and all(exact(x,y) for x,y in zip(a,b))
        return a==b
    require(exact(actual,expected),label+': values/types differ')

def close_tree(actual,expected,label):
    if type(expected) is float:
        require(type(actual) in (int,float) and math.isfinite(actual) and math.isclose(actual,expected,rel_tol=2e-12,abs_tol=1e-12),label+': numeric recomputation differs')
    elif isinstance(expected,dict):
        require(type(actual) is dict,label+': not an object')
        for key,value in expected.items():
            require(key in actual,label+': missing '+key);close_tree(actual[key],value,label+'.'+key)
    elif isinstance(expected,list):
        require(type(actual) is list and len(actual)==len(expected),label+': list differs')
        for i,(a,b) in enumerate(zip(actual,expected)):close_tree(a,b,label+'['+str(i)+']')
    else:same(actual,expected,label)

sha = lambda data: hashlib.sha256(data).hexdigest()
FIELDS = ['attemptedModules','attemptedModuleBytes','attemptedImportVectorBytes','maxAttemptedModuleBytes',
          'compiledModules','instantiatedModules','instantiatedModuleBytes','instantiatedImportVectorBytes','maxInstantiatedModuleBytes','overflow']
MAXIMA = {'maxAttemptedModuleBytes','maxInstantiatedModuleBytes'}
ADDITIVE = [name for name in FIELDS if name not in MAXIMA]
OUTER = 'defuss-passive-fifo-resource-v1'
OBSERVATION = 'diagnostic-module-input-bytes-passive-fifo-v1'
PACKAGE_OBSERVATION = 'module-input-bytes-passive-fifo-v1'
SOURCE = 'artifacts/passive-fifo-validation-source-01/manifest.json'
SOURCE_SHA256 = '49bfceac7b571ef856752e9bc177583f657407eafaf7fa0d232ee4aaab9145b7'
HOST_FIELDS = {'hostMs','pairedHostMs','signalHostMs','stopRequestHostMs','stoppedHostMs','readCompleteHostMs','stoppedReadMs','ackHostMs','contReplyHostMs','mapsArtifact'}


def counters(row):
    same(set(row), {'schema', *FIELDS}, 'exact counter fields')
    require(type(row['schema']) is int and row['schema'] == 1, 'counter ABI')
    for name in FIELDS:
        require(pv.integer(row[name]), 'Counter is not an exact nonnegative JSON integer: '+name)
    same(row['overflow'], 0, 'counter overflow')
    same(row['attemptedModules'], row['compiledModules'], 'unfinished/failed compilation')
    same(row['compiledModules'], row['instantiatedModules'], 'unfinished/failed instantiation')
    for left, right in [('attemptedModuleBytes','instantiatedModuleBytes'),('attemptedImportVectorBytes','instantiatedImportVectorBytes'),('maxAttemptedModuleBytes','maxInstantiatedModuleBytes')]:
        same(row[left], row[right], 'completed counter identity')
    n, size, maximum = (row[name] for name in ('instantiatedModules','instantiatedModuleBytes','maxInstantiatedModuleBytes'))
    if n == 0:
        same((size, maximum, row['instantiatedImportVectorBytes']), (0, 0, 0), 'zero-module byte totals')
    else:
        require(8 <= maximum <= size and n*8 <= size <= n*maximum, 'Impossible generated module byte bounds')
    require(row['instantiatedImportVectorBytes'] % 8 == 0, 'Import vector is not uint64 slots')
    return row


def delta(before, after):
    counters(before); counters(after)
    for name in FIELDS:
        require(after[name] >= before[name], 'Cumulative counter decreased: '+name)
    return dict(schema=1, **{name: after[name]-before[name] for name in ADDITIVE})


def partition(browser):
    initial = counters(browser['resourcesInitialized'])
    previous, gaps, warmups, measured = initial, [], [], []
    for rows, target in ((browser['warmups'], warmups), (browser['results'], measured)):
        for row in rows:
            begin, end = row['resources']['begin'], row['resources']['end']
            gaps.append(delta(previous, begin))
            observed = delta(begin, end)
            same(row['resources']['delta'], observed, 'phase resource delta')
            target.append(dict(name=row['name'], sample=row['sample'], **observed))
            previous = end
    complete = counters(browser['resourcesComplete'])
    tail = delta(previous, complete)
    for name in ADDITIVE:
        reconstructed = initial[name] + sum(part[name] for part in [*gaps,*warmups,*measured,tail])
        same(complete[name], reconstructed, 'complete partition '+name)
    require(complete['instantiatedModules'] > 0, 'No generated module observation')
    return dict(initial=initial, gaps=gaps, warmups=warmups, measured=measured, tail=tail, complete=complete)


def derive(source, observer):
    require('DEFUSS_M2_RESOURCE_OBSERVER_BEGIN' not in source, 'Production runtime already instrumented')
    patches = [
        ('worker-send','pcGraphicsBus:Module.pcGraphicsBus}','pcGraphicsBus:Module.pcGraphicsBus,pcResourceBus:Module.pcResourceBus}'),
        ('worker-load','startWorker=async()=>{Module.pcGraphicsBus=','startWorker=async()=>{Module.pcResourceBus=msgData.pcResourceBus;Module.pcGraphicsBus='),
        ('observer','function instantiate_wasm(',observer+'\nfunction instantiate_wasm('),
        ('attempt','const mod=new WebAssembly.Module(wasm);','pcResourceAttempt(wasm.byteLength,import_vec_size);const mod=new WebAssembly.Module(wasm);pcResourceCompiled();'),
        ('instance','const inst=new WebAssembly.Instance(mod,{env:{memory:wasmMemory},helper});','const inst=new WebAssembly.Instance(mod,{env:{memory:wasmMemory},helper});pcResourceInstantiated(wasm.byteLength,import_vec_size);')]
    result, anchors = source, []
    for name, before, after in patches:
        same(result.count(before), 1, 'Exact derivation anchor '+name)
        result = result.replace(before, after, 1)
        anchors.append(dict(name=name, before=before, beforeSha256=sha(before.encode()), afterSha256=sha(after.encode()), occurrences=1))
    return result, dict(sourceSha256=sha(source.encode()), derivedSha256=sha(result.encode()), observerSha256=sha(observer.encode()), anchors=anchors)


def snapshot_envelope(path, manifest):
    """Stream the retained compressed/raw payload; keep at most a1MiB chunk."""
    with path.open('rb') as stream:
        header = stream.read(12)
        require(len(header) == 12 and header[:8] == b'BWSNAP01', 'Snapshot envelope magic')
        length = struct.unpack('<I', header[8:])[0]
        require(0 < length <= 16384, 'Snapshot metadata bound')
        metadata = json.loads(stream.read(length))
        close_tree(metadata, dict(schema=1, encoding='gzip', appSha256=manifest['appSha256'], compatibilitySha256=manifest['compatibilitySha256']), 'snapshot metadata identity')
        require(pv.integer(metadata['bytes'], 1, 1024**3), 'Snapshot raw bound')
        require(pv.integer(metadata['compressedBytes'], 1, 1024**3), 'Snapshot compressed bound')
        compressed_sha, compressed_bytes = hashlib.sha256(), 0
        for chunk in iter(lambda: stream.read(1024**2), b''):
            compressed_sha.update(chunk); compressed_bytes += len(chunk)
        same((compressed_bytes,compressed_sha.hexdigest()), (metadata['compressedBytes'],metadata['compressedSha256']), 'Snapshot compressed identity')
        stream.seek(12+length)
        raw_sha, raw_bytes = hashlib.sha256(), 0
        with gzip.GzipFile(fileobj=stream) as uncompressed:
            for chunk in iter(lambda: uncompressed.read(1024**2), b''):
                raw_bytes += len(chunk); require(raw_bytes <= metadata['bytes'], 'Snapshot expands beyond declared bytes'); raw_sha.update(chunk)
        same((raw_bytes,raw_sha.hexdigest()), (metadata['bytes'],metadata['sha256']), 'Snapshot raw identity')
        return metadata


PERFORMANCE_FINGERPRINT='fbc926db3afb566515204f470da6d2dfce3b77ef9706fef2d532a71a218ad3ea'
PROOF_PINS={
 'frozenImplementation':('artifacts/passive-fifo-overlay-source-01/manifest.json','0b0007d3c3ccc9732a0a66c308b3f6db31ff27f15d4efc189579051f503fed27'),
 'sourceReview':('artifacts/passive-fifo-overlay-source-review-01/review.json','2083b74b69137a0bbc235449a26a8c640110c8337fa71e3d75227649cd26c6e8'),
 'reviewer':('artifacts/passive-fifo-build-review-tools-01/recheck.py','a0131cadba9a82c47e1b5a7b1fdb72d151e740eee709b70326cffa89904b3b98')}
HELDOUT_APP='4029b0dbcb61f138772fde4488c56960078b8b97a5119cfa68076f667a29c17d'
FINITE_APP='f9ed5327b4549350c4ddd554c6ada074487a45924435ded873abe46e0aa7d668'
RUNTIME_NAMES={'runtime/audio/backend.mjs','runtime/audio/pcm.mjs','runtime/audio/ringbuf.mjs','runtime/graphics.mjs','runtime/native-counters.mjs','runtime/x86_64/qemu-system-x86_64.js','runtime/x86_64/qemu-system-x86_64.wasm'}

def fifo_state(enabled):return dict(abi=1,enabled=enabled,diagnostic=False,status=7 if enabled else 6,state=3 if enabled else 0,rejections=0,effective=enabled)

def published_partition(browser):
    parts=partition(browser)
    gaps=[dict(beforeSeq=row['startSeq'],**value) for row,value in zip(browser['warmups']+browser['results'],parts['gaps'])]
    deltas=[{key:row[key] for key in ['schema',*ADDITIVE]} for row in parts['warmups']+parts['measured']]
    return dict(initial=parts['initial'],gaps=gaps,phaseDeltas=deltas,tail=parts['tail'],reconstructed={key:parts['complete'][key] for key in ADDITIVE},maxima={key:parts['complete'][key] for key in MAXIMA})

ORACLE_CACHE={}
def heldout_oracle(result,mode):
    same(set(result),{'schema','mode','bun','results'},'heldout result fields');same(result['schema'],1,'heldout schema');same(result['mode'],mode,'heldout mode');same(result['bun'],'1.4.4','heldout Bun')
    lengths=[0,1,7,31,55,56,63,64,65,119,120,127,128,129,255,256,1023,1024,4095,4096,65535,65536,65537,1048576]
    same(len(result['results']),192,'heldout cases')
    for n,row in enumerate(result['results']):
        round,index=divmod(n,24);length=lengths[index];seed=(0x9e3779b9^((round+1)*65537)^((index+1)*1664525))&0xffffffff
        key=(round,index)
        if key not in ORACLE_CACHE:
            state=seed;data=bytearray(length)
            for j in range(length):
                state=(state^((state<<13)&0xffffffff))&0xffffffff;state^=state>>17;state=(state^((state<<5)&0xffffffff))&0xffffffff;data[j]=state&255
            ORACLE_CACHE[key]=hashlib.sha256(data).hexdigest()
        expected=dict(round=round,index=index,length=length,seed=seed,offset=(index+round)%17,direct=ORACLE_CACHE[key],streamed=ORACLE_CACHE[key],inputUnchanged=True)
        same(row,expected,'independent heldout oracle row '+str(n))
    return 384

class Review(pv.Reviewer):
    def frozen_sources(self):
        path=self.path(SOURCE);self.hash(path,dict(sha256=SOURCE_SHA256));record=self.read(path)
        for row in record['files']:
            for name in ('path','archive'):self.hash(self.path(row[name]),{k:row[k] for k in ('sha256','bytes')})
        for name,digest in record['dependencies'].items():self.hash(self.path(name),dict(sha256=digest))
        self.hash(self.path('artifacts/passive-fifo-validation-source-review-01/review.json'),dict(sha256='e7c06526c05ca6279b6adaafaf27833f20394ffa3ca6e77d5b9a8c6b92f1684d'))
        self.hash(DEPENDENCY,dict(sha256=DEPENDENCY_SHA256));self.hash(Path(__file__))
        return record

    def runtime_proof(self,directory):
        proof=self.read(directory/'runtime-provenance.json');same(proof['status'],'verified','runtime proof status')
        same(proof['schema'],1,'runtime proof schema');same(proof['contract'],dict(sourceFingerprint=PERFORMANCE_FINGERPRINT,frozen=PROOF_PINS['frozenImplementation'][0],frozenSha256=PROOF_PINS['frozenImplementation'][1],review=PROOF_PINS['sourceReview'][0],reviewSha256=PROOF_PINS['sourceReview'][1],reviewer=PROOF_PINS['reviewer'][0],reviewerSha256=PROOF_PINS['reviewer'][1]),'runtime proof pinned contract')
        for name,digest in proof['inputs'].items():self.hash(self.path(name),dict(sha256=digest))
        bp=self.path(proof['buildReport']);op=self.path(proof['sourceManifest']);ap=self.path(proof['sourceRecheck'])
        build=self.read(bp);overlay=self.read(op);audit=self.read(ap)
        close_tree(build,dict(status='passed',sourceFingerprint=PERFORMANCE_FINGERPRINT,targets=['x86_64-softmmu']),'performance build');require(all(x['returncode']==0 for x in build['runs']),'failed build step')
        close_tree(overlay,dict(kind='passive-fifo-v1',variant='performance',diagnostic=False,defaultEnabled=False,newYield=False,forceGC=False,constants=dict(soft=9000,batch=256,newInstalls=256,minimumLive=512,cap=12000)),'performance overlay')
        close_tree(audit,dict(status='passed',kind='passive-fifo-postbuild-audit',variant='performance',sourceFingerprint=PERFORMANCE_FINGERPRINT),'postbuild source audit')
        same(audit['buildReport'],self.hash(bp),'audit/build identity');same(audit['overlay'],self.hash(op),'audit/overlay identity')
        same(build['source'],'/project/'+audit['source'],'build source path');same(self.path(audit['source']),self.path(overlay['output']),'prepared source path')
        for key,(name,digest) in PROOF_PINS.items():same(audit[key],self.hash(self.path(name),dict(sha256=digest)),'pinned source audit dependency')
        self.hash(self.path(audit['inventory']['path']),{k:audit['inventory'][k] for k in ('sha256','bytes')})
        same(set(build['artifacts']),RUNTIME_NAMES,'exact seven runtime files');same(audit['runtimeArtifacts'],build['artifacts'],'audited runtime artifacts');same(set(proof['artifacts']),RUNTIME_NAMES,'proof runtime files')
        for name,identity in build['artifacts'].items():
            path=bp.parent/name;self.hash(path,identity);same(proof['artifacts'][name],dict(path=str(path.relative_to(self.root)),**identity),'actual runtime proof artifact')
        return proof

    def production_runtime(self,manifest,proof):
        for name in ('qemu-system-x86_64.js','qemu-system-x86_64.wasm'):
            expected=proof['artifacts']['runtime/x86_64/'+name]
            same(manifest['artifacts']['runtime/'+name],{k:expected[k] for k in ('sha256','bytes')},'production manifest/reviewed build identity')

    def production_manifest(self,directory,measurement):
        manifest=self.read(directory/'app.json')
        close_tree(manifest,dict(schema=1,os='linux',architecture='amd64',bunVersion='1.4.4',vm=pv.VM,image='oven/bun@sha256:b14d4eb5d84af31d532380ad42fbc8243936bbe23e2b85c5f740efbd845fe6f2',snapshot=dict(enabled=True,protocol='com1-ready-v1',readyByte=49,readyMode='manual')),'production manifest')
        same(manifest['benchmark'],dict(protocol=pv.PROTOCOL if measurement=='defuss-passive-fifo-finite-v1' else 'unchanged-msg2-heldout-payload',measurementProtocol=measurement),'production workload identity');require('observation' not in manifest,'diagnostic production package')
        same(manifest['appSha256'],FINITE_APP if measurement=='defuss-passive-fifo-finite-v1' else HELDOUT_APP,'fixed unchanged guest payload')
        same(set(manifest['artifacts']),pv.ARTIFACTS,'production artifacts');same(manifest['appSha256'],manifest['artifacts']['app.mjs']['sha256'],'app identity')
        digest=sha(canonical({k:v for k,v in manifest.items() if k not in ('generation','compatibilitySha256')}));same(manifest['generation'],digest,'generation');same(manifest['compatibilitySha256'],digest,'compatibility')
        for name,identity in manifest['artifacts'].items():self.hash(directory/digest/name,identity)
        proof=self.runtime_proof(directory);self.production_runtime(manifest,proof);return manifest

    def validate_plan(self,plan):
        close_tree(plan,dict(schema=1,protocol=OUTER,kind='diagnostic-resource-pair',experiment='passive-fifo-v1',timingEligible=False,parameters=pv.PARAMETERS,orders=pv.ORDERS,warmupOrders=pv.WARMUP_ORDERS,upperRatio=1.10,timeoutMs=600000),'prospective resource plan')
        same(set(plan['inputs']),set(plan['inputIdentities']),'resource plan inputs');require(bool(plan['inputs']),'empty resource inputs')
        for name,digest in plan['inputIdentities'].items():self.hash(self.path(name),dict(sha256=digest))
        condition=plan['hostCondition'];close_tree(condition,dict(schema=1,arguments=['list','builder','--json'],environment=dict(LIMA_HOME='/Users/admin/.defuss-vm-lima'),expected=dict(name='builder',status='Stopped',memory=12884901888)),'compiler VM configuration');self.hash(Path(condition['executable']),{k:condition[k] for k in ('sha256','bytes')})
        manifests=[]
        for side,enabled in [('control',False),('candidate',True)]:
            package=plan['packages'][side];directory=self.path(package['path']);manifest=self.production_manifest(directory,'defuss-passive-fifo-finite-v1');same(manifest,package['manifest'],'planned production manifest');self.hash(directory/'app.json',dict(sha256=package['manifestSha256']));same(manifest['experiment'],dict(name='passive-fifo-v1',enabled=enabled),'planned policy choice');manifests.append(manifest)
        stripped=lambda m:{k:v for k,v in m.items() if k not in ('generation','compatibilitySha256','experiment')};same(stripped(manifests[0]),stripped(manifests[1]),'only policy selection differs');require(manifests[0]['generation']!=manifests[1]['generation'],'cross-mode snapshot identity')

    def heldout_run(self,argument,enabled,mode,capture=None):
        path=self.path(argument);raw=self.read(path);close_tree(raw,dict(schema=1,status='passed',protocol='defuss-passive-fifo-heldout-v1',timingEligible=False,snapshotMode=mode,checkedDigests=384,resultRecords=1,fifo=fifo_state(enabled)),'heldout report')
        require('failure' not in raw and 'cleanupFailure' not in raw,'heldout failure retained')
        directory=self.path(raw['package']);manifest=self.production_manifest(directory,'defuss-passive-fifo-heldout-v1');same(raw['manifest'],manifest,'heldout manifest');same(manifest['experiment'],dict(name='passive-fifo-v1',enabled=enabled),'heldout selected mode')
        proof=self.runtime_proof(directory);same(raw['runtimeProvenance'],proof,'heldout actual runtime proof')
        required=['tests/passive-fifo-heldout/'+x+'.mjs' for x in ('run','oracle','runtime-proof')]+['benchmarks/harness/passive-fifo-finite-v1/'+x+'.mjs' for x in ('vm-adapter','snapshot','attempt')]+['experiments/passive-fifo/reader.mjs','tests/accelerators/msg2-heldout.mjs','benchmarks/harness/code/physical.mjs']+['host/browser/'+x+'.mjs' for x in ('qmp','machine','hotspots','helper-names')]+['packaging/bun-app/'+x+'.mjs' for x in ('serial','snapshots','file-store')]
        recorded={str(self.path(name)):digest for name,digest in raw['inputs'].items()}
        required.extend(str(directory/name) for name in ('app.json','runtime-provenance.json'));required.extend(str(directory/manifest['generation']/name) for name in pv.ARTIFACTS)
        require({str(self.path(name)) for name in required}<=set(recorded),'missing heldout host/package input')
        for name,digest in recorded.items():self.hash(self.path(name),dict(sha256=digest))
        same(raw['fixtureSha256'],HELDOUT_APP,'heldout source digest');same(raw['runnerSha256'],self.hash(self.path('tests/passive-fifo-heldout/run.mjs'))['sha256'],'runner source digest')
        serial_path=path.parent/'serial.log';self.hash(serial_path);serial=serial_path.read_text();require('Kernel panic' not in serial and 'BUN_APP_FAILURE:' not in serial,'heldout raw guest failure')
        results=[json.loads(line[len('MSG2_HELDOUT:'):]) for line in serial.splitlines() if line.startswith('MSG2_HELDOUT:')];same(results,[raw['result']],'exact one raw heldout result');heldout_oracle(raw['result'],mode)
        events=[event for event in raw['events'] if event['event']!='stderr'];expected=['cache-miss','vm-started','snapshot-start','snapshot-captured','snapshot-saved','ready'] if mode=='cold' else ['cache-hit','vm-started','ready'];same([e['event'] for e in events],expected,'heldout lifecycle')
        clocks=[pv.elapsed(event['atMs'],'heldout lifecycle') for event in events];same(clocks,sorted(clocks),'heldout lifecycle clocks')
        close_tree(raw['ready'],dict(mode=mode,snapshotSaved=mode=='cold',appSha256=manifest['appSha256'],compatibilitySha256=manifest['compatibilitySha256']),'heldout ready identity')
        if mode=='cold':
            require(capture is None and 'restoreSource' not in raw,'capture source');snapshot_dir=path.parent
        else:
            require(capture is not None,'restore requires audited capture');same(raw['restoreSource'],dict(path=str(capture['directory']),reportSha256=capture['reportSha256']),'restore capture linkage');same(manifest,capture['manifest'],'restore package identity');same(raw['snapshotIdentity'],capture['snapshotIdentity'],'unchanged restore snapshot');snapshot_dir=capture['directory']
        snapshot=snapshot_dir/'snapshots'/manifest['appSha256']/(manifest['compatibilitySha256']+'.snapshot');self.hash(snapshot,raw['snapshotIdentity']);metadata=snapshot_envelope(snapshot,manifest);same(metadata,raw['snapshotMetadata'],'heldout snapshot inner metadata');close_tree(events[-1],raw['ready'],'ready lifecycle record');pv.elapsed(raw['ready']['readyMs'],'ready elapsed')
        if mode=='cold':same(events[-2]['metadata'],metadata,'saved snapshot metadata');same(events[-3]['bytes'],metadata['bytes'],'native captured bytes');same(raw['ready']['snapshotBytes'],metadata['compressedBytes'],'ready snapshot bytes')
        else:same(events[0]['metadata'],metadata,'restored cache metadata')
        return dict(path=str(path),directory=path.parent,reportSha256=self.hash(path)['sha256'],enabled=enabled,mode=mode,manifest=manifest,snapshotIdentity=raw['snapshotIdentity'],snapshotMetadata=metadata,node=raw['node'],checkedDigests=384,fifo=raw['fifo'])

    def heldout(self,off_capture,off_restore,on_capture,on_restore):
        self.frozen_sources();paths=[self.path(x) for x in (off_capture,off_restore,on_capture,on_restore)];same(len(set(paths)),4,'four distinct run reports')
        a=self.heldout_run(off_capture,False,'cold');ar=self.heldout_run(off_restore,False,'restored',a);b=self.heldout_run(on_capture,True,'cold');br=self.heldout_run(on_restore,True,'restored',b)
        stripped=lambda m:{k:v for k,v in m.items() if k not in ('generation','compatibilitySha256','experiment')};same(stripped(a['manifest']),stripped(b['manifest']),'matched heldout packages');require(a['manifest']['generation']!=b['manifest']['generation'],'mode-specific snapshots')
        same(len({r['node'] for r in (a,ar,b,br)}),1,'same Node version')
        for row in (a,ar,b,br):row['directory']=str(row['directory'])
        return dict(status='passed',kind='passive-fifo-heldout-four-way-review',checkedDigests=1536,runs=[a,ar,b,br],timingEligible=False,productPromotionEligible=False,scope='Fresh passive-policy heldout capture and read-only restore,384 oracle digests per run. Eligible policy state is checked; soft-retirement occurrence and exact Asyncify lifetime remain separate diagnostic gates.')

    def resource_manifest(self, directory):
        manifest = self.read(directory/'app.json')
        close_tree(manifest, dict(schema=1,os='linux',architecture='amd64',bunVersion='1.4.4',vm=pv.VM,
            image='oven/bun@sha256:b14d4eb5d84af31d532380ad42fbc8243936bbe23e2b85c5f740efbd845fe6f2',
            benchmark=dict(protocol=pv.PROTOCOL,measurementProtocol='defuss-passive-fifo-finite-v1'),snapshot=dict(enabled=True,protocol='com1-ready-v1',readyByte=49,readyMode='manual'),
            observation=dict(name=PACKAGE_OBSERVATION,diagnostic=True)), 'resource manifest')
        same(set(manifest['artifacts']), pv.ARTIFACTS, 'resource artifacts')
        same(manifest['appSha256'], manifest['artifacts']['app.mjs']['sha256'], 'resource app identity')
        spec = {k:v for k,v in manifest.items() if k not in ('generation','compatibilitySha256')}
        digest = sha(canonical(spec))
        same(manifest['generation'], digest, 'resource generation'); same(manifest['compatibilitySha256'], digest, 'resource compatibility')
        for name, identity in manifest['artifacts'].items():
            self.hash(directory/digest/name, identity)
        return manifest

    def report(self, argument, enabled, plan_path, plan):
        path = self.path(argument); raw = self.read(path); browser = raw['browserResult']
        close_tree(raw, dict(schema=1,protocol=OUTER,timingEligible=False,observation=OBSERVATION,status='passed',
            mode='baseline',snapshotMode='capture',captureCode=False,pageErrors=[],serverErrors=[],
            executionConfiguration=dict(aotEnabled=False,planDisabled=True)), 'resource report')
        require(not raw.get('deadlineExceeded') and 'failure' not in raw, 'Resource deadline/failure')
        close_tree(browser, dict(timingEligible=False,observation=OBSERVATION,experiment=dict(name='passive-fifo-v1',enabled=enabled),fifo=fifo_state(enabled)), 'resource browser')
        same(raw['experiment'], browser['experiment'], 'mode choice')
        same(raw['resourcePlan'], dict(path=str(plan_path.relative_to(self.root)),sha256=self.hash(plan_path)['sha256']), 'prospective resource plan binding')
        same(raw['inputHashes'][raw['resourcePlan']['path']], raw['resourcePlan']['sha256'], 'plan input hash')
        condition = raw['hostCondition']; same(condition['configuration'], plan['hostCondition'], 'host condition configuration')
        times = []
        for phase in ('before','after'):
            observed = condition[phase]; same(json.loads(observed['stdout']), observed['status'], 'raw host status')
            close_tree(observed['status'], plan['hostCondition']['expected'], 'stopped compiler VM')
            same(observed['status'].get('errors',[]), [], 'host status errors')
            a,b = pv.timestamp(observed['startedUtc']),pv.timestamp(observed['completedUtc']); require(a<=b,'host status chronology');times.append((a,b))
        require(times[0][1]<=times[1][0], 'before/after host chronology')
        directory = self.path(raw['package']); manifest = self.resource_manifest(directory); same(raw['manifest'],manifest,'reported manifest')
        same(manifest['experiment'],browser['experiment'],'manifest mode')
        derivation = self.read(directory/'derivation.json'); same(raw['derivation'],derivation,'reported derivation')
        production = plan['packages']['candidate' if enabled else 'control']; p = production['manifest']
        same(self.path(derivation['production']),self.path(production['path']),'production package path')
        same(derivation['productionManifestSha256'],production['manifestSha256'],'production manifest hash')
        def unchanged(m):
            value=copy.deepcopy(m)
            for name in ('generation','compatibilitySha256','observation'):value.pop(name,None)
            del value['artifacts']['runtime/qemu-system-x86_64.js']
            return value
        same(unchanged(manifest),unchanged(p),'complete production/derived specifications')
        source_path=self.path(production['path'])/p['generation']/'runtime/qemu-system-x86_64.js'
        self.hash(source_path,p['artifacts']['runtime/qemu-system-x86_64.js'])
        observer_path=self.path('benchmarks/harness/passive-fifo-resource-v1/observer.js');self.hash(observer_path)
        derived, reconstructed=derive(source_path.read_text(),observer_path.read_text())
        for key,value in reconstructed.items():same(derivation[key],value,'independent derivation '+key)
        same((directory/manifest['generation']/'runtime/qemu-system-x86_64.js').read_bytes(),derived.encode(),'exact derived JS')
        same(manifest['observation']['productionJsSha256'],reconstructed['sourceSha256'],'observer production identity')
        same(derivation['wasmSha256'],p['artifacts']['runtime/qemu-system-x86_64.wasm']['sha256'],'byte-identical production WASM')
        same(manifest['observation']['wasmSha256'],derivation['wasmSha256'],'observer WASM identity')
        required={str((directory/'app.json').relative_to(self.root)),str((directory/'derivation.json').relative_to(self.root)),*pv.CRITICAL_INPUTS}
        for name in ('m1','m2','m2-sustained-v2','passive-fifo-resource-v1','code'):
            required.update(str(p.relative_to(self.root)) for p in (self.root/'benchmarks/harness'/name).rglob('*') if p.is_file() and p.suffix in ('.mjs','.js','.ts','.json'))
        payloads={str((directory/manifest['generation']/name).relative_to(self.root)) for name in pv.ARTIFACTS}
        require(required|payloads <= set(raw['inputHashes']), 'Missing mandatory source/package input hash')
        served={'benchmarks/harness/passive-fifo-resource-v1/browser.mjs','benchmarks/harness/passive-fifo-resource-v1/vm-adapter.mjs','benchmarks/harness/passive-fifo-resource-v1/observer.mjs','benchmarks/harness/m2-sustained-v2/protocol.mjs'}|payloads
        require(served <= set(raw['servedHashes']), 'Missing mandatory served identity')
        for category in ('inputHashes','servedHashes'):
            for name,digest in raw[category].items():self.hash(self.path(name),dict(sha256=digest))
        required_host={str(p.relative_to(self.root)) for p in (self.root/'tests/passive-fifo-heldout').glob('*.mjs')}
        require(required_host <= set(raw['inputHashes']),'Missing policy host input')
        require('experiments/passive-fifo/reader.mjs' in raw['servedHashes'],'Missing served policy reader')
        proof=self.runtime_proof(directory);same(raw['runtimeProvenance'],proof,'reported runtime proof');self.production_runtime(p,proof)
        for name,digest in plan['inputIdentities'].items():same(raw['inputHashes'][name],digest,'Resource plan execution input')
        nonce=pv.protocol(raw)
        serial_path=path.parent/'serial.log';self.hash(serial_path);serial=serial_path.read_text()
        require('Kernel panic' not in serial and 'BUN_APP_FAILURE:' not in serial,'Guest failure in raw serial')
        records=[json.loads(line[len(pv.PREFIX):]) for line in serial.splitlines() if line.startswith(pv.PREFIX)]
        normalized=[]
        for event in browser['events']:
            value={k:v for k,v in event.items() if k not in HOST_FIELDS}
            if event['event'] in ('initialized','maps'):
                info=event['mapsArtifact'];same(Path(info['path']).name,info['path'],'sibling maps path');require(0<info['bytes']<=2097152,'maps bound')
                self.hash(path.parent/info['path'],{k:info[k] for k in ('sha256','bytes')})
                same((event['mapsSha256'],event['mapsBytes']),(info['sha256'],info['bytes']),'guest maps identity')
                value['maps']=(path.parent/info['path']).read_text()
                last = 0
                require(bool(value['maps'].splitlines()), 'Empty process maps')
                for line in value['maps'].splitlines():
                    match = re.fullmatch(r'([0-9a-f]+)-([0-9a-f]+)\s+[r-][w-][x-][ps]\s+[0-9a-f]+\s+[0-9a-f]+:[0-9a-f]+\s+\d+\s*.*', line, re.I)
                    require(match is not None, 'Malformed process maps')
                    start, end = map(lambda x:int(x,16), match.groups())
                    require(last <= start < end, 'Unordered/overlapping process maps')
                    last = end
            normalized.append(value)
        same(records,normalized,'exact raw serial/report records')
        for row in browser['warmups']+browser['results']:
            pool=row['runtimeStats']['jitPool'];same(pool['limit'],12000,'fixed pool cap');require(pv.integer(pool['charged'],0,12000) and pv.integer(pool['linearMemoryBytes'],1),'pool integer observations')
        snapshot=self.path(raw['cache'])/manifest['appSha256']/(manifest['compatibilitySha256']+'.snapshot')
        self.hash(snapshot,{k:raw['snapshot'][k] for k in ('sha256','bytes')});metadata=snapshot_envelope(snapshot,manifest)
        return dict(path=str(path),sha256=self.hash(path)['sha256'],nonce=nonce,manifest=manifest,browser=raw['browser'],host=raw['host'],
                    partition=partition(browser),publishedPartition=published_partition(browser),snapshotMetadata=metadata)

    def compare(self, control, candidate, analysis):
        self.frozen_sources()
        first=self.read(self.path(control));plan_path=self.path(first['resourcePlan']['path']);plan=self.read(plan_path);self.validate_plan(plan)
        a=self.report(control,False,plan_path,plan);b=self.report(candidate,True,plan_path,plan)
        require(a['nonce']!=b['nonce'],'Resource modes must be fresh captures')
        same(a['browser'],b['browser'],'same browser')
        for key in ('platform','arch','release','logicalCPUs','totalMemoryBytes'):same(a['host'][key],b['host'][key],'same host '+key)
        stripped=lambda m:{k:v for k,v in m.items() if k not in ('experiment','compatibilitySha256','generation')}
        same(stripped(a['manifest']),stripped(b['manifest']),'only selected mode differs')
        total=b['partition']['complete']['instantiatedModuleBytes']/a['partition']['complete']['instantiatedModuleBytes']
        maximum=b['partition']['complete']['maxInstantiatedModuleBytes']/a['partition']['complete']['maxInstantiatedModuleBytes']
        phases={};all_phases={}
        for name in pv.NAMES:
            left=sum(x['instantiatedModuleBytes'] for x in a['partition']['measured'] if x['name']==name)
            right=sum(x['instantiatedModuleBytes'] for x in b['partition']['measured'] if x['name']==name)
            phases[name]=dict(controlBytes=left,candidateBytes=right,ratio=right/left if left else None)
            left=sum(x['instantiatedModuleBytes'] for x in a['partition']['warmups']+a['partition']['measured'] if x['name']==name);right=sum(x['instantiatedModuleBytes'] for x in b['partition']['warmups']+b['partition']['measured'] if x['name']==name)
            all_phases[name]=dict(controlBytes=left,candidateBytes=right,ratio=right/left if left else None)
        proposed=self.read(self.path(analysis))
        expected=dict(schema=1,status='passed',kind=OBSERVATION,timingEligible=False,productPromotionEligible=False,workloadProtocol=pv.PROTOCOL,
            resourcePlan=dict(path=str(plan_path.relative_to(self.root)),sha256=self.hash(plan_path)['sha256']),totalRatio=total,maximumModuleRatio=maximum,phases=phases,allPhases=all_phases,
            budget=dict(metric='Cumulative successfully instantiated module input bytes from VM start through complete stopped gate',upperRatio=1.10,observedWithinBudget=total<=1.10))
        expected['inputs']=[dict(path=x['path'],sha256=x['sha256'],nonce=x['nonce'],total=x['partition']['complete'],partition=x['publishedPartition'],warmups=x['partition']['warmups'],phases=x['partition']['measured']) for x in (a,b)]
        close_tree(proposed,expected,'published resource analysis')
        return dict(status='passed',timingEligible=False,productPromotionEligible=False,totalRatio=total,observedWithinBudget=total<=1.10,
                    protocolDependency=dict(path=str(DEPENDENCY.relative_to(self.root)),sha256=DEPENDENCY_SHA256),runs=[a,b],publishedAnalysis=expected)



def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    heldout=sub.add_parser('heldout');resources=sub.add_parser('resources')
    for name in ('off-capture','off-restore','on-capture','on-restore','output'):heldout.add_argument('--'+name,required=True)
    for name in ('control','candidate','analysis','output'):resources.add_argument('--'+name,required=True)
    args=parser.parse_args();output=Path(args.output).resolve();require(output.is_relative_to(ROOT/'artifacts') and not output.exists(),'Use fresh project artifacts output')
    output.mkdir(parents=True);review=Review(ROOT);result=dict(schema=1,status='failed',createdUtc=dt.datetime.now(dt.timezone.utc).isoformat())
    try:
        inputs=[args.off_capture,args.off_restore,args.on_capture,args.on_restore] if args.command=='heldout' else [args.control,args.candidate,args.analysis]
        for name in inputs:
            path=review.path(name);require(path.is_relative_to(ROOT/'artifacts'),'Acceptance CLI requires retained artifacts, not synthetic/tmp evidence')
            raw=review.read(path);require(not raw.get('synthetic') and 'synthetic' not in str(raw.get('browser','')).lower() and 'synthetic' not in str(raw.get('scope','')).lower(),'Synthetic data cannot establish policy evidence')
        if args.command=='heldout':result.update(review.heldout(args.off_capture,args.off_restore,args.on_capture,args.on_restore))
        else:result.update(review.compare(args.control,args.candidate,args.analysis))
        for name,identity in list(review.inventory.items()):review.hash(Path(name) if Path(name).is_absolute() else ROOT/name,identity)
    except Exception as error:result.update(status='failed',failure=str(error))
    result['inventory']=review.inventory;result['reviewerSha256']=sha(Path(__file__).read_bytes())
    result['limits']=['Retained-data audit only; no guest or build is launched. Synthetic and historical MSG2 records are never passive-policy acceptance evidence.',
      'Heldout eligible-state readback does not prove a soft batch or Asyncify retirement. Those are separate diagnostic gates.',
      'Resource bytes count cumulative generated module inputs, including reinstantiation; not live/native JIT resident bytes, true host peak memory or long-run stability. Diagnostic timing is ineligible.']
    with (output/'review.json').open('x') as stream:json.dump(result,stream,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
    for path in (output,output.parent):
        fd=os.open(path,os.O_RDONLY)
        try:os.fsync(fd)
        finally:os.close(fd)
    print(json.dumps({key:result[key] for key in ('status','checkedDigests','totalRatio','observedWithinBudget','failure') if key in result}))
    return 0 if result['status']=='passed' else 1

if __name__=='__main__':raise SystemExit(main())
