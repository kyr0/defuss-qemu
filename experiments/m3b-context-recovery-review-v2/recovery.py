"""Independent typed recovery arithmetic and raw evidence; no VM/API calls."""
from copy import deepcopy
from semantics import *
from trace import flags,prelude,match_native,global_guard_redispatches

def expected_stage(enabled,stage,seq):
    need(type(enabled)is bool and stage in ('startup','gate','configured','injection','complete') and integer(seq,44),'Typed stage')
    if stage=='startup':eq(seq,0,'Startup seq')
    if stage=='complete':eq(seq,44,'Complete seq')
    if stage=='injection':need(enabled and seq in (1,5),'Only two exact injection stages')
    after=stage in ('configured','injection')
    return dict(stale=int(enabled and (seq>1 or seq==1 and after)),invalid=int(enabled and (seq>5 or seq==5 and after)),staleMiss=int(enabled and seq>=2),fusedReject=int(enabled and seq>=6),watchReject=int(enabled and stage=='gate' and seq==6))

def recovery_native(row,enabled,stage,seq):
    e=expected_stage(enabled,stage,seq);a=bank(row['m3aRaw'],96);b=bank(row['m3bRaw'],128);c=bank(row['censusRaw'],2400)
    eq([a[34],a[35],a[22],a[21]],[e['stale'],e['invalid'],e['staleMiss'],0],'Exact old ABI action/miss evidence')
    eq(b[19],e['fusedReject'],'Exact one fused lifetime refusal')
    eq([b[44+i*20]for i in range(4)],[e['watchReject'],0,0,0],'Exact one watched refusal scope')
    eq(c[16:20],[e['stale']+e['invalid'],e['stale'],e['invalid'],0],'Exact injection request/success/reject counts')
    if not e['stale']:zero(c[16:32]+a[50:55],'No early injection evidence')
    else:
        action=2 if e['invalid'] else 1;pc=pair(c,24);generation=pair(c,26)
        eq(c[20:24],[action,action,1,0],'Exact request ID/action/result/slot');need(0x100000<=pc<1<<32 and generation>0,'Bounded injected target')
        eq(pair(c,28),generation,'No mismatched generation success');eq(c[30:32],[0x18c0c2b3,0xff020000],'Exact normal injection key')
        eq([pair(a,50),pair(a,52),a[54]],[pc,generation,action],'Old/new injection ABI agreement')
    # Only already-proven special evidence is neutralized for the unchanged
    # baseline structural decoder. Original arrays and returned counts remain real.
    view=deepcopy(row);view['m3aRaw'][34]=view['m3aRaw'][35]=0;view['m3aRaw'][50:55]=[0]*5
    view['m3bRaw'][19]=view['m3bRaw'][44]=0;view['censusRaw'][16:32]=[0]*16
    state=native(view,enabled,stage=='startup')
    state['a']['injectedStaleInstances']=a[34];state['a']['injectedInvalidDescriptors']=a[35]
    state['b']['entryRejects']=b[19];state['bw'][0]['entryRejects']=b[44];state['c']['raw']=list(c)
    state['injection']=dict(raw=list(c[16:32]),requests=c[16],stale=c[17],invalid=c[18],rejects=c[19],requestID=c[20],action=c[21],returnCode=c[22],slot=c[23],pc=pair(c,24),expectedGeneration=pair(c,26),actualGeneration=pair(c,28),flags=c[30],cflags=c[31]);state['allowances']=e
    return state

def same_injection(first,last):
    eq(last['injection']['raw'],first['injection']['raw'],'Latest typed injection identity unchanged outside explicit mutation')

def monotonic(first,last):
    for family in ('a','b'):
        for name,n in first[family].items():need(last[family][name]>=n,'Monotonic '+family+'.'+name)
    need(last['c']['total']>=first['c']['total'],'Monotonic census')

def put(w,at,n):w[at]=n&U32;w[at+1]=n>>32

