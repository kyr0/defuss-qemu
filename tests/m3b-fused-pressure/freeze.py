#!/usr/bin/env python3
"""Freeze the isolated fused pressure host after the real baseline passes."""
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
HERE='tests/m3b-fused-pressure'
INPUT_BOUND_MANIFEST='artifacts/m3b-context-inspection-v6-source-01/manifest.json'
INPUT_BOUND_REVIEW='artifacts/m3b-context-inspection-v6-source-review-01/review.json'

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
        baseline_inventory=review.get('inventory')
        p.require(type(baseline_inventory) is dict and baseline_inventory,'Complete baseline outcome inventory required')
        for name,identity in baseline_inventory.items():
            p.require(type(identity) is dict and type(identity.get('bytes')) is int and identity['bytes']>=0 and type(identity.get('sha256')) is str and len(identity['sha256'])==64 and all(c in '0123456789abcdef' for c in identity['sha256']),'Exact baseline inventory identity')
            a.file(name,identity)
        a.file(INPUT_BOUND_MANIFEST,{'sha256':'f02c3c64e84c5123adbcc5b39e978845d19f5c4981f3fbd9426fecaf17860bdf'})
        a.file(INPUT_BOUND_REVIEW,{'sha256':'970bda1c7acb7b88696251c1c6462524fa853948dd13f7aa0e837e6ff3b607c3'})
        bound_source=a.read(INPUT_BOUND_MANIFEST);bound_review=a.read(INPUT_BOUND_REVIEW)
        p.require(bound_source['status']=='frozen' and bound_review['status']=='passed' and bound_review['sourceBlockers']==[] and bound_review['sourceManifest']==a.ref(INPUT_BOUND_MANIFEST),'Reviewed input-bound helper')
        bound_row=next(row for row in bound_source['files'] if row['path']=='tests/m3b-context-inspection-v6/input-bound.mjs')
        a.file(bound_row['path'],bound_row);a.file(bound_row['archive'],bound_row)
        authored=p.p.tree_names(HERE);p.require(1<=len(authored)<=32 and all(Path(n).suffix in p.p.SUFFIXES for n in authored),'Bounded authored closure')
        dependencies=set(parent['dependencies'])|set(baseline_inventory)|{'tests/regions-pressure/fixture.c',args.binding,args.baseline_review,NATIVE,'artifacts/m3b-context-v2-native-source-review-01/review.json',binding['sourceManifest']['path'],binding['sourceReview']['path'],INPUT_BOUND_MANIFEST,INPUT_BOUND_REVIEW,bound_row['path'],bound_row['archive']}|set(args.dependency)|set(args.test_evidence)
        p.require(1<=len(args.test_evidence)<=32 and len(set(args.test_evidence))==len(args.test_evidence),'Actual unique test evidence required')
        for n in args.test_evidence:p.inside(n,True)
        # This one immutable test contains source-equivalence replacement
        # strings that the inherited regex mistakes for directory imports.
        # Verify the complete real source, keep it in the evidence closure,
        # and record its actual import and file-read edges explicitly.
        fixture_path='tests/m3b-context-inspection-v6/test.mjs'
        fixture_row=next(row for row in bound_source['files'] if row['path']==fixture_path)
        p.require(fixture_row['sha256']=='ae5dc6839463609787c0fe6971664dcdf9a2ed85caefd4b072b27ae917a526b4' and fixture_row['bytes']==2408,'Exact frozen import fixture required')
        fixture_bytes=a.bytes(fixture_path,fixture_row);a.file(fixture_row['archive'],fixture_row)
        matches=['node:test','node:assert/strict','node:fs/promises','./input-bound.mjs','./input-bound.mjs','../m3b-context-runner-v5/','./']
        p.require(p.p.IMPORTS.findall(fixture_bytes.decode())==matches,'Pinned fixture regex matches changed')
        p.require(fixture_path in dependencies and fixture_path not in authored,'Only the external pinned fixture may bypass regex scanning')
        dynamic_inputs=['tests/m3b-context-runner-v5/inspect.mjs','tests/m3b-context-inspection-v6/inspect.mjs']
        for name in dynamic_inputs:
            p.require(name in baseline_inventory and name in dependencies,'Fixture readFile input must remain in accepted baseline inventory')
            a.file(name,baseline_inventory[name])
        dependencies.add(fixture_row['archive'])
        dependencies.remove(fixture_path)
        try:
            imports=p.close_imports(a,authored,dependencies)
        finally:
            dependencies.add(fixture_path)
        edge={'source':fixture_path,'specifier':'./input-bound.mjs','target':bound_row['path']}
        p.require(edge not in imports,'Pinned fixture import duplicated')
        imports=sorted(imports+[edge],key=lambda row:(row['source'],row['specifier']))
        import_scan_fixtures=[{'source':a.ref(fixture_path),'archive':a.ref(fixture_row['archive']),'verifiedRegexMatches':matches,
          'realImports':matches[:4],'importEdges':[edge],'dynamicInputs':[a.ref(name) for name in dynamic_inputs],
          'reason':'Exact immutable source-equivalence fixture contains quoted replacement strings, not extra imports. All real bytes/hashes and input edges remain verified; every other source uses the unchanged scanner.'}]
        files=[]
        for name in authored:
            data=a.bytes(name);archive=out/'source'/name;archive.parent.mkdir(parents=True,exist_ok=True);p.publish(archive,data)
            files.append({'path':name,'archive':p.relative(archive),**a.file(archive)})
        p.require(p.p.tree_names(HERE)==authored,'Pressure source set changed')
        result={'schema':1,'kind':'m3b-fused-pressure-source-freeze','status':'frozen','timingEligible':False,'sourceFingerprint':binding['sourceFingerprint'],
          'parentBinding':a.ref(args.binding),'parentSourceManifest':binding['sourceManifest'],'parentSourceReview':binding['sourceReview'],'baselineReview':a.ref(args.baseline_review),
          'files':files,'dependencies':{n:a.identities[n] for n in sorted(dependencies-set(authored))},'imports':imports,'importScanExactFixtures':import_scan_fixtures,'testEvidence':args.test_evidence,
          'scope':'New bounded256MiB fused pressure fixture and host; existing runtime and accepted baseline remain unchanged. Source freeze does not imply lifetime success.'}
        for directory in sorted((q for q in out.rglob('*') if q.is_dir()),key=lambda q:len(q.parts),reverse=True):p.p.sync(directory)
        a.stable();p.publish(out/'manifest.json',result);print(json.dumps({'status':'frozen','manifest':p.relative(out/'manifest.json'),'files':len(files)}))
    except BaseException as error:
        p.publish(out/'failure.json',{'status':'failed','error':repr(error)});raise

if __name__=='__main__':main()
