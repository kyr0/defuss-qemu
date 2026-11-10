#!/usr/bin/env python3
"""Recheck both exact MSG1 overlays and retained semantic/exposure evidence."""
import hashlib,importlib.util,json,os,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'experiments/rnds2-lanes'))
from prepare import inventory,ident
spec=importlib.util.spec_from_file_location('msg1_prepare',ROOT/'experiments/m2-sha-msg1/prepare.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
def save(p,obj):
    with p.open('x')as f:json.dump(obj,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
if __name__=='__main__':
    out=ROOT/'artifacts/m2-msg1-performance-source-proof-01';assert not out.exists()
    base=ROOT/'engine/qemu';basefp,basefiles=inventory(base);assert basefp=='2aa3673909fa05c2c2407776b5825be674e80850168d8459323fa6451bab3c7a'
    sources={}
    for mode,name in [('switch','m2-msg1-performance-source-01'),('diagnostic','m2-msg1-diagnostic-source-01')]:
        source=ROOT/'artifacts'/name/'source';fp,files=inventory(source);expected=dict(basefiles)
        for p,s in mod.changes(base,mode).items():b=s.encode();expected[str(p)]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
        assert expected==files,mode
        overlay=json.loads(source.with_name('source-m2-msg1-overlay.json').read_text());assert overlay['mode']==mode
        for n,h in overlay['inputs'].items():assert ident(ROOT/'experiments/m2-sha-msg1'/n)['sha256']==h
        sources[mode]={'source':str(source.relative_to(ROOT)),'sourceFingerprint':fp,'files':files}
    checked={}
    for name,key in [('artifacts/m2-msg1-host-01/report.json','inputs'),('artifacts/m2-msg1-diagnostic-review-01/review.json','identities'),('artifacts/m2-msg1-exposure-review-01/review.json','inventory')]:
        report=json.loads((ROOT/name).read_text());assert report['status']=='passed';checked[name]=ident(ROOT/name)
        for p,id in report[key].items():
            actual=ident(ROOT/p)
            assert (actual['sha256']==id if isinstance(id,str)else actual==id),p
            checked[p]=actual
    checked[str(Path(__file__).relative_to(ROOT))]=ident(Path(__file__))
    for name in ['prepare.py','lowering.c.inc','config.c.inc']:p='experiments/m2-sha-msg1/'+name;checked[p]=ident(ROOT/p)
    out.mkdir();save(out/'inventories.json',sources);save(out/'report.json',{'status':'passed','scope':'Current identity/source revalidation of retained independent correctness/exposure evidence; no new timing claim','baseFingerprint':basefp,'sources':{k:{p:v[p]for p in ['source','sourceFingerprint']}for k,v in sources.items()},'checkedInputs':checked,'inventory':ident(out/'inventories.json')})
    print(json.dumps({'status':'passed','checkedInputs':len(checked),'fingerprints':{k:v['sourceFingerprint']for k,v in sources.items()}}))
