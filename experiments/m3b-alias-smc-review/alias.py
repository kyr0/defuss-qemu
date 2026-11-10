"""Python interpretation of guest alias bytes, arithmetic and native owners."""
import copy,re
from semantics import *
STAGES=['layout','add-complete','sub-patched','sub-complete','add-patched','add-restored-complete']
ITERATIONS=[0,1,17,4096,100000,100003,100019,131071]
ADD='89f931c083f900740701f083e901ebf4c3';SUB='89f931c083f900740729f083e901ebf4c3'

def address(value):
 need(type(value) is str and re.fullmatch(r'0x(?:0|[1-9a-f][0-9a-f]*)',value),'Canonical uint64');n=int(value,16);need(n<=U64,'uint64');return n
def layout(p):
 want=dict(schema=1,rx='0x20000000',rw='0x21000000',a='0x20000004',b='0x20000009',back='0x2000000e',side='0x20000010',end='0x20000011',pageBytes=4096,codeBytes=17)
 eq(sorted(p),sorted([*want,'physicalFrame']),'Layout fields')
 for k,v in want.items():eq(p[k],v,'Fixed layout '+k)
 n=address(p['physicalFrame']);need(0<n*4096<512*1024*1024,'Guest nonzero physical frame');return p
def values(subtract):
 return [((-1 if subtract else 1)*n*(0x9e3779b9^((i*0x10203041)&U32)))&U32 for i,n in enumerate(ITERATIONS)]
def gate(g,p):
 eq(sorted(g),sorted(['seq','stage','checks','patches','rxPagemap','rwPagemap','rxHex','rwHex','values']),'Gate fields');seq=g['seq'];need(integer(seq,5),'Gate bound');eq(g['stage'],STAGES[seq],'Stage');eq([g['checks'],g['patches']],[[0,8,8,16,16,24][seq],[0,0,1,1,2,2][seq]],'Fixed work')
 for key in ('rxPagemap','rwPagemap'):
  v=address(g[key]);need(v>>63==1 and not v&(1<<62),'Present unswapped mapping');eq(v&((1<<55)-1),int(p['physicalFrame'],16),'Same persistent physical page')
 sub=seq in (2,3);eq([g['rxHex'],g['rwHex']],[SUB if sub else ADD]*2,'Exact opcode and unchanged remainder');eq(g['values'],values(sub) if seq%2 else [],'Independent modulo32 arithmetic')
def jit(row,s):
 eq(row['jitError'],None,'JIT query');eq([row['jitStatus']['running'],row['jitStatus']['status']],[False,'paused'],'JIT stopped');text=row['jitRaw']['human-readable-text'];need(type(text) is str and len(text)<=32768,'Bounded JIT text')
 def one(pattern):
  m=re.findall(pattern,text,re.M);eq(len(m),1,'Unique JIT field');return [int(x) for x in m[0]] if type(m[0]) is tuple else int(m[0])
 used,cap=one(r'^gen code size\s+(\d+)/(\d+)[ \t]*\r?$');count=one(r'^TB count\s+(\d+)[ \t]*\r?$');flush=one(r'^TB flush count\s+(\d+)[ \t]*\r?$')
 need(127*1048576<cap<=128*1048576 and used<=cap and count>0,'Original128MiB buffer');eq([flush,s['a']['flushes']],[0,0],'No global flush');return dict(usedBytes=used,capacityBytes=cap,tbCount=count,flushCount=flush)
def watched(s,p,enabled,epoch,clear=False):
 eq(s['c']['raw'][13],1,'Only exact A watched')
 for i,(a,b,c) in enumerate(zip(s['aw'],s['bw'],s['c']['slots'])):
  pc=int(p['a'],16) if i==0 else 0;end=pc+1 if pc else 0
  for w in (a,b):eq([w['begin'],w['end']],[pc,end],'Exact watch range')
  eq([a['enabled'],c['pc'],c['active'],c['required'],c['epoch']],[i==0,pc,i==0,i==0 and enabled,epoch-3+i],'Exact native watch contract')
  if clear or i:zero([a['selected'],a['last'],c['total']]+[b[k] for k in WATCH])
 a,b,c=s['aw'][0],s['bw'][0],s['c']['slots'][0];eq(c['sites'][0],a['selected'],'Compiled census');eq(c['counts'][:2],[b['compiledEntries'],b['tciEntries']],'Fused tiers');zero(c['counts'][6:]);zero(c['counts'][4:6] if enabled else c['counts'][:2])
 for t in c['tuples']:
  if t:
   eq([pair(t,0),pair(t,8)],[int(p['a'],16)]*2,'Exact translated PC');eq(pair(t,10)&~4095,int(p['physicalFrame'],16)*4096,'Native owner on actual shared PFN');eq(pair(t,12),U64,'Single-page owner')
 return s

