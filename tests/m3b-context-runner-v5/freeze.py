#!/usr/bin/env python3
"""Freeze the isolated host scoped-counter adapter after preserving the failed ABI2 capture."""
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
HERE='tests/m3b-context-runner-v5'
ROOTS=(HERE,'tests/m3b-context-accounting-v3')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('output','binding','previous-failure-review'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--test-evidence',action='append',required=True)
    parser.add_argument('--dependency',action='append',default=[])
    args=parser.parse_args();a=p.p.Audit();out=p.inside(args.output,True);p.p.mkdir(out)
    try:
        binding=a.read(args.binding);p.require(binding['status']=='passed' and binding['variant']==p.VARIANT,'Exact census runtime required')
        parent=p.frozen(a,argparse.Namespace(manifest=binding['sourceManifest']['path'],review=binding['sourceReview']['path']))
        p.require(a.ref(binding['sourceManifest']['path'])==binding['sourceManifest'] and a.ref(binding['sourceReview']['path'])==binding['sourceReview'],'Parent refs differ')
        native_recheck=a.read(binding['sourceRecheck']['path'],binding['sourceRecheck'])
        native_inventory=a.read(native_recheck['inventory']['path'],native_recheck['inventory'])
        native_tree=next(t for t in native_inventory['trees'] if t['path']==native_recheck['source']['path'])
        for native_name in ('accel/tcg/cpu-exec.c','tcg/wasm64.c','tcg/m3b-runtime-head.inc'):
            a.file(native_tree['path']+'/'+native_name,native_tree['files'][native_name])
        review=a.read(args.previous_failure_review);p.require(review['status']=='reviewed-failed-capture' and review['baselinePassed'] is False and review['captureStatus']=='failed' and review['binding']==a.ref(args.binding),'Preserved independently reviewed failed capture required')
        prior=a.read(review['capture']['path'],review['capture']);p.require(prior['status']=='failed' and prior['enabled'] is True and prior['oracleFailure']['gate']['seq']==3 and len(prior['gates'])==4,'Exact failed ON gate3 report required')
        host_manifest='artifacts/m3b-context-v4-source-01/manifest.json'
        host_review='artifacts/m3b-context-v4-source-review-01/review.json'
        h=a.read(host_manifest);hr=a.read(host_review)
        p.require(h['kind']=='m3b-context-host-v4-source-freeze' and h['status']=='frozen' and h['parentBinding']==a.ref(args.binding),'Exact previous host source required')
        p.require(hr['status']=='passed' and hr['sourceBlockers']==[] and hr['sourceManifest']==a.ref(host_manifest),'Previous host review required')
        for row in h['files']:a.file(row['path'],row);a.file(row['archive'],row)
        for name,identity in h['dependencies'].items():a.file(name,identity)
        authored=sorted(n for root in ROOTS for n in p.p.tree_names(root));p.require(1<=len(authored)<=32 and all(Path(n).suffix in p.p.SUFFIXES for n in authored),'Bounded authored host closure')
        dependencies=set(parent['dependencies'])|{args.binding,args.previous_failure_review,NATIVE,'artifacts/m3b-context-v2-native-source-review-01/review.json',binding['sourceManifest']['path'],binding['sourceReview']['path']}|set(args.dependency)|set(args.test_evidence)
        dependencies.update(row[key] for row in parent['files'] for key in ('path','archive'))
        dependencies.add(review['capture']['path'])
        dependencies.update(h['dependencies'])
        dependencies.update(row[key] for row in h['files'] for key in ('path','archive'))
        dependencies.update([host_manifest,host_review,'artifacts/m3b-context-v2-source-01/source/accel/tcg/cpu-exec.c'])
        dependencies.update(['artifacts/m3b-context-v2-source-01/source/tcg/wasm64.c','artifacts/m3b-context-v2-source-01/source/tcg/m3b-runtime-head.inc'])
        dependencies.add(native_recheck['inventory']['path'])
        p.require(1<=len(args.test_evidence)<=32 and len(set(args.test_evidence))==len(args.test_evidence),'Actual unique test evidence required')
        for n in args.test_evidence:p.inside(n,True)
        imports=p.close_imports(a,authored,dependencies)
        files=[]
        for name in authored:
            data=a.bytes(name);archive=out/'source'/name;archive.parent.mkdir(parents=True,exist_ok=True);p.publish(archive,data)
            files.append({'path':name,'archive':p.relative(archive),**a.file(archive)})
        p.require(sorted(n for root in ROOTS for n in p.p.tree_names(root))==authored,'Host source set changed')
        result={'schema':1,'kind':'m3b-context-host-v5-source-freeze','status':'frozen','timingEligible':False,'sourceFingerprint':binding['sourceFingerprint'],
          'previousHostSourceManifest':a.ref(host_manifest),'previousHostSourceReview':a.ref(host_review),'parentBinding':a.ref(args.binding),'parentSourceManifest':binding['sourceManifest'],'parentSourceReview':binding['sourceReview'],'previousFailureReview':a.ref(args.previous_failure_review),
          'files':files,'dependencies':{n:a.identities[n] for n in sorted(dependencies-set(authored))},'imports':imports,'testEvidence':args.test_evidence,
          'scope':'New host accounting for the global pre-admission TCI target return counter only; existing ABI2 runtime, selected-tier guards and full guest workload remain unchanged. Source freeze does not imply baseline or recovery success.'}
        for directory in sorted((q for q in out.rglob('*') if q.is_dir()),key=lambda q:len(q.parts),reverse=True):p.p.sync(directory)
        a.stable();p.publish(out/'manifest.json',result);print(json.dumps({'status':'frozen','manifest':p.relative(out/'manifest.json'),'files':len(files)}))
    except BaseException as error:
        p.publish(out/'failure.json',{'status':'failed','error':repr(error)});raise

if __name__=='__main__':main()
