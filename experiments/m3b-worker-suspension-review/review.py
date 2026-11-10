"""Separate Python replay of actual worker suspension captures; no VM actions."""
import argparse,datetime,json,re,sys,traceback
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent
sys.path.insert(1,str(ROOT/'experiments/m3b-fused-pressure-review'))
import baseline as base
from semantics import need,eq,number
from pressure import Lifetime,SETTINGS,completion
SOURCE='artifacts/m3b-worker-suspension-fixture-source-01/manifest.json'
BINDING='artifacts/m3b-worker-suspension-observed-binding-01/binding.json'
PROTOCOL='defuss-m3b-worker-suspension-v1'
LIMITS=dict(chunk=65536,pending=64*1024*1024,trace=0,serial=4*1024*1024,stderr=1024*1024,records=640)

def serial_records(raw):
 text=raw.decode('utf-8').replace('\r','');need(not re.search(r'M3S_PRESSURE_FAIL:|BUN_APP_FAILURE|Kernel panic',text),'Guest fatal marker');records=[]
 for line in text.splitlines():
  if line.startswith('M3S_PRESSURE_'):
   m=re.fullmatch(r'M3S_PRESSURE_(LAYOUT|GATE|PASS):(.*)',line);need(m is not None,'Unknown guest record');records.append((m[1],base.loads(m[2])))
 return records

def reconstruct(r,rows,raw,prefixes,elf):
 need(4<len(rows)<=640,'Bounded complete journal');header=rows[0]
 eq([header['event'],header['protocol'],header['enabled']],['header',PROTOCOL,r['enabled']],'Header')
 for key in ('inputs','limits','settings','timeoutMs','sourceProof','fixtureProof','hostCondition','hostBefore','chrome','arguments'):eq(header[key],r[key],'Prelaunch header '+key)
 eq(header['binding'],r['runtimeProof']['binding'],'Prelaunch native binding');oracle=Lifetime(r['enabled'],elf);last_chunks=0;gates=[]
 for row in rows[1:]:
  prefix=base.queue(row['streams'],prefixes);need(row['streams']['chunks']>=last_chunks,'Monotonic durable prefix');last_chunks=row['streams']['chunks']
  oracle.accept(row)
  if row['event']=='gate':
   seq=row['seq'];gates.append(row);actual=r['gates'][seq];eq({k:v for k,v in actual.items() if k not in ('ackHostMs','contHostMs')},row,'Raw gate/report equality')
   eq(row['signalHostMs'],r['signals'][seq],'Actual COM1');need(number(actual['ackHostMs']) and number(actual['contHostMs']) and row['readHostMs']<=actual['ackHostMs']<=actual['contHostMs'],'ACK after raw durable observation')
   rec=serial_records(raw['serial'][:prefix['serial']]);eq(rec,[('LAYOUT',r['layout'])]+[('GATE',g['gate']) for g in gates],'Every guest gate bytes durable before ACK')
  elif row['event']=='ack':eq(row['hostMs'],r['gates'][row['seq']]['ackHostMs'],'ACK clock')
 eq(oracle.phase,'done','Complete state machine');eq(oracle.status,r['status'],'Python result');need(oracle.status in ('passed','incomplete'),'Acceptable complete outcome')
 eq(len(rows),2*oracle.seq+4,'Exactly one watch setup');eq(len(gates),oracle.seq,'Gate count');eq(len(r['signals']),oracle.seq,'Signal count')
 eq(serial_records(raw['serial']),[('LAYOUT',r['layout'])]+[('GATE',g) for g in oracle.gates]+[('PASS',completion(oracle.nodes,oracle.attempts))],'Complete raw serial arithmetic protocol')
 eq(r['startup'],rows[1],'Startup copy');eq(r['final'],rows[-1],'Final copy');summary=oracle.summary()
 for key in ('status','enabled','nodes','attempts','warmSeq','retirementSeq','fullCapWithoutNewCompiledObservation','qualifyingEpisodes','observer','selectedAfterRetirement'):eq(r['lifetime'][key],summary[key],'Separately reconstructed '+key)
 return summary