class Alias:
 def __init__(self,enabled):
  need(type(enabled) is bool,'Boolean arm');self.enabled=enabled;self.phase='startup';self.seq=0;self.clock=0;self.last_ack=0;self.epoch=0;self.gates=[];self.epochs=[];self.resets=[];self.previous=None
 def snapshot(self,r,initial=False):
  s=native(r,self.enabled,initial);eq(s['epoch'],self.epoch,'Current epoch');eq(s['a']['invalidRedispatches'],0,'No invalid redispatch')
  if self.previous:
   for family in ('a','b'):
    for k,v in self.previous[family].items():need(s[family][k]>=v,'Cumulative native counter')
   need(s['c']['total']>=self.previous['c']['total'],'Cumulative native census')
  self.previous=s;return s
 def accept(self,r):
  event=r['event'];time=r['readHostMs'] if event=='gate' else r['hostMs'];need(number(time) and time>=self.clock,'Record clock');self.clock=time
  if event=='startup':
   eq(self.phase,'startup','Startup order');s=self.snapshot(r,True);eq(r['startupFailure'],None,'Startup success');need(len(r['startupCpus'])==1 and r['startupCpus'][0]['cpu-index']==0,'One actual CPU');self.phase='gate';return
  if event=='configured':
   eq([self.phase,r['seq']],['configured',self.seq],'Reset ordering');need(self.seq in (0,2,4),'Only three resets');old=self.previous;self.epoch+=4;s=watched(self.snapshot(r),self.layout,self.enabled,self.epoch,True);eq(s['c']['total'],old['c']['total'],'Reset preserves total');self.resets.append(dict(seq=self.seq,epoch=self.epoch));self.phase='ack';return
  if event=='ack':
   eq([self.phase,r['seq'],r['ack']],['ack',self.seq,'K'],'ACK order');eq(r['watchEpoch'],dict(m3a=self.epoch,m3b=self.epoch,census=self.epoch),'Actual ACK watch epochs');self.last_ack=time;self.seq+=1;self.phase='complete' if self.seq==6 else 'gate';return
  if event=='complete':
   eq(self.phase,'complete','Complete ordering');eq(r['validation'],dict(checks=24,calls=24,patches=2),'Fixed pass');old=self.previous;s=watched(self.snapshot(r),self.layout,self.enabled,self.epoch);jit(r,s);eq(s['c']['slots'][0]['raw'],old['c']['slots'][0]['raw'],'No extra code invocation');eq(s['bw'][0],old['bw'][0],'No extra fused invocation');eq(len(self.epochs),3,'Three actual compiled epochs');self.phase='done';return
  eq([event,self.phase,r['seq'],r['gate']['seq']],['gate','gate',self.seq,self.seq],'Gate order');need(self.last_ack<=r['signalHostMs']<=time,'Signal ordering');old=self.previous;s=self.snapshot(r);storage=jit(r,s)
  if self.seq==0:self.layout=layout(r['layout']);eq(s['c']['raw'][13],0,'No initial watches');self.phase='configured'
  else:
   watched(s,self.layout,self.enabled,self.epoch)
   if self.seq%2==0:
    eq(s['c']['slots'][0]['raw'],old['c']['slots'][0]['raw'],'No execution while patching');eq(s['aw'][0],old['aw'][0],'No selected invocation while patching');eq(s['bw'][0],old['bw'][0],'No fused invocation while patching');need(s['a']['invalidations']>old['a']['invalidations'],'Actual normal invalidation');self.phase='configured'
   else:
    c=s['c']['slots'][0];kind=0 if self.enabled else 2;t=c['tuples'][kind];need(t and c['counts'][2*kind]>0,'Positive compiled exact-PC owner');eq(t[14:16],[0x18c0c2b3,0xff020000],'Original supported context')
    if self.enabled:
     b=s['bw'][0];need(b['compiledEntries']>0 and b['BAttempts']>0,'Positive fused B');eq(b['BAttempts'],b['servicePaid'],'Service equality');eq(b['emittedOwners'],1,'One new fused owner');eq(b['generation'],pair(t,4),'Selected generation')
    if self.epochs:
     prior=self.epochs[-1]['tuple'];eq(pair(t,10),pair(prior,10),'Same physical page')
     if self.enabled:need(pair(t,4)>pair(prior,4) and pair(t,2)!=pair(prior,2) and pair(t,6)!=pair(prior,6),'Fresh fused owner/code/generation')
    self.epochs.append(dict(seq=self.seq,epoch=self.epoch,opcode=41 if self.seq==3 else 1,tuple=copy.deepcopy(t),compiled=c['counts'][2*kind],tci=c['counts'][2*kind+1],BAttempts=s['bw'][0]['BAttempts'],servicePaid=s['bw'][0]['servicePaid'],storage=storage));self.phase='ack'
  gate(r['gate'],self.layout);self.gates.append(copy.deepcopy(r['gate']))
