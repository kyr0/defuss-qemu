#!/usr/bin/env python3
"""Reconstruct frozen XSTATE captures without importing a JavaScript oracle."""
import argparse,datetime,hashlib,importlib.util,json,os,re,traceback
from pathlib import Path
from xstate import state as xstate
ROOT=Path(__file__).resolve().parents[2]
LEGACY='experiments/m3b-context-recovery-review-v2/semantics.py'
spec=importlib.util.spec_from_file_location('legacy_fixture',ROOT/LEGACY);s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
need=s.need;eq=s.eq

def digest(p):
 h=hashlib.sha256();size=0
 with p.open('rb') as f:
  while b:=f.read(1048576):h.update(b);size+=len(b)
 return {'sha256':h.hexdigest(),'bytes':size}

def native(row,enabled,initial=False):
 eq(row['status'],{'running':False,'status':'prelaunch' if initial else 'paused'},'Stopped state')
 a=s.bank(row['m3a']['raw'],96);b=s.bank(row['m3b']['raw'],128)
 eq(a[:11],[0x4d335231,1,1,0 if initial else 1,0,176,88,24,4,64,8],'M3a layout');s.zero(a[13:16]+a[37:40]+a[49:64])
 ac=dict(zip(s.M3A,a[16:37]));eq(ac,row['m3a']['counters'],'Decoded M3a counters')
 need(ac['compiledAttempts']==ac['selectedEntries']+ac['fallbackEntries']+ac['invalidRedispatches'] and ac['fallbackEntries']==sum(a[40:49]),'M3a attempt partition');s.zero([ac[n] for n in s.M3A[14:]])
 eq(b[:11],[0x4d334231,1,63 if enabled else 62,0,0,1,32,128,12,32,20],'M3b layout');eq(b[12],4,'Slots');s.zero(b[13:16]+b[30:32]+b[112:]);bc=dict(zip(s.M3B,b[16:30]));eq(bc,row['m3b']['counters'],'Decoded M3b counters')
 need(bc['BRequested']<=bc['BAttempts']==bc['servicePaid'],'Service partition');s.zero([bc['debtErrors'],bc['entryRejects']])
 if not enabled or initial:s.zero(list(bc.values()))
 if initial:s.zero(list(ac.values()))
 eq(a[11],b[11],'Matching watch epochs');eq(a[11],row['m3a']['watchEpoch'],'M3a normalized epoch');eq(b[11],row['m3b']['watchEpoch'],'M3b normalized epoch')
 aw=[];bw=[]
 for slot in range(4):
  at=64+8*slot;need(a[at+7] in (0,1),'Watch enabled');av=dict(begin=s.pair(a,at),end=s.pair(a,at+2),selected=a[at+4],last=s.pair(a,at+5),enabled=bool(a[at+7]));aw.append(av)
  eq(row['m3a']['watches'][slot],dict(slot=slot,begin=hex(av['begin']),end=hex(av['end']),selectedEntries=av['selected'],lastSelectedPC=hex(av['last']),enabled=av['enabled']),'Normalized ordinary watch')
  at=32+slot*20;v=dict(zip(s.WATCH,b[at+4:at+15]));v.update(begin=s.pair(b,at),end=s.pair(b,at+2),last=s.pair(b,at+16),generation=s.pair(b,at+18));bw.append(v);eq(b[at+15],0,'Reserved watch')
  need(v['BRequested']<=v['BAttempts']==v['servicePaid'] and not v['entryRejects'],'Watched service');need(all(v[k]<=bc[k] for k in s.WATCH),'Watch below lifetime')
  if v['compiledEntries']+v['tciEntries']:need(v['begin']<=v['last']<v['end'] and v['generation']>0,'Selected owner')
  else:s.zero([v['last'],v['generation']])
  if not enabled or v['begin']==v['end']:s.zero([v[k] for k in s.WATCH])
  eq(row['m3b']['watches'][slot],dict(slot=slot,begin=hex(v['begin']),end=hex(v['end']),lastSelectedPC=hex(v['last']),lastGeneration=hex(v['generation']),**{k:v[k] for k in s.WATCH}),'Normalized fused watch')
 need(row['pool']['limit']==12000 and s.integer(row['pool']['charged'],12000),'Unchanged hard cap')
 return dict(a=ac,b=bc,aw=aw,bw=bw,epoch=a[11])

def ranges(n,p,epoch,clear):
 eq(n['epoch'],epoch,'Expected watch epoch')
 for slot in range(4):
  start=int(p['a' if slot==0 else 'b'],16) if p and slot<2 else 0
  for w in (n['aw'][slot],n['bw'][slot]):eq([w['begin'],w['end']],[start,start+1 if start else 0],'Exact watched PC')
  a,b=n['aw'][slot],n['bw'][slot];eq(a['enabled'],bool(start),'Enabled watch');eq(a['last'],start if a['selected'] else 0,'Selected ordinary PC')
  if clear:s.zero([a['selected'],b['last'],b['generation']]+[b[k] for k in s.WATCH])

