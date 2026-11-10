#!/usr/bin/env python3
"""Independent finite-horizon campaign replay. A passed audit is not a promotion."""
import argparse
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import statistics
import sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
DEPENDENCY=ROOT/'experiments/passive-fifo-validation-review/review.py'
DEPENDENCY_SHA='908f3a5f6d7549257bd5754709f96e1710e0adcbd7501ed47e10be61caf3258f'
if hashlib.sha256(DEPENDENCY.read_bytes()).hexdigest()!=DEPENDENCY_SHA:raise ValueError('Frozen independent validation reviewer changed')
spec=importlib.util.spec_from_file_location('frozen_fifo_validation',DEPENDENCY)
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
pv=v.pv
require,same,close_tree,sha=v.require,v.same,v.close_tree,v.sha
OUTER='defuss-passive-fifo-finite-v1'
BASE='benchmarks/harness/passive-fifo-finite-v1/'
SOURCE='artifacts/passive-fifo-finite-v1-source-01/manifest.json'
SOURCE_SHA='c3e2871b5a374c1fd43beb5bb0cbb0282d08422ac86c7267d4969f23993e4dbe'
SOURCE_REVIEW='artifacts/passive-fifo-finite-v1-source-review-01/review.json'
SOURCE_REVIEW_SHA='ebebddc71b440aa089106405fe86d1e888995689b27e1a7cf697c6a9bb0f2fff'
HORIZON_RULE=dict(clock='browser performance.now relative to one origin; raw binary64 milliseconds retained',
 start='Immediately before startBunApp invocation, before asset reads or runtime factory initialization',
 end='Complete gate readCompleteHostMs after confirmed pause, protocol and effective-policy validation, before final ACK',
 phases=52,preludePhases=20,subsequentPhases=32,iterationsPerPhase=100,partitionAbsoluteToleranceMs=1e-6,
 partition='prefix + all52 ACK-to-result intervals + all51 intervening gaps + suffix; no subtraction or discarded interval',
 failure='Any post-start failure or unknown start invalidates the campaign; only durably proven pre-start failure may be replaced')
BOOTSTRAP_RULE=dict(prng='xorshift32: x^=x<<13; x^=x>>>17; x^=x<<5; unsigned/2^32',
 quantile='Sorted draw index floor(p*(draws-1))',unit='Whole paired log-ratio; identical resampled pair indices for every endpoint',
 primaryAlpha=.01,secondaryOneSidedAlpha=.002,readyOneSidedAlpha=.01,serviceOneSidedAlpha=.005)
SECONDARY=['phaseSum','integer','json','sha256','http']
SERVICE=['emptyGateP95','resultStopMaxMs']
ENDPOINTS=['fullHorizon',*SECONDARY,'ready',*SERVICE]
DRIFT_SCOPE='Descriptive drift only; never an exclusion, retry or decision veto. All52 phases remain in the horizon and workload totals; no stationarity claim.'

def horizon(browser):
    """Independent interval partition, including startup and all inter-phase work."""
    h=browser['horizon'];require(type(h['startId']) is str and re.fullmatch(r'[a-f0-9-]{36}',h['startId']),'horizon start identity')
    t0=pv.elapsed(h['t0HostMs'],'horizon start');t1=pv.elapsed(h['t1HostMs'],'horizon end');require(t0<t1,'empty horizon')
    complete=[e for e in browser['events'] if e['event']=='complete'];require(len(complete)==1,'complete boundary count')
    same(t1,complete[0]['readCompleteHostMs'],'t1 after final policy read');require(t1<=complete[0]['ackHostMs'],'final ACK outside horizon')
    phases=browser['warmups']+browser['results'];same(len(phases),52,'all fixed phases')
    expected=[dict(name=name,sample=i if i<5 else i-5,iterations=100) for i,order in enumerate(pv.WARMUP_ORDERS+pv.ORDERS) for name in order]
    same([{k:r[k] for k in ('name','sample','iterations')} for r in phases],expected,'all phase identity/order')
    totals={name:0.0 for name in pv.NAMES};gaps=[];previous=t0;phase_sum=0.0
    for index,row in enumerate(phases):
        start=pv.elapsed(row['startAckHostMs'],'phase start');end=pv.elapsed(row['resultHostMs'],'phase end');duration=pv.elapsed(row['hostMs'],'phase duration')
        require(previous<=start<end,'phase overlap or reversal');require(duration==end-start,'unsubtracted phase interval')
        if index:gaps.append(float(start-previous))
        totals[row['name']]+=duration;phase_sum+=duration;previous=end
    require(previous<=t1,'phase outside horizon');prefix=float(phases[0]['startAckHostMs']-t0);suffix=float(t1-previous)
    full=float(t1-t0);partition_total=prefix+phase_sum+sum(gaps)+suffix
    require(abs(partition_total-full)<=1e-6,'horizon partition does not close')
    for event in browser['events']:require(t0<=pv.elapsed(event['hostMs'],'event clock')<=t1,'event outside horizon')
    ready=float(browser['startup']['readyHostMs']-t0);require(0<ready<=full,'ready outside horizon')
    gates=sorted(pv.elapsed(r['hostMs'],'empty gate') for r in browser['calibration']);require(len(gates)==20 and gates[0]>0,'empty gate endpoint')
    stop=max(pv.elapsed(r['resultToStopMs'],'stop tail') for r in phases);require(stop>0,'stop-tail endpoint')
    split=dict(preludeMs=float(sum(r['hostMs'] for r in browser['warmups'])),subsequentMs=float(sum(r['hostMs'] for r in browser['results'])),
      byWorkload={name:dict(preludeMs=float(sum(r['hostMs'] for r in browser['warmups'] if r['name']==name)),subsequentMs=float(sum(r['hostMs'] for r in browser['results'] if r['name']==name))) for name in pv.NAMES})
    return dict(fullHorizon=full,phaseSum=phase_sum,**totals,ready=ready,emptyGateP95=float(gates[18]),resultStopMaxMs=float(stop),
      partition=dict(prefixMs=prefix,phaseSumMs=phase_sum,gapMs=gaps,suffixMs=suffix,totalMs=partition_total,errorMs=partition_total-full),phaseSplit=split)

