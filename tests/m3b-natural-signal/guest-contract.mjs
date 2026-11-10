// Exact integer model of actual Linux signal contexts; no native mutation API.
export const protocol='defuss-m3b-natural-signal';
export const settings=Object.freeze({guestRamMiB:512,tbMiB:128,hotLimit:1500,flags:2,instanceLimit:12000,timeoutMs:1800000,cases:8,gates:10,timerUsec:10000});
export const codeAdd='89f931c083f900740701f083e901ebf4c3';
const U32=0xffffffffn,U64=(1n<<64n)-1n;
const need=(x,s)=>{if(!x)throw Error(s);};
const exact=(x,keys)=>{need(x&&typeof x==='object'&&!Array.isArray(x),'Object');need(JSON.stringify(Object.keys(x).sort())===JSON.stringify([...keys].sort()),'Exact fields');};
const eq=(a,b,s)=>need(JSON.stringify(a)===JSON.stringify(b),s);
export function address(s){need(typeof s==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(s),'Canonical uint64');const n=BigInt(s);need(n<=U64,'uint64');return n;}
const hex=n=>'0x'+n.toString(16);
export function flags(a,b,subtract){a&=U32;b&=U32;const z=(subtract?a-b:a+b)&U32;let parity=1n;for(let i=0n;i<8n;i++)parity^=(z>>i)&1n;return 0x202n|BigInt(subtract?a<b:a+b>U32)|(parity<<2n)|((a^b^z)&16n)|(z===0n?64n:0n)|((z>>24n)&128n)|((((subtract?a^b:~(a^b))&(a^z))>>20n)&2048n);}
export function initial(index,sp){
 need(Number.isInteger(index)&&index>=-1&&index<8,'Case');const n=index<0?100000:1000000+1009*index,step=Number(0x9e3779b9n^(BigInt(index+1)*0x10203041n&U32));
 const gpr=Array.from({length:16},(_,i)=>(0x1122334455667788n^(BigInt(i+1)*0x0102030405060708n)^(BigInt(index+2)*0x0102030405060708n))&U64);gpr[0]=0n;gpr[2]=BigInt(n);gpr[4]=BigInt(step);gpr[5]=BigInt(n);gpr[7]=sp;
 return {iterations:n,step,state:{gpr:gpr.map(hex),rflags:'0x202'}};
}
function state(s){exact(s,['gpr','rflags']);need(Array.isArray(s.gpr)&&s.gpr.length===16,'Sixteen GPRs');return {gpr:s.gpr.map(address),rflags:address(s.rflags)};}
export function validateLayout(p){
 exact(p,['schema','rx','a','b','back','side','end','physicalFrame','timer','timerUsec','cases','codeHex']);
 for(const [k,v]of Object.entries({schema:1,rx:'0x20000000',a:'0x20000004',b:'0x20000009',back:'0x2000000e',side:'0x20000010',end:'0x20000011',timer:'ITIMER_VIRTUAL',timerUsec:10000,cases:8,codeHex:codeAdd}))need(p[k]===v,'Layout '+k);
 const f=address(p.physicalFrame);need(f>0n&&f*4096n<512n*1048576n,'Actual code PFN');return p;
}
export function validateGate(g,p){
 exact(g,['seq','stage','case','iterations','step','deliveries','initial','observed','sample']);need(Number.isInteger(g.seq)&&g.seq>=0&&g.seq<10,'Gate seq');need(g.case===g.seq-2,'Case order');need(g.stage===(g.seq===0?'layout':g.seq===1?'warm':'signal'),'Stage');
 const before=state(g.initial),after=state(g.observed);
 if(g.seq===0){eq(g.initial,{gpr:Array(16).fill('0x0'),rflags:'0x0'},'Initial zeros');eq(g.observed,g.initial,'Observed zeros');eq([g.iterations,g.step,g.deliveries,g.sample],[0,0,0,null],'Layout no work');return g;}
 const sp=before.gpr[7];need(sp>0n&&sp<(1n<<47n)&&sp%16n===0n,'Aligned user stack');const model=initial(g.case,sp);eq([g.iterations,g.step,g.initial],[model.iterations,model.step,model.state],'Exact seeds/work');const n=BigInt(g.iterations),step=BigInt(g.step),result=[...before.gpr];result[0]=(n*step)&U32;result[2]=0n;eq(g.observed,{gpr:result.map(hex),rflags:'0x246'},'Complete final state after resume');
 if(g.seq===1){eq([g.deliveries,g.sample],[0,null],'No warm timer');return g;}
 need(g.deliveries===1,'Exactly one actual timer delivery');const s=g.sample;exact(s,['signo','code','error','pc','gpr','rflags']);eq([s.signo,s.code,s.error],[26,128,0],'Natural kernel virtual timer');const pc=address(s.pc),off=Number(pc-address(p.rx));need([4,7,9,11,14,16].includes(off),'Exact instruction boundary');const actual=state({gpr:s.gpr,rflags:s.rflags}),left=actual.gpr[2];need(left<=n,'Bounded remaining iterations');if([9,11].includes(off))need(left>0n,'Positive B count');if(off===16)need(left===0n,'Side exit');
 let acc=((n-left)*step)&U32,ef;
 if(off===11){ef=flags(acc,step,false);acc=(acc+step)&U32;}
 else if(off===4)ef=left===n?0x246n:flags(left+1n,1n,true);
 else if(off===14)ef=flags(left+1n,1n,true);
 else ef=flags(left,0n,true);
 const want=[...before.gpr];want[0]=acc;want[2]=left;want[7]-=8n;eq(s.gpr,want.map(hex),'Exact interrupted GPR relation');need(actual.rflags===ef,'Exact interrupted flags');return g;
}
export function validatePass(p){exact(p,['calls','signals','contexts']);eq(p,{calls:9,signals:8,contexts:8},'Fixed natural signal work');return p;}