def reconstruct(rows,enabled,layout,configuration):
 wanted,passed=s.reference();s.layout_check(layout);need(len(rows)==138,'Header/startup/45 gate-config-ack/final records')
 gate_rows=[];states=[];previous=None;epoch=0;current=None;serial='';phase='header';seq=0;windows=[]
 for i,entry in enumerate(rows):
  eq(entry['record'],i,'Journal sequence');eq(entry['schema'],1,'Journal schema');r=entry['observation'];event=r['event'];need(event in ('header','startup','gate','configured','ack','complete'),'Accepted events')
  if event=='header':eq(i,0,'Header first');eq(r['enabled'],enabled,'Header mode');phase='startup';continue
  need(type(r['serialChunk']) is str,'Raw serial chunk');serial+=r['serialChunk']
  if event=='ack':
   eq(phase,'ack','ACK ordering');eq(r['seq'],seq,'ACK seq');eq(r['watchEpoch'],{'m3a':epoch,'m3b':epoch},'ACK epochs');seq+=1;phase='complete' if seq==45 else 'gate';continue
  n=native(r,enabled,event=='startup')
  if previous:
   for family in ('a','b'):need(all(n[family][k]>=v for k,v in previous[family].items()),'Cumulative native counters')
  previous=n
  if event=='startup':eq(phase,'startup','Startup ordering');ranges(n,None,0,True);phase='gate'
  elif event=='gate':
   eq(phase,'gate','Gate ordering');g=r['gate'];eq(g,wanted[seq],'Independent guest arithmetic/digest');eq(r['xstateCaps'],configuration,'Stable caps');eq(r['xstateFeatures'],{'xcr0Low':configuration['mask'],'xcr0High':0},'Raw XCR0');states.append(xstate(r['xstate'],configuration,g));gate_rows.append(r)
   if not seq:eq(r['layout'],layout,'Guest ELF layout');ranges(n,None,0,True)
   else:
    eq(current,g['program'],'Selected program');ranges(n,layout['programs'][current],epoch,False);s.basic_window(n,layout['programs'][current],g,enabled)
    if enabled and layout['programs'][current]['expectation']=='fused' and g['phase']!='warm':windows.append({'seq':seq,'compiledAttempts':n['bw'][0]['compiledEntries'],'BAttempts':n['bw'][0]['BAttempts'],'servicePaid':n['bw'][0]['servicePaid']})
   phase='configured'
  elif event=='configured':
   eq(phase,'configured','Watch reset ordering');eq(r['seq'],seq,'Reset seq');g=wanted[seq];nxt=0 if not seq else g['program']+1 if g['phase']=='direct-b' else g['program'];current=nxt if nxt<11 else None;eq(r['program'],current,'Next program');epoch+=4;ranges(n,layout['programs'][current] if current is not None else None,epoch,True);phase='ack'
  else:eq(phase,'complete','Final ordering');eq(r['validation'],passed,'PASS');ranges(n,None,epoch,True);phase='done'
 eq(phase,'done','Complete state machine');need(len(windows)==(12 if enabled else 0),'Positive enabled measured windows')
 records=[]
 for line in serial.splitlines():
  need(not any(t in line for t in ('M3B_FAIL:','Kernel panic','BUN_APP_FAILURE')),'No guest failure')
  if line.startswith(('M3B_','M3X_')):
   kind,payload=line.split(':',1);records.append((kind,json.loads(payload)))
 expected=[('M3X_FEATURES',{'xcr0Low':configuration['mask'],'xcr0High':0}),('M3X_CAPS',configuration),('M3B_LAYOUT',layout)]
 for row in gate_rows:expected += [('M3X_STATE',row['xstate']),('M3B_GATE',row['gate'])]
 expected.append(('M3B_PASS',passed));eq(records,expected,'Complete raw guest protocol')
 return dict(gates=45,invocations=47168,checks=passed['checks'],digest=passed['digest'],caps=configuration,states=states,positiveWindows=windows,lifetime=previous),serial

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args();out=ROOT/args.output;need(out.resolve().is_relative_to(ROOT/'artifacts'),'Artifact output');out.mkdir();inventory={}
 def check(name,expected=None):
  path=ROOT/name;need(path.resolve()==path and path.is_relative_to(ROOT),'Canonical input')
  if name not in inventory:inventory[name]=digest(path)
  if expected:eq(inventory[name],{k:expected[k] for k in ('sha256','bytes')},'Identity '+name)
  return path
 def read(name):return json.loads(check(name).read_bytes())
 report=dict(schema=1,status='failed',timingEligible=False,candidatePromotion=False,inventory=inventory,runs={},authorship='Same root agent; separate Python reconstruction, not an external independent source audit.')
 try:
  for p in sorted(Path(__file__).parent.glob('*.py')):check(str(p.relative_to(ROOT)))
  check(LEGACY)
  freeze=read('artifacts/m3b-xstate-v2-source-01/manifest.json');eq(freeze['status'],'frozen','Frozen source')
  for f in freeze['files']:check(f['path'],f);check(f['archive'],f)
  for name,id in freeze['dependencies'].items():check(name,id)
  for key in ('hostTests','runtimeAndBuildPreflight'):
   ref=freeze[key];check(ref['path'],ref);eq(read(ref['path'])['status'],'passed','Preflight/tests')
  for arm,enabled in [('off',False),('on',True)]:
   base='artifacts/m3b-xstate-v2-'+arm+'-01/';r=read(base+'report.json');eq(r['status'],'passed','Actual capture');eq(r['enabled'],enabled,'Arm');eq(r['timingEligible'],False,'Diagnostic');eq(r['protocol'],'defuss-m3b-xstate-fixture-v2','Protocol');eq(r['inputRecheck'],[],'Stable capture inputs')
   for name,id in r['inputs'].items():check(name,id)
   for f in freeze['files']:
    eq(r['inputs'][f['path']],{k:f[k] for k in ('sha256','bytes')},'Captured frozen source')
   for name,id in r['served'].items():eq(id,r['inputs'][name],'Served bytes')
   binding=read('artifacts/m3b-context-v2-binding-01/binding.json');eq(inventory['artifacts/m3b-context-v2-binding-01/binding.json']['sha256'],'fde6abcfa0cae40e8be1fed679f4e54783325ad16d8d88b9a9a0a517e35c4c22','Original runtime pin');eq(r['runtimeProvenance']['binding'],binding,'Actual bound native runtime')
   build=read('artifacts/m3b-xstate-v2-fixture-01/build-report.json');eq(build['status'],'passed','Actual image build');eq([{k:p[k] for k in ('name','a','b','back','side','end','ownerBytes','codeHex')} for p in r['layout']['programs']],[{k:p[k] for k in ('name','a','b','back','side','end','ownerBytes','codeHex')} for p in build['layout']],'Actual ELF guest layout')
   raw=check(base+'progress.jsonl',r['artifacts']['progress']).read_bytes();need(raw.endswith(b'\n'),'Complete journal');rows=[json.loads(x) for x in raw.splitlines()];eq(rows[0]['observation']['inputs'],r['inputs'],'Prelaunch inventory')
   summary,serial=reconstruct(rows,enabled,r['layout'],r['xstateCaps']);eq(summary['states'],r['xstateObservations'],'Host/Python state agreement');eq(serial,check(base+'serial.log',r['artifacts']['serial']).read_bytes().decode(),'Exact serial bytes')
   execution='artifacts/m3b-xstate-v2-execution-'+arm+'-01/';result=read(execution+'execution.json');request=read(execution+'request.json');need(result['returncode']==0 and not result['timedOut'] and result['error'] is None and result['cleanupError'] is None,'Controller completion');eq(result['request'],request,'Retained request');need(request['outerDeadlineSeconds']==2100 and r['timeoutMs']==1800000,'Finite deadlines');eq(read(execution+'browser-cleanup.json')['status'],'passed','Owned browser cleanup')
   controller=check('tests/m3b-xstate-v2/controller.py');check(execution+'controller.py',digest(controller));eq(request['controllerSha256'],digest(controller)['sha256'],'Controller identity');eq(request['argv'][1:],['tests/m3b-xstate-v2/run.mjs','--binding','artifacts/m3b-context-v2-binding-01/binding.json','--fixture','artifacts/m3b-xstate-v2-fixture-01','--enabled','1' if enabled else '0','--timeout','1800000','--output',base[:-1]],'Exact planned command');need(Path(request['scratch']).resolve().is_relative_to(ROOT/'tmp'),'Project scratch')
   for suffix in ('Before','After'):eq(r['host'+suffix]['status']['status'],'Stopped','Builder stopped')
   report['runs'][arm]=summary
  eq(report['runs']['off']['caps'],report['runs']['on']['caps'],'Matched user state profiles');eq(report['runs']['off']['digest'],report['runs']['on']['digest'],'Matched final arithmetic');report['status']='passed'
 except Exception:report['failure']=traceback.format_exc()
 report['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (out/'review.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 print(json.dumps({'status':report['status'],'identities':len(inventory),'failure':report.get('failure')}));return report['status']!='passed'
if __name__=='__main__':raise SystemExit(main())
