#!/usr/bin/env python3
"""Independent typed-recovery replay. Draft; execute only in root-authorized gap."""
import baseline as base
from baseline import *
from recovery import recovery_native,typed_mutation,recovery_window,monotonic,same_injection

PROTOCOL='defuss-m3b-context-recovery-v2'
RECOVERY_SOURCE='artifacts/m3b-context-recovery-v2-source-02/manifest.json'
RECOVERY_SOURCE_HASH='1fc2b5ab4a10ccfd5b55894e6d6b74b8cd191ecf5e2f29c16f60b2ba1f1d4c09'
RECOVERY_REVIEW='artifacts/m3b-context-recovery-v2-source-review-02/review.json'
RECOVERY_REVIEW_HASH='ce9a0fbeffa64260385439bfc193360714e52de15b18a5c2a97db6c96a64c16f'
BASELINE='artifacts/m3b-context-v2-baseline-review-01/review.json'
BASELINE_HASH='8a57a079a6566deed0724fb3164d76beb7517df2b23e6297c9d4b312f39f30ce'


PRIOR_SOURCE='artifacts/m3b-context-recovery-review-source-01/manifest.json'
PRIOR_SOURCE_HASH='5c72f0a4e8f3c189440631af324b9da46a57b77cd8d68944a942a95840a18b53'
PRIOR_REVIEW='artifacts/m3b-context-recovery-reviewer-source-review-01/review.json'
PRIOR_REVIEW_HASH='eeaebb0027e8cbba69d47a5d5ba93506cd6411161a0383e0f5b59586546a235d'
PRIOR_FAILURE='artifacts/m3b-context-recovery-v2-review-01/failure.json'
DIAGNOSIS='artifacts/m3b-context-recovery-review-representation-diagnosis-01/review.json'
DIAGNOSIS_HASH='ff207ad95f3ef88dcfc0e0fa03fc4187a3c46d7ee82841f75aacda25a9a97559'

def prior_failure(a):
    manifest=a.json(PRIOR_SOURCE,PRIOR_SOURCE_HASH);review=a.json(PRIOR_REVIEW,PRIOR_REVIEW_HASH)
    eq(manifest['status'],'frozen','Original seven sources frozen');eq([review['status'],review['sourceBlockers'],review['sourceManifest']],['passed',[],a.ref(PRIOR_SOURCE)],'Original independent source review')
    need(len(manifest['files'])==7,'Exact original source closure')
    for row in manifest['files']:a.file(row['path'],row);a.file(row['archive'],row)
    for path,id in manifest['dependencies'].items():a.file(path,id)
    failed=a.json(PRIOR_FAILURE);eq([failed['status'],failed['typedRecoveryPassed'],failed['candidatePromotion'],failed['error']],['failed-review',False,False,"ValueError('Exact source-bound old-owner refusal stop')"],'Exact retained failed replay')
    for path,id in failed['inventory'].items():a.file(path,id)
    diagnosis=a.json(DIAGNOSIS,DIAGNOSIS_HASH);eq(diagnosis['status'],'reviewed-representation-mismatch','Bounded diagnosis');eq(diagnosis['priorFailure'],a.ref(PRIOR_FAILURE),'Diagnosis exact failed attempt')
    return failed

