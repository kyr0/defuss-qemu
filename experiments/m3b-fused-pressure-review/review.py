#!/usr/bin/env python3
"""Independent retained pressure replay; source draft, no VM or build API."""
import argparse
import struct
import baseline as base
from baseline import Audit,ROOT,SDK,FP,digest,loads,lines,utc,fsync,publish
from semantics import *
from pressure import Lifetime,SETTINGS,CODE,layout,completion

HERE='experiments/m3b-fused-pressure-review'
PARENT='artifacts/m3b-context-v3-review-source-02/manifest.json'
PARENT_HASH='df287a58e46cef17d203c72892faa8151ffe7f1a462890131673c7ee52fea522'
PARENT_REVIEW='artifacts/m3b-context-v3-reviewer-source-review-01/review.json'
PARENT_REVIEW_HASH='ac710a6e2762ca764b8b8d455d6b0ebccd17717ad9691b77e59d8b8d81b3f578'
SOURCE='artifacts/m3b-fused-pressure-source-01/manifest.json'
SOURCE_HASH='7f91612106b5a241e40437eba3210252d3604437b5aa473be330ceaa9e9ca795'
SOURCE_REVIEW='artifacts/m3b-fused-pressure-source-review-01/review.json'
SOURCE_REVIEW_HASH='13acace4dae3aa1456f5674799c78b3d277009c43fecb40340f9d92edd505b40'
BUILD='artifacts/m3b-fused-pressure-fixture-01/build-report.json'
BUILD_HASH='b598333e1905ae1899359fcc94576caf14e19d2c841cb7f6216a6ed8245898e9'
PROTOCOL='defuss-m3b-fused-pressure-v1'
LIMITS=dict(chunk=65536,pending=64*1024*1024,trace=0,serial=4*1024*1024,stderr=1024*1024,records=640)
FILES=['baseline.py','semantics.py','trace.py','pressure.py','review.py','test_review.py','README.md']
BEFORE_CONTROLLER='artifacts/m3b-fused-pressure-review-before-controller-pin-01/manifest.json'
CONTROLLER='tmp/m3b-fused-pressure-controller-01.py'
IMAGE_SOURCES=['tests/m3b-fused-pressure/'+n for n in ('build.py','fixture.c','fixture.S','guest-contract.mjs')]+['experiments/m3b-fallthrough/predecode.h','packaging/bun_app_package.py']+['scripts/'+n for n in ('sdk.py','build.py','container_engine.py','runtime_dependencies.py')]

