#!/usr/bin/env python3
"""Bind retained XSTATE source, failed predecessor and accepted OFF/ON evidence."""
import argparse,datetime,hashlib,json,os,traceback
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def identity(p):
 h=hashlib.sha256();size=0
 with p.open('rb') as f:
  while b:=f.read(1048576):h.update(b);size+=len(b)
 return {'sha256':h.hexdigest(),'bytes':size}
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args();out=ROOT/a.output;assert out.resolve().is_relative_to(ROOT/'artifacts');out.mkdir();inventory={};inputs={}
 def check(n,expected=None):
  path=ROOT/n;assert path.resolve()==path and path.is_relative_to(ROOT)
  if n not in inventory:inventory[n]=identity(path)
  if expected:assert inventory[n]=={k:expected[k] for k in ('sha256','bytes')},n
  return path
 def read(n):
  d=json.loads(check(n).read_bytes());inputs[n]=inventory[n];return d
 def accepted(n):
  d=read(n);assert d['status']=='passed',n
  for key in ('inputs','inventory','sources'):
   for name,id in d.get(key,{}).items():check(name,id)
  return d
 def freeze(n):
  d=read(n);assert d['status']=='frozen'
  for f in d['files']:check(f['path'],f);check(f['archive'],f)
  for name,id in d['dependencies'].items():check(name,id)
  t=d['hostTests'];check(t['path'],t);accepted(t['path'])
  return d
 report={'schema':1,'status':'failed','inputs':inputs,'timingEligible':False,'candidatePromotion':False,'productionDefaultEnabled':False,'authorship':'Same root agent; separate JavaScript and Python raw-data reconstruction, no external independent source audit.'}
 try:
  source=str(Path(__file__).relative_to(ROOT));check(source);inputs[source]=inventory[source]
  captureFreeze=freeze('artifacts/m3b-xstate-v2-source-01/manifest.json');freeze('artifacts/m3b-xstate-v2-review-source-01/manifest.json')
  preflight=captureFreeze['runtimeAndBuildPreflight'];check(preflight['path'],preflight);accepted(preflight['path'])
  failed=read('artifacts/m3b-xstate-off-failure-01/review.json');assert failed['status']=='reviewed-failed-capture' and failed['capturePassed'] is False and failed['gates']==0
  for name,id in failed['inputs'].items():check(name,id)
  review=accepted('artifacts/m3b-xstate-v2-review-01/review.json');report['runs']={}
  for arm in ('off','on'):
   inspection=accepted('artifacts/m3b-xstate-v2-inspection-'+arm+'-01/review.json');r=accepted('artifacts/m3b-xstate-v2-'+arm+'-01/report.json');summary=review['runs'][arm]
   for k in ('gates','invocations','checks','digest','caps'):assert inspection[k]==summary[k],k
   assert r['xstateCaps']==summary['caps'] and r['final']['validation']['digest']==summary['digest'];assert len(summary['states'])==45 and summary['invocations']==47168 and summary['checks']==943364
   assert r['timingEligible'] is False and r['timeoutMs']==1800000
   execution='artifacts/m3b-xstate-v2-execution-'+arm+'-01/';e=read(execution+'execution.json');request=read(execution+'request.json');cleanup=accepted(execution+'browser-cleanup.json')
   assert e['returncode']==0 and not e['timedOut'] and e['request']==request and not cleanup['remainingProfileProcesses'] and cleanup['ownedScratch']==request['scratch']
   assert (ROOT/request['scratch']).resolve().is_relative_to(ROOT/'tmp')
   report['runs'][arm]={'gates':45,'legacyChecks':943364,'invocations':47168,'actualBeforeAfterComparisons':94336,'rawNoninitialStateImages':176,'digest':summary['digest'],'caps':summary['caps'],'positiveMeasuredWindows':len(summary['positiveWindows']),'fusion':r['final']['m3b']['counters'],'finalPool':r['final']['pool']}
  assert report['runs']['off']['caps']==report['runs']['on']['caps'];assert report['runs']['on']['positiveMeasuredWindows']==12
  report.update(status='passed',scope='Return-state preservation of all enabled user XSAVE components in observed XCR0=31, with every original GPR/user-RFLAGS check and positive compiled fused exposure. No complete intermediate native state, supervisor XSTATE, natural interrupt, Asyncify/SMC, retired-body or performance claim.',observedComponents=['x87','SSE including MXCSR and all sixteen XMM registers','All sixteen upper YMM halves','All four MPX bounds and BNDCSR with bounds checking disabled'],pkruGuestEnabled=False,pkruLiveValidation=False,pythonReconstructionIdentities=len(review['inventory']),priorRejectedCaptureRetained=True,remainingGates=['Complete intermediate native architectural state','Natural interrupt and alias-SMC behavior','Owning-worker Asyncify continuation and suspended-owner invalidation','Uninstrumented resource/performance acceptance'])
 except Exception:report['failure']=traceback.format_exc()
 report['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();report['verifiedIdentities']=len(inventory)
 def write(name,b):
  with (out/name).open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 write('inventory.json',(json.dumps(inventory,indent=2)+'\n').encode());report['inventory']={'path':str((out/'inventory.json').relative_to(ROOT)),**identity(out/'inventory.json')};write('summary.json',(json.dumps(report,indent=2)+'\n').encode());write('aggregate.py',Path(__file__).read_bytes())
 print(json.dumps({'status':report['status'],'identities':len(inventory),'failure':report.get('failure')}));return report['status']!='passed'
if __name__=='__main__':raise SystemExit(main())