def planning(endpoints,plan):
    # Independently invert analytic chi-square(df3) CDF and NormalDist CDF.
    chi=pv.chi_square_three_quantile(.10);close_tree(chi,pv.PLANNING_RULE['sdChiSquareLowerQuantile'],'chi-square quantile')
    normal=statistics.NormalDist();details={};required=8
    for name in ENDPOINTS:
        ratios=endpoints[name]['ratios'];require(len(ratios)==4 and all(type(x) in (int,float) and math.isfinite(x) and x>0 for x in ratios),'four positive pilot ratios')
        logs=list(map(math.log,ratios));mean=sum(logs)/4;sd=math.sqrt(sum((x-mean)**2 for x in logs)/3);design_sd=sd*math.sqrt(3/chi)
        limit=plan['primaryUpperRatio'] if name=='fullHorizon' else plan['readyUpperRatio'] if name=='ready' else plan['serviceUpperRatio'] if name in SERVICE else plan['secondaryUpperRatio']
        target=.90 if name=='fullHorizon' else 1
        probability=.995 if name=='fullHorizon' or name in SERVICE else .99 if name=='ready' else .998
        z=normal.inv_cdf(probability);n=math.ceil(((z+normal.inv_cdf(.80))*design_sd/math.log(limit/target))**2)
        details[name]=dict(pilotSD=sd,designSD=design_sd,target=target,limit=limit,zBound=z,rawRequiredPairs=n);required=max(required,n)
    required+=required%2
    return dict(rule=pv.PLANNING_RULE,endpoints=details,requiredPairs=required,feasible=required<=32,
      action='Freeze exactly the required number of wholly fresh confirmation pairs.' if required<=32 else 'No confirmation under this plan. Retain the pilot and declare a new expanded pilot/design or an explicit larger budget before collecting more data.')

def aggregate(plan,pairs):
    endpoints={}
    for name in ENDPOINTS:
        ratios=[p['candidate'][name]/p['control'][name] for p in pairs]
        require(all(math.isfinite(x) and x>0 for x in ratios),'positive endpoint ratios')
        row=dict(ratios=ratios,geometricMean=math.exp(sum(map(math.log,ratios))/len(ratios)))
        if plan['kind']=='confirmation':
            alpha=.005 if name in SERVICE else .01 if name in ('fullHorizon','ready') else .002
            row['interval']=pv.interval(ratios,50000,20261107,alpha)
        endpoints[name]=row
    memory=[p['candidate']['peakObservedLinearMemoryBytes']/p['control']['peakObservedLinearMemoryBytes'] for p in pairs]
    descriptive=all(d['withinBound'] for pair in pairs for side in ('control','candidate') for d in pair[side]['drift'].values())
    selected=plan['kind']=='exploration' and endpoints['fullHorizon']['geometricMean']<.95 and all(endpoints[n]['geometricMean']<1.10 for n in SECONDARY+['ready']) and all(endpoints[n]['geometricMean']<1.50 for n in SERVICE) and max(memory)<=1.10
    confirmed=plan['kind']=='confirmation' and endpoints['fullHorizon']['interval']['upper']<.95 and all(endpoints[n]['interval']['oneSidedUpper']<1.10 for n in SECONDARY+['ready']) and all(endpoints[n]['interval']['oneSidedUpper']<1.50 for n in SERVICE) and max(memory)<=1.10
    return dict(endpoints=endpoints,memoryRatios=memory,driftWithinDescriptiveBand=descriptive,confirmationPlanning=planning(endpoints,plan) if plan['kind']=='exploration' else plan['selection']['confirmationPlanning'],selected=selected,confirmationPassed=confirmed,productPromotionEligible=False)

def covered(path,inputs):return any(path==name or path.startswith(name.rstrip('/')+'/') for name in inputs)