def reviewed_sources(a,self_source,self_review):
    # No helper logic is accepted merely because a similarly named module exists.
    parent=a.json(PARENT,PARENT_HASH);pr=a.json(PARENT_REVIEW,PARENT_REVIEW_HASH)
    eq([pr['status'],pr['sourceBlockers'],pr['sourceManifest']],['passed',[],a.ref(PARENT)],'Frozen independent baseline reviewer accepted')
    rows={r['path']:r for r in parent['files']}
    for new,old in [('baseline.py','review.py'),('semantics.py','semantics.py'),('trace.py','trace.py')]:
        name='experiments/m3b-context-v3-review/'+old;row=rows[name];a.file(name,row);a.file(row['archive'],row);a.file(HERE+'/'+new,row)
    own=a.json(self_source);review=a.json(self_review)
    eq([own['status'],own['timingEligible']],['frozen',False],'Actual reviewer freeze')
    eq([review['status'],review['sourceBlockers'],review['sourceManifest']],['passed',[],a.ref(self_source)],'Independent reviewer source review')
    eq(sorted(r['path'] for r in own['files']),sorted(HERE+'/'+n for n in FILES),'Exact seven reviewer files')
    for r in own['files']:a.file(r['path'],r);a.file(r['archive'],r)
    for name,id in own['dependencies'].items():a.file(name,id)
    old=a.json(BEFORE_CONTROLLER,own['dependencies'][BEFORE_CONTROLLER]);eq([old['kind'],old['status']],['m3b-fused-pressure-review-before-controller-pin','preserved'],'Retained tested reviewer source')
    old_tests=a.json(old['testReport']['path'],old['testReport']);eq([old_tests['status'],old_tests['returncode'],old_tests['sourceStable']],['passed',0,True],'Passed prior synthetic checks')
    eq(sorted(r['path'] for r in old['files']),sorted(HERE+'/'+n for n in FILES),'Prior exact seven files')
    for r in old['files']:
        ident={k:r[k] for k in ('sha256','bytes')};eq(old_tests['sources'][r['path']],ident,'Prior tested exact source');eq(own['dependencies'][r['archive']],ident,'Prior archive frozen dependency');a.file(r['archive'],r)
    base.frozen(a)
    need(re.fullmatch('[0-9a-f]{64}',SOURCE_HASH) is not None and re.fullmatch('[0-9a-f]{64}',SOURCE_REVIEW_HASH) is not None,'Actual pressure freeze/review pins must replace draft placeholders')
    source=a.json(SOURCE,SOURCE_HASH);sr=a.json(SOURCE_REVIEW,SOURCE_REVIEW_HASH)
    eq([source['schema'],source['kind'],source['status'],source['timingEligible']],[1,'m3b-fused-pressure-source-freeze','frozen',False],'Pressure source contract')
    eq([sr['status'],sr['sourceBlockers'],sr['sourceManifest']],['passed',[],a.ref(SOURCE)],'Pressure independent source acceptance')
    need(len(source['files'])==17 and len({r['path'] for r in source['files']})==17,'Exact pressure source17')
    for r in source['files']:a.file(r['path'],r);a.file(r['archive'],r)
    for name,id in source['dependencies'].items():a.file(name,id)
    baseline=a.json(source['baselineReview']['path'],source['baselineReview']);eq([baseline['status'],baseline['baselinePassed'],baseline['candidatePromotion']],['passed',True,False],'Actual accepted diagnostic baseline')
    eq(source['parentBinding'],baseline['binding'],'Exact baseline runtime')
    need(type(baseline['inventory']) is dict and baseline['inventory'],'Full accepted baseline inventory')
    for name,id in baseline['inventory'].items():eq(source['dependencies'][name],id,'Baseline closure');a.file(name,id)
    return source,baseline

def arguments():
    return ['-nodefaults','-machine','pc,acpi=off,hpet=off,usb=off','-cpu','max','-global','apic.vapic=off','-accel','tcg,tb-size=256','-smp','cpus=1,maxcpus=1','-m','512','-S','-display','none','-monitor','none','-qmp','stdio','-chardev','file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1','-serial','chardev:fixture-com1','-serial','file:/guest/console.log','-parallel','none','-no-reboot','-no-shutdown','-L','/rom','-kernel','/guest/kernel','-initrd','/guest/initramfs','-append','console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on']

