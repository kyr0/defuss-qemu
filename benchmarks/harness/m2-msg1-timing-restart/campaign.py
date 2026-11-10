#!/usr/bin/env python3
"""Serial durable execution; incomplete or failed attempts are never replaced."""
import datetime,hashlib,json,os,shutil,signal,subprocess,tempfile,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
PLAN=ROOT/'artifacts/m2-msg1-timing-plan-02/plan.json'
OUT=ROOT/'artifacts/m2-msg1-timing-02'
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def ident(p):
    with p.open('rb') as f:h=hashlib.file_digest(f,'sha256').hexdigest()
    return {'sha256':h,'bytes':p.stat().st_size}
def write(p,obj):
    with p.open('x') as f:json.dump(obj,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    fd=os.open(p.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
def check(inputs):
    for name,id in inputs.items():assert ident(ROOT/name)==id,name
if __name__=='__main__':
    assert Path.cwd()==ROOT
    plan=json.loads(PLAN.read_text());assert plan['status']=='frozen';check(plan['inputs'])
    OUT.mkdir(exist_ok=True)
    saved=OUT/'plan.json'
    if saved.exists():assert saved.read_bytes()==PLAN.read_bytes()
    else:write(saved,plan)
    lock=ROOT/'artifacts/.m1-campaign.lock';owner={'token':str(uuid.uuid4()),'pid':os.getpid(),'campaign':str(OUT.relative_to(ROOT)),'createdUtc':utc()};write(lock,owner)
    results=[]
    try:
        for step in plan['steps']:
            key=step['id'];capture=ROOT/step['capture'];execution=ROOT/step['execution']
            if execution.exists():
                done=json.loads((execution/'execution.json').read_text());audit=json.loads((execution/'browser-cleanup.json').read_text());report=json.loads((capture/'report.json').read_text())
                assert done['returncode']==0 and audit['status']==report['status']=='passed','Existing incomplete/failed attempt retained; no retry'
                assert done['plan']==ident(PLAN) and done['arm']==report['arm']==step['arm'];check(report['inputs']);results.append({'id':key,'report':ident(capture/'report.json')});continue
            assert not capture.exists();execution.mkdir()
            scratch=Path(tempfile.mkdtemp(prefix='m2-msg1-time-',dir=ROOT/'tmp'))
            env=dict(os.environ,TMPDIR=str(scratch),TMP=str(scratch),TEMP=str(scratch),DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
            node=Path(shutil.which('node')).resolve();assert str(node)==plan['hostTools']['node']['path'];assert ident(node)=={k:plan['hostTools']['node'][k]for k in ['sha256','bytes']};argv=[str(node),'benchmarks/harness/m2-msg1-timing/run.mjs','--arm',step['arm'],'--output',step['capture'],'--timeout','1800000']
            write(execution/'request.json',{'scratch':str(scratch),'argv':argv,'startedUtc':utc(),'arm':step['arm'],'plan':ident(PLAN),'node':ident(node),'outerDeadlineSeconds':2100})
            print(json.dumps({'event':'starting','step':key,'utc':utc()}),flush=True)
            started=time.monotonic();proc=None;timedout=False
            with (execution/'stdout.log').open('xb') as stdout,(execution/'stderr.log').open('xb') as stderr:
                try:
                    proc=subprocess.Popen(argv,stdout=stdout,stderr=stderr,env=env,start_new_session=True)
                    write(execution/'process.json',{'pid':proc.pid,'processGroup':proc.pid,'startedUtc':utc()});proc.wait(timeout=2100)
                except subprocess.TimeoutExpired:timedout=True
                finally:
                    if proc and proc.poll() is None:
                        os.killpg(proc.pid,signal.SIGTERM)
                        try:proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
                    stdout.flush();os.fsync(stdout.fileno());stderr.flush();os.fsync(stderr.fileno())
                    write(execution/'execution.json',{'returncode':proc.returncode if proc else None,'timedout':timedout,'elapsedSeconds':time.monotonic()-started,'completedUtc':utc(),'arm':step['arm'],'plan':ident(PLAN)})
            subprocess.run(['python3','-B','tmp/audit-owned-chrome-01.py',step['execution']],check=True,env=env)
            assert proc and proc.returncode==0 and not timedout,'Failed attempt retained; campaign halted'
            report=json.loads((capture/'report.json').read_text());assert report['status']=='passed';results.append({'id':key,'report':ident(capture/'report.json')})
            print(json.dumps({'event':'completed','step':key,'horizonSeconds':report['summary']['horizonMs']/1000,'utc':utc()}),flush=True)
        write(OUT/'complete.json',{'status':'passed','completedUtc':utc(),'plan':ident(PLAN),'runs':results})
    finally:
        assert json.loads(lock.read_text())['token']==owner['token'];lock.unlink()
