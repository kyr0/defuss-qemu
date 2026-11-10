"""Separate Python interpretation of saved Linux integer signal contexts."""
import copy
from semantics import *
from alias import jit,address,ADD
from codebank import decode,difference
SUB='89f931c083f900740729f083e901ebf4c3'
STAGES=['layout','warm']+['signal']*8
def layout(p):
 want=dict(schema=1,rx='0x20000000',rw='0x21000000',a='0x20000004',b='0x20000009',back='0x2000000e',side='0x20000010',end='0x20000011',timer='ITIMER_VIRTUAL',timerUsec=10000,cases=8,codeHex=ADD)
 eq(sorted(p),sorted([*want,'physicalFrame']),'Exact layout fields')
 for k,v in want.items():eq(p[k],v,'Layout '+k)
 f=address(p['physicalFrame']);need(0<f*4096<512*1048576,'Actual code PFN');return p
def flags(a,b,sub):
 a&=U32;b&=U32;z=(a-b if sub else a+b)&U32
 cf=int(a<b if sub else a+b>U32);pf=int((z&255).bit_count()%2==0);af=int((a&15)<(b&15) if sub else (a&15)+(b&15)>15)
 sa,sb,sz=(a>>31)&1,(b>>31)&1,(z>>31)&1;of=int(sa!=sb and sz!=sa if sub else sa==sb and sz!=sa)
 return 0x202|cf|(pf<<2)|(af<<4)|(int(z==0)<<6)|(sz<<7)|(of<<11)
def initial(index,sp):
 need(type(index) is int and -1<=index<8,'Case');n=100000 if index<0 else 1000000+1009*index;step=0x9e3779b9^(((index+1)*0x10203041)&U32)
 g=[(0x1122334455667788^((i+1)*0x0102030405060708)^((index+2)*0x0102030405060708))&U64 for i in range(16)]
 g[0]=0;g[2]=n;g[4]=step;g[5]=n;g[7]=sp;return n,step,dict(gpr=list(map(hex,g)),rflags='0x202')
def state(s):
 eq(sorted(s),['gpr','rflags'],'Integer state fields');need(type(s['gpr']) is list and len(s['gpr'])==16,'All GPRs');return list(map(address,s['gpr'])),address(s['rflags'])
def gate(g,p):
 eq(sorted(g),sorted(['seq','stage','case','iterations','step','deliveries','initial','observed','sample','patches','rxPagemap','rwPagemap','rxHex','rwHex']),'Gate fields');seq=g['seq'];need(integer(seq,9),'Gate bound');eq([g['case'],g['stage']],[seq-2,STAGES[seq]],'Fixed order')
 patches=max(0,seq-1);current=SUB if patches%2 else ADD;eq([g['patches'],g['rxHex'],g['rwHex']],[patches,current,current],'Coherent patched code')
 for key in ('rxPagemap','rwPagemap'):
  word=address(g[key]);need(word>>63==1 and word&(1<<62)==0 and word&((1<<55)-1)==address(p['physicalFrame']),'Actual same physical alias')
 before,_=state(g['initial']);state(g['observed'])
 if not seq:
  eq(g['initial'],dict(gpr=['0x0']*16,rflags='0x0'),'Initial zero state');eq(g['observed'],g['initial'],'No work');eq([g['iterations'],g['step'],g['deliveries'],g['sample']],[0,0,0,None],'No layout work');return
 need(0<before[7]<(1<<47) and before[7]%16==0,'User stack');n,step,seed=initial(seq-2,before[7]);eq([g['iterations'],g['step'],g['initial']],[n,step,seed],'Exact work/seeds');result=before.copy();result[2]=0
 if seq==1:eq([g['deliveries'],g['sample']],[0,None],'No warm timer');result[0]=n*step&U32
 else:
  eq(g['deliveries'],1,'Single actual timer');s=g['sample'];eq(sorted(s),sorted(['signo','code','error','pc','gpr','rflags','beforeRxHex','beforeRwHex','afterRxHex','afterRwHex']),'Saved context/bytes');eq([s['signo'],s['code'],s['error']],[26,128,0],'Kernel timer')
  subtract=bool((seq-2)%2);prior=SUB if subtract else ADD;eq([s[k] for k in ('beforeRxHex','beforeRwHex','afterRxHex','afterRwHex')],[prior,prior,current,current],'Exact single opcode patch')
  off=address(s['pc'])-address(p['rx']);need(off in (4,7,9,11,14),'Active instruction boundary');regs,ef=state(dict(gpr=s['gpr'],rflags=s['rflags']));left=regs[2];need(4096<=left<n,'Interrupted work window')
  completed=n-left;operation=-step if subtract else step;acc=completed*operation&U32
  if off==11:expected_flags=flags(acc,step,subtract);acc=(acc+operation)&U32
  elif off in (4,14):expected_flags=flags(left+1,1,True)
  else:expected_flags=flags(left,0,True)
  wanted=before.copy();wanted[0]=acc;wanted[2]=left;wanted[7]-=8;eq(regs,wanted,'All interrupted GPRs');eq(ef,expected_flags|0x10000,'Exact RF-inclusive flags')
  # Count old and new operations separately, including the pre-decrement PC.
  old_operations=completed+int(off==11);new_operations=n-old_operations
  result[0]=(old_operations*operation-new_operations*operation)&U32
 eq(g['observed'],dict(gpr=list(map(hex,result)),rflags='0x246'),'Complete mixed-operation return')
