"""Separate Python interpretation of the raw native worker observer bank."""
from semantics import bank,eq,need,zero,pair

def decode(raw,enabled):
 bank(raw,2624);need(type(enabled) is bool,'Boolean arm')
 eq(raw[:5],[0x4d335357,1,2624,4,640],'Observer header');eq(raw[14],64,'Slot offset')
 n=raw[5];need(n<=4,'Four retained candidates');eq(raw[6:8],[0,0],'Completed nonfaulted observer');eq(raw[9:11],[n,n*4],'Four transitions per completion');zero([raw[11],raw[15]]+raw[18:64])
 if not enabled:eq([n,raw[8]],[0,0],'OFF has no service candidates')
 if n:
  for i in (12,16):need(pair(raw,i)>0 and pair(raw,i)%4==0,'Aligned native bank pointers')
 else:zero(raw[12:14]+raw[16:18])
 slots=[]
 for i in range(4):
  w=raw[64+i*640:64+(i+1)*640]
  if i>=n:zero(w);continue
  eq(w[:2],[i+1,2],'Completed ordered slot');need(w[2] in (0,1) and w[3] in (1,2),'Actual tier/debt')
  for at in (4,6,8,10,12,16):need(pair(w,at)>0,'Native identity')
  need(pair(w,16)%4==0,'Aligned debt');eq(w[14:16],[1,0],'Valid eligible original descriptor');eq(w[18],4,'Exactly four native transitions');zero([w[19],w[28],w[31]]+w[544:])
  eq(w[20],w[21],'No unpaid old debt');eq(w[24:28],[w[20]+1,w[21]+1,w[22]+int(w[3]==2),0],'Exactly one payment and cleared debt');eq(w[23],1,'Unchanged countdown reached one');eq(w[29],12000,'Original full-cap predicate');need(w[30]<=12000,'Bounded post-sleep charge')
  before=w[32:160];after=w[160:288];eq(after,before,'Native raw state preserved across actual sleep')
  for state in (before,after):zero(state[62:64]+state[104:])
  events=[]
  for k in range(4):
   e=w[288+k*64:288+(k+1)*64];eq(e[:4],[k+1,[0,1,0,2][k],[1,0,2,0][k],1],'Real unwind/rewind state transition');eq(pair(e,4),pair(w,4),'Same owning pthread');eq(e[6],0,'Debt already cleared during transition');eq(e[7:10],w[24:27],'One original service payment');need(e[10]<=2,'JS state');eq(e[11:13],[i+1,12000],'Same candidate while original charge retained');zero(e[13:]);events.append(e)
  slots.append(dict(token=i+1,compiled=bool(w[2]),debtBefore=w[3],worker=hex(pair(w,4)),pc=hex(pair(w,6)),code=hex(pair(w,8)),generation=hex(pair(w,10)),owner=hex(pair(w,12)),Bbefore=w[20],Bafter=w[24],paidBefore=w[21],paidAfter=w[25],requestedBefore=w[22],requestedAfter=w[26],poolBefore=w[29],poolAfter=w[30],stateBefore=before,stateAfter=after,events=events,raw=w))
 return dict(count=n,completed=raw[9],events=raw[10],overflow=raw[8],slots=slots)
