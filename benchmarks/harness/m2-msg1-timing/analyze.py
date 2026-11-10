#!/usr/bin/env python3
"""Replay all raw journals and compute launch-level paired confirmation intervals."""
import hashlib,json,math,statistics,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'artifacts/m2-msg1-timing-analysis-01'
NAMES=['integer','json','sha256','http']
EXPECTED={'integer':1526500379,'json':133784,'sha256':'022efbc5f459321b5cc989106e3d38a7a9f878ddda28663e409811af0cd5e19d','http':1392}
def ident(p):
    with p.open('rb') as f:h=hashlib.file_digest(f,'sha256').hexdigest()
    return {'sha256':h,'bytes':p.stat().st_size}
def estimate(values):
    assert len(values)==6 and all(v>0 for v in values)
    logs=list(map(math.log,values));m=statistics.mean(logs);width=2.570581835636314*statistics.stdev(logs)/math.sqrt(6)
    return {'ratios':values,'geometricMean':math.exp(m),'interval95':[math.exp(m-width),math.exp(m+width)],'units':6,'method':'paired log Student t, df=5; MSG1 exploration marginal interval'}
def main():
    plan=json.loads((ROOT/'artifacts/m2-msg1-timing-plan-01/plan.json').read_text());complete=json.loads((ROOT/'artifacts/m2-msg1-timing-01/complete.json').read_text());assert complete['status']=='passed'
    for p,id in plan['inputs'].items():assert ident(ROOT/p)==id,p
    assert complete['plan']==ident(ROOT/'artifacts/m2-msg1-timing-plan-01/plan.json')
    runs=[];nonces=set();inputs={str(Path(__file__).relative_to(ROOT)):ident(Path(__file__))}
    for step in plan['steps']:
        directory=ROOT/step['capture'];report=json.loads((directory/'report.json').read_text());assert report['status']=='passed' and report['inputsStable'] and report['arm']==step['arm']
        for p,id in report['inputs'].items():assert ident(ROOT/p)==id,p
        for file in ['report.json','progress.jsonl','serial.log','inputs.json']:inputs[str((directory/file).relative_to(ROOT))]=ident(directory/file)
        for file in ['execution.json','browser-cleanup.json']:
            p=ROOT/step['execution']/file;inputs[str(p.relative_to(ROOT))]=ident(p)
        assert json.loads((ROOT/step['execution']/'execution.json').read_text())['returncode']==0
        assert json.loads((ROOT/step['execution']/'browser-cleanup.json').read_text())['status']=='passed'
        rows=[json.loads(line) for line in (directory/'progress.jsonl').read_text().splitlines()];assert len(rows)==72
        assert ''.join(r['serialChunk'] for r in rows)==(directory/'serial.log').read_bytes().decode('utf-8')
        events=[json.loads(l[len('DEFUSS_M1 '):]) for l in (directory/'serial.log').read_bytes().decode('utf-8').splitlines() if l.startswith('DEFUSS_M1 ')]
        assert len(events)==71 and events[0]['event']=='snapshot-prepared' and events[1]['event']=='resumed'
        nonce=events[0]['nonce'];assert nonce not in nonces;nonces.add(nonce)
        gates=[e for e in events if 'seq'in e];assert [e['seq']for e in gates]==list(range(1,70))
        assert all(e['nonce']==nonce for e in events)
        measured={n:[] for n in NAMES};stops=[];gates_times=[]
        for i,row in enumerate(rows):
            assert row['sequence']==i and row['status']['running'] is False
            assert row['nativeStatus']==None
            if row['kind']!='gate':continue
            e=row['gate'];assert e==gates[e['seq']-1];assert row['previousAck']['seq']==e['seq']-1
            elapsed=row['markerHostMs']-row['previousAck']['hostMs'];assert elapsed>0
            if e['event']=='result':
                assert e['value']==EXPECTED[e['name']] and e['iterations']==100
                previous=gates[e['seq']-2];assert previous['event']=='start' and previous['name']==e['name'] and previous['sample']==e['sample']
                measured[e['name']].append(elapsed);stops.append(row['hostMs']-row['markerHostMs'])
            if e['event']=='gate-result':gates_times.append(elapsed)
            if e['event']in ['warmup-complete','complete']:assert e['values']==EXPECTED
        assert all(len(v)==3 for v in measured.values());assert len(gates_times)==20
        for n in NAMES:assert measured[n]==[r['hostMs']for r in report['summary']['results']if r['name']==n]
        metrics={n:statistics.median(v) for n,v in measured.items()};metrics['horizon']=rows[-1]['hostMs']-rows[0]['startHostMs'];metrics['ready']=rows[1]['hostMs']-rows[0]['startHostMs'];metrics['resultToStopMax']=max(stops)
        assert metrics['horizon']==report['summary']['horizonMs']
        # A separate JS protocol replay also checks warmup/configuration/lifecycle.
        script="import {readFile} from 'node:fs/promises';import {Oracle} from './benchmarks/harness/m2-msg1-timing/oracle.mjs';const o=new Oracle({arm:process.argv[1]});for(const l of (await readFile(process.argv[2],'utf8')).trimEnd().split('\\n'))o.accept(JSON.parse(l));o.finish();"
        subprocess.run(['node','--input-type=module','-e',script,step['arm'],str(directory/'progress.jsonl')],check=True,cwd=ROOT)
        for moment in ['beforeCondition','afterCondition']:assert report['host'][moment]['status']['status']=='Stopped'
        runs.append({**step,'nonce':nonce,'metricsMs':metrics,'batchesMs':measured,'browser':report['browser'],'host':report['host'],'maxChargedInstances':max(r['pool']['charged']for r in rows),'linearMemoryBytes':sorted({r['pool']['linearMemoryBytes']for r in rows})})
    assert len(nonces)==18 and len(set(r['browser']for r in runs))==1
    prior=json.loads((ROOT/'artifacts/memory32-rnds2-timing-analysis-01/analysis.json').read_text())
    assert nonces.isdisjoint({r['nonce']for r in prior['runs']})
    comparisons={}
    for a,b in [('candidate','original'),('control','original'),('candidate','control')]:
        rows=[]
        for block in range(1,7):
            arms={r['arm']:r for r in runs if r['block']==block};rows.append({key:arms[a]['metricsMs'][key]/arms[b]['metricsMs'][key] for key in runs[0]['metricsMs']})
        comparisons[a+'/'+b]={key:estimate([r[key]for r in rows]) for key in rows[0]}
    primary={pair:comparisons[pair]['sha256']for pair in ['candidate/original','candidate/control']}
    decision={'primary':'sha256','improvementVsBoth':all(r['interval95'][1]<1 for r in primary.values()),'atLeastFivePercentVsBoth':all(r['interval95'][1]<.95 for r in primary.values()),'promotion':False,'reason':'Scoped timing only; independent confirmation and remaining held-out/resource/platform acceptance are separate'}
    sizes={k:(ROOT/v['directory']/'qemu-system-x86_64.wasm').stat().st_size for k,v in plan['runtimes'].items()if k!='diagnostic'}
    resources={'wasmBytes':sizes,'candidateWasmRatios':{k:sizes['candidate']/sizes[k]for k in ['original','control']},'wasmSizeBudget':plan['promotionBudgets']['wasmBytesRatio'],'wasmSizeBudgetPassed':all(sizes['candidate']/sizes[k]<=plan['promotionBudgets']['wasmBytesRatio']for k in ['original','control']),'maxChargedInstances':max(r['maxChargedInstances']for r in runs),'linearMemoryBytes':sorted({b for r in runs for b in r['linearMemoryBytes']}),'peakProcessMemory':'not measured as a per-VM peak','remainingGates':plan['promotionBudgets']['untestedGates']}
    decision['wasmSizeBudgetPassed']=resources['wasmSizeBudgetPassed']
    result={'resources':resources,'decision':decision,'schema':1,'status':'passed','scope':'Six-block cold same-binary MSG1 experiment, no promotion or native-gap claim. Independent Python arithmetic and same-author JS replay.','plan':ident(ROOT/'artifacts/m2-msg1-timing-plan-01/plan.json'),'inputs':inputs,'runs':runs,'comparisons':comparisons,'candidatePromotion':False}
    OUT.mkdir();(OUT/'analysis.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':'passed','comparisons':comparisons},indent=2))
if __name__=='__main__':main()
