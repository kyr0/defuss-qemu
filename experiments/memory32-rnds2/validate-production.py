#!/usr/bin/env python3
"""Serial correctness launches, retaining every attempt and auditing cleanup."""
import datetime, json, os, signal, subprocess, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def save(p,obj):
    with p.open('x')as f:json.dump(obj,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
if __name__=='__main__':
    assert Path.cwd()==ROOT
    for mode in ['pshufb','production','rnds2']:
        out=ROOT/f'artifacts/memory32-rnds2-validation-execution-{mode}-01'
        report=ROOT/f'artifacts/memory32-rnds2-validation-{mode}-01'
        if out.exists():
            assert json.loads((out/'execution.json').read_text())['returncode']==0
            assert json.loads((out/'browser-cleanup.json').read_text())['status']=='passed'
            assert json.loads((report/'report.json').read_text())['status']=='passed'
            continue
        out.mkdir();scratch=Path(tempfile.mkdtemp(prefix='lanes-test-',dir=ROOT/'tmp'))
        env=dict(os.environ,TMPDIR=str(scratch),TMP=str(scratch),TEMP=str(scratch),DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        argv=['node','experiments/memory32-rnds2/fixture-run.mjs',mode,str(report.relative_to(ROOT))]
        save(out/'request.json',{'scratch':str(scratch),'argv':argv,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()})
        print('starting '+mode,flush=True);start=time.monotonic();proc=None
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
        assert proc.returncode==0,'Retained failed attempt; halt'
        print('passed '+mode,flush=True)
