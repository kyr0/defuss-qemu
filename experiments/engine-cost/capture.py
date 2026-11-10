#!/usr/bin/env python3
"""Bound and retain the separately scoped Node/Chrome component experiment."""
import json, os, signal, subprocess, time
from pathlib import Path
root=Path.cwd();assert root.name=='defuss-vm'
out=root/'artifacts/engine-cost-execution-01';out.mkdir()
scratch=Path(os.environ['TMPDIR']);assert scratch.is_relative_to(root/'tmp')
def save(name,obj):
    with (out/name).open('x')as f:json.dump(obj,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
argv=['node','experiments/engine-cost/run.mjs','artifacts/engine-cost-01']
save('request.json',{'scratch':str(scratch),'argv':argv,'scope':'Component only, no VM performance or observed-tier claim'})
env=dict(os.environ,DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
proc=None;start=time.monotonic()
with (out/'stdout.log').open('xb')as stdout,(out/'stderr.log').open('xb')as stderr:
    try:
        proc=subprocess.Popen(argv,env=env,stdout=stdout,stderr=stderr,start_new_session=True)
        save('process.json',{'pid':proc.pid,'processGroup':proc.pid});proc.wait(timeout=180)
    finally:
        if proc and proc.poll()is None:
            os.killpg(proc.pid,signal.SIGTERM)
            try:proc.wait(timeout=5)
            except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
        stdout.flush();os.fsync(stdout.fileno());stderr.flush();os.fsync(stderr.fileno())
        save('execution.json',{'returncode':proc.returncode if proc else None,'elapsedSeconds':time.monotonic()-start})
subprocess.run(['python3','-B','tmp/audit-owned-chrome-01.py',str(out.relative_to(root))],env=env,check=True)
assert proc.returncode==0
print('Component probe passed; owned browser cleanup passed')
