#!/usr/bin/env python3
"""Separate Python reconstruction of cold Bun exposure; no JS oracle imports.

Same agent authorship is explicit. This provides a separate implementation of
serial/result/counter reconstruction, not an external independent source audit.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
from pathlib import Path
from admission import reconstruct as reconstruct_admission

ROOT=Path(__file__).resolve().parents[2]
PROTOCOL='defuss-m3b-bun-cold-admission-v1'
BINDING='artifacts/m3b-admission-binding-01/binding.json'
BINDING_SHA='d0020fa7f08233f86048a7365ebc52f88123198ac2f3de7d3698fe075a625465'
M3B=['predecodeAccepted','formed','cleanRetries','entryRejects','compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','debtErrors','tciTargetReturns','backedgeTciReturns','IRRejected','emittedOwners']
M3A=['published','eligiblePublished','compiledAttempts','selectedEntries','fallbackEntries','invalidRedispatches','staleInstanceMisses','instanceInstalls','instanceRetires','invalidations','flushes','emittedWasmBytes','importBytes','descriptorBytes','invalidMetadata','generationExhaustions','extraWorkerRejects','watchPcMismatches','injectedStaleInstances','injectedInvalidDescriptors','injectionRejects']
EXPECTED={'integer':1526500379,'json':133784,'sha256':'022efbc5f459321b5cc989106e3d38a7a9f878ddda28663e409811af0cd5e19d','http':1392}
ORDERS=[['integer','json','sha256','http'],['http','sha256','json','integer'],['json','sha256','http','integer']]
PARAMETERS={'integerIterations':250000,'jsonRecords':128,'jsonRounds':8,'shaBytes':65536,'shaRounds':16,'httpRequests':8,'batchRepetitions':100,'samples':3,'warmupCycles':10,'gatePairs':20}

def need(value,message):
    if not value:raise ValueError(message)

def digest(path):
    h=hashlib.sha256();size=0
    with path.open('rb') as f:
        while b:=f.read(1024*1024):h.update(b);size+=len(b)
    return {'sha256':h.hexdigest(),'bytes':size}

def delta(a,b):
    need(a.keys()==b.keys(),'Counter fields changed')
    for k in a:need(type(a[k]) is int and type(b[k]) is int and 0<=a[k]<=b[k],f'Counter reset/wrap {k}')
    return {k:b[k]-v for k,v in a.items()}

def bank(row,enabled,initial=False):
    need(row['status']=={'running':False,'status':'prelaunch' if initial else 'paused'},'Confirmed stopped state')
    a,b,c,d=(row[k] for k in ('m3aRaw','m3bRaw','censusRaw','boundaryRaw'))
    for values,size in [(a,96),(b,128),(c,2400),(d,256)]:need(len(values)==size and all(type(n) is int and 0<=n<=0xffffffff for n in values),'Raw uint32 bank')
    need(a[:13]==[0x4d335231,1,1,int(not initial),0,176,88,24,4,64,8,0,1 if initial else 3],'M3a header')
    need(b[:16]==[0x4d334231,1,63 if enabled else 62,0,0,1,32,128,12,32,20,0,4,0,0,0],'M3b header')
    need(row['nativeStatus']==b[2] and all(n==0 for n in b[30:]),'M3b state/unwatched bank')
    need(c[:16]==[0x4d334343,2,3 if initial else 7,0,0,2400,4,32,592,112,0,0,0,0,0,0] and not any(c[16:]),'Unwatched census must remain empty')
    need(row['censusNativeStatus']==c[2],'Census state')
    idle=[0]*256;idle[0]=0x4d334253;idle[1]=1;idle[6]=256;idle[7]=64
    need(d==idle,'Boundary injection controls')
    need(not any(a[50:55]) and not any(a[64:]),'M3a controls/watch disabled')
    ac=dict(zip(M3A,a[16:37]));bc=dict(zip(M3B,b[16:30]))
    need(ac['compiledAttempts']==ac['selectedEntries']+ac['fallbackEntries']+ac['invalidRedispatches'],'M3a attempts partition')
    need(ac['fallbackEntries']==sum(a[40:49]),'M3a fallback partition')
    need(not any(ac[k] for k in M3A[14:]),'M3a invariant/injection failure')
    need(bc['servicePaid']==bc['BAttempts'] and bc['BRequested']<=bc['BAttempts'] and bc['debtErrors']==0 and bc['entryRejects']==0,'M3b boundary/service partition')
    need(enabled or not any(bc.values()),'Disabled fusion activity')
    if initial:need(not any(ac.values()) and not any(bc.values()),'Startup activity')
    pool=row['pool'];need(pool['limit']==12000 and type(pool['charged']) is int and 0<=pool['charged']<=12000,'Fixed instance cap')
    return {'m3a':ac,'m3b':bc,'pool':pool}

def plan():
    result=[{'event':'initialized'}]
    for i in range(20):result.extend([{'event':'gate-start','index':i},{'event':'gate-result','index':i}])
    result.extend([{'event':'warmup-start'},{'event':'warmup-complete'},{'event':'maps','phase':'post-warmup'}])
    for sample,order in enumerate(ORDERS):
        for name in order:result.extend([{'event':event,'name':name,'sample':sample,'iterations':100} for event in ['start','result']])
    result.append({'event':'complete'});return result

def reconstruct(rows,enabled,graph,objects):
    need(len(rows)==72,'Exactly startup, ready, 69 gates, final')
    events=[];serial='';tail='';gates=[];phases=[];previous=None;phase=None;prepared=None;resumed=None
    wanted=plan()
    for seq,row in enumerate(rows):
        need(row['sequence']==seq,'Row ordering');observed=bank(row,enabled,seq==0)
        if previous:
            for family in ('m3a','m3b'):delta(previous[family],observed[family])
        previous=observed;need(isinstance(row['serialChunk'],str),'Serial chunk');serial+=row['serialChunk'];tail+=row['serialChunk'];fresh=[]
        while '\n' in tail:
            line,tail=tail.split('\n',1);line=line.removesuffix('\r');need('Kernel panic' not in line and 'BUN_APP_FAILURE:' not in line,'Guest failure')
            if line.startswith('DEFUSS_M1 '):fresh.append(json.loads(line[10:]))
        events.extend(fresh)
        for event in fresh:
            need(event['protocol']=='defuss-m1-v1' and event['bun']=='1.4.4' and event['revision']=='38afee6c84fcf48c0edb2466aa4b27d287a59c30' and event['arch']=='x64','Guest identity')
            need(type(event['pid']) is int and event['pid']>0 and event['heap'] is True and event['file'] is True and event['heapLength']==4096,'Guest continuation state')
            need(type(event['heapChecksum']) is int and 0<=event['heapChecksum']<=0xffffffff,'Heap checksum')
        if seq==0:
            need(row['kind']=='startup' and not fresh and row['graph']==graph and row['objects']==objects and len(row['cpus'])==1 and row['cpus'][0]['cpu-index']==0,'Startup graph/CPU')
        elif seq==1:
            need(row['kind']=='ready' and row['signal']==49 and len(fresh)==1,'Cold ready protocol');prepared=fresh[0]
            need(prepared['event']=='snapshot-prepared' and prepared['ordinal']==0 and 'seq' not in prepared,'Original preparation')
            need(prepared['parameters']==PARAMETERS and prepared['orders']==ORDERS,'Original workload configuration')
        elif seq<=70:
            need(row['kind']=='gate' and row['signal']==71,'Gate signal')
            if seq==2:
                need(len(fresh)==2,'Cold continuation plus first gate');resumed=fresh.pop(0)
                need(resumed['event']=='resumed' and resumed['ordinal']==1 and resumed['mode']=='cold' and 'seq' not in resumed,'Cold continuation')
                need(resumed['parameters']==PARAMETERS and resumed['orders']==ORDERS,'Continuation workload configuration')
                need(resumed['nonce']==prepared['nonce'] and resumed['heapChecksum']==prepared['heapChecksum'],'Preserved heap/nonce')
            need(len(fresh)==1,'One raw gate per observation');event=fresh[0];index=len(gates)
            need(row['gate']==event and event['seq']==index+1 and all(event[k]==v for k,v in wanted[index].items()),'Original 69-gate sequence')
            need(event['ordinal']==1 and event['mode']=='cold' and event['nonce']==resumed['nonce'] and event['heapChecksum']==resumed['heapChecksum'],'Gate continuation')
            name=event['event']
            if name in ('initialized','maps'):
                data=event['maps'].encode();need(0<len(data)<=2097152 and len(data)==event['mapsBytes'] and hashlib.sha256(data).hexdigest()==event['mapsSha256'],'Process maps hash')
            if name=='result':need(event['value']==EXPECTED[event['name']],'Unchanged Bun result')
            if name in ('warmup-complete','complete'):need(event['values']==EXPECTED,'Unchanged final values')
            if name in ('start','warmup-start'):need(phase is None,'No overlapping phase');phase=(event,observed)
            if name in ('result','warmup-complete'):
                need(phase is not None,'Phase start missing');start,before=phase
                need(start.get('name')==event.get('name') and start.get('sample')==event.get('sample'),'Phase pairing')
                phases.append({'name':event.get('name','warmup'),'sample':event.get('sample'),'startSeq':start['seq'],'endSeq':event['seq'],**{family:delta(before[family],observed[family]) for family in ('m3a','m3b')}});phase=None
            gates.append(event)
        else:need(row['kind']=='final' and not fresh and not tail and row['gateAcks']==69 and phase is None,'Final ACK/drain')
    need(len(gates)==69 and len(phases)==13 and len(serial.encode())<=4*1024*1024,'Complete bounded protocol')
    previous['admission']=reconstruct_admission(rows,phases)
    need(previous['admission']['counters']['translations']>0,'Admission observer executed')
    return {'phases':phases,'lifetime':previous,'nonce':resumed['nonce'],'gates':69,'results':12},serial

def review_pair():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);options=parser.parse_args()
    out=ROOT/options.output;need(out.resolve().is_relative_to(ROOT/'artifacts'),'Artifact output');out.mkdir()
    inventory={};cache={};report={'schema':1,'status':'failed','protocol':PROTOCOL,'timingEligible':False,'candidatePromotion':False,'authorship':'Same root agent; separately implemented Python raw-data reconstruction, not an external source audit.','runs':{},'inventory':inventory}
    def check(name,expected=None):
        path=ROOT/name;need(path.resolve()==path and path.is_relative_to(ROOT),'Canonical input')
        if name not in cache:cache[name]=digest(path)
        if expected:need(cache[name]==expected,'Identity '+name)
        inventory[name]=cache[name];return path
    def read(name):
        p=check(name);need(p.stat().st_size<=32*1024*1024,'Metadata bound');return json.loads(p.read_text())
    try:
        reviewer=read('artifacts/m3b-bun-admission-review-source-01/manifest.json')
        for f in reviewer['files']:
            expected={k:f[k] for k in ('sha256','bytes')};check(f['path'],expected);check(f['archive'],expected)
        reviewer_tests=reviewer['hostTests'];check(reviewer_tests['path'],{k:reviewer_tests[k] for k in ('sha256','bytes')});need(read(reviewer_tests['path'])['status']=='passed','Reviewer tests')
        freeze=read('artifacts/m3b-bun-admission-source-01/manifest.json')
        for f in freeze['files']:
            expected={k:f[k] for k in ('sha256','bytes')};check(f['path'],expected);check(f['archive'],expected)
        tests=freeze['hostTests'];check(tests['path'],{k:tests[k] for k in ('sha256','bytes')});need(read(tests['path'])['status']=='passed','Host tests')
        for enabled,arm in [(False,'off'),(True,'on')]:
            base='artifacts/m3b-bun-admission-'+arm+'-01/';capture=read(base+'report.json');need(capture['status']=='passed' and capture['enabled'] is enabled and capture['protocol']==PROTOCOL and capture['timingEligible'] is False,'Capture acceptance')
            need(capture['coldOnly'] is True and capture['snapshots']==0 and capture['inputsStable'] is True and capture['timeoutMs']==1800000,'Cold-only finite experiment')
            need(capture['inputs'][BINDING]['sha256']==BINDING_SHA,'Exact native runtime binding')
            need(read(base+'inputs.json')['inputs']==capture['inputs'],'Prelaunch input inventory')
            for name,expected in capture['inputs'].items():check(name,expected)
            binding=read(read(BINDING)['parent']['path']);contract_ref=binding['graphContract'];contract=check(contract_ref['path'],{k:contract_ref[k] for k in ('sha256','bytes')}).read_text()
            for key,symbol in [('graph','m3b_expected_graph'),('objects','m3b_expected_objects')]:
                match=re.search(r'static const char '+symbol+r'\[\]\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*)+);',contract);need(match is not None,'Native contract literal')
                text=''.join(json.loads(x) for x in re.findall(r'"(?:[^"\\]|\\.)*"',match.group(1)))
                need(capture[key]=={'text':text,'sha256':hashlib.sha256(text.encode()).hexdigest(),'bytes':len(text.encode())},'Native graph/object contract')
            for f in freeze['files']:need(capture['inputs'][f['path']]=={k:f[k] for k in ('sha256','bytes')},'Captured harness freeze')
            for name,expected in capture['served'].items():need(expected==capture['inputs'][name],'Bound served bytes')
            raw=check(base+'progress.jsonl').read_text();need(raw.endswith('\n') and len(raw.encode())<32*1024*1024,'Complete journal');rows=[json.loads(line) for line in raw.splitlines()]
            summary,serial=reconstruct(rows,enabled,capture['graph']['text'],capture['objects']['text'])
            need(serial==check(base+'serial.log').read_bytes().decode('utf-8') and serial==capture['browserResult']['serial'],'Serial reconstruction')
            for key,value in summary.items():need(value==capture['summary'][key],'Independent summary '+key)
            offline=read('artifacts/m3b-bun-admission-inspection-'+arm+'-01/review.json');need(offline['status']=='passed' and offline['summary']==capture['summary'],'Same-code inspection')
            for name,expected in offline['inputs'].items():check(name,expected)
            execution='artifacts/m3b-bun-admission-execution-'+arm+'-01/'
            result=read(execution+'execution.json');request=read(execution+'request.json');need(result['returncode']==0 and result['timedOut'] is False and result['error'] is None and result['cleanupError'] is None and result['request']==request,'Completed finite controller')
            source=check(execution+'controller.py');need(digest(source)['sha256']==request['controllerSha256']==capture['inputs']['benchmarks/harness/m3b-admission/controller.py']['sha256'],'Exact execution controller')
            need(request['argv'][1:]==['benchmarks/harness/m3b-admission/run.mjs','--enabled','1' if enabled else '0','--timeout','1800000','--output',base.removesuffix('/')],'Exact outer execution command')
            need(request['outerDeadlineSeconds']==2100 and Path(request['scratch']).resolve().is_relative_to(ROOT/'tmp'),'Bounded local scratch execution')
            cleanup=read(execution+'browser-cleanup.json');need(cleanup['status']=='passed','Owned browser cleanup')
            report['runs'][arm]=summary
        need(report['runs']['off']['nonce']!=report['runs']['on']['nonce'],'Fresh guests')
        report['status']='passed'
    except Exception as exc:
        import traceback
        report['failure']=traceback.format_exc()
    report['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (out/'review.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    print(json.dumps({'status':report['status'],'identities':len(inventory),'failure':report.get('failure')}));return report['status']!='passed'

if __name__=='__main__':raise SystemExit(review_pair())
