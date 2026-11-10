"""Bind the accepted natural signal evidence and keep earlier failed evidence intact."""
import datetime,hashlib,json,os,traceback
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def digest(p):
 h=hashlib.sha256();n=0
 with p.open('rb') as f:
  while b:=f.read(1048576):h.update(b);n+=len(b)
 return {'sha256':h.hexdigest(),'bytes':n}
def main():
 out=ROOT/'artifacts/m3b-natural-signal-v2-validation-01';out.mkdir();inventory={}
 def check(name,id=None):
  p=ROOT/name;assert p.resolve()==p and p.is_relative_to(ROOT);current=digest(p)
  if name in inventory:assert current==inventory[name]
  if id:assert current=={k:id[k] for k in ('sha256','bytes')},name
  inventory[name]=current;return p
 def read(name):return json.loads(check(name).read_bytes())
 def write(name,value):
  b=value if isinstance(value,bytes) else (json.dumps(value,indent=2)+'\n').encode()
  with (out/name).open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
  fd=os.open(out,os.O_RDONLY);os.fsync(fd);os.close(fd)
 report=dict(schema=1,status='failed',candidatePromotion=False,timingEligible=False,inventory=inventory)
 try:
  review=read('artifacts/m3b-natural-signal-v2-review-01/review.json');assert review['status']=='passed'
  for p,id in review['inventory'].items():check(p,id)
  for p in ('artifacts/m3b-natural-signal-fixture-source-01/manifest.json','artifacts/m3b-natural-signal-v2-fixture-source-01/manifest.json','artifacts/m3b-natural-signal-review-source-01/manifest.json'):
   freeze=read(p);assert freeze['status']=='frozen'
   for f in freeze['files']:check(f['path'],f);check(f['archive'],f)
   for name,id in freeze['dependencies'].items():check(name,id)
   for key in ('tests','hostTests'):
    if key in freeze:ref=freeze[key];check(ref['path'],ref);assert read(ref['path'])['status']=='passed'
  failed=read('artifacts/m3b-natural-signal-off-failure-01/decision.json');assert failed['status']=='reviewed-failed-capture'
  runs={};names='predecodeAccepted formed cleanRetries entryRejects compiledEntries tciEntries BAttempts BRequested servicePaid debtErrors tciTargetReturns backedgeTciReturns IRRejected emittedOwners'.split()
  for arm in ('off','on'):
   r=read('artifacts/m3b-natural-signal-v2-'+arm+'-01/report.json');assert r['status']=='passed';summary=review['runs'][arm];assert summary['status']=='passed' and summary['gates']==len(r['gates'])==10
   inspection=read('artifacts/m3b-natural-signal-v2-inspection-'+arm+'-01/report.json');assert inspection['status']=='passed' and inspection['acceptance']
   assert read('artifacts/m3b-natural-signal-v2-execution-'+arm+'-01/browser-cleanup.json')['status']=='passed'
   epochs=[]
   for js,py in zip(r['lifetime']['epochs'],summary['epochs']):
    assert js['owner']['raw']==py['tuple'];epochs.append({k:js[k] for k in ('seq','epoch','compiled','tci','BAttempts','servicePaid','storage')}|{'owner':{k:js['owner'][k] for k in ('pc','owner','generation','code','page0','fused')}})
   assert len(epochs)==9
   runs[arm]=dict(gates=10,guest=r['final']['validation'],layout=r['layout'],epochs=epochs,finalPool=r['final']['pool'],m3b=dict(zip(names,r['final']['m3bRaw'][16:30])),signals=[dict(case=g['gate']['case'],pc=g['gate']['sample']['pc'],rflags=g['gate']['sample']['rflags'],remaining=g['gate']['sample']['gpr'][2]) for g in r['gates'][2:]])
  own=str(Path(__file__).relative_to(ROOT));check(own);write('aggregate.py',Path(__file__).read_bytes());check(str((out/'aggregate.py').relative_to(ROOT)))
  report.update(status='passed',runs=runs,scope='Eight actual single-shot Linux virtual timer signals per arm. All sixteen saved GPRs, exact instruction-boundary progress and RF-inclusive flags pass, followed by correct full integer return state. Every fixed call has positive compiled exact-PC exposure with a stable warmed owner. Native dispatch tier at each delivery is not attributed.',remaining=['Exact natural native B-boundary attribution','FP/XSTATE and complete native intermediate state','Active-body later-block SMC and suspended-owner invalidation','Uninstrumented resource and performance acceptance'],authorship='Same root author; JavaScript and separate Python reconstruction, not an external source audit.',timingRepetitions='Earlier load-affected pilot and exactly two requested repetitions remain complete; no new timing set.')
 except Exception:report['failure']=traceback.format_exc()
 report['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();write('summary.json',report);print(json.dumps({'status':report['status'],'identities':len(inventory),'failure':report.get('failure')}));return report['status']!='passed'
if __name__=='__main__':raise SystemExit(main())