def typed_mutation(before,after,record,seq,pc,generation):
    need(seq in (1,5),'Only exact two mutations');action=1 if seq==1 else 2;name='stale-instance'if seq==1 else'invalid-descriptor'
    eq(record,dict(requestID=action,action=name,slot=0,pc=hx(pc),generation=hx(generation),returnCode=1,nativeCalls=1),'Actual single native call')
    pre=recovery_native(before,True,'gate',seq);post=recovery_native(after,True,'injection',seq);w=pre['c']['slots'][0];owner=w['tuples'][0]
    need(w['active']and w['required']and w['counts'][0]>0 and owner is not None,'Compiled warm target')
    eq([pair(owner,0),pair(owner,4)],[pc,generation],'Exact requested warm owner');eq([pre['injection'][k]for k in ('requestID','requests','stale','invalid')],[action-1,action-1,action-1,0],'Prior injection chronology')
    expected=list(before['censusRaw']);expected[16]+=1;expected[17 if seq==1 else 18]+=1;expected[20:24]=[action,action,1,0]
    for at,n in ((24,pc),(26,generation),(28,generation)):put(expected,at,n)
    expected[30:32]=owner[14:16];eq(after['censusRaw'],expected,'Only exact paused census injection fields change')
    expected=list(before['m3aRaw']);need(expected[34 if seq==1 else 35]<U32,'No action counter overflow');expected[34 if seq==1 else 35]+=1
    put(expected,50,pc);put(expected,52,generation);expected[54]=action;eq(after['m3aRaw'],expected,'Only exact old ABI action fields change')
    for key in ('m3bRaw','boundaryRaw','nativeStatus','censusNativeStatus','pool','status'):eq(after[key],before[key],'Unchanged paused '+key)
    return dict(requestID=action,action=name,pc=hx(pc),generation=hx(generation),mutations=1)

def projection(entries,stops,p,gate,warm):
    old=warm['c']['slots'][0]['tuples'][0];pc=int(p['a'],16);code=pair(old,6)
    frames=[e for e in entries if e['pc']==pc and e['pointer']==code];hits=[s for s in stops if s['pc']==pc and s['pointer']==code]
    fresh=gate['program']==1;first=gate['seq']==6
    if not first:
        if fresh:eq(frames,[],'No old owner execution after first recovery');eq(hits,[],'No old hidden rejection after first recovery')
        return entries,stops,None
    eq(len(hits),1,'Exact one pre-entry old-owner refusal');need(len(frames)<=1,'At most one refused outer frame');stop=hits[0];frame=frames[0]if frames else None
    if frame:
        eq([frame['flags'],frame['cflags']],[0x18c0c2b3,0xff020000],'Refused old normal key');eq(stop['precedingEntry'],frame['index'],'Refusal attaches exact old frame');need(stop['start']>=frame['end'],'Refusal follows frame');match_native(old,frame)
        eq([s for s in stops if s['precedingEntry']==frame['index']],[stop],'No orphaned extra stop on removed old frame')
        index=entries.index(frame)
        if index:need(not entries[index-1]['flags']&RF,'Do not splice across unresolved RF')
    result=dict(kind='outer-old-owner-refusal'if frame else'hidden-chain-old-owner-refusal',oldPC=hx(pc),oldCode=hx(code),oldGeneration=hx(pair(old,4)),frame=None if frame is None else{k:frame[k]for k in ('index','start','end')},stop=stop,addsLogicalBodyTerm=False)
    return [e for e in entries if e is not frame],[s for s in stops if s is not stop],result

