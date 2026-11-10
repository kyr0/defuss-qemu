#!/usr/bin/env python3
"""Independent retained-resource evidence audit; never a performance/promotion decision."""
import argparse
import copy
import datetime as dt
import gzip
import hashlib
import importlib.util
import json
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
require, same, canonical = pv.require, pv.same, pv.canonical
sha = lambda data: hashlib.sha256(data).hexdigest()
FIELDS = ['attemptedModules','attemptedModuleBytes','attemptedImportVectorBytes','maxAttemptedModuleBytes',
          'compiledModules','instantiatedModules','instantiatedModuleBytes','instantiatedImportVectorBytes','maxInstantiatedModuleBytes','overflow']
MAXIMA = {'maxAttemptedModuleBytes','maxInstantiatedModuleBytes'}
ADDITIVE = [name for name in FIELDS if name not in MAXIMA]
OUTER = 'defuss-m2-resource-v2'
OBSERVATION = 'diagnostic-module-input-bytes-sustained-v2'
PACKAGE_OBSERVATION = 'module-input-bytes-sustained-v2'
SOURCE = 'artifacts/m2-resource-v2-source-01/manifest.json'
SOURCE_SHA256 = 'd82da4bdd443600757967d4c9b1cd0f532f8a8c31c5e5c75f4ce519655884591'
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
        pv.close_tree(metadata, dict(schema=1, encoding='gzip', appSha256=manifest['appSha256'], compatibilitySha256=manifest['compatibilitySha256']), 'snapshot metadata identity')
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


