"""Freeze exact fixture sources and their import/runtime/build evidence closure."""
import datetime,hashlib,json,os,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent
def ident(p):
 b=p.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def write(p,b):
 p.parent.mkdir(parents=True,exist_ok=True)
 if not isinstance(b,bytes):b=(json.dumps(b,indent=2)+'\n').encode()
 with p.open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 fd=os.open(p.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
def main():
 out=ROOT/'artifacts/m3b-signal-alias-v2-fixture-source-01';out.mkdir()
 prepath='artifacts/m3b-signal-alias-v2-preflight-01/report.json';testpath='artifacts/m3b-signal-alias-v2-fixture-host-tests-01/report.json'
 pre=json.loads((ROOT/prepath).read_bytes());test=json.loads((ROOT/testpath).read_bytes());assert pre['status']==test['status']=='passed' and test['sourceStable']
 names=sorted(str(p.relative_to(ROOT)) for p in HERE.iterdir() if p.is_file());assert set(names)==set(test['sources'])
 dependencies=dict(pre['inputs']);dependencies[prepath]=ident(ROOT/prepath);dependencies[testpath]=ident(ROOT/testpath)
 # Every literal relative import in executable fixture/dependency modules.
 queue=list(names)+['experiments/m3b-signal-alias/V2.md','artifacts/m3b-signal-alias-off-launch-failure-01/decision.json','artifacts/m3b-signal-alias-fixture-source-01/manifest.json','experiments/m3b-signal-alias/DESIGN.md','artifacts/m3b-bun-code-attribution-validation-01/summary.json','benchmarks/harness/m2-sustained-v2/host-condition.mjs','scripts/with-tmp.py','experiments/m3b-natural-signal/DESIGN.md','experiments/m3b-natural-signal/V2.md','artifacts/m3b-natural-signal-off-failure-01/decision.json','artifacts/m3b-natural-signal-fixture-source-01/manifest.json','artifacts/m3b-context-v2-source-01/source/target/i386/tcg/seg_helper.c','artifacts/m3b-context-v2-source-01/source/target/i386/tcg/translate.c','tests/m3b-fused-pressure/fixture.c','tests/m3b-fused-pressure/fixture.S','package.json','package-lock.json','node_modules/playwright/package.json','node_modules/playwright-core/package.json'];seen=set();edges=[]
 while queue:
  name=queue.pop()
  if name in seen:continue
  seen.add(name);p=ROOT/name;assert p.is_file();identity=ident(p)
  if name not in names:
   if name in dependencies:assert dependencies[name]==identity
   dependencies[name]=identity
  if p.suffix not in ('.mjs','.js'):continue
  for target in re.findall(r'(?:from\s*|import\s*\()\s*[\'\"]([^\'\"]+)[\'\"]',p.read_text()):
   if not target.startswith(('.', '/')):continue
   q=(p.parent/target if target.startswith('.') else ROOT/target[1:]).resolve();assert q.is_relative_to(ROOT) and q.is_file(),(name,target)
   key=str(q.relative_to(ROOT));edges.append({'source':name,'specifier':target,'target':key});queue.append(key)
 rows=[]
 for name in names:
  p=ROOT/name;assert ident(p)==test['sources'][name];archive=out/'source'/name;write(archive,p.read_bytes());rows.append({'path':name,'archive':str(archive.relative_to(ROOT)),**ident(p)})
 for name,id in dependencies.items():assert ident(ROOT/name)==id,name
 write(out/'manifest.json',{'schema':1,'kind':'m3b-signal-alias-v2-fixture-freeze-v1','status':'frozen','timingEligible':False,'binding':pre['binding'],'files':rows,'dependencies':dependencies,'imports':edges,'hostTests':{'path':testpath,**ident(ROOT/testpath)},'createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Ten gates, one warm call and eight natural timer-handler alias writes with exact mixed-operation resume, one OFF and one ON; no automatic retries or timing claim. Same-agent provenance, no external source audit.'})
 print(json.dumps({'status':'frozen','files':len(rows),'dependencies':len(dependencies)}))
if __name__=='__main__':main()
