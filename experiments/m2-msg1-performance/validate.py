#!/usr/bin/env python3
"""Fresh production MSG1 ISA fixtures; one owned Node VM at a time."""
import datetime,json,os,signal,subprocess,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def save(p,o):
    with p.open('x')as f:json.dump(o,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
if __name__=='__main__':
    assert Path.cwd()==ROOT
    for cold in [False,True]:
        for enabled in ['off','on']:
            key=('cold'if cold else'hot')+'-'+enabled
            out=ROOT/f'artifacts/m2-msg1-production-isa-execution-{key}-01';capture=ROOT/f'artifacts/m2-msg1-production-isa-{key}-01'
            assert not out.exists()and not capture.exists();out.mkdir()
            scratch=Path(tempfile.mkdtemp(prefix='msg1-isa-',dir=ROOT/'tmp'))
            env=dict(os.environ,TMPDIR=str(scratch),TMP=str(scratch),TEMP=str(scratch))
            argv=['node','experiments/m2-sha-msg1/run-guest.mjs','--runtime','artifacts/m2-msg1-performance-build-01/runtime/x86_64/qemu-system-x86_64.js','--fixture','artifacts/m2-msg1-guest-01','--output',str(capture.relative_to(ROOT)),'--enabled',enabled]+(['--cold']if cold else[])
            save(out/'request.json',{'argv':argv,'scratch':str(scratch),'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Untimed Node ISA correctness, not Chrome timing'})
            print('starting '+key,flush=True);start=time.monotonic();proc=None
            with (out/'stdout.log').open('xb')as stdout,(out/'stderr.log').open('xb')as stderr:
                try:
                    proc=subprocess.Popen(argv,env=env,stdout=stdout,stderr=stderr,start_new_session=True);save(out/'process.json',{'pid':proc.pid,'processGroup':proc.pid});proc.wait(timeout=360)
                finally:
                    if proc and proc.poll()is None:
                        os.killpg(proc.pid,signal.SIGTERM)
                        try:proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
                    stdout.flush();os.fsync(stdout.fileno());stderr.flush();os.fsync(stderr.fileno());save(out/'execution.json',{'returncode':proc.returncode if proc else None,'seconds':time.monotonic()-start})
            assert proc and proc.returncode==0,'Retain failure; stop matrix'
            report=json.loads((capture/'report.json').read_text());assert report['status']=='passed' and report['timingEligible']is False and report['executionCounts']is False
            assert report['lateConfigurationResult']==-1 and report['finalStatus']==(0x10004 if enabled=='on'else 0x10003)
            print('passed '+key,flush=True)