class Review(pv.Reviewer):
    def frozen_sources(self):
        manifest_path = self.path(SOURCE)
        self.hash(manifest_path, dict(sha256=SOURCE_SHA256))
        record = self.read(manifest_path)
        same(record['protocol'], OUTER, 'resource source protocol')
        same(record['guestProtocol'], pv.PROTOCOL, 'unchanged workload protocol')
        archive = manifest_path.parent
        for name, digest in record['files'].items():
            self.hash(self.path(name), dict(sha256=digest))
            self.hash(archive/name, dict(sha256=digest))
        for name, digest in record['unchangedDependencies'].items():
            self.hash(self.path(name), dict(sha256=digest))
        self.hash(DEPENDENCY, dict(sha256=DEPENDENCY_SHA256))
        self.hash(Path(__file__))
        return record

    def resource_manifest(self, directory):
        manifest = self.read(directory/'app.json')
        pv.close_tree(manifest, dict(schema=1,os='linux',architecture='amd64',bunVersion='1.4.4',vm=pv.VM,
            image='oven/bun@sha256:b14d4eb5d84af31d532380ad42fbc8243936bbe23e2b85c5f740efbd845fe6f2',
            benchmark=dict(protocol=pv.PROTOCOL),snapshot=dict(enabled=True,protocol='com1-ready-v1',readyByte=49,readyMode='manual'),
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
        pv.close_tree(raw, dict(schema=1,protocol=OUTER,timingEligible=False,observation=OBSERVATION,status='passed',
            mode='baseline',snapshotMode='capture',captureCode=False,pageErrors=[],serverErrors=[],
            executionConfiguration=dict(aotEnabled=False,planDisabled=True)), 'resource report')
        require(not raw.get('deadlineExceeded'), 'Resource deadline exceeded')
        pv.close_tree(browser, dict(timingEligible=False,observation=OBSERVATION,experiment=dict(name='sha256msg2-v1',enabled=enabled),msg2Status=0x10004 if enabled else 0x10003), 'resource browser')
        same(raw['experiment'], browser['experiment'], 'mode choice')
        same(raw['timingPlan'], dict(path=str(plan_path.relative_to(self.root)),sha256=self.hash(plan_path)['sha256']), 'timing plan binding')
        same(raw['inputHashes'][raw['timingPlan']['path']], raw['timingPlan']['sha256'], 'plan input hash')
        condition = raw['hostCondition']; same(condition['configuration'], plan['hostCondition'], 'host condition configuration')
        times = []
        for phase in ('before','after'):
            observed = condition[phase]; same(json.loads(observed['stdout']), observed['status'], 'raw host status')
            pv.close_tree(observed['status'], plan['hostCondition']['expected'], 'stopped compiler VM')
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
        observer_path=self.path('benchmarks/harness/m2-resource-v2/observer.js');self.hash(observer_path)
        derived, reconstructed=derive(source_path.read_text(),observer_path.read_text())
        for key,value in reconstructed.items():same(derivation[key],value,'independent derivation '+key)
        same((directory/manifest['generation']/'runtime/qemu-system-x86_64.js').read_bytes(),derived.encode(),'exact derived JS')
        same(manifest['observation']['productionJsSha256'],reconstructed['sourceSha256'],'observer production identity')
        same(derivation['wasmSha256'],p['artifacts']['runtime/qemu-system-x86_64.wasm']['sha256'],'byte-identical production WASM')
        same(manifest['observation']['wasmSha256'],derivation['wasmSha256'],'observer WASM identity')
        required={str((directory/'app.json').relative_to(self.root)),str((directory/'derivation.json').relative_to(self.root)),*pv.CRITICAL_INPUTS}
        for name in ('m1','m2','m2-sustained-v2','m2-resource-v2','code'):
            required.update(str(p.relative_to(self.root)) for p in (self.root/'benchmarks/harness'/name).rglob('*') if p.is_file() and p.suffix in ('.mjs','.js','.ts','.json'))
        payloads={str((directory/manifest['generation']/name).relative_to(self.root)) for name in pv.ARTIFACTS}
        require(required|payloads <= set(raw['inputHashes']), 'Missing mandatory source/package input hash')
        served={'benchmarks/harness/m2-resource-v2/browser.mjs','benchmarks/harness/m2-resource-v2/vm-adapter.mjs','benchmarks/harness/m2-resource-v2/observer.mjs','benchmarks/harness/m2-sustained-v2/protocol.mjs'}|payloads
        require(served <= set(raw['servedHashes']), 'Missing mandatory served identity')
        for category in ('inputHashes','servedHashes'):
            for name,digest in raw[category].items():self.hash(self.path(name),dict(sha256=digest))
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
                    partition=partition(browser),snapshotMetadata=metadata)

    def compare(self, control, candidate, analysis):
        self.frozen_sources()
        first=self.read(self.path(control));plan_path=self.path(first['timingPlan']['path']);plan=self.read(plan_path);self.validate_plan(plan)
        a=self.report(control,False,plan_path,plan);b=self.report(candidate,True,plan_path,plan)
        require(a['nonce']!=b['nonce'],'Resource modes must be fresh captures')
        same(a['browser'],b['browser'],'same browser')
        for key in ('platform','arch','release','logicalCPUs','totalMemoryBytes'):same(a['host'][key],b['host'][key],'same host '+key)
        stripped=lambda m:{k:v for k,v in m.items() if k not in ('experiment','compatibilitySha256','generation')}
        same(stripped(a['manifest']),stripped(b['manifest']),'only selected mode differs')
        total=b['partition']['complete']['instantiatedModuleBytes']/a['partition']['complete']['instantiatedModuleBytes']
        maximum=b['partition']['complete']['maxInstantiatedModuleBytes']/a['partition']['complete']['maxInstantiatedModuleBytes']
        phases={}
        for name in pv.NAMES:
            left=sum(x['instantiatedModuleBytes'] for x in a['partition']['measured'] if x['name']==name)
            right=sum(x['instantiatedModuleBytes'] for x in b['partition']['measured'] if x['name']==name)
            phases[name]=dict(controlBytes=left,candidateBytes=right,ratio=right/left if left else None)
        proposed=self.read(self.path(analysis))
        expected=dict(schema=1,status='passed',kind=OBSERVATION,timingEligible=False,productPromotionEligible=False,workloadProtocol=pv.PROTOCOL,
            timingPlan=dict(path=str(plan_path.relative_to(self.root)),sha256=self.hash(plan_path)['sha256']),totalRatio=total,maximumModuleRatio=maximum,phases=phases,
            budget=dict(metric='Cumulative successfully instantiated module input bytes from VM start through complete stopped gate',upperRatio=1.10,observedWithinBudget=total<=1.10))
        expected['inputs']=[dict(path=x['path'],sha256=x['sha256'],nonce=x['nonce'],total=x['partition']['complete'],warmups=x['partition']['warmups'],phases=x['partition']['measured']) for x in (a,b)]
        pv.close_tree(proposed,expected,'published resource analysis')
        return dict(status='passed',timingEligible=False,productPromotionEligible=False,totalRatio=total,observedWithinBudget=total<=1.10,
                    protocolDependency=dict(path=str(DEPENDENCY.relative_to(self.root)),sha256=DEPENDENCY_SHA256),runs=[a,b],publishedAnalysis=expected)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('control','candidate','analysis','output'):parser.add_argument('--'+name,required=True)
    args=parser.parse_args();output=Path(args.output).resolve();require(output.is_relative_to(ROOT/'artifacts') and not output.exists(),'Use fresh project artifacts output')
    output.mkdir(parents=True);review=Review(ROOT);result=dict(schema=1,status='failed',createdUtc=dt.datetime.now(dt.timezone.utc).isoformat())
    try:
        result.update(review.compare(args.control,args.candidate,args.analysis))
        for name,identity in list(review.inventory.items()):review.hash(Path(name) if Path(name).is_absolute() else ROOT/name,identity)
    except Exception as error:
        result.update(status='failed', failure=str(error))
    result['inventory']=review.inventory
    result['scope']=['Independent Python exact counter partitions, JS derivation, production/plan/snapshot identities and descriptive1.10 byte budget; raw guest protocol uses the hash-pinned independent sustained Python reviewer, never the JS analyzer.',
        'Cumulative successfully instantiated module input bytes count repeated instantiations. They are not native JIT resident bytes, live-code bytes, true host peak memory or a long-run bound.',
        'All diagnostic timing remains ineligible. A passed evidence audit or byte budget cannot establish performance improvement or product promotion.']
    (output/'review.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k] for k in ('status','totalRatio','observedWithinBudget','failure') if k in result}))
    return 0 if result['status']=='passed' else 1

if __name__=='__main__':raise SystemExit(main())