def durable_json(path,value):
    path=Path(path)
    with path.open('x') as stream:json.dump(value,stream,indent=2,allow_nan=False);stream.write('\n');stream.flush();os.fsync(stream.fileno())
    for directory in path.parents:
        fd=os.open(directory,os.O_RDONLY)
        try:os.fsync(fd)
        finally:os.close(fd)
        if directory==ROOT:break

class Review(v.Review):
    def frozen_sources(self):
        super().frozen_sources();self.hash(DEPENDENCY,dict(sha256=DEPENDENCY_SHA))
        self.hash(self.path('artifacts/passive-fifo-validation-reviewer-source-review-01/review.json'),dict(sha256='d0f09ae2c476a5639fc80cd3a64786681158fb3cef749835eccbd91020c82086'))
        self.hash(self.path(SOURCE),dict(sha256=SOURCE_SHA));record=self.read(self.path(SOURCE))
        for row in record['files']:
            for key in ('path','archive'):self.hash(self.path(row[key]),{k:row[k] for k in ('sha256','bytes')})
        for path,digest in record['dependencies'].items():self.hash(self.path(path),dict(sha256=digest))
        self.hash(self.path(SOURCE_REVIEW),dict(sha256=SOURCE_REVIEW_SHA));self.hash(Path(__file__))
        return record

    def validate_plan(self,plan):
        kind=plan['kind'];require(kind in ('exploration','confirmation'),'plan kind')
        close_tree(plan,dict(schema=1,experiment='passive-fifo-v1',protocol=OUTER,guestProtocol=pv.PROTOCOL,primary='fullHorizon',secondary=SECONDARY,service=SERVICE,
          primaryUpperRatio=.95,secondaryUpperRatio=1.10,readyUpperRatio=1.10,memoryUpperRatio=1.10,serviceUpperRatio=1.50,driftRatioLimit=1.10,
          runtimeArtifactByteRatio=1,generatedCodeByteRatio=1.10,confidence=.99,bootstrapDraws=50000,bootstrapSeed=20261107),'fixed finite design')
        for key,wanted in [('parameters',pv.PARAMETERS),('orders',pv.ORDERS),('warmupOrders',pv.WARMUP_ORDERS),('horizonRule',HORIZON_RULE),('bootstrapRule',BOOTSTRAP_RULE),('planningRule',pv.PLANNING_RULE)]:same(plan[key],wanted,'fixed '+key)
        pairs=plan['pairs'];require(pv.integer(pairs,4,32) and pairs%2==0,'pair count')
        if kind=='exploration':same(pairs,4,'pilot pairs');same(plan['selection'],None,'no prior selection')
        else:
            require(pairs>=8,'minimum confirmation count');same(plan['selection']['confirmationPlanning']['feasible'],True,'feasible confirmation');same(pairs,plan['selection']['confirmationPlanning']['requiredPairs'],'planned sample count')
        require(type(plan['inputs']) is list and all(type(x) is str for x in plan['inputs']),'plan inputs')
        require(bool(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}',plan['id'])),'plan id');pv.timestamp(plan['createdUtc'])
        condition=plan['hostCondition'];close_tree(condition,dict(schema=1,arguments=['list','builder','--json'],environment=dict(LIMA_HOME='/Users/admin/.defuss-vm-lima'),expected=dict(name='builder',status='Stopped',memory=12884901888)),'compiler stopped condition')
        self.hash(Path(condition['executable']),{k:condition[k] for k in ('sha256','bytes')})
        steps=[]
        for pair in range(1,pairs+1):
            for enabled in ((False,True) if pair%2 else (True,False)):
                steps.append(dict(id=f"pair-{pair:02d}-{'on' if enabled else 'off'}",pair=pair,enabled=enabled,package=plan['packages']['candidate' if enabled else 'control']['path'],mode='baseline',snapshot='capture',samplePeriod=257,timeoutMs=600000))
        same(plan['steps'],steps,'exact alternating fresh capture steps')
        manifests=[]
        for side,enabled in [('control',False),('candidate',True)]:
            package=plan['packages'][side];directory=self.path(package['path']);m=self.production_manifest(directory,OUTER)
            same(package['manifest'],m,'planned full manifest');self.hash(directory/'app.json',dict(sha256=package['manifestSha256']));same(m['experiment'],dict(name='passive-fifo-v1',enabled=enabled),'planned selection');manifests.append(m)
            proof=self.runtime_proof(directory)
            for name in [proof['buildReport'],proof['sourceManifest'],proof['sourceRecheck'],*[x[0] for x in v.PROOF_PINS.values()],SOURCE,SOURCE_REVIEW]:require(covered(name,plan['inputs']),'Missing preregistered build/source input '+name)
        stripped=lambda m:{k:x for k,x in m.items() if k not in ('generation','compatibilitySha256','experiment')}
        same(stripped(manifests[0]),stripped(manifests[1]),'matched package specifications');require(manifests[0]['generation']!=manifests[1]['generation'],'separate policy snapshot identity')

    def prestart_failure(self,folder):
        run=folder/'run';require(not (run/'execution-start.json').exists(),'Post-start or unknown observation cannot be omitted')
        certificate=self.read(run/'pre-start-failure.json');raw=self.read(run/'report.json')
        close_tree(certificate,dict(schema=1,state='proven-pre-start-failure',reportSha256=self.hash(run/'report.json')['sha256']),'pre-start certificate')
        close_tree(raw,dict(status='failed',executionBoundary=dict(started=False)),'proven pre-start report');require(raw.get('browserResult') is None,'completed browser in pre-start certificate')
        return dict(path=str(folder),reportSha256=certificate['reportSha256'])

    def raw_protocol(self,path,raw):
        b=raw['browserResult'];nonce=pv.protocol(raw)
        # The pinned legacy protocol helper is numeric-equality based. Enforce
        # JSON type identity here for the identity/sequence fields it examines.
        for event in b['events']:
            for key in ('pid','heapLength','heapChecksum','ordinal'):require(pv.integer(event[key]),'integer guest '+key)
            for key in ('heap','file'):same(event[key],True,'guest '+key)
            for key in ('seq','sample','iterations','index'):
                if key in event:require(pv.integer(event[key]),'integer gate '+key)
        same(b['gateAcks'],148,'all gates');same(len(b['signals']),149,'all signals')
        for signal in b['signals']:require(pv.integer(signal['byte']),'integer COM1 byte')
        sequences=[]
        for row in b['warmups']+b['results']:
            for key in ('sample','iterations','startSeq','endSeq'):require(pv.integer(row[key]),'integer phase '+key)
            sequences.extend([row['startSeq'],row['endSeq']]);pool=row['runtimeStats']['jitPool'];same(pool['limit'],12000,'pool authority')
            require(pv.integer(pool['charged'],0,12000) and pv.integer(pool['linearMemoryBytes'],1),'bounded pool observations')
        same(len(set(sequences)),104,'one-to-one phase gates')
        serial_path=path.parent/'serial.log';self.hash(serial_path);serial=serial_path.read_text();require('Kernel panic' not in serial and 'BUN_APP_FAILURE:' not in serial,'raw guest failure')
        records=[json.loads(line[len(pv.PREFIX):]) for line in serial.splitlines() if line.startswith(pv.PREFIX)];normalized=[]
        for event in b['events']:
            value={k:x for k,x in event.items() if k not in v.HOST_FIELDS}
            if event['event'] in ('initialized','maps'):
                info=event['mapsArtifact'];same(Path(info['path']).name,info['path'],'sibling map path');require(pv.integer(info['bytes'],1,2097152),'bounded maps')
                mp=path.parent/info['path'];self.hash(mp,{k:info[k] for k in ('sha256','bytes')});same(event['mapsSha256'],info['sha256'],'maps hash');same(event['mapsBytes'],info['bytes'],'maps bytes');value['maps']=mp.read_text();last=0
                require(bool(value['maps'].splitlines()),'empty maps')
                for line in value['maps'].splitlines():
                    match=re.fullmatch(r'([0-9a-f]+)-([0-9a-f]+)\s+[r-][w-][x-][ps]\s+[0-9a-f]+\s+[0-9a-f]+:[0-9a-f]+\s+\d+\s*.*',line,re.I);require(match is not None,'malformed maps')
                    start,end=map(lambda x:int(x,16),match.groups());require(last<=start<end,'unordered maps');last=end
            normalized.append(value)
        same(records,normalized,'exact serial/event replay');return nonce

    def run_report(self,path,step,request,frozen):
        r=self.read(path);b=r['browserResult'];enabled=step['enabled'];m=frozen['plan']['packages']['candidate' if enabled else 'control']['manifest']
        close_tree(r,dict(schema=1,status='passed',protocol=OUTER,experiment=dict(name='passive-fifo-v1',enabled=enabled),mode='baseline',snapshotMode='capture',captureCode=False,samplePeriod=257,timeoutMs=600000,package=step['package'],cache=request['cache'],pageErrors=[],serverErrors=[],executionConfiguration=dict(aotEnabled=False,planDisabled=True)),'finite raw report')
        require(not r.get('deadlineExceeded') and 'failure' not in r,'deadline or failure');same(r['manifest'],m,'reported planned manifest')
        for scope in (r,b,m):require('observation' not in scope and 'resourcesInitialized' not in scope and scope.get('timingEligible',True) is not False,'diagnostic timing contamination')
        close_tree(b,dict(status='passed',protocol=OUTER,captureCode=False,experiment=r['experiment'],fifo=v.fifo_state(enabled)),'finite browser')
        close_tree(b['ready'],dict(mode='cold',snapshotSaved=True,appSha256=m['appSha256'],compatibilitySha256=m['compatibilitySha256']),'typed readiness identity');same(r['transport']['publications'],1,'single snapshot publication')
        if 'deadlineExceeded' in r:same(r['deadlineExceeded'],False,'typed deadline flag')
        marker_path=path.parent/'execution-start.json';marker=self.read(marker_path)
        close_tree(marker,dict(schema=1,state='browser-entry-armed'),'durable execution start');require(bool(re.fullmatch(r'[a-f0-9-]{36}',marker['id'])),'start UUID')
        same(r['executionBoundary'],dict(started=True,id=marker['id'],recordSha256=self.hash(marker_path)['sha256']),'start boundary');same(b['horizon']['startId'],marker['id'],'browser start identity')
        folder=path.parent.parent;spawned=self.read(folder/'spawned.json');exit_record=self.read(folder/'exit.json')
        times=list(map(pv.timestamp,[request['utc'],spawned['utc'],r['createdUtc'],marker['utc'],exit_record['utc']]))
        require(times==sorted(times) and pv.integer(spawned['pid'],1),'attempt lifecycle');same(exit_record['code'],0,'child success')
        condition=r['hostCondition'];same(condition['configuration'],frozen['plan']['hostCondition'],'host condition config');checks=[]
        for phase in ('before','after'):
            observed=condition[phase];same(json.loads(observed['stdout']),observed['status'],'raw host condition');close_tree(observed['status'],condition['configuration']['expected'],'stopped compiler');same(observed['status'].get('errors',[]),[],'host errors')
            start,end=map(pv.timestamp,[observed['startedUtc'],observed['completedUtc']]);require(start<=end,'host check order');checks.append((start,end))
        require(checks[0][1]<=checks[1][0],'before/after host order')
        required={BASE+n for n in ('run.mjs','browser.mjs','vm-adapter.mjs','protocol.mjs')}|{'benchmarks/harness/m2-sustained-v2/protocol.mjs','experiments/passive-fifo/reader.mjs',step['package']+'/app.json'}|{step['package']+'/'+m['generation']+'/'+n for n in pv.ARTIFACTS}
        require(required<=set(r['inputHashes']),'missing execution input')
        require({BASE+'browser.mjs',BASE+'vm-adapter.mjs','experiments/passive-fifo/reader.mjs'}<=set(r['servedHashes']),'missing served input')
        for category in ('inputHashes','servedHashes'):
            for name,digest in r[category].items():same(frozen['files'][name]['sha256'],digest,'frozen execution input');self.hash(self.path(name),dict(sha256=digest))
        nonce=self.raw_protocol(path,r);observed=horizon(b)
        observed['drift']={}
        for name in pv.NAMES:
            drift=pv.assess_drift([row for row in b['results'] if row['name']==name],1.10);drift['scope']=DRIFT_SCOPE;observed['drift'][name]=drift
        for key,rows in [('warmups',b['warmups']),('measured',b['results'])]:observed[key]=[dict(name=row['name'],sample=row['sample'],hostMs=row['hostMs'],guestMs=row['guestMs'],pool=row['runtimeStats']['jitPool']) for row in rows]
        pools=[row['runtimeStats']['jitPool'] for row in b['warmups']+b['results']];observed['peakObservedLinearMemoryBytes']=max(p['linearMemoryBytes'] for p in pools);observed['peakObservedChargedInstances']=max(p['charged'] for p in pools)
        snapshot=self.path(r['cache'])/m['appSha256']/(m['compatibilitySha256']+'.snapshot');self.hash(snapshot,{k:r['snapshot'][k] for k in ('sha256','bytes')});v.snapshot_envelope(snapshot,m)
        return r,nonce,observed

    def prerequisite_review(self,role,item,packages):
        rp=self.path(item['path']);self.hash(rp,dict(sha256=item['sha256']));review=self.read(rp)
        same(review['status'],'passed','prerequisite '+role)
        require(not review.get('synthetic') and 'synthetic' not in str(review.get('scope','')).lower(),'synthetic prerequisite')
        inventory=review.get('inventory',review.get('identities'));require(type(inventory) is dict and inventory,'missing prerequisite inventory')
        for name,identity in inventory.items():self.hash(self.path(name) if not Path(name).is_absolute() else Path(name),identity)
        require(type(review.get('reviewerSha256')) is str and pv.HEX.fullmatch(review['reviewerSha256']) and any(name.endswith('.py') and identity['sha256']==review['reviewerSha256'] for name,identity in inventory.items()),'reviewer source absent from prerequisite inventory')
        performance=self.runtime_proof(self.path(packages['control']['path']))
        if role=='heldout':
            close_tree(review,dict(kind='passive-fifo-heldout-four-way-review',checkedDigests=1536,timingEligible=False,productPromotionEligible=False,reviewerSha256=DEPENDENCY_SHA),'heldout prerequisite');same(len(review['runs']),4,'four real heldout runs')
            for row,(enabled,mode) in zip(review['runs'],[(False,'cold'),(False,'restored'),(True,'cold'),(True,'restored')]):
                close_tree(row,dict(enabled=enabled,mode=mode,checkedDigests=384,fifo=v.fifo_state(enabled)),'heldout modes and exposure');self.production_runtime(row['manifest'],performance)
        elif role=='resource':
            close_tree(review,dict(timingEligible=False,productPromotionEligible=False,observedWithinBudget=True,reviewerSha256=DEPENDENCY_SHA),'resource prerequisite');require(type(review['totalRatio']) in (int,float) and 0<review['totalRatio']<=1.10,'resource byte budget')
            published=review['publishedAnalysis'];same(published['kind'],'diagnostic-module-input-bytes-passive-fifo-v1','policy resource identity')
            binding=published['resourcePlan'];path=self.path(binding['path']);self.hash(path,dict(sha256=binding['sha256']));resource_plan=self.read(path)
            for side in ('control','candidate'):
                same(resource_plan['packages'][side]['manifest'],packages[side]['manifest'],'resource/timing full production specification');same(resource_plan['packages'][side]['manifestSha256'],packages[side]['manifestSha256'],'resource/timing manifest identity')
        elif role=='diagnostic':
            same(review['kind'],'passive-fifo-combined-independent-replay','combined diagnostic identity');same(len(review['runs']),2,'diagnostic pair')
            for row,enabled in zip(review['runs'],[False,True]):
                same(row['enabled'],enabled,'diagnostic mode');same(row['mainFaults'],384,'architectural fault oracle');require(pv.integer(row['mainChecks'],414168),'architectural state oracle')
                delta=row['pressureAfterWarm'];final=row['finalCounters'];pool=row['finalPool'];trace=row['trace']
                require(pv.integer(trace['rows'],1,16384) and pv.integer(trace['episode'],1),'closed observed Asyncify episode');require(pv.integer(trace['pendingEpisodes'],0,64),'bounded descriptive pending episodes')
                for name in ('accountingErrors',):same(final[name],0,'diagnostic errors')
                require(all(pv.integer(pool[n],0,12000) for n in ('charged','live','pending','done')) and pool['charged']==pool['live']+pool['pending'] and pool['done']<=pool['pending'],'final ownership accounting')
                if enabled:require(delta['softBatches']>=2 and delta['softRetired']>=512 and delta['gcConsumed']>=256,'candidate soft/natural-GC exposure')
                else:require(delta['emergencyRetired']>=6000 and final['softBatches']==0 and final['softRetired']==0,'legacy emergency exposure')
                require(pv.integer(row['mainExposure']['compiledCalls']),'descriptive aggregate compiled main exposure')
            audit_path='artifacts/passive-fifo-diagnostic-build-01/source-recheck.json';require(audit_path in inventory,'diagnostic post-build audit missing');audit=self.read(self.path(audit_path))
            close_tree(audit,dict(status='passed',kind='passive-fifo-postbuild-audit',variant='diagnostic',sourceFingerprint='a212205ce5c8cbdd83dcf66ce8396ec3cdaa436037a77969963395f6e2b2a97c'),'diagnostic runtime source audit')
            same(audit['frozenImplementation']['sha256'],v.PROOF_PINS['frozenImplementation'][1],'same frozen policy overlay')
        else:raise ValueError('unknown prerequisite role')
        return review

    def prerequisites(self,argument,plan,frozen):
        path=self.path(argument);ledger=self.read(path);relative=str(path.relative_to(self.root))
        close_tree(ledger,dict(schema=1,experiment='passive-fifo-v1',protocol=OUTER),'prerequisite ledger')
        require(covered(relative,plan['inputs']),'prerequisite ledger was not frozen before timing');same(frozen['files'][relative],self.hash(path),'ledger frozen identity')
        same(set(ledger['reviews']),{'heldout','diagnostic','resource'},'required independent prerequisite roles')
        require(pv.timestamp(ledger['createdUtc'])<=pv.timestamp(plan['createdUtc']),'prerequisites declared after timing plan')
        for side in ('control','candidate'):
            same(ledger['packages'][side]['manifestSha256'],plan['packages'][side]['manifestSha256'],'prerequisite package identity')
        retained={}
        for role,item in ledger['reviews'].items():
            require(covered(item['path'],plan['inputs']),'prerequisite review absent from plan inputs');same(frozen['files'][item['path']]['sha256'],item['sha256'],'frozen prerequisite hash')
            review=self.prerequisite_review(role,item,plan['packages']);require(pv.timestamp(review['createdUtc'])<=pv.timestamp(ledger['createdUtc']),'review published after prerequisite ledger')
            retained[role]=dict(path=item['path'],sha256=item['sha256'],status=review['status'])
        return retained

    def campaign(self,directory,published_path,prerequisites=None,stack=()):
        directory,published_path=self.path(directory),self.path(published_path)
        require(str(directory) not in stack,'circular selection evidence');require(not (directory/'invalid-completed-observation.json').exists(),'campaign permanently invalidated')
        frozen=self.read(directory/'frozen.json');same(frozen['schema'],1,'frozen schema');freeze_sha=self.hash(directory/'frozen.json')['sha256']
        plan=self.read(directory/'plan.json');self.hash(directory/'plan.json',dict(sha256=frozen['planSha256']));same(plan,frozen['plan'],'hashed plan copy equals frozen plan')
        for name,identity in frozen['files'].items():self.hash(self.path(name),identity)
        for executable in ('node','chrome'):self.hash(Path(frozen['environment'][executable]),frozen['environment'][executable+'Identity'])
        self.validate_plan(plan)
        source=self.read(self.path(SOURCE))
        for row in source['files']:same(frozen['files'][row['path']],{k:row[k] for k in ('sha256','bytes')},'frozen timing harness source')
        for path in plan['inputs']:
            absolute=self.path(path)
            names=[absolute] if absolute.is_file() else [p for p in absolute.rglob('*') if p.is_file()]
            require(bool(names),'empty declared input')
            for name in names:same(frozen['files'][str(name.relative_to(self.root))],self.hash(name),'all prerequisite inputs frozen')
        prerequisite_records=self.prerequisites(prerequisites,plan,frozen) if prerequisites is not None else None
        selected_nonces=set();selection=plan['selection']
        if plan['kind']=='confirmation':
            require(covered(selection['path'],plan['inputs']),'selection absent from plan inputs');selected_path=self.path(selection['path']);self.hash(selected_path,dict(sha256=selection['sha256']));selected=self.read(selected_path)
            screen=self.campaign(selected['sourceCampaign'],selection['path'],prerequisites,(*stack,str(directory)))
            close_tree(screen,dict(kind='exploration',selected=True),'fresh independently selected pilot');same(screen['packages'],plan['packages'],'same pilot packages')
            for name in ('protocol','guestProtocol','horizonRule','bootstrapRule','parameters','orders','warmupOrders','planningRule','primary','secondary','service','primaryUpperRatio','secondaryUpperRatio','readyUpperRatio','serviceUpperRatio','memoryUpperRatio','bootstrapDraws','bootstrapSeed'):same(screen['plan'][name],plan[name],'same pilot design '+name)
            close_tree(selection['confirmationPlanning'],screen['confirmationPlanning'],'independent pilot count');same(screen['confirmationPlanning']['feasible'],True,'feasible pilot count');same(plan['pairs'],screen['confirmationPlanning']['requiredPairs'],'exact confirmation count');same(selection['captureNonces'],screen['captureNonces'],'pilot capture inventory');selected_nonces=set(screen['captureNonces'])
        accepted={};attempts=[];retained=[];planned={s['id']:s for s in plan['steps']};indices={s['id']:i for i,s in enumerate(plan['steps'])}
        for folder in sorted((directory/'attempts').iterdir()):
            require(folder.is_dir(),'unexpected attempt entry');require((folder/'request.json').is_file(),'orphan attempt has unknown start; cannot omit')
            request=self.read(folder/'request.json');same(request['schema'],1,'request schema');same(request['freezeSha256'],freeze_sha,'attempt freeze');require(request['stepId'] in planned,'unplanned attempt')
            exit_record=self.read(folder/'exit.json');started,ended=pv.timestamp(request['utc']),pv.timestamp(exit_record['utc']);require(started<=ended,'attempt chronology')
            command=request['command'];require(type(command) is list and len(command)>=4,'child invocation')
            argument=command[3];self.hash(self.path(argument),dict(sha256=frozen['planSha256']));same(frozen['files'][argument]['sha256'],frozen['planSha256'],'child plan frozen');step=planned[request['stepId']]
            expected=[frozen['environment']['node'],str(self.root/BASE/'run.mjs'),'--plan',argument,'--package',step['package'],'--output',str((folder/'run').relative_to(self.root)),'--mode','baseline','--snapshot','capture','--sample-period','257','--timeout','600000']
            same(command,expected,'exact child command');same(request['cache'],str((folder/'run/snapshots').relative_to(self.root)),'owned fresh snapshot cache')
            is_accepted=(folder/'accepted.json').exists()
            if is_accepted:
                require(step['id'] not in accepted,'multiple accepted attempts');record=self.read(folder/'accepted.json');require(ended<=pv.timestamp(record['utc']),'acceptance before child close')
                same(exit_record['code'],0,'successful child exit');same(exit_record.get('signal'),None,'child terminating signal');require(not exit_record.get('error'),'child error')
                self.hash(folder/'request.json',dict(sha256=record['requestSha256']));self.hash(folder/'run/report.json',dict(sha256=record['reportSha256']));accepted[step['id']]=(folder,request,record)
            else:retained.append(self.prestart_failure(folder))
            attempts.append(dict(path=str(folder.relative_to(self.root)),stepId=step['id'],accepted=is_accepted,started=started,ended=ended))
        ordered=sorted(attempts,key=lambda row:row['started']);previous=pv.timestamp(plan['createdUtc']);prior_index=-1
        for row in ordered:
            require(previous<=row['started'],'overlapping/reversed attempt chronology');require(prior_index<=indices[row['stepId']],'attempt order differs from fixed steps');previous=row['ended'];prior_index=indices[row['stepId']]
            if not row['accepted'] and row['stepId'] in accepted:require(row['ended']<=pv.timestamp(accepted[row['stepId']][1]['utc']),'attempt appeared after accepted step')
        reports=[];pairs={};nonces=[];start_ids=set()
        for step in plan['steps']:
            require(step['id'] in accepted,'missing accepted step '+step['id']);folder,request,record=accepted[step['id']];path=folder/'run/report.json'
            report,nonce,observed=self.run_report(path,step,request,frozen)
            require(nonce not in nonces and nonce not in selected_nonces,'capture nonce reused');nonces.append(nonce)
            start_id=report['executionBoundary']['id'];require(start_id not in start_ids,'durable execution UUID reused');start_ids.add(start_id)
            pair=pairs.setdefault(step['pair'],dict(pair=step['pair']));pair['candidate' if step['enabled'] else 'control']=observed
            reports.append(dict(stepId=step['id'],path=str(path),sha256=record['reportSha256'],nonce=nonce,browser=report['browser'],host=report['host'],observed=observed))
        for row in reports:
            same(row['browser'],reports[0]['browser'],'browser version')
            for name in ('platform','arch','release','logicalCPUs','totalMemoryBytes'):same(row['host'][name],reports[0]['host'][name],'host identity '+name)
        baseline=self.read(self.path('manifests/runtime-baseline.json'))
        for path,identity in baseline['runtimes']['x86_64']['files'].items():self.hash(self.path(path),identity)
        runtime={}
        for name in ('qemu-system-x86_64.js','qemu-system-x86_64.wasm'):
            retained_artifact=baseline['runtimes']['x86_64']['files']['runtime/x86_64/'+name];candidate=plan['packages']['control']['manifest']['artifacts']['runtime/'+name]
            runtime[name]=dict(retainedProduction=retained_artifact,experimentalRuntime=candidate,deltaBytes=candidate['bytes']-retained_artifact['bytes'],ratio=candidate['bytes']/retained_artifact['bytes'])
        units=list(pairs.values());same(len(units),plan['pairs'],'complete independent pairs')
        result=dict(schema=1,status='passed',kind=plan['kind'],protocol=OUTER,frozenSha256=freeze_sha,packages=plan['packages'],plan=plan,pairs=units,reports=reports,captureNonces=nonces,**aggregate(plan,units))
        result['resourceCoverage']=dict(runtimeVersusProduction=runtime,runtimeArtifactBytes={name:info['bytes'] for name,info in plan['packages']['control']['manifest']['artifacts'].items() if name.startswith('runtime/')})
        published=self.read(published_path);close_tree(published,result,'published independent recomputation');same(self.path(published['sourceCampaign']),directory,'analysis campaign')
        same(published['analyzerSha256'],frozen['files'][BASE+'analyze.mjs']['sha256'],'analysis source');same(set(published['retainedPreStartFailures']),{row['path'] for row in retained},'every certified pre-start failure retained')
        result['retainedPreStartFailures']=published['retainedPreStartFailures'];self.audit.append(dict(campaign=str(directory.relative_to(self.root)),analysis=str(published_path.relative_to(self.root)),attempts=attempts,prerequisites=prerequisite_records))
        return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--campaign',required=True);parser.add_argument('--analysis',required=True);parser.add_argument('--prerequisites',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    output=Path(args.output).resolve();require(output.is_relative_to(ROOT/'artifacts') and not output.exists(),'fresh project artifacts output required');output.mkdir(parents=True)
    review=Review();result=dict(schema=1,status='failed',kind='independent-passive-fifo-finite-campaign-review',createdUtc=dt.datetime.now(dt.timezone.utc).isoformat())
    try:
        for argument in (args.campaign,args.analysis,args.prerequisites):require(review.path(argument).is_relative_to(ROOT/'artifacts'),'synthetic/tmp cannot enter acceptance CLI')
        source=review.frozen_sources();record=review.campaign(args.campaign,args.analysis,args.prerequisites)
        for raw in record['reports']:
            r=review.read(review.path(raw['path']));require(not r.get('synthetic') and 'synthetic' not in str(r.get('browser','')).lower(),'synthetic report cannot establish timing evidence')
        result.update(status='passed',recomputed=record,audit=review.audit,productPromotionEligible=False)
        for name,identity in list(review.inventory.items()):review.hash(Path(name) if Path(name).is_absolute() else ROOT/name,identity)
    except Exception as error:result.update(status='failed',failure=str(error))
    result['inventory']=review.inventory;result['reviewerSha256']=sha(Path(__file__).read_bytes());result['scope']='Read-only evidence replay. No guest/build or timing plan is launched. Drift is descriptive, all52 phases remain; statistical agreement is not product promotion, native resident memory or long-run stability evidence.'
    durable_json(output/'review.json',result);print(json.dumps({k:result[k] for k in ('status','failure') if k in result}));return 0 if result['status']=='passed' else 1

if __name__=='__main__':raise SystemExit(main())
