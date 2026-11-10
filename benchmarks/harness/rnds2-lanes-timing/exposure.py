#!/usr/bin/env python3
"""One separately labeled Bun exposure capture; counts are not elapsed costs."""
import json, os, signal, subprocess, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def save(p,obj):
    with p.open('x')as f:json.dump(obj,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
if __name__=='__main__':
    assert Path.cwd()==ROOT
    out=ROOT/'artifacts/rnds2-lanes-exposure-execution-01';capture=ROOT/'artifacts/rnds2-lanes-exposure-01';out.mkdir()
    scratch=Path(tempfile.mkdtemp(prefix='lanes-exposure-',dir=ROOT/'tmp'))
    env=dict(os.environ,TMPDIR=str(scratch),TMP=str(scratch),TEMP=str(scratch),DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    argv=['node','benchmarks/harness/rnds2-lanes-timing/run.mjs','--arm','diagnostic','--output',str(capture.relative_to(ROOT)),'--timeout','1800000']
    save(out/'request.json',{'scratch':str(scratch),'argv':argv});start=time.monotonic();proc=None
    with (out/'stdout.log').open('xb')as stdout,(out/'stderr.log').open('xb')as stderr:
        try:
            proc=subprocess.Popen(argv,env=env,stdout=stdout,stderr=stderr,start_new_session=True)
            save(out/'process.json',{'pid':proc.pid,'processGroup':proc.pid});proc.wait(timeout=2100)
        finally:
            if proc and proc.poll()is None:
                os.killpg(proc.pid,signal.SIGTERM)
                try:proc.wait(timeout=5)
                except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
            stdout.flush();os.fsync(stdout.fileno());stderr.flush();os.fsync(stderr.fileno())
            save(out/'execution.json',{'returncode':proc.returncode if proc else None,'seconds':time.monotonic()-start})
    subprocess.run(['python3','-B','tmp/audit-owned-chrome-01.py',str(out.relative_to(ROOT))],env=env,check=True)
    assert proc.returncode==0
    report=json.loads((capture/'report.json').read_text());assert report['status']=='passed' and report['timingEligible']is False
    rows=[json.loads(x)for x in (capture/'progress.jsonl').read_text().splitlines()]
    assert ''.join(r['serialChunk']for r in rows)==(capture/'serial.log').read_bytes().decode()
    summary={};samples=[];last=None
    for row in rows:
        counts=row['rnds2Counts'];assert len(counts)==3 and all(isinstance(x,int)and x>=0 for x in counts)
        if last:assert all(a>=b for a,b in zip(counts,last))
        last=counts
        event=row.get('gate',{})
        if event.get('event')=='start':before=row
        elif event.get('event')=='result':
            assert before['gate']['name']==event['name']and before['gate']['sample']==event['sample']
            delta=[a-b for a,b in zip(counts,before['rnds2Counts'])]
            samples.append({'name':event['name'],'sample':event['sample'],'compiledDeltas':delta})
            previous=summary.setdefault(event['name'],[0]*3);summary[event['name']]=[a+b for a,b in zip(previous,delta)]
    assert len(samples)==12 and summary['sha256'][1]>0
    save(capture/'exposure.json',{'status':'passed','scope':'Observed RNDS2 execution counts, not exclusive time or exact source-site attribution','counterOrder':['nativeIncludingCompiledFallback','compiledInline','compiledFallbackSubset'],'totals':summary,'samples':samples})
    print(json.dumps({'status':'passed','totals':summary}))
