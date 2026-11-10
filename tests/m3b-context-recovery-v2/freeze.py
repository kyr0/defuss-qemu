#!/usr/bin/env python3
"""Freeze the isolated typed recovery host after the real baseline passes."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import types
sys.dont_write_bytecode = True
ROOT=Path(__file__).resolve().parents[2]
NATIVE='artifacts/m3b-context-v2-native-source-01/manifest.json'
data=(ROOT/NATIVE).read_bytes()
if hashlib.sha256(data).hexdigest()!='c804956c31d854103c8dae13ca088a93ab31a692fe011d5745d9f787b27826cb':
    raise ValueError('Frozen native/proof manifest changed')
manifest=json.loads(data)
name='experiments/m3b-context-proof-v2/proof.py'
row=next(r for r in manifest['files'] if r['path']==name)
source=(ROOT/name).read_bytes()
if hashlib.sha256(source).hexdigest()!=row['sha256'] or len(source)!=row['bytes']:
    raise ValueError('Reviewed proof helper changed before execution')
p=types.ModuleType('verified_context_proof');p.__file__=str(ROOT/name)
exec(compile(source,p.__file__,'exec'),p.__dict__)
HERE='tests/m3b-context-recovery-v2'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('output','binding','baseline-review'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--test-evidence',action='append',required=True)
    parser.add_argument('--dependency',action='append',default=[])
    args=parser.parse_args();a=p.p.Audit();out=p.inside(args.output,True);p.p.mkdir(out)
    try:
        binding=a.read(args.binding);p.require(binding['status']=='passed' and binding['variant']==p.VARIANT,'Exact census runtime required')
        parent=p.frozen(a,argparse.Namespace(manifest=binding['sourceManifest']['path'],review=binding['sourceReview']['path']))
        p.require(a.ref(binding['sourceManifest']['path'])==binding['sourceManifest'] and a.ref(binding['sourceReview']['path'])==binding['sourceReview'],'Parent refs differ')
        review=a.read(args.baseline_review);p.require(review['status']=='passed' and review['baselinePassed'] is True and review['binding']==a.ref(args.binding),'Accepted independently reviewed baseline required')
        p.require(isinstance(review.get('inventory'),dict) and len(review['inventory'])>0,'Complete baseline review inventory map required')
        baseline_paths=set()
        for name,identity in review['inventory'].items():
            p.require(isinstance(name,str) and isinstance(identity,dict),'Baseline inventory identities required')
            baseline_paths.add(name);a.file(name,identity)
        host_manifest='artifacts/m3b-context-v5-source-01/manifest.json'
        host_review='artifacts/m3b-context-v5-source-review-01/review.json'
        host=a.read(host_manifest);host_acceptance=a.read(host_review)
        p.require(host['kind']=='m3b-context-host-v5-source-freeze' and host['status']=='frozen' and host['parentBinding']==a.ref(args.binding),'Exact reviewed v5 host source required')
        p.require(host['parentSourceManifest']==binding['sourceManifest'] and host['parentSourceReview']==binding['sourceReview'] and host['sourceFingerprint']==binding['sourceFingerprint'],'Host and ABI2 parent proof differ')
        p.require(host_acceptance['status']=='passed' and host_acceptance['sourceBlockers']==[] and host_acceptance['sourceManifest']==a.ref(host_manifest),'Independent v5 host source acceptance required')
        p.require(len(host['files'])==24,'Exact24-file v5 host/accounting source')
        for row in host['files']:a.file(row['path'],row);a.file(row['archive'],row)
        for name,identity in host['dependencies'].items():a.file(name,identity)
        archive_name='artifacts/m3b-context-recovery-v2-before-v4-port-01/manifest.json'
        archive=a.read(archive_name);p.require(archive['kind']=='m3b-context-recovery-v2-before-v4-port' and archive['status']=='preserved' and len(archive['files'])==15,'Preserved passed-host-test recovery source required')
        prior_tests=a.read(archive['testReport']['path'],archive['testReport']);p.require(prior_tests['status']=='passed' and prior_tests['returncode']==0 and prior_tests['sourceStable'] is True,'Actual preserved host-tests02 result required')
        p.require(set(prior_tests['sources'])=={row['path'] for row in archive['files']},'Preserved tested source set differs')
        for row in archive['files']:
            p.require(prior_tests['sources'][row['path']]=={k:row[k] for k in ('sha256','bytes')},'Preserved source differs from passed host tests')
            a.file(row['archive'],row)
        latest_archive_name='artifacts/m3b-context-recovery-v2-before-v5-port-01/manifest.json'
        latest_archive=a.read(latest_archive_name)
        p.require(latest_archive['kind']=='m3b-context-recovery-v2-before-v5-port' and latest_archive['status']=='preserved' and len(latest_archive['files'])==15,'Preserved unexecuted v4-port source required')
        p.require(latest_archive['priorArchive']==a.ref(archive_name),'Recovery archive chain differs')
        p.require({r['path'] for r in latest_archive['files']}=={r['path'] for r in archive['files']},'Preserved recovery source sets differ')
        for row in latest_archive['files']:a.file(row['archive'],row)
        cache_archive_name='artifacts/m3b-context-recovery-v2-before-cache-fix-01/manifest.json'
        cache_archive=a.read(cache_archive_name)
        p.require(cache_archive['kind']=='m3b-context-recovery-v2-before-cache-fix' and cache_archive['status']=='preserved' and len(cache_archive['files'])==15 and cache_archive['priorArchive']==a.ref(latest_archive_name),'Preserved tested pre-cache-cleanup sources required')
        cache_tests=a.read(cache_archive['testReport']['path'],cache_archive['testReport'])
        p.require(cache_tests['status']=='passed' and cache_tests['returncode']==0 and cache_tests['sourceStable'] is True and set(cache_tests['sources'])=={r['path'] for r in cache_archive['files']},'Actual host-tests03 source evidence required')
        for row in cache_archive['files']:
            p.require(cache_tests['sources'][row['path']]=={k:row[k] for k in ('sha256','bytes')},'Pre-cache-cleanup source differs from passed host test')
            a.file(row['archive'],row)
        authored=p.p.tree_names(HERE);p.require(1<=len(authored)<=32 and all(Path(n).suffix in p.p.SUFFIXES for n in authored),'Bounded authored closure')
        dependencies=set(parent['dependencies'])|{args.binding,args.baseline_review,NATIVE,'artifacts/m3b-context-v2-native-source-review-01/review.json',binding['sourceManifest']['path'],binding['sourceReview']['path'],'tests/m3b-context-inspection-v6/input-bound.mjs'}|set(args.dependency)|set(args.test_evidence)
        dependencies.update([host_manifest,host_review,archive_name,archive['testReport']['path']])
        dependencies.update(baseline_paths)
        dependencies.add(latest_archive_name)
        dependencies.update(row['archive'] for row in latest_archive['files'])
        dependencies.update([cache_archive_name,cache_archive['testReport']['path']])
        dependencies.update(row['archive'] for row in cache_archive['files'])
        dependencies.update(host['dependencies'])
        dependencies.update(row[key] for row in host['files'] for key in ('path','archive'))
        dependencies.update(row['archive'] for row in archive['files'])
        p.require(1<=len(args.test_evidence)<=32 and len(set(args.test_evidence))==len(args.test_evidence),'Actual unique test evidence required')
        for n in args.test_evidence:p.inside(n,True)
        # The frozen v6 equivalence test contains quoted replacement strings
        # resembling imports. Treat only these exact hash-bound bytes as a
        # fixture and retain its actual import plus both dynamic source reads.
        fixture_manifest='artifacts/m3b-context-inspection-v6-source-01/manifest.json'
        fixture_name='tests/m3b-context-inspection-v6/test.mjs'
        fixture_proof=a.read(fixture_manifest,{'sha256':'f02c3c64e84c5123adbcc5b39e978845d19f5c4981f3fbd9426fecaf17860bdf'})
        fixture_row=next(row for row in fixture_proof['files'] if row['path']==fixture_name)
        a.file(fixture_name,fixture_row)
        p.require(p.p.IMPORTS.findall(a.bytes(fixture_name).decode())==['node:test','node:assert/strict','node:fs/promises','./input-bound.mjs','./input-bound.mjs','../m3b-context-runner-v5/','./'],'Exact frozen fixture import literals required')
        fixture_targets=['tests/m3b-context-inspection-v6/input-bound.mjs','tests/m3b-context-inspection-v6/inspect.mjs','tests/m3b-context-runner-v5/inspect.mjs']
        p.require({fixture_name,*fixture_targets}<=dependencies,'All exact fixture inputs remain mandatory dependencies')
        dependencies.remove(fixture_name)
        try:imports=p.close_imports(a,authored,dependencies)
        finally:dependencies.add(fixture_name)
        imports.append({'source':fixture_name,'specifier':'./input-bound.mjs','target':fixture_targets[0]})
        imports.sort(key=lambda row:(row['source'],row['specifier']))
        fixture_scan={'source':a.ref(fixture_name),'sourceManifest':a.ref(fixture_manifest),'actualImport':fixture_targets[0],'dynamicReads':fixture_targets[1:],'reason':'Exact frozen source-equivalence test replacement strings are not executable imports; complete file identity remains checked.'}

        files=[]
        for name in authored:
            data=a.bytes(name);archive=out/'source'/name;archive.parent.mkdir(parents=True,exist_ok=True);p.publish(archive,data)
            files.append({'path':name,'archive':p.relative(archive),**a.file(archive)})
        p.require(p.p.tree_names(HERE)==authored,'Recovery source set changed')
        result={'schema':1,'kind':'m3b-context-recovery-v2-source-freeze','status':'frozen','timingEligible':False,'sourceFingerprint':binding['sourceFingerprint'],
          'parentBinding':a.ref(args.binding),'parentSourceManifest':binding['sourceManifest'],'parentSourceReview':binding['sourceReview'],'hostSourceManifest':a.ref(host_manifest),'hostSourceReview':a.ref(host_review),'baselineReview':a.ref(args.baseline_review),'previousRecoverySource':a.ref(latest_archive_name),'cacheCleanupSource':a.ref(cache_archive_name),
          'files':files,'dependencies':{n:a.identities[n] for n in sorted(dependencies-set(authored))},'imports':imports,'importScanExactFixture':fixture_scan,'testEvidence':args.test_evidence,
          'scope':'New host recovery adapter only; existing runtime and baseline source remain unchanged. Source freeze does not imply recovery success.'}
        for directory in sorted((q for q in out.rglob('*') if q.is_dir()),key=lambda q:len(q.parts),reverse=True):p.p.sync(directory)
        a.stable();p.publish(out/'manifest.json',result);print(json.dumps({'status':'frozen','manifest':p.relative(out/'manifest.json'),'files':len(files)}))
    except BaseException as error:
        p.publish(out/'failure.json',{'status':'failed','error':repr(error)});raise

if __name__=='__main__':main()
