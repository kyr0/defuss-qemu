#!/usr/bin/env python3
"""Bind accepted admission diagnostics and the predeclared parent confirmation."""
import argparse, datetime, hashlib, json, os, traceback
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def need(value,message):
    if not value: raise ValueError(message)
def digest(path):
    h=hashlib.sha256();size=0
    with path.open('rb') as f:
        while b:=f.read(1024*1024):h.update(b);size+=len(b)
    return {'sha256':h.hexdigest(),'bytes':size}
def main():
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args()
    out=ROOT/args.output;need(out.resolve().is_relative_to(ROOT/'artifacts'),'Artifact output');out.mkdir()
    inventory={};inputs={}
    def check(name,expected=None):
        path=ROOT/name;need(path.resolve()==path and path.is_relative_to(ROOT),'Canonical input '+name)
        if name not in inventory:inventory[name]=digest(path)
        if expected:need(inventory[name]=={k:expected[k] for k in ('sha256','bytes')},'Identity '+name)
        return path
    def read(name):
        data=json.loads(check(name).read_bytes());inputs[name]=inventory[name];return data
    def bind_map(values):
        for name,expected in values.items():check(name,expected)
    def accepted(name):
        data=read(name);need(data['status']=='passed','Passed '+name)
        for key in ('inputs','inventory','dependencies','sources'):
            if key in data:bind_map(data[key])
        return data
    def freeze(name):
        data=accepted(name)
        for f in data['files']:check(f['path'],f);check(f['archive'],f)
        tests=data['hostTests'];check(tests['path'],tests);accepted(tests['path'])
    report={'schema':1,'status':'failed','inputs':inputs,'timingEligible':False,'candidatePromotion':False,'productionDefaultEnabled':False,'authorship':'Same root agent. Separate JavaScript/Python reconstruction, not an external independent source audit.'}
    try:
        source=str(Path(__file__).relative_to(ROOT));check(source);inputs[source]=inventory[source]
        old=accepted('artifacts/m3b-bun-exposure-validation-01/summary.json')
        accepted('artifacts/m3b-bun-exposure-review-01/review.json')
        admission=accepted('artifacts/m3b-bun-admission-review-01/review.json')
        confirmation=accepted('artifacts/m3b-original-confirmation-review-01/review.json')
        freeze('artifacts/m3b-bun-admission-source-01/manifest.json')
        freeze('artifacts/m3b-bun-admission-review-source-01/manifest.json')
        accepted('artifacts/m3b-admission-host-tests-01/report.json')
        pre=accepted('artifacts/m3b-admission-prebuild-01/report.json')
        for f in pre['files']:check(f['path'],f);check(f['archive'],f)
        post=accepted('artifacts/m3b-admission-postbuild-01/report.json')
        accepted('artifacts/m3b-admission-runtime-host-verification-01/review.json')
        need(pre['allOtherFilesByteIdentical'] and pre['originalEligibilityFunctionUnchanged'] and post['sourceStable'] and post['parentSourceStable'],'Unchanged guards/source')
        need(pre['sourceFingerprint']==post['sourceFingerprint'],'Stable source fingerprint')
        need(pre['changes']==['target/i386/tcg/m3b-frontend.inc','target/i386/tcg/m3ba-admission.inc'],'Exact observer overlay')
        for record in (pre,post):check(record['sourceInventory']['path'],record['sourceInventory'])
        # Full source inventories were rederived before/after the native build.
        # Here rehash their closure and all experiment/replay dependencies;
        # do not claim to reconstruct the 10k-file native tree a third time.
        plan=read('artifacts/m3b-original-confirmation-plan-01/plan.json')
        for key in ('controller','derivedFromController','parentRuntimeBinding','originalZeroExposure','admissionObserverPositiveReview'):
            ref=plan[key];check(ref['path'],ref)
        runs={}
        for name in ['m3b-bun-exposure-off-01','m3b-bun-exposure-on-01','m3b-bun-admission-off-01','m3b-bun-admission-on-01','m3b-bun-exposure-on-02']:
            capture=accepted('artifacts/'+name+'/report.json');s=capture['summary']
            need(capture['timingEligible'] is False and capture['coldOnly'] is True and capture['snapshots']==0 and capture['recordCount']==72 and s['gates']==69 and s['results']==12,'Diagnostic protocol '+name)
            runs[name]={'runtimeBinding':capture['runtimeBinding'],'enabled':capture['enabled'],'gates':s['gates'],'results':s['results'],'records':capture['recordCount'],'lifetime':s['lifetime'],'phaseFusion':{n:{k:sum(p['m3b'][k] for p in s['phases'] if p['name']==n) for k in s['lifetime']['m3b']} for n in ['warmup','integer','json','sha256','http']}}
        need(old['positiveBunFusionExposure'] is False,'Original zero retained')
        need(admission['runs']['on']['lifetime']['m3b']['compiledEntries']>0 and confirmation['summary']['lifetime']['m3b']['compiledEntries']>0,'Positive exposure in both runtimes')
        report.update(status='passed',runs=runs,positiveBunFusionExposure=True,originalRuntimePositiveExposure=True,earlierZeroCauseEstablished=False,currentFusedPcIdentityEstablished=False,
            sourceFingerprint=post['sourceFingerprint'],sourceFiles=pre['sourceFiles'],nativeOverlay=pre['changes'],
            admissionReconstructionIdentities=len(admission['inventory']),confirmationReconstructionIdentities=len(confirmation['inventory']),
            scope='Original zero pair retained. Observation-only admission OFF/ON pair and one predeclared original-runtime ON confirmation passed; no timing pooling, no retry, no promotion.',
            remainingGates=['Full required architectural state','Natural interrupt and alias-SMC behavior','Owning-worker Asyncify suspension and suspended-owner invalidation','Exact current application PC/code identity and exposure variability','Uninstrumented resource and performance acceptance'])
    except Exception:report['failure']=traceback.format_exc()
    report['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();report['verifiedIdentities']=len(inventory)
    def write(name,data):
        with (out/name).open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
    write('inventory.json',(json.dumps(inventory,indent=2)+'\n').encode())
    report['inventory']={'path':str((out/'inventory.json').relative_to(ROOT)),**digest(out/'inventory.json')}
    write('summary.json',(json.dumps(report,indent=2)+'\n').encode());write('aggregate.py',Path(__file__).read_bytes())
    fd=os.open(out,os.O_RDONLY);os.fsync(fd);os.close(fd)
    print(json.dumps({'status':report['status'],'verifiedIdentities':len(inventory),'failure':report.get('failure')}))
    return report['status']!='passed'
if __name__=='__main__':raise SystemExit(main())