def fifo_source(a,recheck):
    src=recheck['source']['path'];inventory=a.json(recheck['inventory']['path'],recheck['inventory']);trees=[t for t in inventory['trees'] if t['path']==src];eq(len(trees),1,'Actual source inventory')
    path=src+'/tcg/wasm64.c';id=trees[0]['files']['tcg/wasm64.c'];text=a.read(path,id).decode()
    for token in ('#define MAX_INSTANCES 12000','#define INSTANCES_BUF_MAX (MAX_INSTANCES + 1)','static __thread struct WasmInstanceInfo instances[INSTANCES_BUF_MAX];'):
        need(text.count(token)==1,'Pinned FIFO source anchor')
    def function(name,next_name):
        start=text.index(name);return text[start:text.index(next_name,start)]
    add=function('static void add_instance(','static __thread int instance_pending_gc;')
    need('m3_note(M3_INSTANCE_INSTALLS);' in add and 'instances_end  = (instances_end + 1) % INSTANCES_BUF_MAX;' in add,'FIFO append/install counter')
    retire=function('static void remove_old_instances(','static bool can_add_instance(')
    for token in ('if (instance_pending_gc > 0)','num /= 2;','removeFunction($0);','instances[instances_begin].m3_generation = 0;','m3_note(M3_INSTANCE_RETIRES);','instances[instances_begin].tb_ptr = NULL;','instances_begin = (instances_begin + 1) % INSTANCES_BUF_MAX;','instance_pending_gc += num;'):
        need(retire.count(token)==1,'Exact oldest-half/pending-charge rule')
    need('instances_global' not in retire,'Unlink does not release charge')
    gc=function('static void check_gc_completion(','EM_JS_PRE(void, init_wasm_js,')
    for token in ('if (instance_done_gc > 0)','qatomic_sub(&instances_global, instance_done_gc);','instance_pending_gc -= instance_done_gc;','instance_done_gc = 0;'):need(gc.count(token)==1,'Completed-only reclamation accounting')
    need(text.count('qatomic_sub(&instances_global,')==1,'Sole global charge-release site')
    need('new FinalizationRegistry((i) =>' in text and 'memory_v.setInt32(DEC_PTR(instance_done_gc), v + 1, true);' in text,'Natural delivered callback marker')
    start=text.index('} else if (!reserve_instance()) {');tail=text[start:text.index('} else {',start)]
    need(tail.index('remove_old_instances();')<tail.index('check_gc_completion();')<tail.index('m3cc_note('),'Full-cap retirement before real fallback attempt')
    return dict(source=a.ref(path),cap=12000,initialRetirement=6000,semantics='Single owning worker FIFO: unlink retains charge; only completed GC callbacks consumed by existing code release it. No forced collection or callback-identity attribution.')

