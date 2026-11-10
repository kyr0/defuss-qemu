#!/usr/bin/env python3
"""Independent retained-evidence replay. Run only in a root-authorized I/O gap."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import re
from semantics import *
from trace import parse,positive_window

ROOT=Path(__file__).resolve().parents[2]
SOURCE='artifacts/m3b-context-v2-implementation-source-01/manifest.json'
SOURCE_HASH='f115f7fcf452b7473479aa581aa8269189ba3e82893b22290eb7eb607d53264f'
SOURCE_REVIEW='artifacts/m3b-context-v2-implementation-source-review-01/review.json'
SOURCE_REVIEW_HASH='0d57ece07fd991d4feda9d30820c104d766d31e7e11b8fcf4bb3f8e51b90700f'
HOST_SOURCE='artifacts/m3b-context-v5-source-01/manifest.json'
HOST_SOURCE_HASH='af3f4d89d70511627cbc53387c2ad9679312360324349f137106c5a99d4de1ff'
HOST_REVIEW='artifacts/m3b-context-v5-source-review-01/review.json'
HOST_REVIEW_HASH='3550d8ee1d14fa5e7396f7cab62c0bd4a1d57ce68c92fa747dbb747ad9ab1bac'
FP='46499e15df66b2f8d363d35846812bf99685ac2da44727d54494890e459ea321'
PROTOCOL='defuss-m3b-context-runner-v5'
LIMITS=dict(chunk=65536,pending=64*1024*1024,trace=512*1024*1024,serial=4*1024*1024,stderr=1024*1024,records=200)
FILENAMES=dict(trace='native-trace.log',serial='serial.log',stderr='stderr.log',progress='progress.jsonl',chunks='chunks.jsonl',events='events.jsonl')
SDK='registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812'

def digest(data): return hashlib.sha256(data).hexdigest()
def loads(data):
    def obj(rows):
        d={}
        for k,v in rows: need(k not in d,'Duplicate JSON key'); d[k]=v
        return d
    return json.loads(data,object_pairs_hook=obj,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
def lines(raw):
    need(not raw or raw.endswith(b'\n'),'Incomplete JSONL tail'); return [loads(s) for s in raw.splitlines() if s]
def utc(s): return datetime.fromisoformat(s.replace('Z','+00:00'))
def fsync(path):
    fd=os.open(path,os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)
def publish(out,name,value):
    with (out/name).open('x') as f: json.dump(value,f,indent=2,sort_keys=True,allow_nan=False); f.write('\n'); f.flush(); os.fsync(f.fileno())
    fsync(out); fsync(out.parent)

class Audit:
    def __init__(self,root=ROOT): self.root=root; self.inventory={}; self.stats={}
    def path(self,name):
        p=self.root/name; need(not Path(name).is_absolute() and p.resolve()==p and p.is_file(),'Internal regular file: '+str(name)); return p
    def file(self,name,expected=None):
        p=self.path(name); before=p.stat(); stamp=(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)
        if name not in self.inventory:
            h=hashlib.sha256(); n=0
            with p.open('rb') as f:
                while b:=f.read(1024*1024): h.update(b); n+=len(b)
            after=p.stat(); eq(stamp,(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns),'File changed during hash')
            self.inventory[name]=dict(sha256=h.hexdigest(),bytes=n); self.stats[name]=stamp
        else: eq(stamp,self.stats[name],'Previously hashed file changed')
        actual=self.inventory[name]
        if expected:
            if isinstance(expected,str): expected={'sha256':expected}
            eq(actual['sha256'],expected['sha256'],'SHA '+name)
            if 'bytes' in expected: eq(actual['bytes'],expected['bytes'],'Size '+name)
        return actual
    def read(self,name,expected=None,limit=32*1024*1024):
        ident=self.file(name,expected); need(ident['bytes']<=limit,'Bounded JSON/source read'); data=self.path(name).read_bytes(); eq(dict(sha256=digest(data),bytes=len(data)),ident,'Exact read identity'); return data
    def json(self,name,expected=None): return loads(self.read(name,expected))
    def ref(self,name): return dict(path=name,**self.file(name))
    def final(self):
        for name,stamp in self.stats.items():
            s=self.path(name).stat(); eq((s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns),stamp,'Post-replay immutable identity')

def frozen(a):
    m=a.json(SOURCE,SOURCE_HASH); eq([m['schema'],m['kind'],m['variant'],m['status'],m['timingEligible']],[1,'m3b-context-census-source-freeze','m3b-context-census-v2','frozen',False],'Frozen ABI2 source')
    need(len(m['files'])==93 and len(m['dependencies'])==531,'Reviewed source closure count')
    names=set()
    for row in m['files']:
        need(row['path'] not in names,'Source duplicate'); names.add(row['path']); a.file(row['path'],row); a.file(row['archive'],row)
    for name,ident in m['dependencies'].items(): a.file(name,ident)
    review=a.json(SOURCE_REVIEW,SOURCE_REVIEW_HASH); eq(review['status'],'passed','Independent source review'); eq(review['sourceBlockers'],[],'Source blockers'); eq(review['sourceManifest']['sha256'],SOURCE_HASH,'Review source')
    host=a.json(HOST_SOURCE,HOST_SOURCE_HASH); eq([host['kind'],host['status'],host['timingEligible']],['m3b-context-host-v5-source-freeze','frozen',False],'Host v4 freeze'); eq(host['parentSourceManifest'],a.ref(SOURCE),'Exact host parent'); eq(host['parentSourceReview'],a.ref(SOURCE_REVIEW),'Exact host parent review'); need(len(host['files'])==24,'Host source closure')
    for row in host['files']: a.file(row['path'],row); a.file(row['archive'],row)
    for name,id in host['dependencies'].items(): a.file(name,id)
    hr=a.json(HOST_REVIEW,HOST_REVIEW_HASH); eq(hr['status'],'passed','Host source review'); eq(hr['sourceBlockers'],[],'Host source blockers'); eq(hr['sourceManifest'],a.ref(HOST_SOURCE),'Host review source')
    return m

def binding(a,path):
    b=a.json(path); eq([b['schema'],b['kind'],b['variant'],b['status'],b['timingEligible'],b['profile']],[1,'m3b-differential-runtime-binding-v1','m3b-context-census-v2','passed',False,1],'Actual ABI2 binding')
    eq(b['sourceFingerprint'],FP,'Exact prepared fingerprint'); eq(b['censusAbi'],dict(version=2,words=2400,slots=4),'Census ABI')
    eq(b['diagnosticExtensions'],['context-entry-census-v2','generation-specific-injection-v1'],'Native extension scope')
    eq(b['sourceManifest'],a.ref(SOURCE),'Source binding'); eq(b['sourceReview'],a.ref(SOURCE_REVIEW),'Review binding')
    for name in ['buildReport','overlayManifest','sourceRecheck','graphContract','graphReview','parentBinding','tool']: a.file(b[name]['path'],b[name])
    build=a.json(b['buildReport']['path']); eq(build['status'],'passed','Actual SDK build status');eq(build['sourceFingerprint'],FP,'Actual built source');eq(build['sdk'],SDK,'Actual build SDK'); recheck=a.json(b['sourceRecheck']['path']); eq(recheck['status'],'passed','Full postbuild source check'); eq(recheck['variant'],'m3b-context-census-v2','Postbuild variant')
    for name in ['buildReport','overlayManifest','sourceManifest','sourceReview']: eq(recheck[name],b[name],'Postbuild binding '+name)
    s=recheck['source']; need(s['matches'] is True,'Prepared source still exact'); eq(s['fingerprintBeforeBuild'],FP,'Prebuild fingerprint'); eq(s['fingerprintAfterBuild'],FP,'Postbuild fingerprint')
    need(len(recheck['runtimeArtifacts'])==7,'Seven exact runtime artifacts')
    for name,row in recheck['runtimeArtifacts'].items():
        need(row['matchesBuildReport'] is True,'Runtime matches actual build'); a.file(str(Path(b['buildReport']['path']).parent/name),row); eq(build['artifacts'][name],{k:row[k] for k in ('sha256','bytes')},'Actual build runtime identity')
    for row in recheck['overlayChecks']: need(row['passed'] is True and row['observedAfter']==row['after'],'Exact source overlay')
    for name,id in b['assets'].items(): a.file(name,id)
    for key in ['sdkInvocation','sdkOriginal','inventory']:
        ref=recheck[key]; a.file(ref['path'],ref)
    sdk=a.json(recheck['sdkInvocation']['path']); need(sdk['status']=='passed' and sdk['returncode']==0,'Completed actual SDK'); eq(sdk['sdk'],SDK,'Pinned SDK'); need(sdk['command'][-8:]==['--source',s['path'],'--output',str(Path(b['buildReport']['path']).parent),'--targets','x86_64-softmmu','--jobs','4'],'Exact SDK build command'); need(sdk['command'][sdk['command'].index('--network')+1]=='none','Offline SDK')
    graph=a.json(b['graphReview']['path']); eq(graph['status'],'passed','Actual observed graph review'); eq(graph['graphContract'],b['graphContract'],'Graph literal pin')
    # The diagnostic counter meaning is checked against the actual postbuild source inventory.
    inv=a.json(recheck['inventory']['path'],recheck['inventory']); trees=[t for t in inv['trees'] if t['path']==s['path']];eq(len(trees),1,'Actual prepared source inventory')
    native_refs={}
    for name in ('tcg/wasm64.c','tcg/m3b-runtime-head.inc','accel/tcg/cpu-exec.c'):
        full=s['path']+'/'+name;a.file(full,trees[0]['files'][name]);native_refs[name]=a.ref(full)
        eq(a.json(HOST_SOURCE)['dependencies'][full],trees[0]['files'][name],'Host native meaning bound to compiled source')
    text=a.read(native_refs['tcg/wasm64.c']['path']).decode();eq(text.count('defuss_m3b_note(M3B_TCI_TARGET_RETURNS);'),2,'Exactly two global ordinary-TCI guard note sites')
    for op,nextop in [('INDEX_op_goto_tb:','INDEX_op_goto_ptr:'),('INDEX_op_goto_ptr:','INDEX_op_qemu_ld:')]:
        begin=text.index('case '+op);end=text.index('case '+nextop,begin);part=text[begin:end]
        guard=part.index('if (m3b_fused(tb_ptr))');note=part.index('defuss_m3b_note(M3B_TCI_TARGET_RETURNS);',guard);ret=part.index('return 0;',note);admit=part.index('if (inc_counter',ret);census=part.index('m3cc_note(',admit)
        need(guard<note<ret<admit<census,'Ordinary TCI redirect precedes target admission/census')
    return b,build,recheck

def argv(layout):
    filt=','.join(p['a']+'..'+hex(int(p['end'],16)-1) for p in layout['programs'])
    return ['-nodefaults','-machine','pc,acpi=off,hpet=off,usb=off','-cpu','max','-global','apic.vapic=off','-accel','tcg,tb-size=128','-smp','cpus=1,maxcpus=1','-m','512','-S','-display','none','-monitor','none','-qmp','stdio','-chardev','file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1','-serial','chardev:fixture-com1','-serial','file:/guest/console.log','-parallel','none','-no-reboot','-no-shutdown','-L','/rom','-kernel','/guest/kernel','-initrd','/guest/initramfs','-append','console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on','-d','exec,in_asm,cpu','-dfilter',filt,'-D','/guest/m3b-tb.log']

def terminal(raw,start):
    need(len(raw)<=65536 and integer(start,1<<53),'Bounded terminal suffix');need(not raw or raw.endswith(b'\n'),'Complete terminal line')
    rows=raw[:-1].split(b'\n') if raw else []
    for row in rows:
        m=re.fullmatch(rb'Linking TBs 0x([0-9a-f]{1,16}) index ([01]) -> 0x([0-9a-f]{1,16})',row);need(m is not None,'Only exact Linking TBs lines');need(int(m[1],16)>0 and int(m[3],16)>0,'Nonzero linking pointers')
    return dict(schema=1,status='terminal-link-only',start=start,end=start+len(raw),bytes=len(raw),sha256=digest(raw),linkingRecords=len(rows),executionRecords=0,sourceSite={'path':'accel/tcg/cpu-exec.c','function':'tb_add_jump','mask':'CPU_LOG_EXEC','format':'Linking TBs %p index %d -> %p\n','addressFilter':False},acceptance=False,scope='No Trace, Stopped, CPU, disassembly or other record occurs in this exact terminal suffix. This does not prove absence of unwatched kernel execution.')

def chunks(a,run,report):
    eq(sorted(report['artifacts']),sorted(FILENAMES),'All six raw artifacts'); raw={}
    for name,filename in FILENAMES.items():
        id=report['artifacts'][name]; eq(id['path'],filename,'Exact raw artifact name'); a.file(run+'/'+filename,id)
        if name!='trace': raw[name]=a.read(run+'/'+filename,id,32*1024*1024)
    totals={n:0 for n in ('trace','serial','stderr')}; prefixes=[dict(totals)]; hashes={n:hashlib.sha256() for n in totals}; rows=lines(raw['chunks']); need(len(rows)<=100000,'Chunk cap')
    handles={n:a.path(run+'/'+FILENAMES[n]).open('rb') for n in totals}
    try:
        for seq,row in enumerate(rows):
            eq(sorted(row),sorted(['schema','seq','stream','offset','bytes','sha256']),'Chunk fields'); eq([row['schema'],row['seq']],[1,seq],'Chunk order'); n=row['stream']; need(n in totals,'Stream name'); eq(row['offset'],totals[n],'Contiguous offset'); need(integer(row['bytes'],65536) and row['bytes']>0,'Chunk bound')
            b=handles[n].read(row['bytes']); eq(len(b),row['bytes'],'Chunk actual bytes'); eq(digest(b),row['sha256'],'Chunk identity'); hashes[n].update(b); totals[n]+=len(b); need(totals[n]<=LIMITS[n],'Stream cap'); prefixes.append(dict(totals))
        for n,h in handles.items(): need(not h.read(1),'Unindexed tail')
    finally:
        for h in handles.values(): h.close()
    files={n:dict(bytes=totals[n],sha256=hashes[n].hexdigest()) for n in totals}; eq(report['streamsDurable'],dict(chunks=len(rows),files=files),'Durable index summary')
    return raw,prefixes,files

def queue(s,prefixes):
    count=s['chunks']; need(integer(count,len(prefixes)-1),'Stream checkpoint'); prefix=prefixes[count]; eq(s['streams'],{n:dict(seen=v,queued=v) for n,v in prefix.items()},'Drained stream prefix'); q=s['queue']
    ints='producedBytes queuedBytes acknowledgedBytes acknowledgedChunks pendingBytes peakPendingBytes windowPeakPendingBytes drains'.split(); clocks='sampledAtMs lastAckMs maxAckMs maxEnqueueToAckMs lastDrainMs maxDrainMs'.split(); eq(sorted(q),sorted(ints+clocks),'Queue fields')
    for k in ints: need(integer(q[k],1<<53),'Queue integer '+k)
    for k in clocks: need(number(q[k]),'Queue clock '+k)
    for k in ints[:3]: eq(q[k],sum(prefix.values()),'Drained total')
    eq(q['acknowledgedChunks'],count,'All chunks acknowledged'); eq(q['pendingBytes'],0,'No pending data'); need(q['windowPeakPendingBytes']<=q['peakPendingBytes']<=LIMITS['pending'],'Queue cap'); need(q['drains']>0 and q['lastDrainMs']<=q['maxDrainMs'] and q['lastAckMs']<=q['sampledAtMs'] and q['maxAckMs']<=q['maxEnqueueToAckMs'],'Queue clock order')
    return prefix

def host(report):
    h=report['hostCondition']; eq(h['arguments'],['list','builder','--json'],'Stopped builder query'); eq(h['environment'],{'LIMA_HOME':'/Users/admin/.defuss-vm-lima'},'Persistent builder home')
    for key in ('hostBefore','hostAfter'):
        x=report[key]; eq(loads(x['stdout']),x['status'],'Raw host status'); eq(x['stderr'],'','Host stderr'); need(x['status']['name']=='builder' and x['status']['status']=='Stopped','Builder actually stopped')

def fixture(a,r):
    path=r['fixtureProof']['buildReport']; need(path=='artifacts/m3b-fixture-01/build-report.json','Original guest image'); b=a.json(path,r['inputs'][path]); eq([b['schema'],b['kind'],b['status'],b['compilerTarget'],b['sdk']],[1,'m3b-differential-fixture-image','passed','x86_64-linux-gnu',SDK],'Actual guest build')
    eq(b['baseInitramfsSha256'],'6dde230b0e49d80c54337e2854d7cff6e8c9aa8cfa37588eaf9df4dd325a87a9','Rootfs base'); need(len(b['sources'])==10 and b['hostShapeValidated'] is True,'Exact source/build contract')
    base=str(Path(path).parent)
    for name,id in b['artifacts'].items(): a.file(base+'/'+name,id); eq(r['inputs'][base+'/'+name],id,'Guest artifact served input')
    for name,id in b['sources'].items(): a.file(name,id)
    for name,id in b['copiedSources'].items(): a.file(name,id); a.file(base+'/'+id['artifact'],id)
    complete=a.json(b['sdkInvocation']['path'],r['inputs'][b['sdkInvocation']['path']]); start=a.json(base+'/sdk-invocation-start.json',r['inputs'][base+'/sdk-invocation-start.json'])
    eq(complete['status'],'passed','Guest SDK completion'); eq(complete['returncode'],0,'Guest SDK success')
    for key in start:
        if key not in ('status','completedUtc','finishedUtc','returncode','elapsedSeconds'): eq(start[key],complete[key],'SDK start/completion '+key)
    elf=a.json(base+'/layout.json',r['inputs'][base+'/layout.json'])
    for p,q in zip(r['layout']['programs'],elf['programs']):
        for k in ('name','a','b','back','side','end','ownerBytes','codeHex'): eq(p[k],q[k],'Actual ELF layout '+k)
    return base

def cleanup(a,execution,run,enabled,binding_path):
    x=a.json(execution+'/execution.json'); c=a.json(execution+'/browser-cleanup.json'); eq(x['schema'],1,'Execution schema'); eq(x['returncode'],0,'Actual process success'); eq(x['timedOut'],False,'No timeout'); eq(x['outerDeadlineSeconds'],2100,'Outer bound'); need(number(x['elapsedSeconds']) and x['elapsedSeconds']<2100,'Bounded completion')
    req=x['request']; need(req['scratch'].startswith(str(ROOT/'tmp')+'/'),'Project scratch'); args=req['argv']; eq(args[1:],['tests/m3b-context-runner-v5/run.mjs','--binding',binding_path,'--fixture','artifacts/m3b-fixture-01','--source-manifest',HOST_SOURCE,'--source-review',HOST_REVIEW,'--enabled',str(int(enabled)),'--timeout','1800000','--output',run],'Exact actual capture argv'); eq(x.get('error'),None,'No controller error'); eq(x.get('cleanupError'),None,'No controller cleanup error')
    eq(c['status'],'passed','Owned browser cleanup'); eq(c['ownedScratch'],req['scratch'],'Owned scratch linkage'); eq(c['remainingProfileProcesses'],[],'No owned Chrome remains'); need(utc(c['checkedUtc'])>=utc(x['completedUtc'])>utc(req['startedUtc']),'Cleanup after process exit'); a.file(execution+'/controller.py',req['controllerSha256'])
    return dict(execution=a.ref(execution+'/execution.json'),cleanup=a.ref(execution+'/browser-cleanup.json'),scratch=req['scratch'],startedUtc=req['startedUtc'],completedUtc=x['completedUtc'],cleanupUtc=c['checkedUtc'])

def run(a,run,inspection,execution,enabled,binding_path,b):
    r=a.json(run+'/report.json'); eq([r['schema'],r['protocol'],r['status'],r['enabled'],r['timingEligible'],r['contextAcceptanceIntegrated']],[1,PROTOCOL,'passed',enabled,False,True],'Passed diagnostic capture'); eq(r['inputRecheck'],[],'No input drift'); eq(r['oracleFailure'],None,'No oracle failure'); eq(r['limits'],LIMITS,'Fixed bounds'); eq(r['timeoutMs'],1800000,'Prospective deadline')
    for k in ('failure','pauseFailure','drainFailure'): need(k not in r or r[k] is None,'Capture failure '+k)
    eq(r['endStatus'].get('running'),False,'Final paused'); eq(r['endStatus']['status'],'paused','Final stop state'); host(r)
    eq(r['runtimeProof']['binding'],b,'Actual runtime binding'); eq(r['runtimeProof']['bindingPath'],binding_path,'Binding path'); eq(r['runtimeProof']['sourceFingerprint'],FP,'Runtime fingerprint'); eq(r['sourceProof']['sourceManifest'],a.ref(HOST_SOURCE),'Frozen host source'); eq(r['sourceProof']['sourceReview'],a.ref(HOST_REVIEW),'Frozen host source review'); eq(r['sourceProof']['parentSourceProof']['parentSourceProof']['parentSourceProof']['sourceManifest'],a.ref(SOURCE),'Frozen native/accounting parent')
    layout_check(r['layout']); eq(r['arguments'],argv(r['layout']),'Exact diagnostic CLI'); base=fixture(a,r)
    eq(r['configuration'],dict(enabled=enabled,profile=1,phase='preRun-before-vCPU',returnCode=0,status=11 if enabled else 10,census=dict(enabled=True,phase='preRun-before-vCPU',returnCode=0,status=3,abi=dict(version=2,words=2400,slots=4)),m3aEnabled=True,hotLimit=1500,flags=2,instanceLimit=12000),'One-time actual configuration')
    for path,id in r['inputs'].items(): a.file(path,id)
    for path,id in r['served'].items(): eq(r['inputs'].get(path),id,'Served identity')
    for path in ['tests/m3b-context-accounting-v3/census-browser.mjs','tests/m3b-context-runner-v5/guest.mjs','tests/m3b-context-runner-v5/config.mjs','tests/m3b-context-runner-v5/transport.mjs','tests/m3b-fallthrough/guest.mjs','tests/m3b-fallthrough/reader.mjs','experiments/m3a-region/reader.mjs','host/browser/qmp.mjs','host/browser/machine.mjs','packaging/bun-app/serial.mjs',base+'/initramfs.cpio.gz',b['runtime']+'/qemu-system-x86_64.js',b['runtime']+'/qemu-system-x86_64.wasm',*b['assets']]: need(path in r['served'],'Required served source '+path)
    raw,prefixes,stream_files=chunks(a,run,r); queue(r['streams'],prefixes); eq(r['streams']['chunks'],len(prefixes)-1,'Final drained chunk count'); eq(lines(raw['events']),[],'No durable error events')
    journal=lines(raw['progress']); need(len(journal)==138,'Header/startup/45 gate-config-ACK/complete')
    for i,x in enumerate(journal): eq([x['schema'],x['record']],[1,i],'Durable journal order'); utc(x['utc'])
    rows=[x['observation'] for x in journal]; header=rows[0]; eq([header['schema'],header['event'],header['protocol'],header['enabled']],[1,'header',PROTOCOL,enabled],'Durable prelaunch header')
    for key in ['inputs','limits','trace','timeoutMs','sourceProof','fixtureProof','hostCondition','hostBefore','chrome','arguments']: eq(header[key],r[key],'Header/report '+key)
    eq(header['binding'],b,'Prelaunch binding'); ref_gates,ref_pass=reference(); serial=raw['serial'].decode('utf-8').replace('\r',''); need(not re.search(r'M3B_FAIL:|BUN_APP_FAILURE|Kernel panic',serial),'Guest failure marker')
    records=[]
    for line in serial.splitlines():
        if line.startswith('M3B_'):
            m=re.fullmatch(r'M3B_(LAYOUT|GATE|PASS):(.*)',line); need(m is not None,'Unknown raw guest record'); records.append((m[1],loads(m[2])))
    eq(records,[('LAYOUT',r['layout'])]+[('GATE',g) for g in ref_gates]+[('PASS',ref_pass)],'Independent guest oracle/raw serial')
    startrow=rows[1]; eq(startrow['event'],'startup','Startup order'); eq(startrow['startupFailure'],None,'No startup failure'); need(len(startrow['startupCpus'])==1 and startrow['startupCpus'][0]['cpu-index']==0,'One actual CPU'); state=native(startrow,enabled,True); ranges(state,None,0,enabled,True); eq(r['startup'],startrow,'Startup copy')
    header_text=a.read(b['graphContract']['path']).decode();
    for label,key in [('graph','graphRaw'),('objects','objectsRaw')]:
        # Actual native byte arrays must equal the frozen literal, not a QOM approximation.
        matches=re.findall(r'static const char m3b_expected_'+label+r'\[\] =\s*((?:"[^"\n]*"\s*)+);',header_text)
        need(len(matches)==1,'Exact frozen '+label+' literal'); literal=''.join(loads(s) for s in re.findall(r'"[^"\n]*"',matches[0])); eq(startrow[key],list(literal.encode()),'Native frozen '+label)
    trace_start=queue(startrow['streams'],prefixes)['trace']; previous=state; current=None; before=None; warm={}; partitions=[]; summaries=[]; clock=startrow['hostMs']; last_ack=0; lastchunks=startrow['streams']['chunks']; epoch=0
    trace_path=a.path(run+'/native-trace.log')
    with trace_path.open('rb') as tf:
        for seq,g in enumerate(ref_gates):
            gate,configured,ack=rows[2+3*seq:5+3*seq]; eq([gate['event'],configured['event'],ack['event']],['gate','configured','ack'],'Exact stopped/ACK sequence'); eq(gate['gate'],g,'Independent gate oracle'); eq(gate['signalHostMs'],r['signals'][seq],'Signal order'); need(number(gate['signalHostMs']) and gate['signalHostMs']>=last_ack and gate['readHostMs']>=gate['signalHostMs'],'Gate clocks')
            copy={k:v for k,v in r['gates'][seq].items() if k not in ('ackHostMs','contHostMs')}; eq(copy,gate,'Raw gate retained'); need(gate['readHostMs']<=r['gates'][seq]['ackHostMs']<=r['gates'][seq]['contHostMs'],'ACK after persisted stop')
            for row in (gate,configured,ack):
                t=row.get('readHostMs',row.get('hostMs')); need(number(t) and t>=clock,'Monotonic host observations'); clock=t; prefix=queue(row['streams'],prefixes); need(row['streams']['chunks']>=lastchunks,'Chunk prefix monotonic'); lastchunks=row['streams']['chunks']
            end=gate['streams']['streams']['trace']['seen']; need(trace_start<=end and end-trace_start<=128*1024*1024,'Trace window bound'); state=native(gate,enabled); ranges(state,current,epoch,enabled,seq==0)
            for family in ('a','b'):
                need(all(state[family][k]>=previous[family][k] for k in previous[family]),'Lifetime counter monotonic')
            need(state['c']['total']>=previous['c']['total'],'Census lifetime monotonic')
            if seq==0:
                eq(gate['layout'],r['layout'],'Gate0 layout'); summary=dict(schema=1,seq=0,status='boot-prefix-not-analyzed',start=trace_start,end=end,bytes=end-trace_start,acceptance=False)
            else:
                eq(g['program'],(seq-1)//4,'Program order'); eq(state['c']['total']-before['c']['total'],state['c']['slots'][0]['total'],'Exact native window lifetime')
                tf.seek(trace_start); data=tf.read(end-trace_start); eq(len(data),end-trace_start,'Window bytes'); entries,stops=parse(data,trace_start)
                summary=dict(schema=1,seq=seq,status='parsed-only',start=trace_start,end=end,bytes=end-trace_start,sha256=digest(data),outerEntries=len(entries),stoppedMessages=len(stops),acceptance=False)
                basic_window(state,current,g,enabled)
                if enabled and current['expectation']=='fused' and g['phase']!='warm': partitions.append(positive_window(entries,stops,current,g,before,state,warm[g['program']]))
                if g['phase']=='warm': warm[g['program']]=state
            eq(a.json(run+'/window-'+str(seq).zfill(2)+'.json'),summary,'Saved window exact replay'); summaries.append(summary)
            eq(configured['seq'],seq,'Configured seq'); eq(ack['seq'],seq,'ACK seq'); need(configured['streams']['streams']['trace']['seen']==end==ack['streams']['streams']['trace']['seen'],'No execution during reset/ACK')
            nextp=0 if seq==0 else g['program']+1 if g['phase']=='direct-b' else g['program']; nextp=nextp if nextp<11 else None; eq(configured['program'],nextp,'Next program'); current=r['layout']['programs'][nextp] if nextp is not None else None; epoch+=4; fresh=native(configured,enabled); ranges(fresh,current,epoch,enabled,True); eq(fresh['c']['total'],state['c']['total'],'Paused census reset does not execute')
            for family in ('a','b'): eq(fresh[family],state[family],'Paused reset preserves lifetimes')
            eq(ack['watchEpoch'],dict(m3a=epoch,m3b=epoch,census=epoch),'ACK exact reset epochs'); before=fresh; previous=fresh; last_ack=ack['hostMs']; trace_start=end
    final=rows[-1]; eq(final['event'],'complete','Final event'); eq(final['validation'],ref_pass,'Final oracle'); last=native(final,enabled); ranges(last,None,180,enabled,True); eq(last['c']['total'],previous['c']['total'],'Final census no recorded watched entries'); terminal_end=queue(final['streams'],prefixes)['trace'];need(trace_start<=terminal_end<=trace_start+65536,'Terminal bound')
    with trace_path.open('rb') as tf:tf.seek(trace_start);tail=tf.read(terminal_end-trace_start)
    eq(terminal_end,stream_files['trace']['bytes'],'No unparsed bytes after terminal summary');need(number(final['hostMs']) and final['hostMs']>=clock,'Final clock');terminal_summary=terminal(tail,trace_start);native_path='artifacts/m3b-context-v2-source-01/source/accel/tcg/cpu-exec.c';terminal_summary.update(runtimeSourceFingerprint=FP,nativeSource=a.ref(native_path));eq(terminal_summary,r['terminalSummary'],'Independent terminal suffix');eq(a.json(run+'/terminal-summary.json'),terminal_summary,'Durable separate terminal summary')
    eq(r['final'],final,'Final raw row'); need(len(r['signals'])==len(r['gates'])==45,'Exactly 45 gates'); eq(r['stoppedWindows'],summaries,'All window copies')
    need(len(partitions)==(12 if enabled else 0),'All 12 positive windows'); eq(len(r['bodyPartitions']),len(partitions),'Reported partition count')
    for got,want in zip(r['bodyPartitions'],partitions):
        eq(got['seq'],want['seq'],'Partition seq'); need(got['windowAccepted'] is True and got['acceptance'] is False,'Diagnostic window acceptance scope'); eq(got['partition'],want['partition'],'Independent body equation'); eq(got['nativeDelta'],want['nativeDelta'],'Native delta'); eq(got['globalGuardRedispatches'],want['globalGuardRedispatches'],'Separate exact global guard redispatches'); eq(got['ownerGeneration'],want['ownerGeneration'],'Owner generation')
        eq([(x['offset'],x['successorOffset'],x['target'],x['transition']) for x in got['coverage']['classification']['certificates']],[(x['offset'],x['successorOffset'],x['target'],x['transition']) for x in want['certificates']],'Exact RF A certificates'); eq([x['offset'] for x in got['coverage']['classification']['refused']],want['refusedRfA'],'Exact RF A refusals'); eq(got['coverage']['classification']['unclassified'],[],'No unclassified RF A'); eq([(x['offset'],x['successorOffset'],x['originCertificate'],x['unassignedRoute']) for x in got['coverage']['rfBCompletions']],[(x['offset'],x['successorOffset'],x['originCertificate'],x['unassignedRoute']) for x in want['rfBCompletions']],'RF B completion evidence'); eq([x['offset'] for x in got['coverage']['refusedRfB']],want['refusedRfB'],'RF B refused evidence'); eq([x['offset'] for x in got['coverage']['unassignedDpContinuations']],want['unassignedDpRoutes'],'D/P continuation groups')
        eq(got['recorded']['unloggedNormalAttempts'],want['hiddenNormalAttempts'],'Native hidden entry coverage')
    offline=a.json(inspection+'/report.json'); eq([offline['schema'],offline['kind'],offline['status'],offline['acceptance'],offline['captureStatus'],offline['gateCount']],[1,'m3b-context-host-v5-capture-replay','passed',True,'passed',45],'Completed root offline replay'); eq(offline['run'],run,'Replay capture'); eq(offline['positiveWindows'],r['bodyPartitions'],'Same-code/independent result agreement'); eq(offline['stoppedWindows'],summaries,'Replay windows');eq(offline['terminalSummary'],terminal_summary,'Offline terminal suffix')
    for path,id in offline['inventory'].items(): a.file(path,id)
    need(run+'/report.json' in offline['inventory'],'Replay hashes capture'); eq(offline['inventory'][run+'/report.json'],a.file(run+'/report.json'),'Replay report identity')
    closed=cleanup(a,execution,run,enabled,binding_path)
    return dict(enabled=enabled,status='passed',baselinePassed=True,candidatePromotion=False,report=a.ref(run+'/report.json'),inspection=a.ref(inspection+'/report.json'),execution=closed,gates=45,guestValidation=ref_pass,censusFaults=0,censusApiRejects=0,injectionEvidence=0,positiveWindows=partitions,terminalSummary=terminal_summary,streamFiles=stream_files,chunks=len(prefixes)-1,maximumPendingBytes=r['streams']['queue']['peakPendingBytes'],scope='Complete fixed-guest baseline, exact native entry census and source-bound RF routes. No timing, natural pressure, recovery or production eligibility claim.')

def main():
    p=argparse.ArgumentParser(); p.add_argument('--off',required=True); p.add_argument('--on',required=True); p.add_argument('--off-inspection',required=True); p.add_argument('--on-inspection',required=True); p.add_argument('--off-execution',required=True); p.add_argument('--on-execution',required=True); p.add_argument('--binding',required=True); p.add_argument('--output',required=True); args=p.parse_args(); out=ROOT/args.output; need(out.parent==ROOT/'artifacts' and not out.exists(),'Fresh artifact output'); out.mkdir(); fsync(out.parent); a=Audit()
    try:
        for name in ['review.py','semantics.py','trace.py','test_review.py','README.md']: a.file('experiments/m3b-context-v3-review/'+name)
        frozen(a); b,_,_=binding(a,args.binding);eq(a.json(HOST_SOURCE)['parentBinding'],a.ref(args.binding),'Reviewed host exact runtime binding'); off=run(a,args.off,args.off_inspection,args.off_execution,False,args.binding,b); on=run(a,args.on,args.on_inspection,args.on_execution,True,args.binding,b)
        need(off['execution']['scratch']!=on['execution']['scratch'],'Distinct capture scratch'); need(utc(off['execution']['cleanupUtc'])<=utc(on['execution']['startedUtc']),'Serial cleanup before ON'); a.final()
        result=dict(schema=1,kind='m3b-context-v3-independent-baseline-replay',status='passed',baselinePassed=True,candidatePromotion=False,timingEligible=False,createdUtc=datetime.now(timezone.utc).isoformat(),binding=a.ref(args.binding),sourceManifest=a.ref(SOURCE),sourceReview=a.ref(SOURCE_REVIEW),runs=[off,on],inventory=a.inventory,limits=['Diagnostic profile1 only; production profile0 remains ineligible.','RF certificates prove completed ordinary A preludes; native attempts cover hidden normal owner/context entries; neither is a direct retired-body counter.','No natural retirement/GC, SMC recovery, production timing, DMA-generalization or full XSAVE claim.','Earlier ABI1 sticky-fault capture remains failed; no host pardon. Draft-status strings in frozen sources do not supersede actual evidence.'])
        publish(out,'review.json',result); print(json.dumps(dict(status='passed',baselinePassed=True,output=args.output+'/review.json',identities=len(a.inventory))))
    except Exception as e:
        publish(out,'failure.json',dict(schema=1,status='failed-review',baselinePassed=False,candidatePromotion=False,error=repr(e),inventory=a.inventory)); raise
if __name__=='__main__': main()