def canonical_stop(stop,raw,window_start):
    # Serialization only: no execution/census/owner/refusal classification is
    # changed. Reconstruct the JS six-field report from the same original bytes.
    eq(sorted(stop),sorted(['start','end','pointer','pc','precedingEntry']),'Independent stop field set')
    need(type(raw)is bytes and len(raw)<=128*1024*1024 and integer(window_start,512*1024*1024) and window_start+len(raw)<=512*1024*1024,'Original bounded window bytes')
    need(integer(stop['start'],1<<53) and integer(stop['end'],1<<53) and window_start<=stop['start']<stop['end']<=window_start+len(raw),'Exact stop byte interval')
    for key in ('pc','pointer'):need(integer(stop[key],U64) and stop[key]>0,'Exact uint64 stop '+key)
    need(stop['precedingEntry'] is None or integer(stop['precedingEntry'],1<<53),'Exact preceding-entry identity')
    lo=stop['start']-window_start;hi=stop['end']-window_start;need(lo==0 or raw[lo-1]==10,'Stop starts at complete line boundary');line=raw[lo:hi];need(line.endswith(b'\n') and line.count(b'\n')==1,'One exact complete stop line');text=line[:-1]
    if text.endswith(b'\r'):text=text[:-1]
    need(b'\r'not in text,'Only the parser-supported single terminal CR')
    match=re.fullmatch(rb'Stopped execution of TB chain before (0x[0-9a-f]+) \[([0-9a-f]{16})\](?: .*)?',text);need(match is not None,'Original stopped-chain syntax')
    eq([int(match[1],16),int(match[2],16)],[stop['pointer'],stop['pc']],'Raw stop values match independent classified record')
    return dict(start=stop['start'],end=stop['end'],line=raw[:lo].count(b'\n')+1,pointer=hx(stop['pointer']),pc=hx(stop['pc']),precedingEntry=stop['precedingEntry'])

def frozen(a):
    base.frozen(a)
    m=a.json(RECOVERY_SOURCE,RECOVERY_SOURCE_HASH);r=a.json(RECOVERY_REVIEW,RECOVERY_REVIEW_HASH)
    eq([m['schema'],m['kind'],m['status'],m['timingEligible']],[1,'m3b-context-recovery-v2-source-freeze','frozen',False],'Exact recovery source')
    eq([r['status'],r['sourceBlockers'],r['sourceManifest']],['passed',[],a.ref(RECOVERY_SOURCE)],'Independent recovery source review')
    need(len(m['files'])==15 and len({x['path']for x in m['files']})==15,'Exact recovery source closure')
    for row in m['files']:a.file(row['path'],row);a.file(row['archive'],row)
    for name,id in m['dependencies'].items():a.file(name,id)
    eq(m['hostSourceManifest'],a.ref(HOST_SOURCE),'Reviewed v5 host parent');eq(m['hostSourceReview'],a.ref(HOST_REVIEW),'Reviewed host source proof')
    baseline=a.json(BASELINE,BASELINE_HASH);eq([baseline['status'],baseline['baselinePassed'],baseline['candidatePromotion']],['passed',True,False],'Actual accepted diagnostic baseline')
    eq(m['baselineReview'],a.ref(BASELINE),'Exact prerequisite baseline');eq(m['parentBinding'],baseline['binding'],'Unchanged exact runtime')
    for path,id in baseline['inventory'].items():eq(m['dependencies'][path],id,'Full baseline evidence retained');a.file(path,id)
    return m,baseline

def mutation_summary(seq,result):
    need(integer(seq) and seq in (1,5),'Exact mutation summary sequence')
    return dict(seq=seq,**result,scope='Paused metadata injection only; subsequent exact recovery remains required.')

def cleanup(a,execution,run,enabled,binding_path):
    x=a.json(execution+'/execution.json'); c=a.json(execution+'/browser-cleanup.json'); eq(x['schema'],1,'Execution schema'); eq(x['returncode'],0,'Actual process success'); eq(x['timedOut'],False,'No timeout'); eq(x['outerDeadlineSeconds'],2100,'Outer bound'); need(number(x['elapsedSeconds']) and x['elapsedSeconds']<2100,'Bounded completion')
    req=x['request']; need(req['scratch'].startswith(str(ROOT/'tmp')+'/'),'Project scratch'); args=req['argv']; eq(args[1:],['tests/m3b-context-recovery-v2/run.mjs','--binding',binding_path,'--fixture','artifacts/m3b-fixture-01','--source-manifest',RECOVERY_SOURCE,'--source-review',RECOVERY_REVIEW,'--enabled',str(int(enabled)),'--timeout','1800000','--output',run],'Exact actual capture argv'); eq(x.get('error'),None,'No controller error'); eq(x.get('cleanupError'),None,'No controller cleanup error')
    eq(c['status'],'passed','Owned browser cleanup'); eq(c['ownedScratch'],req['scratch'],'Owned scratch linkage'); eq(c['remainingProfileProcesses'],[],'No owned Chrome remains'); need(utc(c['checkedUtc'])>=utc(x['completedUtc'])>utc(req['startedUtc']),'Cleanup after process exit'); a.file(execution+'/controller.py',req['controllerSha256'])
    return dict(execution=a.ref(execution+'/execution.json'),cleanup=a.ref(execution+'/browser-cleanup.json'),scratch=req['scratch'],startedUtc=req['startedUtc'],completedUtc=x['completedUtc'],cleanupUtc=c['checkedUtc'])

