#!/usr/bin/env python3
"""Bind a new balanced confirmation schedule to the frozen measurement protocol."""
import ast,datetime,hashlib,json,os,shutil,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
OUT=ROOT/'artifacts/rnds2-rebuild-confirm-plan-01'
def ident(p):
    with p.open('rb')as f:h=hashlib.file_digest(f,'sha256').hexdigest()
    return {'sha256':h,'bytes':p.stat().st_size}
def save(p,obj):
    with p.open('x')as f:json.dump(obj,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def main():
    assert not OUT.exists()
    protocol='artifacts/memory32-rnds2-timing-plan-01/plan.json'
    base=json.loads((ROOT/protocol).read_text())
    assert base['status']=='frozen'
    for p,id in base['inputs'].items():assert ident(ROOT/p)==id,p
    prior='artifacts/memory32-rnds2-timing-analysis-01/analysis.json'
    analysis=json.loads((ROOT/prior).read_text());assert analysis['status']=='passed' and len(analysis['runs'])==18
    scripts=[str(p.relative_to(ROOT))for p in sorted(HERE.iterdir())if p.is_file()]
    for p in scripts:
        if p.endswith('.py'):ast.parse((ROOT/p).read_text())
    # Check the new interval arithmetic with simple independently known cases.
    import importlib.util,math
    spec=importlib.util.spec_from_file_location('confirmation_analysis',HERE/'analyze.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    assert mod.estimate([1]*6)['interval95']==[1,1]
    a=mod.estimate([.8,.9,1,1.1,1.2,1.3]);b=mod.estimate([1/x for x in [.8,.9,1,1.1,1.2,1.3]])
    assert math.isclose(a['geometricMean']*b['geometricMean'],1,rel_tol=1e-12)
    assert all(math.isclose(x*y,1,rel_tol=1e-12)for x,y in zip(a['interval95'],reversed(b['interval95'])))
    orders=[['original','control'],['control','original']]*3
    for arm in ['original','control']:
        for i in range(2):assert sum(row[i]==arm for row in orders)==3
    steps=[]
    for block,order in enumerate(orders,1):
        for arm in order:
            key=f'block-{block:02d}-{arm}'
            steps.append({'id':key,'block':block,'arm':arm,'capture':'artifacts/rnds2-rebuild-confirm-01/'+key,'execution':'artifacts/rnds2-rebuild-confirm-execution-'+key+'-01'})
    inputs={**base['inputs'],**{p:ident(ROOT/p)for p in scripts+[protocol,prior]}}
    OUT.mkdir()
    for p in scripts:
        dest=OUT/'source'/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/p,dest)
    save(OUT/'validation.json',{'status':'passed','checks':['all protocol inputs unchanged','three AB and three BA pairs','six-unit interval identity and reciprocal properties'],'selectedFrom':ident(ROOT/prior)})
    inputs[str((OUT/'validation.json').relative_to(ROOT))]=ident(OUT/'validation.json')
    save(OUT/'plan.json',{'schema':1,'status':'frozen','createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':'independent confirmation of exploratory unchanged-source rebuild signal','measurementProtocol':protocol,'hostTools':base['hostTools'],'runtimes':base['runtimes'],'blocks':6,'timeoutMs':1800000,'snapshot':False,'inputs':inputs,'steps':steps,'statistics':{'primary':'horizon','unit':'independent cold launch paired within two-arm block','aggregation':'full protocol horizon; secondary workload median of three 100-call batches','interval':'paired log Student t marginal 95%, df=5','retainAll':True,'poolWithExploration':False,'meaningfulImprovement':0.05,'improvementDecision':'upper95 < 1 for rebuild versus original RNDS2','fivePercentDecision':'upper95 < .95 for rebuild versus original RNDS2','secondary':'descriptive only'},'promotionBudgets':{'otherWorkloadTimeRatio':1.05,'readyRatio':1.05,'horizonRatio':1.05,'wasmBytesRatio':1.01,'linearMemoryBytes':2147483648,'instanceLimit':12000,'peakProcessMemoryRatio':1.05,'guestServiceLatencyRatio':1.05,'untestedGates':['peak process memory','guest service/interrupt latency','held-out application','other supported platforms'],'automaticPromotion':False}})
    print(json.dumps({'status':'frozen','inputs':len(inputs),'steps':len(steps)}))
if __name__=='__main__':main()
