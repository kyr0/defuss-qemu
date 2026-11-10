"""Separate Python reconstruction of the frozen natural signal captures."""
import argparse,datetime,json,re,sys,traceback
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(1,str(ROOT/'experiments/m3b-alias-smc-review'))
sys.path.insert(2,str(ROOT/'experiments/m3b-fused-pressure-review'))
sys.path.insert(3,str(ROOT/'experiments/m3b-code-attribution-review'))
import baseline as base
from semantics import need,eq,number
from contexts import Contexts
from alias import ADD
SOURCE='artifacts/m3b-signal-alias-v2-fixture-source-01/manifest.json'
BINDING='artifacts/m3b-code-attribution-binding-01/binding.json'
PROTOCOL='defuss-m3b-signal-alias-v2'
LIMITS=dict(chunk=65536,pending=64*1024*1024,trace=0,serial=4*1024*1024,stderr=1024*1024,records=64)
SETTINGS=dict(guestRamMiB=512,tbMiB=128,hotLimit=1500,flags=2,instanceLimit=12000,timeoutMs=1800000,cases=8,gates=10,timerUsec=10000)
def serial_records(raw):
 text=raw.decode().replace('\r','');need(not re.search(r'M3B_SIGNAL_ALIAS_FAIL:|BUN_APP_FAILURE|Kernel panic',text),'No guest failure');records=[]
 for line in text.splitlines():
  if line.startswith('M3B_SIGNAL_ALIAS_'):
   m=re.fullmatch(r'M3B_SIGNAL_ALIAS_(LAYOUT|GATE|PASS):(.*)',line);need(m is not None,'Known serial record');records.append((m[1],base.loads(m[2])))
 return records
def reconstruct(r,rows,raw,prefixes):
 eq(len(rows),23,'Header/startup/ten gates/ten ACKs/final');header=rows[0];eq([header['schema'],header['event'],header['protocol'],header['enabled']],[1,'header',PROTOCOL,r['enabled']],'Prelaunch header')
 for key in ('inputs','limits','settings','timeoutMs','sourceProof','fixtureProof','hostCondition','hostBefore','chrome','arguments'):eq(header[key],r[key],'Header/report '+key)
 eq(header['binding'],r['runtimeProof']['binding'],'Bound original runtime');o=Contexts(r['enabled']);gates=[];last=0
 for row in rows[1:]:
  prefix=base.queue(row['streams'],prefixes);need(row['streams']['chunks']>=last,'Monotonic durable prefix');last=row['streams']['chunks'];o.accept(row)
  if row['event']=='gate':
   gates.append(row['gate']);seq=row['seq'];actual=r['gates'][seq];eq({k:v for k,v in actual.items() if k not in ('ackHostMs','contHostMs')},row,'Raw stopped observation copy');eq(row['signalHostMs'],r['signals'][seq],'COM1 signal');need(number(actual['ackHostMs']) and number(actual['contHostMs']) and row['readHostMs']<=actual['ackHostMs']<=actual['contHostMs'],'ACK after durable observation')
   eq(serial_records(raw['serial'][:prefix['serial']]),[('LAYOUT',r['layout'])]+[('GATE',g) for g in gates],'Raw guest gate bytes already durable before ACK')
  elif row['event']=='ack':eq(row['hostMs'],r['gates'][row['seq']]['ackHostMs'],'ACK clock')
 eq(o.phase,'done','Completed signal protocol');eq(o.seq,10,'Exact gates');eq(len(r['signals']),10,'Exact signals');eq(len(r['gates']),10,'Exact report gates');eq(r['startup'],rows[1],'Startup copy');eq(r['final'],rows[-1],'Final copy');eq(o.layout,r['layout'],'Layout copy')
 eq(serial_records(raw['serial']),[('LAYOUT',r['layout'])]+[('GATE',g) for g in o.gates]+[('PASS',dict(calls=9,signals=8,contexts=8,patches=8))],'Complete guest byte protocol')
 eq(r['lifetime']['status'],'passed','Host acceptance');eq(r['lifetime']['enabled'],r['enabled'],'Mode');eq(r['lifetime']['resets'],o.resets,'One layout watch epoch');eq(len(r['lifetime']['epochs']),9,'Nine compiled calls')
 eq(r['lifetime']['epochs'],o.epochs,'Separately reconstructed exact generations and phase counts')
 return dict(status='passed',gates=10,calls=9,signals=8,layout=o.layout,resets=o.resets,epochs=o.epochs)
