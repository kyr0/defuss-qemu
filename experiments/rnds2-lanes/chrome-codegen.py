#!/usr/bin/env python3
"""Run four small untimed compiler diagnostics with owned browser cleanup."""
import hashlib,json,os,signal,subprocess,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def save(p,obj):
    with p.open('x')as f:json.dump(obj,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
if __name__=='__main__':
    for kind in ['original','candidate']:
        for tier in ['baseline','optimizing']:
            key=kind+'-'+tier;out=ROOT/f'artifacts/rnds2-lanes-chrome-codegen-execution-{key}-01';out.mkdir()
            capture=f'artifacts/rnds2-lanes-chrome-codegen-{key}-01'
            scratch=Path(tempfile.mkdtemp(prefix='lanes-codegen-',dir=ROOT/'tmp'))
            env=dict(os.environ,TMPDIR=str(scratch),TMP=str(scratch),TEMP=str(scratch),DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
            argv=['node','experiments/rnds2-lanes/chrome-codegen.mjs',kind,tier,capture]
            sources=['experiments/rnds2-lanes/chrome-codegen.mjs','experiments/rnds2-lanes/chrome-codegen.py']
            save(out/'request.json',{'scratch':str(scratch),'argv':argv,'timingEligible':False,'inputs':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()for p in sources}})
            proc=None;start=time.monotonic()
            with (out/'stdout.log').open('xb')as stdout,(out/'stderr.log').open('xb')as stderr:
                try:
                    proc=subprocess.Popen(argv,stdout=stdout,stderr=stderr,env=env,start_new_session=True)
                    save(out/'process.json',{'pid':proc.pid,'processGroup':proc.pid});proc.wait(timeout=90)
                finally:
                    if proc and proc.poll()is None:
                        os.killpg(proc.pid,signal.SIGTERM)
                        try:proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
                    stdout.flush();os.fsync(stdout.fileno());stderr.flush();os.fsync(stderr.fileno())
                    save(out/'execution.json',{'returncode':proc.returncode if proc else None,'seconds':time.monotonic()-start})
            subprocess.run(['python3','-B','tmp/audit-owned-chrome-01.py',str(out.relative_to(ROOT))],env=env,check=True)
            assert proc.returncode==0
            print(key+' passed',flush=True)
