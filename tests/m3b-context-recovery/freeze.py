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
NATIVE='artifacts/m3b-context-native-source-01/manifest.json'
data=(ROOT/NATIVE).read_bytes()
if hashlib.sha256(data).hexdigest()!='3638d126d6ff194c81fbc696c6c868a85169f5f2517f2250608b43c633dc1bf2':
    raise ValueError('Frozen native/proof manifest changed')
manifest=json.loads(data)
name='experiments/m3b-context-proof/proof.py'
row=next(r for r in manifest['files'] if r['path']==name)
source=(ROOT/name).read_bytes()
if hashlib.sha256(source).hexdigest()!=row['sha256'] or len(source)!=row['bytes']:
    raise ValueError('Reviewed proof helper changed before execution')
p=types.ModuleType('verified_context_proof');p.__file__=str(ROOT/name)
exec(compile(source,p.__file__,'exec'),p.__dict__)
HERE='tests/m3b-context-recovery'

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
        authored=p.p.tree_names(HERE);p.require(1<=len(authored)<=32 and all(Path(n).suffix in p.p.SUFFIXES for n in authored),'Bounded authored closure')
        dependencies=set(parent['dependencies'])|{args.binding,args.baseline_review,NATIVE,'artifacts/m3b-context-native-source-review-01/review.json',binding['sourceManifest']['path'],binding['sourceReview']['path']}|set(args.dependency)|set(args.test_evidence)
        p.require(1<=len(args.test_evidence)<=32 and len(set(args.test_evidence))==len(args.test_evidence),'Actual unique test evidence required')
        for n in args.test_evidence:p.inside(n,True)
        imports=p.close_imports(a,authored,dependencies)
        files=[]
        for name in authored:
            data=a.bytes(name);archive=out/'source'/name;archive.parent.mkdir(parents=True,exist_ok=True);p.publish(archive,data)
            files.append({'path':name,'archive':p.relative(archive),**a.file(archive)})
        p.require(p.p.tree_names(HERE)==authored,'Recovery source set changed')
        result={'schema':1,'kind':'m3b-context-recovery-source-freeze','status':'frozen','timingEligible':False,'sourceFingerprint':binding['sourceFingerprint'],
          'parentBinding':a.ref(args.binding),'parentSourceManifest':binding['sourceManifest'],'parentSourceReview':binding['sourceReview'],'baselineReview':a.ref(args.baseline_review),
          'files':files,'dependencies':{n:a.identities[n] for n in sorted(dependencies-set(authored))},'imports':imports,'testEvidence':args.test_evidence,
          'scope':'New host recovery adapter only; existing runtime and baseline source remain unchanged. Source freeze does not imply recovery success.'}
        for directory in sorted((q for q in out.rglob('*') if q.is_dir()),key=lambda q:len(q.parts),reverse=True):p.p.sync(directory)
        a.stable();p.publish(out/'manifest.json',result);print(json.dumps({'status':'frozen','manifest':p.relative(out/'manifest.json'),'files':len(files)}))
    except BaseException as error:
        p.publish(out/'failure.json',{'status':'failed','error':repr(error)});raise

if __name__=='__main__':main()