def run(a,arm,source,binding):
 enabled=arm=='on';name='artifacts/m3b-signal-alias-v2-'+arm+'-01';r=a.json(name+'/report.json');eq([r['schema'],r['protocol'],r['status'],r['enabled'],r['timingEligible'],r['naturalGuestTimerAliasOnly']],[1,PROTOCOL,'passed',enabled,False,True],'Actual capture contract');eq(r['inputRecheck'],[],'Stable inputs');eq(r['oracleFailure'],None,'No refused observation');eq(r['settings'],SETTINGS,'Fixed work');eq(r['limits'],LIMITS,'Bounded transport');eq(r['timeoutMs'],1800000,'Deadline')
 for k in ('failure','pauseFailure','drainFailure'):need(not r.get(k),'No capture failure '+k)
 eq([r['endStatus']['running'],r['endStatus']['status']],[False,'paused'],'Final stopped');base.host(r)
 for name_,id in r['inputs'].items():a.file(name_,id)
 for name_,id in r['served'].items():eq(id,r['inputs'][name_],'Served identity')
 eq(r['runtimeProof']['bindingPath'],BINDING,'Original binding');eq(r['runtimeProof']['binding'],binding,'Original native bytes');eq(r['runtimeProof']['sourceFingerprint'],binding['codeBinding']['sourceFingerprint'],'Native source');eq(r['sourceProof']['sourceManifest'],a.ref(SOURCE),'Frozen capture source')
 for f in source['files']:eq(r['inputs'][f['path']],{k:f[k] for k in ('sha256','bytes')},'Executed frozen source')
 eq(r['configuration'],dict(enabled=enabled,profile=1,phase='preRun-before-vCPU',returnCode=0,status=11 if enabled else 10,census=dict(enabled=True,phase='preRun-before-vCPU',returnCode=0,status=3,abi=dict(version=2,words=2400,slots=4)),m3aEnabled=True,hotLimit=1500,flags=2,instanceLimit=12000),'Unmodified settings')
 fixture='artifacts/m3b-signal-alias-v2-fixture-01';eq(r['fixtureProof']['buildReport'],fixture+'/build-report.json','Exact guest build');build=a.json(fixture+'/build-report.json');eq(build['status'],'passed','Actual pinned build');elf=a.json(fixture+'/layout.json');eq(elf,build['layout'],'Actual ELF template');eq('89f931c0'+elf['sentinel']['codeHex']+'c3',ADD,'Actual copied code template')
 for p,id in build['artifacts'].items():a.file(fixture+'/'+p,id)
 sdk=a.json(build['sdkInvocation']['path']);need(sdk['status']=='passed' and sdk['returncode']==0 and sdk['sdk']==base.SDK,'Completed pinned SDK');saved=r['fixtureProof']['sdkCompletion'];need(a.read(name+'/'+saved['path'],saved)==a.read(build['sdkInvocation']['path']),'Exact copied SDK completion bytes')
 for asset in (fixture+'/initramfs.cpio.gz',binding['codeBinding']['runtime']+'/qemu-system-x86_64.js',binding['codeBinding']['runtime']+'/qemu-system-x86_64.wasm',*binding['assets']):need(asset in r['served'],'Actual served required payload')
 raw,prefixes,files=base.chunks(a,name,r);eq(files['trace']['bytes'],0,'No execution trace');base.queue(r['streams'],prefixes);eq(r['streams']['chunks'],len(prefixes)-1,'Complete drain');eq(base.lines(raw['events']),[],'No hidden failure');rows=[]
 for i,e in enumerate(base.lines(raw['progress'])):eq([e['schema'],e['record']],[1,i],'Journal order');base.utc(e['utc']);rows.append(e['observation'])
 literal=a.read(binding['graphContract']['path']).decode()
 for label in ('graph','objects'):
  found=re.findall(r'static const char m3b_expected_'+label+r'\[\] =\s*((?:"[^"\n]*"\s*)+);',literal);eq(len(found),1,'Native literal');text=''.join(base.loads(q) for q in re.findall(r'"[^"\n]*"',found[0]));eq(rows[1][label+'Raw'],list(text.encode()),'Native contract bytes')
 summary=reconstruct(r,rows,raw,prefixes);inspection=a.json('artifacts/m3b-signal-alias-v2-inspection-'+arm+'-02/report.json');eq([inspection['status'],inspection['acceptance']],['passed',True],'Same-code replay');eq(inspection['lifetime'],r['lifetime'],'Offline summary');eq(inspection['gateCount'],10,'Offline gates')
 for p,id in inspection['inventory'].items():a.file(p,id)
 execution='artifacts/m3b-signal-alias-v2-execution-'+arm+'-01';e=a.json(execution+'/execution.json');q=a.json(execution+'/request.json');eq(e['request'],q,'Controller request');need(e['returncode']==0 and not e['timedOut'] and e['error'] is None and e['cleanupError'] is None,'Completed controller');eq(q['outerDeadlineSeconds'],2100,'Outer deadline');eq(a.json(execution+'/browser-cleanup.json')['status'],'passed','Owned browser cleanup')
 controller=a.file('tests/m3b-signal-alias-v2/controller.py');a.file(execution+'/controller.py',controller);eq(q['controllerSha256'],controller['sha256'],'Controller identity');eq(q['argv'][1:],['tests/m3b-signal-alias-v2/run.mjs','--binding',BINDING,'--fixture',fixture,'--source-manifest',SOURCE,'--enabled','1' if enabled else '0','--timeout','1800000','--output',name],'Exact planned command');need(Path(q['scratch']).resolve().is_relative_to(ROOT/'tmp'),'Owned scratch')
 return summary
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args();out=ROOT/args.output;need(out.resolve().is_relative_to(ROOT/'artifacts'),'Internal output');out.mkdir();a=base.Audit();result=dict(schema=1,status='failed',candidatePromotion=False,timingEligible=False,inventory=a.inventory,runs={},authorship='Root separate-language reconstruction; no external independent source audit.')
 try:
  own=a.json('artifacts/m3b-signal-alias-review-v2-source-01/manifest.json');eq(own['status'],'frozen','Frozen reviewer')
  for f in own['files']:a.file(f['path'],f);a.file(f['archive'],f)
  for p,id in own['dependencies'].items():a.file(p,id)
  eq(a.json(own['tests']['path'],own['tests'])['status'],'passed','Reviewer tests');source=a.json(SOURCE);eq(source['status'],'frozen','Frozen fixture')
  for f in source['files']:a.file(f['path'],f);a.file(f['archive'],f)
  for p,id in source['dependencies'].items():a.file(p,id)
  code=a.json(BINDING,'94f58f2f5e8368c871bb67fb81b1711c7862b3b15ecf1539dcdc946542e7bf8d');binding=a.json(code['parent']['path'],code['parent']);binding['codeBinding']=code;eq(source['binding'],binding,'Exact code-attribution runtime')
  eq(a.json('artifacts/m3b-signal-alias-off-launch-failure-01/decision.json')['status'],'reviewed-failed-launch','Preserved V1 launch failure')
  for arm in ('off','on'):result['runs'][arm]=run(a,arm,source,binding)
  result['status']='passed';a.final()
 except Exception:result['failure']=traceback.format_exc()
 result['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();base.publish(out,'review.json',result);print(json.dumps({'status':result['status'],'identities':len(a.inventory),'failure':result.get('failure')}));return result['status']!='passed'
if __name__=='__main__':raise SystemExit(main())