class Contexts:
 def __init__(self,enabled):
  need(type(enabled) is bool,'Boolean mode');self.enabled=enabled;self.phase='startup';self.seq=0;self.clock=0;self.last_ack=0;self.epoch=0;self.gates=[];self.epochs=[];self.resets=[];self.previous=None
 def snapshot(self,r,initial=False):
  eq(r['captureErrors'],[],'Complete raw read');eq(r['m3aRaw'][12],1 if initial else 3,'Locked started configuration');s=native(r,self.enabled,initial);ranges(s,None,0,self.enabled,False);eq(s['a']['invalidRedispatches'],0,'No invalid redispatch');s['code']=decode(r['codeRaw'],s['b'],initial)
  pool=r['pool'];eq(pool['limit'],12000,'Fixed cap');need(integer(pool['charged'],12000) and integer(pool['linearMemoryBytes']) and pool['linearMemoryBytes']>0,'Bounded pool')
  if self.previous:
   for f in ('a','b'):
    for k,v in self.previous[f].items():need(s[f][k]>=v,'Monotonic native counters')
   difference(self.previous['code'],s['code'])
  self.previous=s;return s
 def accept(self,r):
  event=r['event'];time=r['readHostMs'] if event=='gate' else r['hostMs'];need(number(time) and time>=self.clock,'Clock order');self.clock=time
  if event=='startup':
   eq(self.phase,'startup','Startup order');s=self.snapshot(r,True);zero(list(s['a'].values())+list(s['b'].values()));eq(r['startupFailure'],None,'Native startup');need(len(r['startupCpus'])==1 and r['startupCpus'][0]['cpu-index']==0,'One CPU');self.phase='gate';return
  if event=='ack':
   eq([self.phase,r['seq'],r['ack']],['ack',self.seq,'K'],'ACK order');eq(r['watchEpoch'],dict(m3a=0,m3b=0,census=0),'No watch/reset');self.last_ack=time;self.seq+=1;self.phase='complete' if self.seq==10 else 'gate';return
  if event=='complete':
   eq(self.phase,'complete','Completion order');eq(r['validation'],dict(calls=9,signals=8,contexts=8,patches=8),'Fixed work');old=self.previous;s=self.snapshot(r);jit(r,s);eq(s['code'],old['code'],'No extra fused invocation');eq(len(self.epochs),9,'Nine calls');self.phase='done';return
  eq(event,'gate','Known observation event');eq([event,self.phase,r['seq'],r['gate']['seq']],['gate','gate',self.seq,self.seq],'Gate order');need(self.last_ack<=r['signalHostMs']<=time,'Signal clock');old=self.previous;s=self.snapshot(r);storage=jit(r,s)
  if not self.seq:self.layout=layout(r['layout']);eq(s['code']['formed'],0,'No early formation')
  gate(r['gate'],self.layout)
  if self.seq:
   target=[x for x in s['code']['records'] if x['translationPC']==self.layout['a']];before=[x for x in old['code']['records'] if x['translationPC']==self.layout['a']]
   if self.enabled:
    eq([len(target),len(before)],[self.seq,self.seq-1],'One replacement per patch')
    for i,t in enumerate(target):
     eq([t['status'],t['flags'],t['cflags'],t['bytes'],t['bOffset'],t['bytesHex']],['entered',0x18c0c2b3,0xff020000,12,5,(SUB if i%2 else ADD)[8:-2]],'Exact entered code/context');eq(address(t['page0']),address(self.layout['physicalFrame'])*4096+4,'Same physical code page');need(t['compiled']>0,'Compiled generation')
     if i:need(address(t['generation'])>address(target[i-1]['generation']),'New generation')
     if i<len(before)-1:eq([t['compiled'],t['tci']],[before[i]['compiled'],before[i]['tci']],'Earlier owner quiescent')
    if before:need(target[-2]['compiled']>before[-1]['compiled'],'Old warmed owner before patch');need(s['a']['invalidations']>old['a']['invalidations'],'Ordinary code invalidation')
    need(s['b']['BAttempts']>old['b']['BAttempts'],'Positive body interval');eq(s['b']['BAttempts'],s['b']['servicePaid'],'Exact service payment')
   else:eq(target,[],'Disabled fused activity')
   self.epochs.append(dict(seq=self.seq,patches=r['gate']['patches'],code=difference(old['code'],s['code']),target=copy.deepcopy(target),storage=storage))
  self.gates.append(copy.deepcopy(r['gate']));self.phase='ack'