def run(a,arm,source,binding):
 enabled=arm=='on';name='artifacts/m3b-worker-suspension-'+arm+'-01';r=a.json(name+'/report.json')
 eq([r['schema'],r['protocol'],r['enabled'],r['timingEligible'],r['naturalLifetimeOnly']],[1,PROTOCOL,enabled,False,True],'Actual capture contract');need(r['status'] in ('passed','incomplete'),'Completed actual capture');eq(r['inputRecheck'],[],'Stable inputs');eq(r['oracleFailure'],None,'No refused native observation');eq(r['settings'],SETTINGS,'Fixed work');eq(r['limits'],LIMITS,'Fixed transport');eq(r['timeoutMs'],1800000,'Deadline')
 for k in ('failure','pauseFailure','drainFailure'):need(not r.get(k),'No capture failure '+k)
 eq([r['endStatus']['running'],r['endStatus']['status']],[False,'paused'],'Final stopped');base.host(r)
 for path,id in r['inputs'].items():a.file(path,id)
 for path,id in r['served'].items():eq(id,r['inputs'][path],'Served identity')
 eq(r['runtimeProof']['bindingPath'],BINDING,'Exact observed runtime');b=r['runtimeProof']['binding'];eq(b['observedSuspensionBinding'],binding,'Bound observed native/JS bytes');eq(b['suspensionBinding'],a.json(binding['native']['path'],binding['native']),'Native binding')
 eq(r['runtimeProof']['sourceFingerprint'],b['suspensionBinding']['sourceFingerprint'],'Native source identity');eq(r['sourceProof']['sourceManifest'],a.ref(SOURCE),'Exact source freeze')
 for f in source['files']:eq(r['inputs'][f['path']],{k:f[k] for k in ('sha256','bytes')},'Captured frozen source')
 eq(r['configuration'],dict(enabled=enabled,profile=1,phase='preRun-before-vCPU',returnCode=0,status=11 if enabled else 10,census=dict(enabled=True,phase='preRun-before-vCPU',returnCode=0,status=3,abi=dict(version=2,words=2400,slots=4)),m3aEnabled=True,hotLimit=1500,flags=3,instanceLimit=12000),'Original configuration')
 fixture='artifacts/m3b-worker-suspension-fixture-01';eq(r['fixtureProof']['buildReport'],fixture+'/build-report.json','Guest image');build=a.json(fixture+'/build-report.json');eq(build['status'],'passed','Actual SDK image');elf=a.json(fixture+'/layout.json');eq(elf,build['layout'],'ELF layout');eq(elf,dict(schema=1,sentinel=r['layout']['sentinel']),'Exact guest symbols')
 for path,id in build['artifacts'].items():a.file(fixture+'/'+path,id)
 sdk=a.json(build['sdkInvocation']['path']);need(sdk['status']=='passed' and sdk['returncode']==0 and sdk['sdk']==base.SDK,'Completed pinned SDK');saved=r['fixtureProof']['sdkCompletion'];eq(a.read(name+'/'+saved['path'],saved),a.read(build['sdkInvocation']['path']),'Copied SDK completion')
 for asset in (fixture+'/initramfs.cpio.gz',binding['runtime']+'/qemu-system-x86_64.js',binding['runtime']+'/qemu-system-x86_64.wasm',*b['assets']):need(asset in r['served'],'Required actual served bytes')
 raw,prefixes,files=base.chunks(a,name,r);eq(files['trace']['bytes'],0,'No execution trace');base.queue(r['streams'],prefixes);eq(r['streams']['chunks'],len(prefixes)-1,'Complete drain');eq(base.lines(raw['events']),[],'No hidden failure')
 envelopes=base.lines(raw['progress']);rows=[]
 for i,e in enumerate(envelopes):eq([e['schema'],e['record']],[1,i],'Journal sequence');base.utc(e['utc']);rows.append(e['observation'])
 s=rows[1];eq(s['startupFailure'],None,'Startup success');need(len(s['startupCpus'])==1 and s['startupCpus'][0]['cpu-index']==0,'Single CPU')
 literal=a.read(b['graphContract']['path']).decode()
 for label in ('graph','objects'):
  found=re.findall(r'static const char m3b_expected_'+label+r'\[\] =\s*((?:"[^"\n]*"\s*)+);',literal);eq(len(found),1,'Native literal');text=''.join(base.loads(q) for q in re.findall(r'"[^"\n]*"',found[0]));eq(s[label+'Raw'],list(text.encode()),'Native graph/object closure')
 summary=reconstruct(r,rows,raw,prefixes,elf)
 inspection=a.json('artifacts/m3b-worker-suspension-inspection-'+arm+'-01/report.json');eq(inspection['status'],r['status'],'JS/Python result');eq(inspection['lifetime'],r['lifetime'],'Offline summary');eq(inspection['gateCount'],len(r['gates']),'Offline gates')
 for path,id in inspection['inventory'].items():a.file(path,id)
 execution='artifacts/m3b-worker-suspension-execution-'+arm+'-01';e=a.json(execution+'/execution.json');q=a.json(execution+'/request.json');eq(e['request'],q,'Controller request');eq(e['returncode'],0 if r['status']=='passed' else 2,'Controller outcome');need(not e['timedOut'] and e['error'] is None and e['cleanupError'] is None,'Clean completion');eq(q['outerDeadlineSeconds'],2100,'Outer deadline');eq(a.json(execution+'/browser-cleanup.json')['status'],'passed','Owned browser cleanup')
 controller=a.file('tests/m3b-worker-suspension/controller.py');a.file(execution+'/controller.py',controller);eq(q['controllerSha256'],controller['sha256'],'Controller identity');eq(q['argv'][1:],['tests/m3b-worker-suspension/run.mjs','--binding',BINDING,'--fixture',fixture,'--source-manifest',SOURCE,'--enabled','1' if enabled else '0','--timeout','1800000','--output',name],'Predeclared capture');need(Path(q['scratch']).resolve().is_relative_to(ROOT/'tmp'),'Owned scratch')
 return dict(status=r['status'],gates=len(r['gates']),summary=summary,report=a.ref(name+'/report.json'),streamFiles=files)

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args();out=ROOT/args.output;need(out.resolve().is_relative_to(ROOT/'artifacts'),'Internal output');out.mkdir();a=base.Audit();result=dict(schema=1,status='failed',candidatePromotion=False,timingEligible=False,inventory=a.inventory,runs={},authorship='Root-authored separate Python reconstruction. No external independent audit.')
 try:
  own=a.json('artifacts/m3b-worker-suspension-review-source-01/manifest.json');eq(own['status'],'frozen','Reviewer frozen')
  for f in own['files']:a.file(f['path'],f);a.file(f['archive'],f)
  for path,id in own['dependencies'].items():a.file(path,id)
  tests=a.json(own['tests']['path'],own['tests']);eq(tests['status'],'passed','Reviewer corruption checks')
  source=a.json(SOURCE);eq(source['status'],'frozen','Fixture frozen')
  for f in source['files']:a.file(f['path'],f);a.file(f['archive'],f)
  for path,id in source['dependencies'].items():a.file(path,id)
  binding=a.json(BINDING);eq(binding,source['binding'],'Frozen observed binding')
  for arm in ('off','on'):result['runs'][arm]=run(a,arm,source,binding)
  result['status']='passed' if all(r['status']=='passed' for r in result['runs'].values()) else 'incomplete';a.final()
 except Exception:result['failure']=traceback.format_exc()
 result['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();base.publish(out,'review.json',result);print(json.dumps({'status':result['status'],'identities':len(a.inventory),'failure':result.get('failure')}));return 0 if result['status']=='passed' else 2 if result['status']=='incomplete' else 1
if __name__=='__main__':raise SystemExit(main())