def image(a,report):
    eq(report['fixtureProof']['buildReport'],BUILD,'Exact actual pressure image');b=a.json(BUILD,BUILD_HASH);basepath=str(base.Path(BUILD).parent)
    eq([b['schema'],b['kind'],b['status'],b['guestExecuted'],b['timingEligible'],b['hostShapeValidated'],b['sdk']],[1,'m3b-fused-pressure-fixture-image','passed',False,False,True,SDK],'Actual compiled pressure fixture')
    eq(sorted(b['sources']),sorted(IMAGE_SOURCES),'Ten precise build inputs');eq(b['baseInitramfsSha256'],'6dde230b0e49d80c54337e2854d7cff6e8c9aa8cfa37588eaf9df4dd325a87a9','Pinned rootfs')
    eq(b['shapeEvidence'],dict(sentinelBytes=12,sentinelInstructions=5,sentinelPredecode='accept',churnNodes=12000,entriesPerChurnNode=6,churnPredecodeRejections=72000),'Actual shape probe scope')
    for name,id in b['artifacts'].items():a.file(basepath+'/'+name,id);eq(report['inputs'][basepath+'/'+name],id,'Image retained input')
    for name,id in b['sources'].items():a.file(name,id);eq(report['inputs'][name]['sha256'],id,'Build source input')
    copies={'tests/m3b-fused-pressure/fixture.c':'fixture.c','tests/m3b-fused-pressure/fixture.S':'fixture.S','experiments/m3b-fallthrough/predecode.h':'predecode.h'};eq(sorted(b['copiedSources']),sorted(copies),'Exact compiler copies')
    for name,artifact in copies.items():
        r=b['copiedSources'][name];eq(r['artifact'],artifact,'Copy path');eq(r['sha256'],b['sources'][name],'Compile same source');a.file(name,r);a.file(basepath+'/'+artifact,r)
    eq(sorted(b['tools']),['gcc','nm','objdump'],'Tool identities');need(re.fullmatch(r'x86_64.*linux.*',b['compilerTarget']) is not None,'Target architecture')
    out='/project/'+basepath;scratch='/project/'+b['scratch'];need(re.fullmatch(r'tmp/m3b-pressure-image-[A-Za-z0-9_-]+',b['scratch']) is not None,'Owned image scratch')
    tools=b['tools'];cmds=[[tools[n]['path'],'--version'] for n in ('gcc','nm','objdump')]+[[tools['gcc']['path'],'-dumpmachine'],[tools['gcc']['path'],'-O2','-static','-fno-pie','-no-pie','-mno-red-zone','-fno-tree-vectorize','-fno-tree-slp-vectorize',out+'/fixture.c',out+'/fixture.S','-o',out+'/fixture'],[tools['nm']['path'],'-n','--defined-only',out+'/fixture'],[tools['objdump']['path'],'-d','-w','--no-show-raw-insn',out+'/fixture'],[tools['gcc']['path'],'-std=c11','-O2','-I'+out,out+'/shape-probe.c','-o',scratch+'/shape-probe'],[scratch+'/shape-probe']]
    eq([r['argv'] for r in b['commands']],cmds,'Exact nine compiler/probe commands')
    for i,row in enumerate(b['commands']):
        eq(row['exitCode'],0,'Actual SDK command success');need(type(row['stdout']) is str and type(row['stderr']) is str,'Retained command output');eq(a.json(basepath+'/command-'+str(i+1).zfill(2)+'.json'),row,'Durable individual SDK command')
    for i,name in enumerate(('gcc','nm','objdump')):
        t=tools[name];need(t['path'].startswith('/') and re.fullmatch('[0-9a-f]{64}',t['sha256']) is not None and integer(t['bytes'],1<<53) and t['bytes']>0,'Recorded SDK compiler identity');eq(t['version'],b['commands'][i]['stdout'],'Compiler version bytes')
    eq(b['commands'][3]['stdout'].strip(),b['compilerTarget'],'Actual compiler target')
    elf=a.json(basepath+'/layout.json');eq(elf,b['layout'],'Actual symbol layout');binary=a.read(basepath+'/fixture',b['artifacts']['fixture']);need(binary[:6]==b'\x7fELF\x02\x01','ELF64 little endian')
    need(struct.unpack_from('<HH',binary,16)==(2,62),'Static x86-64 executable');phoff,shoff=struct.unpack_from('<QQ',binary,32);phsize,phnum,shsize,shnum,strings=struct.unpack_from('<HHHHH',binary,54);need(phsize==56 and shsize==64 and 0<shnum<4096,'ELF table dimensions')
    need(all(struct.unpack_from('<I',binary,phoff+i*phsize)[0]!=3 for i in range(phnum)),'No interpreter')
    sections=[struct.unpack_from('<IIQQQQIIQQ',binary,shoff+i*64) for i in range(shnum)];st=sections[strings];names=binary[st[4]:st[4]+st[5]];texts=[s for s in sections if names[s[0]:].split(b'\0',1)[0]==b'.text'];eq(len(texts),1,'ELF text');text=texts[0]
    p=elf['sentinel'];addr=int(p['a'],16);offset=text[4]+addr-text[3];need(text[2]&4 and text[3]<=addr-4<addr+13<=text[3]+text[5],'Executable owner extent');need(binary[offset-4:offset+13]==bytes.fromhex('89f931c0'+CODE+'c3'),'Actual ELF prelude/owner/return')
    symbols=a.read(basepath+'/symbols.txt').decode();symbolmap={m[2]:int(m[1],16) for line in symbols.splitlines() if (m:=re.fullmatch(r'([0-9a-f]+)\s+\w\s+(\S+)',line))}
    for key,suffix in [('a','_loop'),('b','_b'),('back','_back'),('side','_side'),('end','_end')]:eq(symbolmap['pressure_sentinel'+suffix],int(p[key],16),'Actual linked symbol')
    dis=a.read(basepath+'/disassembly.txt').decode();pcs=[int(m[1],16) for line in dis.splitlines() if (m:=re.match(r'^\s*([0-9a-f]+):\s+\S',line))];eq([pc for pc in pcs if addr<=pc<addr+12],[addr,addr+3,addr+5,addr+7,addr+10],'Five authoritative instruction boundaries')
    start=a.json(basepath+'/sdk-invocation-start.json');path=b['sdkInvocation']['path'];complete=a.json(path,report['inputs'][path]);need(re.fullmatch(r'tmp/sdk-[A-Za-z0-9_-]+/invocation.json',path) is not None,'Owned SDK invocation')
    eq([start['schema'],start['status'],start['sdk']],[1,'running',SDK],'SDK start');eq([complete['status'],complete['returncode']],['passed',0],'SDK completion')
    eq({k:v for k,v in complete.items() if k not in ('status','returncode','finishedUtc')},{k:v for k,v in start.items() if k!='status'},'Exact start/completion preservation');need(utc(complete['finishedUtc'])>=utc(start['startedUtc']),'SDK time order')
    sc=str(base.Path(path).parent);eq([start['scratch'],start['containerScratch']],[str(ROOT/sc),'/project/'+sc],'Project-owned SDK scratch')
    tail=['run','--rm','--platform','linux/amd64','--network','none','-e','TMPDIR=/project/'+sc,'-e','TMP=/project/'+sc,'-e','TEMP=/project/'+sc,'-v',str(ROOT)+':/project','-v','qemu-wasm-arm64-sdk-cache:/emsdk/upstream/emscripten/cache','-w','/project',SDK,'python3','tests/m3b-fused-pressure/build.py','--output',basepath];eq(start['command'][-len(tail):],tail,'Pinned offline image SDK command')
    saved=report['fixtureProof']['sdkCompletion'];eq(saved['path'],'sdk-invocation-complete.json','Retained completion path');return basepath,elf,dict(build=a.ref(BUILD),sdk=a.ref(path),saved=saved)

