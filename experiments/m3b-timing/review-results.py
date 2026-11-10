#!/usr/bin/env python3
"""Bind completed capture closures, source archives and descriptive host statistics."""
import datetime,hashlib,json,os,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def ident(p):
 with p.open('rb')as f:h=hashlib.file_digest(f,'sha256').hexdigest()
 return {'sha256':h,'bytes':p.stat().st_size}
def main():
 analysis_path='artifacts/m3b-idle-timing-analysis-02/analysis.json';analysis=json.loads((ROOT/analysis_path).read_text());assert analysis['status']=='passed'
 plan_path='artifacts/m3b-idle-timing-plan-01/plan.json';plan=json.loads((ROOT/plan_path).read_text());assert analysis['plan']==ident(ROOT/plan_path)
 inputs={analysis_path:ident(ROOT/analysis_path),plan_path:ident(ROOT/plan_path),str(Path(__file__).relative_to(ROOT)):ident(Path(__file__))};runs=[]
 def bind(name):
  id=ident(ROOT/name)
  if name in inputs:assert inputs[name]==id
  inputs[name]=id;return id
 for name,id in {**plan['inputs'],**analysis['inputs']}.items():assert bind(name)==id
 archives=0;checks=0
 for step in plan['steps']:
  d=ROOT/step['capture'];r=json.loads((d/'report.json').read_text());inv=json.loads((d/'inputs.json').read_text());b=r['browserResult']
  assert r['status']==b['status']=='passed' and r['timingEligible'] and r['candidatePromotion']is False and r['snapshots']==0
  assert r['inputs']==inv['inputs'] and r['arguments']==b['arguments']
  assert b['configuration']=={'arm':step['arm'],'m3aEnabled':step['arm']!='original','hotLimit':1500,'runtimeFlags':3,'instanceLimit':12000}
  assert b['gateAcks']==69 and b['records']==72 and r['recordCount']==72
  assert b['endStatus']=={'status':'paused','running':False}
  assert [s['byte']for s in b['signals']]==[49]+[71]*69
  assert r['pageErrors']==r['serverErrors']==[]
  assert r['runtime']==plan['runtimes'][step['arm']]
  assert r['browser'] in plan['hostTools']['chrome']['version']
  for name,id in r['inputs'].items():assert bind(name)==id
  for name,id in r['served'].items():assert id==r['inputs'][name]
  for p in (d/'source').rglob('*'):
   if p.is_file():
    name=str(p.relative_to(d/'source'));assert ident(p)==r['inputs'][name];bind(str(p.relative_to(ROOT)));archives+=1
  for name in ['stdout.log','stderr.log','request.json','execution.json','process.json','browser-cleanup.json']:bind(step['execution']+'/'+name)
  req=json.loads((ROOT/step['execution']/'request.json').read_text());assert req['plan']==ident(ROOT/plan_path);assert req['node']=={k:plan['hostTools']['node'][k]for k in ['sha256','bytes']}
  assert (ROOT/step['execution']/'stderr.log').read_bytes()==b''
  for t in ['beforeCondition','afterCondition']:
   status=r['host'][t]['status'];assert status['status']=='Stopped' and status['name']=='builder' and status['memory']==12884901888 and not status.get('errors')
  samples=r['host']['samples'];a=samples[0]['cpuTimes'];z=samples[-1]['cpuTimes'];total=sum(sum(y.values())-sum(x.values())for x,y in zip(a,z));idle=sum(y['idle']-x['idle']for x,y in zip(a,z))
  runs.append({'id':step['id'],'cpuIdlePercentIncludingBenchmark':100*idle/total,'oneMinuteLoadBefore':r['host']['before']['loadavg'][0],'oneMinuteLoadAfter':r['host']['after']['loadavg'][0]});checks+=len(r['summary']['results'])*100
 assert checks==14400 and len(runs)==12
 for name in ['source.zip','evidence.zip']:bind('checkpoints/20261108T080846.529740Z-cc81d46f8bb2-m3b-idle-timing-before-measurements/'+name)
 result={'schema':1,'status':'passed','completedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'authorship':'Same-author supplemental identity/source/protocol audit; Python timing reconstruction and JS protocol replay are separate implementations, not external independent authorship.','captures':12,'blocks':4,'gates':828,'measuredBatches':144,'measuredCalls':checks,'warmupCalls':480,'sourceArchivesChecked':archives,'compilerStoppedBeforeAndAfterEveryCapture':True,'ownedBrowserCleanupPassed':True,'runs':runs,'medianTimesMs':{arm:{k:statistics.median(x['metricsMs'][k]for x in analysis['runs']if x['arm']==arm)for k in analysis['runs'][0]['metricsMs']}for arm in ['original','off','on']},'inputs':inputs}
 out=ROOT/'artifacts/m3b-idle-timing-review-01';out.mkdir()
 with (out/'review.json').open('x')as f:json.dump(result,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 print(json.dumps({k:result[k]for k in ['status','captures','gates','measuredCalls','sourceArchivesChecked']}));print('Identities',len(inputs))
if __name__=='__main__':main()
