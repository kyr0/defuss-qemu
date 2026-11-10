#!/usr/bin/env python3
"""Bind current-run code attribution without changing promotion or timing status."""
import datetime,hashlib,json,os,traceback
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def identity(p):
    h=hashlib.sha256();n=0
    with p.open('rb') as f:
        while b:=f.read(1048576):h.update(b);n+=len(b)
    return {'sha256':h.hexdigest(),'bytes':n}
def main():
    out=ROOT/'artifacts/m3b-bun-code-attribution-validation-01';out.mkdir();inventory={}
    def check(name,expected=None):
        p=ROOT/name;assert p.resolve()==p and p.is_relative_to(ROOT),name
        if name not in inventory:inventory[name]=identity(p)
        if expected:assert inventory[name]=={k:expected[k] for k in ('sha256','bytes')},name
        return p
    def read(name):return json.loads(check(name).read_bytes())
    def passed(name):
        data=read(name);assert data['status']=='passed',name
        for key in ('inputs','inventory','sources','dependencies'):
            values=data.get(key,{})
            if isinstance(values,dict) and 'path' not in values:
                for p,id in values.items():check(p,id)
        return data
    def freeze(name):
        data=read(name);assert data['status'] in ('frozen','passed')
        for f in data['files']:check(f['path'],f);check(f['archive'],f)
        for p,id in data['dependencies'].items():check(p,id)
        for key in ('hostTests','preflight'):
            if key in data:ref=data[key];check(ref['path'],ref);passed(ref['path'])
        if 'freezer' in data:f=data['freezer'];check(f['path'],f);check(f['archive'],f)
        return data
    def write(name,value):
        b=value if isinstance(value,bytes) else (json.dumps(value,indent=2)+'\n').encode()
        with (out/name).open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
        fd=os.open(out,os.O_RDONLY);os.fsync(fd);os.close(fd)
    report=dict(schema=1,status='failed',inventory=inventory,timingEligible=False,candidatePromotion=False,productionDefaultEnabled=False,
        authorship='Same root author. Separate JavaScript and Python implementations; not an external independent audit.')
    try:
        freeze('artifacts/m3b-bun-code-attribution-source-01/manifest.json');freeze('artifacts/m3b-bun-code-attribution-review-source-01/manifest.json')
        review=passed('artifacts/m3b-bun-code-attribution-review-01/review.json')
        binding=passed('artifacts/m3b-code-attribution-binding-01/binding.json')
        for key in ('parent','prebuild','postbuild','buildReport','overlay'):ref=binding[key];check(ref['path'],ref)
        pre=passed(binding['prebuild']['path']);post=passed(binding['postbuild']['path']);build=passed(binding['buildReport']['path'])
        assert pre['sourceFingerprint']==post['sourceFingerprint']==build['sourceFingerprint']==binding['sourceFingerprint']
        assert pre['allOtherFilesByteIdentical'] and post['sourceStable'] and post['parentSourceStable']
        assert all(pre[k] for k in ('originalServiceFunctionUnchanged','originalCountdownAndPoolPredicateUnchanged','originalDescriptorLayoutUnchanged'))
        assert pre['changes']==['include/qemu/m3b-profile.h','target/i386/tcg/m3b-frontend.inc','tcg/m3b-runtime-head.inc','tcg/m3co-observer.inc']
        for f in pre['files']:check(f['path'],f);check(f['archive'],f)
        for record in (pre,post):check(record['sourceInventory']['path'],record['sourceInventory'])
        assert read(pre['sourceInventory']['path'])==read(post['sourceInventory']['path'])
        for path,id in build['artifacts'].items():check('artifacts/m3b-code-attribution-build-01/'+path,id)
        passed('artifacts/m3b-code-attribution-host-tests-01/report.json')
        code=passed('artifacts/m3b-bun-code-attribution-bytes-01/report.json')
        for key in ('compiler','objdump'):
            t=code[key];assert identity(Path(t['path']))=={k:t[k] for k in ('sha256','bytes')}
        for p,id in code['sdkMetadata'].items():assert identity(Path(p))==id
        for i,command in enumerate(code['commands'],1):assert read(f'artifacts/m3b-bun-code-attribution-bytes-01/command-{i:02d}.json')==command
        for row in code['observations']:
            for key in ('binary','syntheticElf','disassembly'):ref=row[key];check(ref['path'],ref)
            assert all(p['result']['result']==0 and p['truncatedClosingBranchRejected'] for p in row['probes'])
        runs={}
        for arm in ('off','on'):
            capture=passed('artifacts/m3b-bun-code-attribution-'+arm+'-01/report.json');s=capture['summary']
            inspection=passed('artifacts/m3b-bun-code-attribution-inspection-'+arm+'-01/review.json');assert inspection['summary']==s
            for key,value in review['runs'][arm].items():assert s[key]==value
            assert capture['recordCount']==72 and s['gates']==69 and s['results']==12 and capture['timingEligible'] is False and capture['coldOnly'] is True and capture['snapshots']==0
            assert passed('artifacts/m3b-bun-code-attribution-execution-'+arm+'-01/browser-cleanup.json')['status']=='passed'
            runs[arm]={'gates':69,'results':12,'records':72,'lifetime':s['lifetime'],'attributionAccepted':s['attributionAccepted'],
                'phaseAttempts':{n:{k:sum(p['code'][k] for p in s['phases'] if p['name']==n) for k in ('compiled','tci')} for n in ['warmup','integer','json','sha256','http']},'phases':s['phases']}
        assert len(code['observations'])==runs['on']['lifetime']['code']['formed']
        assert code['attributionAccepted']==review['attributionAccepted']==runs['on']['attributionAccepted']
        own=str(Path(__file__).relative_to(ROOT));check(own);write('aggregate.py',Path(__file__).read_bytes());check(str((out/'aggregate.py').relative_to(ROOT)))
        report.update(status='passed',runs=runs,attributionAccepted=review['attributionAccepted'],codeObservations=code['observations'],sourceFingerprint=binding['sourceFingerprint'],nativeOverlay=pre['changes'],
            scope='Exactly one diagnostic OFF/ON pair, with unchanged Bun guest/workload. Exact formation bytes and descriptor generations reconcile every compiled/TCI attempt at all 69 gates; per-phase counts are attempts, not retired work or time fractions. Zero exposure remains a non-attribution outcome with no retry.',
            remaining=['Complete intermediate architectural state','Exact natural B-poll delivery and suspended-owner invalidation','Active-body later-block SMC','Exposure variability and JSC/source-level attribution','Uninstrumented resource/performance acceptance'],
            timingRepetitions='Earlier load-affected pilot and exactly two requested repetitions remain complete; this is not a timing set.')
    except Exception:report['failure']=traceback.format_exc()
    report['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();write('summary.json',report)
    print(json.dumps({'status':report['status'],'identities':len(inventory),'attributionAccepted':report.get('attributionAccepted'),'failure':report.get('failure')}));return report['status']!='passed'
if __name__=='__main__':raise SystemExit(main())
