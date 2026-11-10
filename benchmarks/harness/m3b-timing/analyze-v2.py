#!/usr/bin/env python3
"""Replay all raw journals and compute launch-level paired exploratory intervals."""
import hashlib,json,math,statistics,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'artifacts/m3b-idle-timing-analysis-02'
NAMES=['integer','json','sha256','http']
EXPECTED={'integer':1526500379,'json':133784,'sha256':'022efbc5f459321b5cc989106e3d38a7a9f878ddda28663e409811af0cd5e19d','http':1392}
def ident(p):
    with p.open('rb') as f:h=hashlib.file_digest(f,'sha256').hexdigest()
    return {'sha256':h,'bytes':p.stat().st_size}
def estimate(values):
    assert len(values)==4 and all(v>0 for v in values)
    logs=list(map(math.log,values));m=statistics.mean(logs);width=3.182446305284263*statistics.stdev(logs)/2
    return {'ratios':values,'geometricMean':math.exp(m),'interval95':[math.exp(m-width),math.exp(m+width)],'units':4,'method':'paired log Student t, df=3; exploratory marginal interval'}
def main():
    plan=json.loads((ROOT/'artifacts/m3b-idle-timing-plan-01/plan.json').read_text());complete=json.loads((ROOT/'artifacts/m3b-idle-timing-01/complete.json').read_text());assert complete['status']=='passed'
    for p,id in plan['inputs'].items():assert ident(ROOT/p)==id,p
    assert complete['plan']==ident(ROOT/'artifacts/m3b-idle-timing-plan-01/plan.json')
    runs=[];nonces=set();inputs={str(Path(__file__).relative_to(ROOT)):ident(Path(__file__)), 'artifacts/m3b-idle-timing-analysis-derivation-02/derivation.json':ident(ROOT/'artifacts/m3b-idle-timing-analysis-derivation-02/derivation.json')}
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
            assert row['nativeStatus']==(None if step['arm']=='original' else 63 if step['arm']=='on' else 62)
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
        script="import {readFile} from 'node:fs/promises';import {Oracle} from './benchmarks/harness/m3b-timing/oracle.mjs';const o=new Oracle({arm:process.argv[1]});for(const l of (await readFile(process.argv[2],'utf8')).trimEnd().split('\\n'))o.accept(JSON.parse(l));o.finish();"
        subprocess.run(['node','--input-type=module','-e',script,step['arm'],str(directory/'progress.jsonl')],check=True,cwd=ROOT)
        for moment in ['beforeCondition','afterCondition']:assert report['host'][moment]['status']['status']=='Stopped'
        runs.append({**step,'nonce':nonce,'metricsMs':metrics,'batchesMs':measured,'browser':report['browser'],'host':report['host']})
    assert len(nonces)==12 and len(set(r['browser']for r in runs))==1
    comparisons={}
    for a,b in [('on','original'),('off','original'),('on','off')]:
        rows=[]
        for block in range(1,5):
            arms={r['arm']:r for r in runs if r['block']==block};rows.append({key:arms[a]['metricsMs'][key]/arms[b]['metricsMs'][key] for key in runs[0]['metricsMs']})
        comparisons[a+'/'+b]={key:estimate([r[key]for r in rows]) for key in rows[0]}
    result={'schema':1,'status':'passed','scope':'Four-block cold exploratory timing, no promotion or native-gap claim. Independent Python arithmetic and same-author JS replay.','plan':ident(ROOT/'artifacts/m3b-idle-timing-plan-01/plan.json'),'inputs':inputs,'runs':runs,'comparisons':comparisons,'candidatePromotion':False}
    OUT.mkdir();(OUT/'analysis.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':'passed','comparisons':comparisons},indent=2))
if __name__=='__main__':main()