def controller_identity(copied,declared,frozen):
    need(type(declared) is str and re.fullmatch('[0-9a-f]{64}',declared) is not None,'Declared controller identity')
    eq(sorted(copied),['bytes','sha256'],'Exact copied controller identity');eq(sorted(frozen),['bytes','sha256'],'Exact frozen controller identity')
    need(integer(copied['bytes'],1<<53) and copied['bytes']>0,'Controller byte count')
    eq(copied['sha256'],declared,'Controller agrees with execution request');eq(copied,frozen,'Controller agrees with frozen pressure source')

def closed(a,path,run,enabled,binding_path):
    x=a.json(path+'/execution.json');request=a.json(path+'/request.json');eq(x['request'],request,'Durable controller request');eq([x['schema'],x['returncode'],x['timedOut'],x.get('error'),x.get('cleanupError'),x['outerDeadlineSeconds']],[1,0,False,None,None,1500],'Successful bounded actual execution')
    need(number(x['elapsedSeconds']) and x['elapsedSeconds']<1500,'Actual elapsed bound');eq(request['outerDeadlineSeconds'],1500,'Prospective deadline');need(request['scratch'].startswith(str(ROOT/'tmp')+'/'),'Owned project scratch')
    expected=['tests/m3b-fused-pressure/run.mjs','--binding',binding_path,'--fixture',str(base.Path(BUILD).parent),'--source-manifest',SOURCE,'--source-review',SOURCE_REVIEW,'--enabled',str(int(enabled)),'--timeout','1200000','--output',run];eq(request['argv'][1:],expected,'Exact actual runner invocation')
    eq(request['argv'][0],request['node']['path'],'Actual Node path');frozen_controller=a.json(SOURCE,SOURCE_HASH)['dependencies'][CONTROLLER];a.file(CONTROLLER,frozen_controller);controller_identity(a.file(path+'/controller.py'),request['controllerSha256'],frozen_controller);process=a.json(path+'/process.json');need(integer(process['pid'],1<<31) and process['pid']>0,'Owned process');eq(process['processGroup'],process['pid'],'Own process group')
    for name in ('stdout.log','stderr.log'):a.file(path+'/'+name)
    c=a.json(path+'/browser-cleanup.json');eq([c['status'],c['ownedScratch'],c['remainingProfileProcesses']],['passed',request['scratch'],[]],'Owned Chrome terminated');need(utc(c['checkedUtc'])>=utc(x['completedUtc'])>utc(request['startedUtc']),'Cleanup after actual exit')
    return dict(execution=a.ref(path+'/execution.json'),cleanup=a.ref(path+'/browser-cleanup.json'),scratch=request['scratch'],startedUtc=request['startedUtc'],completedUtc=x['completedUtc'],cleanupUtc=c['checkedUtc'])