def run(a,run,inspection,execution,enabled,binding_path,b):
    r=a.json(run+'/report.json'); eq([r['schema'],r['protocol'],r['status'],r['enabled'],r['timingEligible'],r['contextAcceptanceIntegrated']],[1,PROTOCOL,'passed',enabled,False,True],'Passed diagnostic capture'); eq(r['inputRecheck'],[],'No input drift'); eq(r['oracleFailure'],None,'No oracle failure'); eq(r['limits'],LIMITS,'Fixed bounds'); eq(r['timeoutMs'],1800000,'Prospective deadline')
    for k in ('failure','pauseFailure','drainFailure'): need(k not in r or r[k] is None,'Capture failure '+k)
    eq(r['endStatus'].get('running'),False,'Final paused'); eq(r['endStatus']['status'],'paused','Final stop state'); host(r)
    eq(r['runtimeProof']['binding'],b,'Actual runtime binding'); eq(r['runtimeProof']['bindingPath'],binding_path,'Binding path'); eq(r['runtimeProof']['sourceFingerprint'],FP,'Runtime fingerprint'); eq(r['sourceProof']['sourceManifest'],a.ref(RECOVERY_SOURCE),'Frozen host source'); eq(r['sourceProof']['sourceReview'],a.ref(RECOVERY_REVIEW),'Frozen host source review'); eq(r['sourceProof']['hostSourceProof']['parentSourceProof']['parentSourceProof']['parentSourceProof']['sourceManifest'],a.ref(SOURCE),'Frozen native/accounting parent')
    eq(r['sourceProof']['hostSourceProof']['sourceManifest'],a.ref(HOST_SOURCE),'Actual v5 host source');eq(r['sourceProof']['baselineReview'],a.ref(BASELINE),'Actual baseline prerequisite')
    layout_check(r['layout']); eq(r['arguments'],argv(r['layout']),'Exact diagnostic CLI'); base=fixture(a,r)
    eq(r['configuration'],dict(enabled=enabled,profile=1,phase='preRun-before-vCPU',returnCode=0,status=11 if enabled else 10,census=dict(enabled=True,phase='preRun-before-vCPU',returnCode=0,status=3,abi=dict(version=2,words=2400,slots=4)),m3aEnabled=True,hotLimit=1500,flags=2,instanceLimit=12000),'One-time actual configuration')
    for path,id in r['inputs'].items(): a.file(path,id)
    for path,id in r['served'].items(): eq(r['inputs'].get(path),id,'Served identity')
    for path in ['tests/m3b-context-accounting-v3/census-browser.mjs','tests/m3b-context-recovery-v2/typed.mjs','tests/m3b-context-recovery-v2/guest.mjs','tests/m3b-context-recovery-v2/config.mjs','tests/m3b-context-runner-v5/config.mjs','tests/m3b-context-runner-v5/transport.mjs','tests/m3b-fallthrough/guest.mjs','tests/m3b-fallthrough/reader.mjs','experiments/m3a-region/reader.mjs','host/browser/qmp.mjs','host/browser/machine.mjs','packaging/bun-app/serial.mjs',base+'/initramfs.cpio.gz',b['runtime']+'/qemu-system-x86_64.js',b['runtime']+'/qemu-system-x86_64.wasm',*b['assets']]: need(path in r['served'],'Required served source '+path)
    raw,prefixes,stream_files=chunks(a,run,r); queue(r['streams'],prefixes); eq(r['streams']['chunks'],len(prefixes)-1,'Final drained chunk count'); eq(lines(raw['events']),[],'No durable error events')
    journal=lines(raw['progress']); need(len(journal)==(142 if enabled else 138),'Exact header/startup/45 gates/two typed mutation pairs/complete')
    for i,x in enumerate(journal): eq([x['schema'],x['record']],[1,i],'Durable journal order'); utc(x['utc'])
    rows=[x['observation'] for x in journal]; header=rows[0]; eq([header['schema'],header['event'],header['protocol'],header['enabled']],[1,'header',PROTOCOL,enabled],'Durable prelaunch header')
    for key in ['inputs','limits','trace','timeoutMs','sourceProof','fixtureProof','hostCondition','hostBefore','chrome','arguments']: eq(header[key],r[key],'Header/report '+key)
    eq(header['binding'],b,'Prelaunch binding'); ref_gates,ref_pass=reference(); serial=raw['serial'].decode('utf-8').replace('\r',''); need(not re.search(r'M3B_FAIL:|BUN_APP_FAILURE|Kernel panic',serial),'Guest failure marker')
    records=[]
    for line in serial.splitlines():
        if line.startswith('M3B_'):
            m=re.fullmatch(r'M3B_(LAYOUT|GATE|PASS):(.*)',line); need(m is not None,'Unknown raw guest record'); records.append((m[1],loads(m[2])))
    eq(records,[('LAYOUT',r['layout'])]+[('GATE',g) for g in ref_gates]+[('PASS',ref_pass)],'Independent guest oracle/raw serial')
    startrow=rows[1]; eq(startrow['event'],'startup','Startup order'); eq(startrow['startupFailure'],None,'No startup failure'); need(len(startrow['startupCpus'])==1 and startrow['startupCpus'][0]['cpu-index']==0,'One actual CPU'); state=recovery_native(startrow,enabled,'startup',0); ranges(state,None,0,enabled,True); eq(r['startup'],startrow,'Startup copy')
    header_text=a.read(b['graphContract']['path']).decode();
    for label,key in [('graph','graphRaw'),('objects','objectsRaw')]:
        # Actual native byte arrays must equal the frozen literal, not a QOM approximation.
        matches=re.findall(r'static const char m3b_expected_'+label+r'\[\] =\s*((?:"[^"\n]*"\s*)+);',header_text)
        need(len(matches)==1,'Exact frozen '+label+' literal'); literal=''.join(loads(s) for s in re.findall(r'"[^"\n]*"',matches[0])); eq(startrow[key],list(literal.encode()),'Native frozen '+label)
    trace_start=queue(startrow['streams'],prefixes)['trace']; previous=state; current=None; before=None; warm={}; partitions=[]; summaries=[]; clock=startrow['hostMs']; last_ack=0; lastchunks=startrow['streams']['chunks']; epoch=0; cursor=2; mutation_rows=[]; mutation_results=[]; fresh_owner=None; recovery_summary=dict(injections=[],stale=None,invalid=None); lifetime_guard=None
    trace_path=a.path(run+'/native-trace.log')
    with trace_path.open('rb') as tf:
        for seq,g in enumerate(ref_gates):
            gate=rows[cursor];cursor+=1;request=mutation=None
            if enabled and seq in (1,5):request,mutation=rows[cursor:cursor+2];cursor+=2
            configured,ack=rows[cursor:cursor+2];cursor+=2; eq([gate['event'],configured['event'],ack['event']],['gate','configured','ack'],'Exact stopped/ACK sequence'); eq(gate['gate'],g,'Independent gate oracle'); eq(gate['signalHostMs'],r['signals'][seq],'Signal order'); need(number(gate['signalHostMs']) and gate['signalHostMs']>=last_ack and gate['readHostMs']>=gate['signalHostMs'],'Gate clocks')
            copy={k:v for k,v in r['gates'][seq].items() if k not in ('ackHostMs','contHostMs')}; eq(copy,gate,'Raw gate retained'); need(gate['readHostMs']<=r['gates'][seq]['ackHostMs']<=r['gates'][seq]['contHostMs'],'ACK after persisted stop')
            for row in ([gate,request,mutation,configured,ack] if request else [gate,configured,ack]):
                t=row.get('readHostMs',row.get('hostMs')); need(number(t) and t>=clock,'Monotonic host observations'); clock=t; prefix=queue(row['streams'],prefixes); need(row['streams']['chunks']>=lastchunks,'Chunk prefix monotonic'); lastchunks=row['streams']['chunks']
            end=gate['streams']['streams']['trace']['seen']; need(trace_start<=end and end-trace_start<=128*1024*1024,'Trace window bound'); state=recovery_native(gate,enabled,'gate',seq);same_injection(previous,state); ranges(state,current,epoch,enabled,seq==0)
            for family in ('a','b'):
                need(all(state[family][k]>=previous[family][k] for k in previous[family]),'Lifetime counter monotonic')
            need(state['c']['total']>=previous['c']['total'],'Census lifetime monotonic')
            if seq==0:
                eq(gate['layout'],r['layout'],'Gate0 layout'); summary=dict(schema=1,seq=0,status='boot-prefix-not-analyzed',start=trace_start,end=end,bytes=end-trace_start,acceptance=False)
            else:
                eq(g['program'],(seq-1)//4,'Program order'); eq(state['c']['total']-before['c']['total'],state['c']['slots'][0]['total'],'Exact native window lifetime')
                tf.seek(trace_start); data=tf.read(end-trace_start); eq(len(data),end-trace_start,'Window bytes'); entries,stops=parse(data,trace_start)
                summary=dict(schema=1,seq=seq,status='parsed-only',start=trace_start,end=end,bytes=end-trace_start,sha256=digest(data),outerEntries=len(entries),stoppedMessages=len(stops),acceptance=False)
                if enabled and current['expectation']=='fused' and g['phase']!='warm':
                    calculation=recovery_window(entries,stops,current,g,before,state,warm[g['program']],fresh_owner if g['program']==1 else None)
                    if calculation['rejectionCertificate'] is not None:
                        certificate=calculation['rejectionCertificate'];calculation['rejectionCertificate']={**certificate,'stop':canonical_stop(certificate['stop'],data,trace_start)}
                    partitions.append(calculation)
                else:basic_window(state,current,g,enabled)
                if g['phase']=='warm': warm[g['program']]=state
            eq(a.json(run+'/window-'+str(seq).zfill(2)+'.json'),summary,'Saved window exact replay'); summaries.append(summary)
            if enabled and seq==1:lifetime_guard=state
            if enabled and lifetime_guard and seq<=8:
                for key in ('flushes','instanceRetires','invalidations'):eq(state['a'][key],lifetime_guard['a'][key],'No competing lifetime event during typed recovery')
            if enabled and seq==2:
                old=warm[0];eq(state['bw'][0]['generation'],old['bw'][0]['generation'],'Same stale owner generation');need(state['a']['instanceInstalls']>old['a']['instanceInstalls'],'Reinstallation observed')
                recovery_summary['stale']=dict(generation=hx(old['bw'][0]['generation']),staleInstanceMisses=state['a']['staleInstanceMisses'],observedFusedCompiled=state['c']['slots'][0]['counts'][0],scope='Same retained owner; global installation delta is not exclusively attributed.')
            if enabled and seq==6:
                fresh_owner=state;old=warm[1]['c']['slots'][0]['tuples'][0];fresh=state['c']['slots'][0]['tuples'][0];counts=state['c']['slots'][0]['counts']
                recovery_summary['invalid']=dict(oldGeneration=hx(pair(old,4)),newGeneration=hx(pair(fresh,4)),watchedEntryRejections=state['bw'][0]['entryRejects'],tiers=dict(compiled=counts[0],tci=counts[1],total=sum(counts[:2])),scope='Fresh owner observed in actual selected tiers; no natural SMC or pressure claim.')
            elif enabled and seq in (7,8):
                counts=state['c']['slots'][0]['counts'];totals=recovery_summary['invalid']['tiers'];totals['compiled']+=counts[0];totals['tci']+=counts[1];totals['total']+=sum(counts[:2])
            reset_from=state
            if request:
                eq([request['event'],request['seq'],mutation['event'],mutation['seq']],['injection-request',seq,'injection',seq],'Exact request/action before reset')
                action=1 if seq==1 else 2;pc=int(current['a'],16);generation=state['bw'][0]['generation'];expected=dict(requestID=action,action='stale-instance' if action==1 else 'invalid-descriptor',slot=0,pc=hx(pc),generation=hx(generation))
                for key,value in expected.items():eq(request[key],value,'Exact durable request '+key)
                eq(request['before'],gate,'Durable pre-action raw snapshot');eq(mutation['before'],gate,'Mutation original snapshot');eq([mutation['failure'],mutation['statusFailure'],mutation['returnCode'],mutation['nativeCalls']],[None,None,1,1],'Actual one successful native call')
                for row in (request,mutation):eq(row['streams']['streams']['trace']['seen'],end,'No trace during paused request/mutation')
                result=mutation_summary(seq,typed_mutation(gate,mutation['after'],mutation['mutation'],seq,pc,generation));mutation_results.append(result);mutation_rows.append(mutation);reset_from=recovery_native(mutation['after'],enabled,'injection',seq)
            eq(configured['seq'],seq,'Configured seq'); eq(ack['seq'],seq,'ACK seq'); need(configured['streams']['streams']['trace']['seen']==end==ack['streams']['streams']['trace']['seen'],'No execution during reset/ACK')
            nextp=0 if seq==0 else g['program']+1 if g['phase']=='direct-b' else g['program']; nextp=nextp if nextp<11 else None; eq(configured['program'],nextp,'Next program'); current=r['layout']['programs'][nextp] if nextp is not None else None; epoch+=4; fresh=recovery_native(configured,enabled,'configured',seq);same_injection(reset_from,fresh); ranges(fresh,current,epoch,enabled,True); eq(fresh['c']['total'],reset_from['c']['total'],'Paused census reset does not execute')
            for family in ('a','b'): eq(fresh[family],reset_from[family],'Paused reset preserves lifetimes')
            eq(ack['watchEpoch'],dict(m3a=epoch,m3b=epoch,census=epoch),'ACK exact reset epochs'); before=fresh; previous=fresh; last_ack=ack['hostMs']; trace_start=end
    eq(cursor,len(rows)-1,'No missing or extra recovery protocol rows');eq(r['injections'],mutation_rows,'Actual mutation report/journal equality');recovery_summary['injections']=mutation_results
    if enabled:recovery_summary['invalid']['compiledFreshOwnerObserved']=recovery_summary['invalid']['tiers']['compiled']>0
    eq(r['recovery'],recovery_summary,'Independent final typed recovery summary')
    final=rows[-1]; eq(final['event'],'complete','Final event'); eq(final['validation'],ref_pass,'Final oracle'); last=recovery_native(final,enabled,'complete',44);same_injection(previous,last); ranges(last,None,180,enabled,True); eq(last['c']['total'],previous['c']['total'],'Final census no recorded watched entries'); terminal_end=queue(final['streams'],prefixes)['trace'];need(trace_start<=terminal_end<=trace_start+65536,'Terminal bound')
    with trace_path.open('rb') as tf:tf.seek(trace_start);tail=tf.read(terminal_end-trace_start)
    eq(terminal_end,stream_files['trace']['bytes'],'No unparsed bytes after terminal summary');need(number(final['hostMs']) and final['hostMs']>=clock,'Final clock');terminal_summary=terminal(tail,trace_start);native_path='artifacts/m3b-context-v2-source-01/source/accel/tcg/cpu-exec.c';terminal_summary.update(runtimeSourceFingerprint=FP,nativeSource=a.ref(native_path));eq(terminal_summary,r['terminalSummary'],'Independent terminal suffix');eq(a.json(run+'/terminal-summary.json'),terminal_summary,'Durable separate terminal summary')
    eq(r['final'],final,'Final raw row'); need(len(r['signals'])==len(r['gates'])==45,'Exactly 45 gates'); eq(r['stoppedWindows'],summaries,'All window copies')
    need(len(partitions)==(12 if enabled else 0),'All 12 positive windows'); eq(len(r['bodyPartitions']),len(partitions),'Reported partition count')
    for got,want in zip(r['bodyPartitions'],partitions):
        eq(got['seq'],want['seq'],'Partition seq'); need(got['windowAccepted'] is True and got['acceptance'] is False,'Diagnostic window acceptance scope'); eq(got['partition'],want['partition'],'Independent body equation'); eq(got['nativeDelta'],want['nativeDelta'],'Native delta'); eq(got['globalGuardRedispatches'],want['globalGuardRedispatches'],'Separate exact global guard redispatches'); eq(got['recovery'],want['recovery'],'Actual recovery generation/tiers');eq(got['m3aDelta'],want['m3aDelta'],'Actual M3a recovery delta');
        actual_rejection=got['rejectionCertificate'];expected_rejection=want['rejectionCertificate']
        if expected_rejection is None:eq(actual_rejection,None,'No extra old-owner projection')
        else:
            for key,value in expected_rejection.items():eq(actual_rejection[key],value,'Exact source-bound old-owner refusal '+key)
        eq([(x['offset'],x['successorOffset'],x['target'],x['transition']) for x in got['coverage']['classification']['certificates']],[(x['offset'],x['successorOffset'],x['target'],x['transition']) for x in want['certificates']],'Exact RF A certificates'); eq([x['offset'] for x in got['coverage']['classification']['refused']],want['refusedRfA'],'Exact RF A refusals'); eq(got['coverage']['classification']['unclassified'],[],'No unclassified RF A'); eq([(x['offset'],x['successorOffset'],x['originCertificate'],x['unassignedRoute']) for x in got['coverage']['rfBCompletions']],[(x['offset'],x['successorOffset'],x['originCertificate'],x['unassignedRoute']) for x in want['rfBCompletions']],'RF B completion evidence'); eq([x['offset'] for x in got['coverage']['refusedRfB']],want['refusedRfB'],'RF B refused evidence'); eq([x['offset'] for x in got['coverage']['unassignedDpContinuations']],want['unassignedDpRoutes'],'D/P continuation groups')
        eq(got['recorded']['unloggedNormalAttempts'],want['hiddenNormalAttempts'],'Native hidden entry coverage')
    offline=a.json(inspection+'/report.json'); eq([offline['schema'],offline['kind'],offline['status'],offline['acceptance'],offline['captureStatus'],offline['gateCount']],[1,'m3b-context-recovery-v2-capture-replay','passed',True,'passed',45],'Completed root offline replay'); eq(offline['run'],run,'Replay capture');eq(offline['recovery'],recovery_summary,'Offline recovery summary'); eq(offline['positiveWindows'],r['bodyPartitions'],'Same-code/independent result agreement'); eq(offline['stoppedWindows'],summaries,'Replay windows');eq(offline['terminalSummary'],terminal_summary,'Offline terminal suffix')
    for path,id in offline['inventory'].items(): a.file(path,id)
    need(run+'/report.json' in offline['inventory'],'Replay hashes capture'); eq(offline['inventory'][run+'/report.json'],a.file(run+'/report.json'),'Replay report identity')
    closed=cleanup(a,execution,run,enabled,binding_path)
    return dict(enabled=enabled,status='passed',typedRecoveryPassed=enabled,controlPassed=not enabled,candidatePromotion=False,report=a.ref(run+'/report.json'),inspection=a.ref(inspection+'/report.json'),execution=closed,gates=45,guestValidation=ref_pass,censusFaults=0,censusApiRejects=0,injectionEvidence=mutation_results,recovery=recovery_summary,positiveWindows=partitions,terminalSummary=terminal_summary,streamFiles=stream_files,chunks=len(prefixes)-1,maximumPendingBytes=r['streams']['queue']['peakPendingBytes'],scope='Complete fixed-guest typed-recovery diagnostic. Actual single paused injections and same/fresh selected generation tiers are checked; no natural SMC, pressure, timing or production eligibility claim.')

def main():
    parser=argparse.ArgumentParser()
    for name in ('off','on','off-inspection','on-inspection','off-execution','on-execution','binding','output'):parser.add_argument('--'+name,required=True)
    args=parser.parse_args();out=ROOT/args.output;need(out.parent==ROOT/'artifacts' and not out.exists(),'Fresh immutable result');out.mkdir();fsync(out.parent);a=Audit()
    try:
        for name in ('review.py','recovery.py','baseline.py','semantics.py','trace.py','test_review.py','README.md'):a.file('experiments/m3b-context-recovery-review-v2/'+name)
        failed=prior_failure(a)
        for path in (args.off+'/report.json',args.on+'/report.json'):a.file(path,failed['inventory'][path])
        manifest,prerequisite=frozen(a);b,_,_=base.binding(a,args.binding);eq(manifest['parentBinding'],a.ref(args.binding),'Exact actual unchanged ABI2 binding');off=run(a,args.off,args.off_inspection,args.off_execution,False,args.binding,b);on=run(a,args.on,args.on_inspection,args.on_execution,True,args.binding,b)
        need(off['execution']['scratch']!=on['execution']['scratch'],'Distinct recovery capture scratch');need(utc(off['execution']['cleanupUtc'])<=utc(on['execution']['startedUtc']),'Serial control/candidate execution');need(utc(prerequisite['createdUtc'])<=utc(off['execution']['startedUtc']),'Baseline passed before recovery launch');a.final()
        result=dict(schema=1,kind='m3b-context-typed-recovery-independent-replay',reviewerRevision='exact-stop-certificate-serialization-v2',previousFailedReview=a.ref(PRIOR_FAILURE),previousReviewerSource=a.ref(PRIOR_SOURCE),representationDiagnosis=a.ref(DIAGNOSIS),status='passed',typedRecoveryPassed=True,baselinePassed=True,candidatePromotion=False,timingEligible=False,createdUtc=datetime.now(timezone.utc).isoformat(),binding=a.ref(args.binding),sourceManifest=a.ref(RECOVERY_SOURCE),sourceReview=a.ref(RECOVERY_REVIEW),baselineReview=a.ref(BASELINE),runs=[off,on],inventory=a.inventory,limits=['Diagnostic profile1 only. Typed paused metadata mutation does not establish natural SMC or FIFO/GC pressure recovery.','Entry attempts and RF route certificates are not retired-body counters; exact fixed guest semantics supply the logical route equation.','Fresh owner compilation is reported only when its real native compiled tier is observed; TCI counts stay TCI.','No full XSAVE, natural interrupt, suspended-stack, timing or production eligibility claim.'])
        publish(out,'review.json',result);print(json.dumps(dict(status='passed',typedRecoveryPassed=True,output=args.output+'/review.json',identities=len(a.inventory))))
    except Exception as error:publish(out,'failure.json',dict(status='failed-review',typedRecoveryPassed=False,candidatePromotion=False,error=repr(error),inventory=a.inventory));raise
if __name__=='__main__':main()
