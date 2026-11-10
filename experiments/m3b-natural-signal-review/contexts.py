"""Separate Python interpretation of saved Linux integer signal contexts."""
import copy
from semantics import *
from alias import watched,jit,address,ADD
STAGES=['layout','warm']+['signal']*8
def layout(p):
 want=dict(schema=1,rx='0x20000000',a='0x20000004',b='0x20000009',back='0x2000000e',side='0x20000010',end='0x20000011',timer='ITIMER_VIRTUAL',timerUsec=10000,cases=8,codeHex=ADD)
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
 eq(sorted(g),sorted(['seq','stage','case','iterations','step','deliveries','initial','observed','sample']),'Gate fields');seq=g['seq'];need(integer(seq,9),'Gate bound');eq([g['case'],g['stage']],[seq-2,STAGES[seq]],'Fixed order');before,_=state(g['initial']);state(g['observed'])
 if seq==0:
  eq(g['initial'],dict(gpr=['0x0']*16,rflags='0x0'),'Zero initialization');eq(g['observed'],g['initial'],'No work');eq([g['iterations'],g['step'],g['deliveries'],g['sample']],[0,0,0,None],'Layout no work');return
 need(0<before[7]<(1<<47) and before[7]%16==0,'Aligned user stack');n,step,seed=initial(seq-2,before[7]);eq([g['iterations'],g['step'],g['initial']],[n,step,seed],'Exact seeds and work');result=before.copy();result[0]=n*step&U32;result[2]=0;eq(g['observed'],dict(gpr=list(map(hex,result)),rflags='0x246'),'Full state after signal return')
 if seq==1:eq([g['deliveries'],g['sample']],[0,None],'No warm timer');return
 eq(g['deliveries'],1,'Single shot');s=g['sample'];eq(sorted(s),sorted(['signo','code','error','pc','gpr','rflags']),'Saved context fields');eq([s['signo'],s['code'],s['error']],[26,128,0],'Kernel timer provenance');off=address(s['pc'])-address(p['rx']);need(off in (4,7,9,11,14,16),'Instruction boundary');regs,ef=state(dict(gpr=s['gpr'],rflags=s['rflags']));left=regs[2];need(left<=n,'Loop progress')
 if off in (9,11):need(left>0,'B positive count')
 if off==16:eq(left,0,'Side exit')
 acc=(n-left)*step&U32
 if off==11:expected_flags=flags(acc,step,False);acc=(acc+step)&U32
 elif off==4:expected_flags=0x246 if left==n else flags(left+1,1,True)
 elif off==14:expected_flags=flags(left+1,1,True)
 else:expected_flags=flags(left,0,True)
 wanted=before.copy();wanted[0]=acc;wanted[2]=left;wanted[7]-=8;eq(regs,wanted,'Complete interrupted GPR state');eq(ef,expected_flags|0x10000,'Precise interrupted status and control flags')

class Contexts:
 def __init__(self,enabled):
  need(type(enabled) is bool,'Boolean arm');self.enabled=enabled;self.phase='startup';self.seq=0;self.clock=0;self.last_ack=0;self.epoch=0;self.gates=[];self.epochs=[];self.resets=[];self.previous=None
 def snapshot(self,r,initial=False):
  s=native(r,self.enabled,initial);eq(s['epoch'],self.epoch,'Current epoch');eq(s['a']['invalidRedispatches'],0,'No invalid redispatch')
  if self.previous:
   for family in ('a','b'):
    for k,v in self.previous[family].items():need(s[family][k]>=v,'Cumulative counter')
   need(s['c']['total']>=self.previous['c']['total'],'Cumulative census')
  self.previous=s;return s
 def accept(self,r):
  event=r['event'];time=r['readHostMs'] if event=='gate' else r['hostMs'];need(number(time) and time>=self.clock,'Clock order');self.clock=time
  if event=='startup':
   eq(self.phase,'startup','Startup order');self.snapshot(r,True);eq(r['startupFailure'],None,'Startup success');need(len(r['startupCpus'])==1 and r['startupCpus'][0]['cpu-index']==0,'One CPU');self.phase='gate';return
  if event=='configured':
   eq([self.phase,r['seq'],self.seq],['configured',0,0],'One layout reset');old=self.previous;self.epoch=4;s=watched(self.snapshot(r),self.layout,self.enabled,4,True);eq(s['c']['total'],old['c']['total'],'Reset preserves total');self.resets.append(dict(seq=0,epoch=4));self.phase='ack';return
  if event=='ack':
   eq([self.phase,r['seq'],r['ack']],['ack',self.seq,'K'],'ACK order');eq(r['watchEpoch'],dict(m3a=4,m3b=4,census=4),'Only epoch four');self.last_ack=time;self.seq+=1;self.phase='complete' if self.seq==10 else 'gate';return
  if event=='complete':
   eq(self.phase,'complete','Complete order');eq(r['validation'],dict(calls=9,signals=8,contexts=8),'Fixed work');old=self.previous;s=watched(self.snapshot(r),self.layout,self.enabled,4);jit(r,s);eq(s['c']['slots'][0]['raw'],old['c']['slots'][0]['raw'],'No extra invocation');eq(s['bw'][0],old['bw'][0],'No extra fused call');eq(len(self.epochs),9,'Nine compiled calls');self.phase='done';return
  eq([event,self.phase,r['seq'],r['gate']['seq']],['gate','gate',self.seq,self.seq],'Gate order');need(self.last_ack<=r['signalHostMs']<=time,'Signal clock');s=self.snapshot(r);storage=jit(r,s)
  if self.seq==0:self.layout=layout(r['layout']);eq(s['c']['raw'][13],0,'Initial watch disabled');self.phase='configured'
  else:
   watched(s,self.layout,self.enabled,4);c=s['c']['slots'][0];kind=0 if self.enabled else 2;t=c['tuples'][kind];old=self.epochs[-1] if self.epochs else None;need(t and c['counts'][2*kind]>(old['compiled'] if old else 0),'Compiled delta each call');eq(t[14:16],[0x18c0c2b3,0xff020000],'Supported original context')
   if self.enabled:
    b=s['bw'][0];need(b['compiledEntries']>0 and b['BAttempts']>0,'Fused exposure');eq(b['BAttempts'],b['servicePaid'],'Single payment');eq(b['emittedOwners'],1,'One fused owner');eq(b['generation'],pair(t,4),'Generation match')
   if old:
    for offset in (2,4,6,10):eq(pair(t,offset),pair(old['tuple'],offset),'Same warmed owner/code/generation/page')
   self.epochs.append(dict(seq=self.seq,epoch=4,tuple=copy.deepcopy(t),compiled=c['counts'][2*kind],tci=c['counts'][2*kind+1],BAttempts=s['bw'][0]['BAttempts'],servicePaid=s['bw'][0]['servicePaid'],storage=storage));self.phase='ack'
  gate(r['gate'],self.layout);self.gates.append(copy.deepcopy(r['gate']))