def run(a,name,inspection,execution,enabled,binding_path,b):
    r=a.json(name+'/report.json');eq([r['schema'],r['protocol'],r['status'],r['enabled'],r['timingEligible'],r['naturalLifetimeOnly']],[1,PROTOCOL,'passed',enabled,False,True],'Complete diagnostic pressure capture required');eq(r['inputRecheck'],[],'Input drift');eq(r['oracleFailure'],None,'No refused native observation');eq(r['limits'],LIMITS,'Fixed pressure transport');eq(r['settings'],SETTINGS,'Fixed pressure work');eq(r['timeoutMs'],1200000,'Exact guest deadline');eq(r['arguments'],arguments(),'Strict256MiB/no-trace profile')
    for k in ('failure','pauseFailure','drainFailure'):need(k not in r or r[k] is None,'Capture failure '+k)
    eq([r['endStatus'].get('running'),r['endStatus']['status']],[False,'paused'],'Final externally stopped');base.host(r);eq(r['hostCondition']['expected'],dict(name='builder',status='Stopped',memory=12884901888),'Fixed host condition')
    for k in ('hostBefore','hostAfter'):eq(r[k]['status']['memory'],12884901888,'Fixed builder RAM');eq(r[k]['status'].get('errors',[]),[],'Host status errors')
    eq(r['runtimeProof']['binding'],b,'Exact runtime');eq(r['runtimeProof']['bindingPath'],binding_path,'Binding path');eq(r['runtimeProof']['sourceFingerprint'],FP,'Built source fingerprint')
    eq(r['sourceProof']['sourceManifest'],a.ref(SOURCE),'Exact pressure source');eq(r['sourceProof']['sourceReview'],a.ref(SOURCE_REVIEW),'Pressure source review');eq(r['sourceProof']['parentBinding'],a.ref(binding_path),'Source same runtime')
    eq(r['configuration'],dict(enabled=enabled,profile=1,phase='preRun-before-vCPU',returnCode=0,status=11 if enabled else 10,census=dict(enabled=True,phase='preRun-before-vCPU',returnCode=0,status=3,abi=dict(version=2,words=2400,slots=4)),m3aEnabled=True,hotLimit=1500,flags=3,instanceLimit=12000),'Immutable settings before execution')
    for path,id in r['inputs'].items():a.file(path,id)
    for path,id in r['served'].items():eq(r['inputs'].get(path),id,'Served payload identity')
    fixture,elf,image_proof=image(a,r);saved=image_proof['saved'];need(a.read(name+'/'+saved['path'],saved)==a.read(image_proof['sdk']['path'],image_proof['sdk']),'Copied completed SDK invocation')
    required=['tests/m3b-context-accounting-v2/census-browser.mjs','tests/m3b-fused-pressure/guest.mjs','tests/m3b-fused-pressure/config.mjs','tests/m3b-fused-pressure/guest-contract.mjs','tests/m3b-fused-pressure/transport.mjs','tests/m3b-fallthrough/guest.mjs','tests/m3b-fallthrough/reader.mjs','experiments/m3a-region/reader.mjs','host/browser/qmp.mjs','host/browser/machine.mjs','packaging/bun-app/serial.mjs',fixture+'/initramfs.cpio.gz',b['runtime']+'/qemu-system-x86_64.js',b['runtime']+'/qemu-system-x86_64.wasm',*b['assets']]
    for path in required:need(path in r['served'],'Required actual served module/payload '+path)
    raw,prefixes,stream_files=base.chunks(a,name,r);eq(stream_files['trace']['bytes'],0,'Pressure trace disabled');base.queue(r['streams'],prefixes);eq(r['streams']['chunks'],len(prefixes)-1,'Final drained chunks');eq(lines(raw['events']),[],'No hidden host failure event')
    need(len(raw['progress'])<=16*1024*1024 and len(raw['chunks'])<=32*1024*1024,'Raw metadata bounds');journal=lines(raw['progress']);need(1<len(journal)<=640,'Bounded journal');rows=[]
    for i,envelope in enumerate(journal):eq([envelope['schema'],envelope['record']],[1,i],'Durable record order');utc(envelope['utc']);rows.append(envelope['observation'])
    header=rows[0];eq([header['schema'],header['event'],header['protocol'],header['enabled']],[1,'header',PROTOCOL,enabled],'Prelaunch durable header')
    for key in ('inputs','limits','settings','timeoutMs','sourceProof','fixtureProof','hostCondition','hostBefore','chrome','arguments'):eq(header[key],r[key],'Header/report agreement '+key)
    eq(header['binding'],b,'Header binding');layout(r['layout']);eq(elf,dict(schema=1,sentinel=r['layout']['sentinel']),'Actual source-linked static sentinel')
    serial=raw['serial'].decode('utf-8').replace('\r','');need(not re.search(r'M3B_PRESSURE_FAIL:|BUN_APP_FAILURE|Kernel panic',serial),'Raw serial fatal marker');records=[]
    for line in serial.splitlines():
        if line.startswith('M3B_PRESSURE_'):
            match=re.fullmatch(r'M3B_PRESSURE_(LAYOUT|GATE|PASS):(.*)',line);need(match is not None,'Unknown pressure serial record');records.append((match[1],loads(match[2])))
    s=rows[1];eq(s['event'],'startup','Startup ordering');eq(s['startupFailure'],None,'No startup failure');need(len(s['startupCpus'])==1,'One native CPU');eq(s['startupCpus'][0]['cpu-index'],0,'Boot CPU')
    literal=a.read(b['graphContract']['path']).decode()
    for label in ('graph','objects'):
        found=re.findall(r'static const char m3b_expected_'+label+r'\[\] =\s*((?:"[^"\n]*"\s*)+);',literal);need(len(found)==1,'Exact frozen native graph literal');text=''.join(loads(q) for q in re.findall(r'"[^"\n]*"',found[0]));eq(s[label+'Raw'],list(text.encode()),'Native graph closure')
    oracle=Lifetime(enabled,elf);last_chunks=0;gate_rows=[]
    for row in rows[1:]:
        base.queue(row['streams'],prefixes);need(row['streams']['chunks']>=last_chunks,'Monotonic durable byte prefix');last_chunks=row['streams']['chunks'];oracle.accept(row)
        if row['event']=='gate':
            seq=row['seq'];gate_rows.append(row);actual=r['gates'][seq];eq({k:v for k,v in actual.items() if k not in ('ackHostMs','contHostMs')},row,'Retained gate/raw observation exact');eq(row['signalHostMs'],r['signals'][seq],'COM1 signal record');need(number(actual['ackHostMs']) and number(actual['contHostMs']) and row['readHostMs']<=actual['ackHostMs']<=actual['contHostMs'],'ACK after durable validation')
        elif row['event']=='ack':eq(row['hostMs'],r['gates'][row['seq']]['ackHostMs'],'Recorded ACK clock')
    eq(oracle.phase,'done','Closed state machine');eq(oracle.status,'passed','Natural same-owner reinstantiation actually observed');eq(len(gate_rows),oracle.seq,'All gates retained');eq(len(r['gates']),oracle.seq,'Report gate count');eq(len(r['signals']),oracle.seq,'Exact signal count');need(4<=oracle.seq<=206,'Bounded complete work')
    eq(len(rows),2*oracle.seq+4,'Header/startup/gates/one-reset/ACKs/complete only');eq(records,[('LAYOUT',r['layout'])]+[('GATE',g) for g in oracle.gates]+[('PASS',completion(oracle.nodes,oracle.attempts))],'Independent raw serial work oracle')
    eq(r['startup'],rows[1],'Startup copy');eq(r['final'],rows[-1],'Complete copy')
    independent=oracle.summary()
    for key in ('status','enabled','nodes','attempts','warmSeq','retirementSeq','reinstantiationSeq','fullCapWithoutNewCompiledObservation'):eq(r['lifetime'][key],independent[key],'Lifetime summary derived independently '+key)
    replay=a.json(inspection+'/report.json');eq([replay['status'],replay['acceptance'],replay['timingEligible'],replay['run'],replay['captureStatus']],['passed',True,False,name,'passed'],'Separate completed offline byte replay');eq(replay['gateCount'],oracle.seq,'Offline gate count');eq(replay['lifetime'],r['lifetime'],'Offline original summary');need(type(replay['inventory']) is dict,'Offline identities')
    for path,id in replay['inventory'].items():a.file(path,id)
    close=closed(a,execution,name,enabled,binding_path)
    return dict(enabled=enabled,status='passed',lifetimePassed=True,timingEligible=False,report=a.ref(name+'/report.json'),inspection=a.ref(inspection+'/report.json'),execution=close,image=image_proof,independent=independent,streamFiles=stream_files,chunks=len(prefixes)-1,scope='Same-descriptor compiled sentinel after ordinary oldest-half retirement and naturally released charged capacity. No unique GC callback, body-retirement, suspended-reference or timing claim.')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ('off','on','off-inspection','on-inspection','off-execution','on-execution','binding','reviewer-source','reviewer-review','output'):p.add_argument('--'+key,required=True)
    args=p.parse_args();out=ROOT/args.output;need(out.parent==ROOT/'artifacts' and not out.exists(),'Fresh output');out.mkdir();fsync(out.parent);a=Audit()
    try:
        source,baseline=reviewed_sources(a,args.reviewer_source,args.reviewer_review);b,_,recheck=base.binding(a,args.binding);eq(source['parentBinding'],a.ref(args.binding),'Unchanged reviewed runtime');eq(baseline['binding'],a.ref(args.binding),'Baseline runtime');fifo=fifo_source(a,recheck)
        off=run(a,args.off,args.off_inspection,args.off_execution,False,args.binding,b);on=run(a,args.on,args.on_inspection,args.on_execution,True,args.binding,b);need(off['execution']['scratch']!=on['execution']['scratch'],'Distinct scratch');need(utc(off['execution']['cleanupUtc'])<=utc(on['execution']['startedUtc']),'Serial lifecycle')
        a.final();result=dict(schema=1,kind='m3b-fused-pressure-independent-review',status='passed',lifetimePassed=True,candidatePromotion=False,timingEligible=False,binding=a.ref(args.binding),sourceManifest=a.ref(SOURCE),sourceReview=a.ref(SOURCE_REVIEW),baselineReview=source['baselineReview'],reviewerSource=a.ref(args.reviewer_source),reviewerReview=a.ref(args.reviewer_review),fifoSource=fifo,runs=[off,on],inventory=a.inventory,limits=['One fixed profile1 CPU,512MiB private RAM,256MiB TCG storage,hot1500/flags3/cap12000.','Only the first6000 retirement and same static descriptor compiled reentry; global invalidations/stale misses are not assigned to a particular callback.','Natural collection may fail to complete within16 bounded revisits; such a capture is incomplete and cannot pass this reviewer.','No forced GC, general async suspended-function lifetime, active SMC, production128MiB or performance acceptance.'])
        publish(out,'review.json',result);print(base.json.dumps(dict(status='passed',lifetimePassed=True,identities=len(a.inventory),output=args.output+'/review.json')))
    except Exception as e:
        publish(out,'failure.json',dict(schema=1,status='failed-review',lifetimePassed=False,candidatePromotion=False,error=repr(e),inventory=a.inventory));raise
if __name__=='__main__':main()
