"""Bind interrupted-call alias writes and all retained source/build/raw evidence."""
import datetime,hashlib,json,os,traceback
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def digest(p):
 h=hashlib.sha256();n=0
 with p.open('rb') as f:
  while b:=f.read(1048576):h.update(b);n+=len(b)
 return {'sha256':h.hexdigest(),'bytes':n}
def main():
 out=ROOT/'artifacts/m3b-signal-alias-v2-validation-01';out.mkdir();inventory={}
 def check(name,id=None):
  p=ROOT/name;assert p.resolve()==p and p.is_relative_to(ROOT)
  if name not in inventory:inventory[name]=digest(p)
  if id:assert inventory[name]=={k:id[k] for k in ('sha256','bytes')},name
  return p
 def read(name):return json.loads(check(name).read_bytes())
 def passed(name):
  data=read(name);assert data['status']=='passed'
  for key in ('inputs','inventory','sources','dependencies'):
   values=data.get(key,{})
   if isinstance(values,dict) and 'path' not in values:
    for p,id in values.items():check(p,id)
  return data
 def write(name,value):
  b=value if isinstance(value,bytes) else (json.dumps(value,indent=2)+'\n').encode()
  with (out/name).open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
  fd=os.open(out,os.O_RDONLY);os.fsync(fd);os.close(fd)
 report=dict(schema=1,status='failed',candidatePromotion=False,timingEligible=False,productionDefaultEnabled=False,inventory=inventory)
 try:
  runtime=passed('artifacts/m3b-bun-code-attribution-validation-01/summary.json');assert runtime['attributionAccepted']
  review=passed('artifacts/m3b-signal-alias-v2-review-02/review.json')
  for name in ('artifacts/m3b-signal-alias-fixture-source-01/manifest.json','artifacts/m3b-signal-alias-v2-fixture-source-01/manifest.json','artifacts/m3b-signal-alias-review-source-01/manifest.json','artifacts/m3b-signal-alias-review-v2-source-01/manifest.json'):
   freeze=read(name);assert freeze['status']=='frozen'
   for f in freeze['files']:check(f['path'],f);check(f['archive'],f)
   for p,id in freeze['dependencies'].items():check(p,id)
   for key in ('tests','hostTests'):
    if key in freeze:ref=freeze[key];check(ref['path'],ref);passed(ref['path'])
  failed=read('artifacts/m3b-signal-alias-off-launch-failure-01/decision.json');assert failed['status']=='reviewed-failed-launch' and not failed['nativeStartupObserved'] and failed['guestSerialBytes']==0
  for p,id in failed['inventory'].items():check(p,id)
  inspector_failure=read('artifacts/m3b-signal-alias-inspector-failure-01/decision.json');assert inspector_failure['status']=='reviewed-inspector-failure' and not inspector_failure['guestCaptureFailure']
  for p,id in inspector_failure['inventory'].items():check(p,id)
  comparison=passed('artifacts/m3b-signal-alias-v2-image-comparison-01/report.json');assert comparison['guestSourcesByteIdentical'] and comparison['allLoadableSegmentsByteIdentical'] and not comparison['guestElfByteIdentical'] and not comparison['initramfsByteIdentical']
  runs={};names='predecodeAccepted formed cleanRetries entryRejects compiledEntries tciEntries BAttempts BRequested servicePaid debtErrors tciTargetReturns backedgeTciReturns IRRejected emittedOwners'.split()
  for arm in ('off','on'):
   r=passed('artifacts/m3b-signal-alias-v2-'+arm+'-01/report.json');summary=review['runs'][arm];assert summary['status']=='passed' and summary['gates']==len(r['gates'])==10 and len(summary['epochs'])==9
   inspection=passed('artifacts/m3b-signal-alias-v2-inspection-'+arm+'-02/report.json');assert inspection['acceptance'] and inspection['lifetime']==r['lifetime']
   assert read('artifacts/m3b-signal-alias-v2-execution-'+arm+'-01/browser-cleanup.json')['status']=='passed'
   assert r['lifetime']['epochs']==summary['epochs'] and r['lifetime']['resets']==[]
   runs[arm]=dict(gates=10,guest=r['final']['validation'],layout=r['layout'],epochs=summary['epochs'],finalPool=r['final']['pool'],m3b=dict(zip(names,r['final']['m3bRaw'][16:30])),signals=[dict(case=g['gate']['case'],pc=g['gate']['sample']['pc'],rflags=g['gate']['sample']['rflags'],remaining=g['gate']['sample']['gpr'][2],savedAccumulator=g['gate']['sample']['gpr'][0],finalAccumulator=g['gate']['observed']['gpr'][0],beforeHex=g['gate']['sample']['beforeRxHex'],afterHex=g['gate']['sample']['afterRxHex']) for g in r['gates'][2:]])
  assert len(runs['on']['epochs'][-1]['target'])==9
  own=str(Path(__file__).relative_to(ROOT));check(own);write('aggregate.py',Path(__file__).read_bytes());check(str((out/'aggregate.py').relative_to(ROOT)))
  report.update(status='passed',runs=runs,scope='Eight actual guest timer-handler alias writes per arm during interrupted calls. Saved integer contexts, exact ADD/SUB mixed results, coherent same-PFN aliases and nine compiled ON generations pass. The generated function exited before Linux delivered its handler; this is not concurrent mutation of an active generated-WASM frame or an Asyncify-suspended owner.',remaining=['Complete intermediate architectural state and XSTATE','Exact natural native B-poll attribution','Invalidation of an Asyncify-suspended owner','Uninstrumented resource and performance acceptance'],authorship='Same root author; separate JavaScript and Python reconstruction, not an external source audit.',timingRepetitions='Earlier load-affected pilot and exactly two requested repetitions remain complete; no new timing set.')
 except Exception:report['failure']=traceback.format_exc()
 report['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();write('summary.json',report);print(json.dumps({'status':report['status'],'identities':len(inventory),'failure':report.get('failure')}));return report['status']!='passed'
if __name__=='__main__':raise SystemExit(main())
