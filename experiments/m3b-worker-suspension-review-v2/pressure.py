"""Independent pressure work, native-bank and natural FIFO lifecycle proof.

No JavaScript oracle is imported. Counts are native entry attempts, not retired
guest bodies. Capacity release is inferred from preserved native charge rules,
never attributed to an individual FinalizationRegistry callback.
"""
import copy
import re
from semantics import *
from suspension import decode

SETTINGS=dict(tbMiB=256,guestRamMiB=512,hotLimit=1500,flags=3,instanceLimit=12000,
              prefillInstalls=7000,maxNodes=12000,batch=64,iterations=100000,retries=16,
              sleepNs=1000000000,timeoutMs=1800000)
CODE='83f900740701f083e901ebf4'

def address(s,lo=0x100000,hi=1<<47):
    need(type(s) is str and re.fullmatch(r'0x(?:0|[1-9a-f][0-9a-f]*)',s),'Canonical address')
    n=int(s,16);need(lo<=n<hi,'Address range');return n

def layout(value):
    eq(sorted(value),sorted(['schema','sentinel','generated','maxNodes','batch','iterations','retries','sleepNs']),'Exact pressure layout keys')
    eq(value['schema'],1,'Pressure layout schema')
    for k in ('maxNodes','batch','iterations','retries','sleepNs'):eq(value[k],SETTINGS[k],'Fixed work '+k)
    p=value['sentinel'];eq(sorted(p),sorted(['a','b','back','side','end','ownerBytes','codeHex']),'Exact sentinel fields')
    a,b,back,side,end=[address(p[k],hi=1<<32) for k in ('a','b','back','side','end')]
    eq([b,back,side,end],[a+5,a+10,a+12,a+13],'Sentinel instruction boundaries')
    need(a%4096==4 and a//4096==(end-1)//4096,'Static one-page owner')
    eq([p['ownerBytes'],p['codeHex']],[12,CODE],'Exact independently decoded owner')
    need(type(value['generated']) is list and len(value['generated'])==2,'Generated mapping endpoints')
    start,finish=map(address,value['generated']);need(start%4096==0 and finish-start==12000*64,'Fixed generated-code size')
    need(finish<=a or start>=end,'Static and generated code do not overlap');return value

def batch(n):return integer(n,12000) and n>0 and (n%64==0 or n==12000)

def gate(stage,nodes,attempt):
    need(integer(nodes,12000) and integer(attempt,15),'Exact bounded gate integers')
    if stage=='layout':need(nodes==attempt==0,'Initial gate bounds');checks=2
    elif stage=='prefill':need(batch(nodes) and attempt==0,'Prefill bounds');checks=2+nodes
    elif stage=='warm':need(batch(nodes) and attempt==0,'Late warm bounds');checks=10+nodes
    elif stage=='churn':need(batch(nodes) and attempt==0,'Churn batch bound');checks=10+nodes
    elif stage=='revisit':need(batch(nodes),'Revisit node bound');checks=11+nodes+attempt
    else:raise ValueError('Unknown pressure gate')
    return dict(stage=stage,nodes=nodes,attempt=attempt,checks=checks)

def completion(nodes,attempts):
    need(batch(nodes) and integer(attempts,16) and attempts==16,'Bounded completed work')
    return dict(checks=10+nodes+attempts,nodes=nodes,attempts=attempts)

def jit(row,state):
    eq(row['jitError'],None,'Successful stopped JIT query');eq(row['jitStatus'].get('running'),False,'JIT query ended stopped');eq(row['jitStatus']['status'],'paused','JIT stop state')
    text=row['jitRaw'].get('human-readable-text');need(type(text) is str and 0<len(text)<=32768,'Bounded raw JIT response')
    def one(pattern):
        found=re.findall(pattern,text,re.M);need(len(found)==1,'Unique JIT field');v=found[0];return [int(x) for x in v] if type(v) is tuple else int(v)
    used,cap=one(r'^gen code size[ \t]+(\d+)/(\d+)[ \t]*\r?$')
    count=one(r'^TB count[ \t]+(\d+)[ \t]*\r?$');flush=one(r'^TB flush count[ \t]+(\d+)[ \t]*\r?$')
    need(all(integer(v,1<<53) for v in (used,cap,count,flush)) and 255*1048576<cap<=256*1048576 and used<=cap and count>0,'Native256MiB translation storage')
    eq(flush,state['a']['flushes'],'Independent native/global flush agreement')
    return dict(usedBytes=used,capacityBytes=cap,tbCount=count,flushCount=flush)

def state(row,enabled,initial=False):
    s=native(row,enabled,initial);eq(s['a']['invalidRedispatches'],0,'No metadata invalid redispatch')
    for counts in [s['b'],*s['bw']]:need(counts['BAttempts']<=counts['compiledEntries']+counts['tciEntries'],'Budget1 B attempts bounded by actual A tier attempts')
    i,r,c=s['a']['instanceInstalls'],s['a']['instanceRetires'],row['pool']['charged']
    need(r<=i and i-r<=c<=i and c<=12000,'Single-worker charged/live/pending conservation bounds')
    s['pool']=copy.deepcopy(row['pool']);eq(row['suspensionAbi'],1,'Actual observer ABI');s['suspension']=decode(row['suspensionRaw'],enabled);
    for x in s['suspension']['slots']:need(x['Bafter']<=s['b']['BAttempts'] and x['paidAfter']<=s['b']['servicePaid'] and x['requestedAfter']<=s['b']['BRequested'],'Observed payment within lifetime')
    return s

def watched(s,p,enabled,clear=False):
    eq(s['epoch'],4,'One cumulative watch epoch')
    for slot in range(4):
        begin=int(p['sentinel']['a'],16) if slot==0 else int(p['generated'][0],16) if slot==1 else 0
        end=begin+1 if slot==0 else int(p['generated'][1],16) if slot==1 else 0
        a,b,c=s['aw'][slot],s['bw'][slot],s['c']['slots'][slot]
        for w in (a,b):eq([w['begin'],w['end']],[begin,end],'Exact sentinel/churn watch')
        eq(a['enabled'],bool(begin),'M3a watch enable')
        if a['selected']:need(begin<=a['last']<end,'Selected PC in exact range')
        else:eq(a['last'],0,'Zero selection PC')
        eq([c['pc'],c['active'],c['required'],c['epoch']],[begin if slot==0 else 0,slot==0,slot==0 and enabled,slot+1],'Only sentinel census active')
        if clear or slot>1:zero([a['selected'],b['last'],b['generation'],c['total']]+[b[k] for k in WATCH])
        if slot>0:eq(c['total'],0,'No generated-code census')
    a,b,c=s['aw'][0],s['bw'][0],s['c']['slots'][0]
    eq(c['sites'][0],a['selected'],'Complete compiled sentinel census')
    eq(c['counts'][:2],[b['compiledEntries'],b['tciEntries']],'Complete fused tiers')
    eq(s['c']['total'],c['total'],'No prior reset erases lifetime attempts')
    zero(c['counts'][6:]);zero(c['counts'][4:6] if enabled else c['counts'][:2])
    selected_kind=0 if enabled else 2;t=c['tuples'][selected_kind]
    if t:
        eq(pair(t,8),int(p['sentinel']['a'],16),'Static translation PC');need(0<pair(t,10)<512*1048576,'Ordinary low RAM page');eq(pair(t,12),U64,'No second page')
        eq([t[14],t[15]],[0x18c0c2b3,0xff020000],'Exact supported context flags')
        if enabled:eq([pair(t,4),pair(t,0)],[b['generation'],b['last']],'Selected descriptor/generation')
    zero([s['bw'][1][k] for k in ('compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','emittedOwners')],'Generated loops never become fused')
    return s

def same_owners(first,last):
    for a,b in zip(first['c']['slots'][0]['tuples'],last['c']['slots'][0]['tuples']):
        if a is not None:need(b is not None,'Existing owner vanished');tuple_equal(a,b)

def monotonic(previous,current):
    for family in ('a','b'):
        for k,v in previous[family].items():need(current[family][k]>=v,'Lifetime counter decrease '+family+'.'+k)
    need(current['c']['total']>=previous['c']['total'],'Cumulative census decrease')
    if previous['epoch']==current['epoch']==4:
        for slot in range(4):
            need(current['aw'][slot]['selected']>=previous['aw'][slot]['selected'],'Watched selected decrease')
            for k in WATCH:need(current['bw'][slot][k]>=previous['bw'][slot][k],'Watched counter decrease')
            for k in ('total','rf'):need(current['c']['slots'][slot][k]>=previous['c']['slots'][slot][k],'Census count decrease')
            for before,after in zip(previous['c']['slots'][slot]['counts'],current['c']['slots'][slot]['counts']):need(after>=before,'Census tier decrease')

class Lifetime:
    def __init__(self,enabled,elf):
        need(type(enabled) is bool,'Boolean arm');self.enabled=enabled;self.elf=elf;self.phase='startup';self.work='new';self.seq=0;self.clock=0;self.last_ack=0;self.epoch=0;self.nodes=0;self.attempts=0;self.previous=None;self.previous_jit=None;self.warm=None;self.retirement=None;self.reentry=None;self.gates=[];self.observations=[];self.cap_fallback=False
    def snapshot(self,row,initial=False):
        s=state(row,self.enabled,initial);eq(s['epoch'],self.epoch,'Exact active epoch')
        if self.previous:
            monotonic(self.previous,s);old=self.previous['suspension'];new=s['suspension'];need(new['count']>=old['count'] and new['overflow']>=old['overflow'],'Observer monotonic');eq(new['slots'][:old['count']],old['slots'],'Completed observations immutable')
        self.previous=s;return s
    def translation(self,row,s):
        x=jit(row,s)
        if self.previous_jit:
            eq(x['capacityBytes'],self.previous_jit['capacityBytes'],'Stable translation capacity')
            if x['flushCount']==self.previous_jit['flushCount']:need(x['usedBytes']>=self.previous_jit['usedBytes'],'Monotonic no-flush occupancy')
        if self.warm:eq(x['flushCount'],self.warm['state']['a']['flushes'],'No post-warm global flush')
        self.previous_jit=x;return x
    def accept(self,row):
        event=row['event'];clock=row['readHostMs'] if event=='gate' else row['hostMs'];need(number(clock) and clock>=self.clock,'Monotonic record clock');self.clock=clock
        if event=='startup':
            eq(self.phase,'startup','Startup order');s=self.snapshot(row,True);eq(s['epoch'],0,'Startup epoch')
            for a,b,c in zip(s['aw'],s['bw'],s['c']['slots']):zero([a['begin'],a['end'],a['selected'],a['last'],b['begin'],b['end'],b['last'],b['generation'],c['total']]+[b[k] for k in WATCH])
            self.phase='gate';return
        if event=='configured':
            eq([self.phase,row['seq'],self.epoch],['configured',0,0],'Exactly one stopped watch setup');old=self.previous['c']['total'];self.epoch=4;s=watched(self.snapshot(row),self.layout,self.enabled,True);eq(s['c']['total'],old,'Setup preserves cumulative attempts');self.phase='ack';return
        if event=='ack':
            eq([self.phase,row['seq'],row['ack']],['ack',self.seq,self.ack],'Exact stopped decision ACK');eq(row['watchEpoch'],dict(m3a=4,m3b=4,census=4),'No repeated reset');self.last_ack=clock;self.seq+=1;self.phase='complete' if self.work in ('complete','incomplete') else 'gate';return
        if event=='complete':
            eq(self.phase,'complete','Complete order');eq(row['validation'],completion(self.nodes,self.attempts),'Independent final guest check total')
            prior=self.previous;s=watched(self.snapshot(row),self.layout,self.enabled);self.translation(row,s);same_owners(self.warm['state'],s)
            for family in ('aw','bw'):eq(s[family][0],prior[family][0],'No terminal sentinel invocation')
            eq(s['c']['slots'][0]['raw'],prior['c']['slots'][0]['raw'],'No terminal sentinel census');eq(s['a']['instanceRetires'],6000,'Exactly first FIFO retirement')
            t=s['c']['slots'][0]['tuples'][0];self.episodes=[x for x in s['suspension']['slots'] if x['token']>self.retirement['state']['suspension']['count'] and x['compiled'] and x['pc']==self.layout['sentinel']['a'] and t and x['code']==hex(pair(t,6)) and x['generation']==hex(pair(t,4)) and x['owner']==hex(pair(t,2))]
            self.status='passed' if self.reentry and (not self.enabled or self.episodes) else 'incomplete';self.phase='done';return
        eq(event,'gate','Allowed protocol event');eq(self.phase,'gate','Gate order');eq(row['seq'],self.seq,'Gate sequence');need(number(row['signalHostMs']) and self.last_ack<=row['signalHostMs']<=clock,'Signal after previous ACK and before read')
        g=row['gate'];eq(g,gate(g['stage'],g['nodes'],g['attempt']),'Independent guest gate');s=self.snapshot(row);x=self.translation(row,s);self.ack='K'
        if g['stage']=='layout':
            eq([self.work,self.seq],['new',0],'One layout gate');self.layout=layout(row['layout']);eq(dict(schema=1,sentinel=self.layout['sentinel']),self.elf,'Actual ELF sentinel')
            for a,b in zip(s['aw'],s['bw']):zero([a['begin'],a['end'],b['begin'],b['end']])
            eq(s['c']['total'],0,'No watched boot attempts');self.work='prefill';self.phase='configured'
        else:
            watched(s,self.layout,self.enabled)
            if self.warm:same_owners(self.warm['state'],s)
            if g['stage']=='prefill':
                eq(self.work,'prefill','Prefill stage');eq(g['nodes'],min(self.nodes+64,12000),'Prefill progress');self.nodes=g['nodes'];eq(s['a']['instanceRetires'],0,'No early retirement');eq(s['aw'][0]['selected'],0,'No early sentinel');eq(s['c']['slots'][0]['total'],0,'No early sentinel attempts');need(s['a']['instanceInstalls']<11000,'Room for sentinel')
                if s['a']['instanceInstalls']>=7000:self.work='warm';self.ack='R'
                else:need(self.nodes<12000,'Bounded prefill')
            elif g['stage']=='warm':
                eq(self.work,'warm','Warm stage');eq(g['nodes'],self.nodes,'Warm nodes');need(7000<=s['a']['instanceInstalls']<11000,'Late compiled sentinel');eq(s['a']['instanceRetires'],0,'No retirement before sentinel');eq(s['pool']['charged'],s['a']['instanceInstalls'],'Every initial install charged');need(s['aw'][0]['selected']>0,'Actual compiled sentinel exposure')
                kind=0 if self.enabled else 2;need(s['c']['slots'][0]['counts'][2*kind]>0,'Correct normal owner compiled tier')
                if self.enabled:need(s['bw'][0]['compiledEntries']>0 and s['bw'][0]['BAttempts']>0,'Fused owner actually entered B');eq(s['bw'][0]['emittedOwners'],1,'One immutable sentinel owner')
                self.warm=dict(seq=self.seq,state=copy.deepcopy(s));self.work='churn'
            elif g['stage']=='churn':
                eq(self.work,'churn','Churn stage');eq(g['nodes'],min(self.nodes+64,12000),'Exact bounded batch progress');self.nodes=g['nodes'];need(s['aw'][1]['selected']>0,'Generated pressure actually compiled')
                for family in ('aw','bw'):eq(s[family][0],self.warm['state'][family][0],'Sentinel cannot run during churn')
                eq(s['c']['slots'][0]['raw'],self.warm['state']['c']['slots'][0]['raw'],'Cumulative sentinel unchanged during churn')
                if s['a']['instanceRetires']==6000:
                    need(s['a']['instanceInstalls']>=12000,'First retirement followed actual full pool');self.retirement=dict(seq=self.seq,state=copy.deepcopy(s));self.work='revisit';self.ack='R'
                else:eq(s['a']['instanceRetires'],0,'No other retirement size');need(self.nodes<12000,'Bounded churn must reach first retirement')
            else:
                eq([g['stage'],self.work,g['nodes'],g['attempt']],['revisit','revisit',self.nodes,self.attempts],'Exact revisit order');self.attempts+=1;eq(s['a']['instanceRetires'],6000,'No second retirement')
                base=self.retirement['state'];kind=0 if self.enabled else 2;selected=s['c']['slots'][0]['counts'][2*kind]-base['c']['slots'][0]['counts'][2*kind];need(selected>=0,'Selected tier monotonic')
                if selected==0 and s['pool']['charged']==12000:self.cap_fallback=True
                if selected:self.reentry=dict(seq=self.seq,state=copy.deepcopy(s))
                if self.attempts==16:self.work='complete'
            self.phase='ack'
        self.gates.append(copy.deepcopy(g));self.observations.append(dict(seq=self.seq,stage=g['stage'],nodes=g['nodes'],attempt=g['attempt'],pool=s['pool'],jit=x,installs=s['a']['instanceInstalls'],retires=s['a']['instanceRetires'],flushes=s['a']['flushes'],staleMisses=s['a']['staleInstanceMisses'],normalCompiled=s['c']['slots'][0]['counts'][0 if self.enabled else 4]))
    def summary(self):
        kind=0 if self.enabled else 2
        owners={name:record['state']['c']['slots'][0]['tuples'][kind] if record else None for name,record in [('warm',self.warm),('retirement',self.retirement),('reentry',self.reentry)]}
        return dict(status=getattr(self,'status','failed'),enabled=self.enabled,nodes=self.nodes,attempts=self.attempts,warmSeq=self.warm['seq'] if self.warm else None,retirementSeq=self.retirement['seq'] if self.retirement else None,qualifyingEpisodes=getattr(self,'episodes',[]),observer=self.previous['suspension'] if self.previous else None,selectedAfterRetirement=self.reentry is not None,fullCapWithoutNewCompiledObservation=self.cap_fallback,normalOwnerTuples=owners,observations=self.observations)
