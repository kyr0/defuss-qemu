"""Retain reviewer corruption tests and freeze their complete source imports."""
import ast,datetime,hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent
def ident(p):
 b=p.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def write(p,value):
 p.parent.mkdir(parents=True,exist_ok=True);b=value if isinstance(value,bytes) else (json.dumps(value,indent=2)+'\n').encode()
 with p.open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 fd=os.open(p.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
def main():
 tests=ROOT/'artifacts/m3b-signal-alias-review-tests-01';tests.mkdir();out=ROOT/'artifacts/m3b-signal-alias-review-source-01'
 files=sorted(HERE.glob('*.py'));assert len(files)==4
 before={str(p.relative_to(ROOT)):ident(p) for p in files}
 command=[sys.executable,'-B',str(HERE/'test_review.py')];r=subprocess.run(command,cwd=ROOT,capture_output=True,timeout=60)
 report={'schema':1,'status':'passed' if r.returncode==0 else 'failed','argv':command,'returncode':r.returncode,'stdout':r.stdout.decode(),'stderr':r.stderr.decode(),'sources':before,'completedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 for p in files:ast.parse(p.read_bytes())
 report['sourceStable']=before=={str(p.relative_to(ROOT)):ident(p) for p in files};assert report['sourceStable'];write(tests/'report.json',report);assert r.returncode==0
 out.mkdir();rows=[]
 for p in files:
  name=str(p.relative_to(ROOT));archive=out/'source'/name;write(archive,p.read_bytes());rows.append({'path':name,'archive':str(archive.relative_to(ROOT)),**ident(p)})
 deps=['experiments/m3b-fused-pressure-review/'+n for n in ('baseline.py','semantics.py','trace.py')]+['experiments/m3b-alias-smc-review/alias.py','experiments/m3b-code-attribution-review/codebank.py','artifacts/m3b-signal-alias-v2-fixture-source-01/manifest.json','artifacts/m3b-signal-alias-off-launch-failure-01/decision.json','artifacts/m3b-signal-alias-v2-image-comparison-01/report.json','experiments/m3b-signal-alias/compare-images.py']
 write(out/'manifest.json',{'schema':1,'status':'frozen','files':rows,'dependencies':{n:ident(ROOT/n) for n in deps},'tests':{'path':str((tests/'report.json').relative_to(ROOT)),**ident(tests/'report.json')},'authorship':'Root separate-language reconstruction using retained Python helpers; no external independent audit.'})
 print(json.dumps({'status':'frozen','files':len(rows),'tests':6,'dependencies':len(deps)}))
if __name__=='__main__':main()
