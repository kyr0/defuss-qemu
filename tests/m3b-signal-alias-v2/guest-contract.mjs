// Exact interrupted-call model; all code writes originate in the guest handler.
import {initial,flags,address,codeAdd} from '../m3b-natural-signal-v2/guest-contract.mjs';
export {initial,flags,address,codeAdd};
export const protocol='defuss-m3b-signal-alias-v2';
export const settings=Object.freeze({guestRamMiB:512,tbMiB:128,hotLimit:1500,flags:2,instanceLimit:12000,timeoutMs:1800000,cases:8,gates:10,timerUsec:10000});
export const codeSub='89f931c083f900740729f083e901ebf4c3';
const U32=0xffffffffn,hex=n=>'0x'+n.toString(16),need=(x,s)=>{if(!x)throw Error(s);};
const eq=(a,b,s)=>need(JSON.stringify(a)===JSON.stringify(b),s);
const exact=(x,keys)=>{need(x&&typeof x==='object'&&!Array.isArray(x),'Object');eq(Object.keys(x).sort(),[...keys].sort(),'Exact fields');};
function state(s){exact(s,['gpr','rflags']);need(Array.isArray(s.gpr)&&s.gpr.length===16,'Sixteen GPRs');return {gpr:s.gpr.map(address),rflags:address(s.rflags)};}
export function validateLayout(p){
 exact(p,['schema','rx','rw','a','b','back','side','end','physicalFrame','timer','timerUsec','cases','codeHex']);
 for(const [k,v] of Object.entries({schema:1,rx:'0x20000000',rw:'0x21000000',a:'0x20000004',b:'0x20000009',back:'0x2000000e',side:'0x20000010',end:'0x20000011',timer:'ITIMER_VIRTUAL',timerUsec:10000,cases:8,codeHex:codeAdd}))need(p[k]===v,'Layout '+k);
 const f=address(p.physicalFrame);need(f>0n&&f*4096n<512n*1048576n,'Actual code PFN');return p;
}
export function validateGate(g,p){
 exact(g,['seq','stage','case','iterations','step','deliveries','initial','observed','sample','patches','rxPagemap','rwPagemap','rxHex','rwHex']);
 need(Number.isInteger(g.seq)&&g.seq>=0&&g.seq<10&&g.case===g.seq-2,'Exact gate/case');need(g.stage===(g.seq===0?'layout':g.seq===1?'warm':'signal'),'Stage');
 const patches=Math.max(0,g.seq-1),current=patches%2?codeSub:codeAdd;need(g.patches===patches,'One patch per signal');eq([g.rxHex,g.rwHex],[current,current],'Current coherent aliases');
 for(const k of ['rxPagemap','rwPagemap']){const x=address(g[k]);need(x>>63n===1n&&(x&(1n<<62n))===0n&&(x&((1n<<55n)-1n))===address(p.physicalFrame),'Actual same persistent alias frame');}
 const before=state(g.initial),after=state(g.observed);
 if(!g.seq){eq(g.initial,{gpr:Array(16).fill('0x0'),rflags:'0x0'},'Initial zeros');eq(g.observed,g.initial,'Observed zeros');eq([g.iterations,g.step,g.deliveries,g.sample],[0,0,0,null],'No layout work');return g;}
 const sp=before.gpr[7];need(sp>0n&&sp<(1n<<47n)&&sp%16n===0n,'Aligned user stack');const model=initial(g.case,sp);eq([g.iterations,g.step,g.initial],[model.iterations,model.step,model.state],'Fixed seeds/work');
 const n=BigInt(g.iterations),step=BigInt(g.step),result=[...before.gpr];result[2]=0n;
 if(g.seq===1){eq([g.deliveries,g.sample],[0,null],'No warm timer');result[0]=n*step&U32;}
 else{
  need(g.deliveries===1,'Exactly one actual timer');const s=g.sample;exact(s,['signo','code','error','pc','gpr','rflags','beforeRxHex','beforeRwHex','afterRxHex','afterRwHex']);eq([s.signo,s.code,s.error],[26,128,0],'Natural kernel virtual timer');
  const oldSub=Boolean(g.case%2),prior=oldSub?codeSub:codeAdd;eq([s.beforeRxHex,s.beforeRwHex,s.afterRxHex,s.afterRwHex],[prior,prior,current,current],'Exact single opcode alias patch');
  const off=Number(address(s.pc)-address(p.rx));need([4,7,9,11,14].includes(off),'Active loop instruction boundary');const saved=state({gpr:s.gpr,rflags:s.rflags}),left=saved.gpr[2];need(left>=4096n&&left<n,'Strict interrupted work window');
  let acc=((oldSub?-1n:1n)*(n-left)*step)&U32,ef;
  if(off===11){ef=flags(acc,step,oldSub);acc=(acc+(oldSub?-step:step))&U32;}
  else if(off===4||off===14)ef=flags(left+1n,1n,true);else ef=flags(left,0n,true);
  const want=[...before.gpr];want[0]=acc;want[2]=left;want[7]-=8n;eq(s.gpr,want.map(hex),'Exact interrupted integer relation');need(saved.rflags===(ef|0x10000n),'Exact RF-inclusive signal flags');
  const remaining=left-(off===11?1n:0n);result[0]=(acc+(oldSub?1n:-1n)*remaining*step)&U32;
 }
 eq(g.observed,{gpr:result.map(hex),rflags:'0x246'},'Full mixed-operation return state');return g;
}
export function validatePass(p){exact(p,['calls','signals','contexts','patches']);eq(p,{calls:9,signals:8,contexts:8,patches:8},'Fixed interrupted-call work');return p;}