def recovery_window(entries,stops,p,gate,pre,post,warm,fresh_baseline=None):
    need(entries,'Nonempty recovery trace');a,b,side=[int(p[k],16)for k in ('a','b','side')];native=post['c']['slots'][0];prior=warm['c']['slots'][0];owner=native['tuples'][0];old=prior['tuples'][0];f=post['bw'][0];wf=warm['bw'][0]
    need(owner is not None and old is not None,'Actual old/new fused owners');tuple_equal(old,owner,True)
    eq([wf['predecodeAccepted'],wf['emittedOwners'],wf['IRRejected'],wf['cleanRetries']],[1,1,0,0],'Exactly one warm generation');need(wf['compiledEntries']>0,'Warm compiled exposure')
    eq(pair(old,4),wf['generation'],'Warm generation');eq(pair(old,0),a,'Warm PC');eq(prior['counts'][:2],[wf['compiledEntries'],wf['tciEntries']],'Warm actual tiers')
    need(pair(owner,8)==a and pair(owner,10)<512*1024*1024 and pair(owner,12)==U64,'Exact physical code pages');eq(owner[14:16],[0x18c0c2b3,0xff020000],'Exact owner key');eq([pair(owner,4),a],[f['generation'],f['last']],'Selected generation/PC')
    fresh=gate['program']==1;first=gate['seq']==6
    if fresh:
        need(pair(owner,4)>pair(old,4) and pair(owner,6)!=pair(old,6),'Fresh generation and distinct code after rejection')
        eq([pre['injection']['pc'],pre['injection']['expectedGeneration']],[a,pair(old,4)],'Injected old owner')
        if first:eq(fresh_baseline,None,'First fresh baseline unavailable')
        else:
            need(fresh_baseline is not None,'Accepted gate6 baseline required');monotonic(fresh_baseline,pre);tuple_equal(owner,fresh_baseline['c']['slots'][0]['tuples'][0])
            rf=fresh_baseline['c']['slots'][0]['tuples'][1]
            if rf and native['tuples'][1]:tuple_equal(rf,native['tuples'][1])
    else:
        eq(fresh_baseline,None,'No fresh baseline for unchanged program');tuple_equal(owner,old);need(f['compiledEntries']>0,'Same owner compiled exposure');eq(f['tciEntries'],0,'Unchanged owner remains compiled')
    if prior['tuples'][1]and native['tuples'][1]:tuple_equal(prior['tuples'][1],native['tuples'][1])
    if gate['program']==0:eq([pre['injection']['pc'],pre['injection']['expectedGeneration']],[a,pair(old,4)],'Exact stale injected owner')
    monotonic(warm,pre);monotonic(pre,post);eq(pre['injection']['raw'],post['injection']['raw'],'No running injection')
    zero(native['counts'][4:]);need(sum(native['counts'][:2])>0,'Selected fused tier observed');eq(native['counts'][:2],[f['compiledEntries'],f['tciEntries']],'Exact actual tiers');eq(native['sites'][0],post['aw'][0]['selected'],'All compiled A sites');eq(post['c']['total']-pre['c']['total'],native['total'],'Census window conservation');zero([post['bw'][1][n]for n in WATCH])
    delta={n:post['b'][n]-pre['b'][n]for n in M3B};adelta={n:post['a'][n]-pre['a'][n]for n in M3A};eq(adelta['staleInstanceMisses'],int(gate['seq']==2),'Exact stale miss');zero([adelta[n]for n in ('invalidRedispatches','instanceRetires','flushes','invalidations','injectedStaleInstances','injectedInvalidDescriptors','injectionRejects')])
    zero([delta[n]for n in ('IRRejected','cleanRetries','debtErrors')])
    for n in WATCH:eq(delta[n],f[n],'Exact watched/lifetime recovery delta '+n)
    for n in ('entryRejects','predecodeAccepted','emittedOwners'):eq(f[n],int(first),'Exact first fresh formation/refusal '+n)
    eq(delta['formed'],int(first),'Exactly one fresh formed owner')
    global_guard=global_guard_redispatches(pre,post)
    if not fresh:eq(f['backedgeTciReturns'],0,'No old-owner TCI closing boundary')
    else:need(f['backedgeTciReturns']<=f['BAttempts'],'Fresh TCI closing bound')
    entries,stops,rejection=projection(entries,stops,p,gate,warm)
    context0=entries[0]['context']; pointers={}; by={}
    for stop in stops: by.setdefault(stop['precedingEntry'],[]).append(stop)
    for e in entries:
        need(e['pc'] in (a,b,side),'Other/interior trace entry'); eq([e['csBase'],e['cflags'],e['efer'],e['flags']&~RF],[0,0xff020000,0xd01,0x18c0c2b3],'Exact trace key'); eq(e['cpu'],[3,0,1,0,0],'User mode'); eq(e['rflags']&0x20100,0,'TF/VM'); eq(bool(e['flags']&RF),bool(e['rflags']&RF),'RF key/state'); eq(e['context'],context0,'Full semantic recorded context')
        key=(e['pc'],e['flags']); need(key not in pointers or pointers[key]==e['pointer'],'Pointer changed for key'); pointers[key]=e['pointer']
        need(all(s['pc'] in (a,b,side) for s in by.get(e['index'],[])),'Foreign stop target')
        if e['pc']==a: match_native(native['tuples'][1 if e['flags']&RF else 0],e)
    def refused(e):
        rows=by.get(e['index'],[]); return len(rows)==1 and rows[0]['pc']==e['pc'] and rows[0]['pointer']==e['pointer']
    width,counter,moves=prelude(p); certificates=[]; refused_a=[]; certified_b={}; rf_a=0; normal_a=0
    for i,e in enumerate(entries):
        if e['pc']!=a: continue
        if not e['flags']&RF: normal_a+=1; continue
        rf_a+=1
        if by.get(e['index']): need(refused(e),'Exact RF A refusal'); refused_a.append(e['start']); continue
        need(i+1<len(entries),'RF A has no successor'); nxt=entries[i+1]; expected=dict(e['gpr']); expected.update(moves); value=expected[counter]&((1<<width)-1); target=side if value==0 else b
        eq([nxt['pc'],nxt['flags']],[target,0x18c0c2b3],'RF A target/clear'); eq(nxt['gpr'],expected,'RF A GPR'); eq(nxt['rflags'],flags(e['rflags'],value,width),'CMP flags'); eq(nxt['cc'],[0,expected[counter],'SUBL' if width==32 else 'SUBQ'],'CMP full lazy state')
        certificates.append(dict(offset=e['start'],successorOffset=nxt['start'],target=hx(target),transition='rf-a-to-side' if value==0 else 'rf-a-to-b'))
        if target==b: certified_b[nxt['index']]=e['start']
    eq(rf_a,native['rf'],'Every native RF A attempt printed'); need(normal_a<=sum(native['counts'][:2]),'Native normal coverage'); eq(rf_a,len(certificates)+len(refused_a),'All RF A classified')
    F,P=f['BAttempts'],f['BRequested']; D=gate['calls'] if gate['phase']=='direct-b' else 0; R=sum(c['transition']=='rf-a-to-b' for c in certificates)
    need(P<=F<=f['compiledEntries']+f['tciEntries'],'Fused actual-tier attempted routes'); eq(F+R+D,gate['bodies'],'All body routes'); eq(f['servicePaid'],F,'Service payments')
    rf_b=[]; refused_b=[]; unassigned={}; raw_code=bytes.fromhex(p['codeHex']); body=raw_code[b-a:int(p['back'],16)-a]
    for i,e in enumerate(entries):
        if not e['flags']&RF or e['pc']==a: continue
        eq(e['pc'],b,'RF only at A/B'); origin=i-1
        while origin>=0 and entries[origin]['pc']==b and entries[origin]['flags']&RF: origin-=1
        normal=entries[origin] if origin>=0 and entries[origin]['pc']==b and entries[origin]['flags']==0x18c0c2b3 else None
        cert=certified_b.get(normal['index']) if normal else None; first=origin if normal else origin+1; route=entries[first]['start']
        if cert is None:
            need(D+P>0,'No fixed CFG origin for RF B'); unassigned.setdefault(route,False)
        for retry in entries[first:i]: need(refused(retry),'Earlier B must be refused'); eq(retry['gpr'],e['gpr'],'Retry GPR'); eq(retry['rflags']&~RF,e['rflags']&~RF,'Retry flags')
        need(i+1<len(entries),'RF B unclosed'); nxt=entries[i+1]
        if by.get(e['index']):
            need(refused(e),'RF B exact refusal'); eq([nxt['pc'],nxt['flags'],nxt['gpr'],nxt['rflags']],[b,e['flags'],e['gpr'],e['rflags']],'Exact RF B retry'); refused_b.append(e['start']); continue
        expected=dict(e['gpr'])
        if body.hex()=='83c03531d083e901': bw=32; ctr='rcx'; expected['rax']=((expected['rax']+53)&U32)^(expected['rdx']&U32); expected['rcx']=(expected['rcx']-1)&U32
        elif body.hex()=='4d31ea4983c2114983e901': bw=64; ctr='r9'; expected['r10']=((expected['r10']^expected['r13'])+17)&U64; expected['r9']=(expected['r9']-1)&U64
        else: raise ValueError('Unsupported exact B body')
        eq([nxt['pc'],nxt['flags'],nxt['gpr']],[a,0x18c0c2b3,expected],'RF B exact GPR successor'); eq(nxt['rflags'],flags(e['rflags'],e['gpr'][ctr],bw,True),'SUB flags'); eq(nxt['cc'],[1,(e['gpr'][ctr]-1)&U64,'SUBL' if bw==32 else 'SUBQ'],'Full-width lazy SUB')
        if cert is None: need(not unassigned[route],'Duplicate D/P completion'); unassigned[route]=True
        rf_b.append(dict(offset=e['start'],successorOffset=nxt['start'],originCertificate=cert,unassignedRoute=None if cert is not None else route))
    need(len(unassigned)<=D+P and all(unassigned.values()),'Bounded complete fixed D/P routes')
    return dict(seq=gate['seq'],gate=gate,partition=dict(fusedBoundaryAttempts=F,completedFusedBodyRoutes=F-P,requestedOrdinaryBodyRoutes=P,certifiedRfAtoBContinuations=R,initialDirectBRoutes=D,logicalRouteSum=F+R+D,expectedGuestBodies=gate['bodies'],extraServiceTurns=F,ordinaryBSelectedAttempts=post['aw'][1]['selected']),certificates=certificates,refusedRfA=refused_a,rfBCompletions=rf_b,refusedRfB=refused_b,unassignedDpRoutes=sorted(unassigned),outerEntries=len(entries),recordedNormalA=normal_a,nativeNormalAttempts=sum(native['counts'][:2]),hiddenNormalAttempts=sum(native['counts'][:2])-normal_a,rfAttempts=rf_a,ownerGeneration=hx(f['generation']),nativeDelta=delta,globalGuardRedispatches=global_guard,m3aDelta=adelta,rejectionCertificate=rejection,recovery=dict(kind='fresh-descriptor' if fresh else 'same-descriptor-stale-instance' if gate['program']==0 else 'unmutated-owner',oldGeneration=hx(pair(old,4)),generation=hx(pair(owner,4)),observedCompiled=f['compiledEntries'],observedTci=f['tciEntries'],freshCompiledObserved=bool(fresh and f['compiledEntries']>0)),windowAccepted=True,candidatePromotion=False)
