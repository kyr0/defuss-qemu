"""Bind accepted worker continuation evidence without running another capture."""
import datetime,hashlib,json,os,traceback
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def digest(p):
 h=hashlib.sha256();n=0
 with p.open('rb') as f:
  while b:=f.read(1048576):h.update(b);n+=len(b)
 return {'sha256':h.hexdigest(),'bytes':n}
def main():
 out=ROOT/'artifacts/m3b-worker-suspension-validation-01';out.mkdir();inventory={}
 def check(name,id=None):
  p=ROOT/name;assert p.resolve()==p and p.is_relative_to(ROOT)
  current=digest(p)
  if name in inventory:assert current==inventory[name]
  if id:assert current=={k:id[k] for k in ['sha256','bytes']},name
  inventory[name]=current;return p
 def read(name):return json.loads(check(name).read_bytes())
 def bound(ref):check(ref['path'],ref);return read(ref['path'])
 def write(name,value):
  b=value if isinstance(value,bytes) else (json.dumps(value,indent=2)+'\n').encode()
  with (out/name).open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
  fd=os.open(out,os.O_RDONLY);os.fsync(fd);os.close(fd)
 report={'schema':1,'status':'failed','timingEligible':False,'candidatePromotion':False,'inventory':inventory}
 try:
  review=read('artifacts/m3b-worker-suspension-review-02/review.json');assert review['status']=='passed'
  for p,id in review['inventory'].items():check(p,id)
  for p in ['artifacts/m3b-worker-suspension-fixture-source-01/manifest.json','artifacts/m3b-worker-suspension-review-source-01/manifest.json','artifacts/m3b-worker-suspension-review-v2-source-01/manifest.json']:
   freeze=read(p);assert freeze['status']=='frozen'
   for f in freeze['files']:check(f['path'],f);check(f['archive'],f)
   for name,id in freeze['dependencies'].items():check(name,id)
   if 'tests' in freeze:assert bound(freeze['tests'])['status']=='passed'
   if 'hostTests' in freeze:assert bound(freeze['hostTests'])['status']=='passed'
  observed=read('artifacts/m3b-worker-suspension-observed-binding-01/binding.json');native=bound(observed['native']);post=bound(native['postbuild']);pre=bound(native['prebuild']);build=bound(native['buildReport']);derivation=bound(observed['derivation'])
  assert observed['status']==native['status']==post['status']==pre['status']==build['status']=='passed'
  assert pre['changes']==['tcg/m3s-observer.inc','tcg/wasm64.c'] and pre['originalServiceFunctionUnchanged'] and pre['originalCountdownAndPoolPredicateUnchanged'] and pre['allOtherFilesByteIdentical']
  for f in pre['files']:check(f['path'],f);check(f['archive'],f)
  assert bound(pre['sourceInventory'])==bound(post['sourceInventory']);assert post['sourceStable'] and post['parentSourceStable']
  for p,id in post['inputs'].items():check(p,id)
  for p,id in observed['inputs'].items():check(p,id)
  base=Path(native['buildReport']['path']).parent
  for p,id in build['artifacts'].items():check(str(base/p),id)
  for p,id in observed['artifacts'].items():
   check('artifacts/m3b-worker-suspension-observed-binding-01/'+p,id)
   expected={k:derivation['derived'][k] for k in ['sha256','bytes']} if p.endswith('.js') else build['artifacts'][p]
   assert id==expected
  assert read('artifacts/m3b-worker-suspension-postbuild-01/failure.json')['status']=='failed'
  assert read('artifacts/m3b-worker-suspension-review-01/review.json')['status']=='failed'
  runs={};names='predecodeAccepted formed cleanRetries entryRejects compiledEntries tciEntries BAttempts BRequested servicePaid debtErrors tciTargetReturns backedgeTciReturns IRRejected emittedOwners'.split()
  for arm in ['off','on']:
   r=read('artifacts/m3b-worker-suspension-'+arm+'-01/report.json');assert r['status']=='passed';l=r['lifetime'];observer=l['observer'];assert r['final']['validation']['attempts']==16
   offline=read('artifacts/m3b-worker-suspension-inspection-'+arm+'-01/report.json');assert offline['status']=='passed' and offline['acceptance']
   for p,id in offline['inventory'].items():check(p,id)
   assert read('artifacts/m3b-worker-suspension-execution-'+arm+'-01/browser-cleanup.json')['status']=='passed'
   summary=review['runs'][arm]['summary'];assert summary['qualifyingEpisodes']==l['qualifyingEpisodes'] and summary['observer']==observer
   runs[arm]={'gates':len(r['gates']),'guest':r['final']['validation'],'warmInstalls':l['snapshots'][l['warmSeq']]['counters']['instanceInstalls'],'retired':6000,'finalPool':r['final']['pool'],'observer':{k:observer[k] for k in ['count','completed','events','overflow']},'compiledSentinelEpisodes':len(l['qualifyingEpisodes']),'m3b':dict(zip(names,r['final']['m3bRaw'][16:30]))}
  assert runs['off']['observer']==dict(count=0,completed=0,events=0,overflow=0)
  assert runs['on']['compiledSentinelEpisodes']==4 and runs['on']['observer']==dict(count=4,completed=4,events=16,overflow=11)
  own=str(Path(__file__).relative_to(ROOT));check(own);write('aggregate.py',Path(__file__).read_bytes());check(str((out/'aggregate.py').relative_to(ROOT)))
  report.update(status='passed',runs=runs,scope='Four first qualifying compiled owning-vCPU-worker dispatcher/service continuations with exact captured state, real native unwind/rewind transitions and single service payment. Generated function had returned before suspension. Eleven later candidates exceeded the declared observation bound and were not examined.',remaining=['Suspended-owner invalidation','Complete intermediate architectural state including XSTATE','Natural interrupt recognition and state','Alias SMC and later-block invalidation','Uninstrumented resource and performance acceptance'],sourceScope='Native pre/post receipts explicitly rederived all source files and links; this aggregate rehashes their receipts, runtime and retained evidence, not a third complete native tree reconstruction.',authorship='Root authored checks plus separate JavaScript and Python interpretations; no external independent source audit.',timingRepetitions='Earlier load-affected pilot and exactly two extra sets remain complete and unchanged; no new timing set.')
 except Exception:report['failure']=traceback.format_exc()
 report['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();write('summary.json',report);print(json.dumps({'status':report['status'],'identities':len(inventory),'failure':report.get('failure')}));return report['status']!='passed'
if __name__=='__main__':raise SystemExit(main())
