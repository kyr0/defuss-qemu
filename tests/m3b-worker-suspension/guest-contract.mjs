// Browser-safe guest work/layout oracle only. Native lifetime acceptance is separate.
export const protocol='defuss-m3b-worker-suspension-v1';
export const pressureSettings=Object.freeze({tbMiB:256,guestRamMiB:512,hotLimit:1500,flags:3,instanceLimit:12000,
 prefillInstalls:7000,maxNodes:12000,batch:64,iterations:100000,retries:16,sleepNs:1000000000,timeoutMs:1800000});
export const sentinelCodeHex='83f900740701f083e901ebf4';
const require=(value,message)=>{if(!value)throw Error(message);};
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const exact=(value,keys)=>{require(value&&typeof value==='object'&&!Array.isArray(value),'Exact object required');require(JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort()),'Exact object fields required');};
const address=(value,low,high)=>{require(typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value),'Canonical hexadecimal address');const n=BigInt(value);require(n>=low&&n<high,'Guest address outside declared range');return n;};
const batchNodes=n=>integer(n)&&n>0&&n<=pressureSettings.maxNodes&&(n%pressureSettings.batch===0||n===pressureSettings.maxNodes);
export function validatePressureLayout(layout){
 exact(layout,['schema','sentinel','generated','maxNodes','batch','iterations','retries','sleepNs']);require(layout.schema===1,'Layout schema1');
 for(const key of ['maxNodes','batch','iterations','retries','sleepNs'])require(layout[key]===pressureSettings[key],'Fixed guest bound '+key);
 const s=layout.sentinel;exact(s,['a','b','back','side','end','ownerBytes','codeHex']);
 const [a,b,back,side,end]=['a','b','back','side','end'].map(k=>address(s[k],0x100000n,0x100000000n));
 require(b===a+5n&&back===a+10n&&side===a+12n&&end===a+13n,'Exact ELF sentinel offsets');
 require((a&4095n)===4n&&(a>>12n)===((end-1n)>>12n),'Aligned function plus four-byte prelude and one-page owner');
 require(s.ownerBytes===12&&s.codeHex===sentinelCodeHex,'Exact five-instruction12-byte sentinel owner');
 require(Array.isArray(layout.generated)&&layout.generated.length===2,'Two generated mapping endpoints');
 const g0=address(layout.generated[0],0x100000n,1n<<47n),g1=address(layout.generated[1],0x100000n,1n<<47n);
 require((g0&4095n)===0n&&g1-g0===768000n,'Fixed12000x64-byte generated mapping');require(g1<=a||g0>=end,'Distinct static sentinel and generated mapping');
 return layout;
}
export function expectedPressureGate(input){
 exact(input,['stage','nodes','attempt']);const {stage,nodes,attempt}=input;require(integer(nodes)&&integer(attempt),'Exact numeric gate fields');let checks;
 if(stage==='layout'){require(nodes===0&&attempt===0,'Initial gate fields');checks=2;}
 else if(stage==='prefill'){require(batchNodes(nodes)&&attempt===0,'Bounded prefill');checks=2+nodes;}
 else if(stage==='warm'){require(batchNodes(nodes)&&attempt===0,'Warm after prefill');checks=10+nodes;}
 else if(stage==='churn'){require(batchNodes(nodes)&&attempt===0,'Bounded churn gate');checks=10+nodes;}
 else if(stage==='revisit'){require(batchNodes(nodes)&&attempt<pressureSettings.retries,'Bounded revisit gate');checks=11+nodes+attempt;}
 else throw Error('Unknown pressure stage');
 return {stage,nodes,attempt,checks};
}
export function expectedPressurePass(input){
 exact(input,['nodes','attempts']);const {nodes,attempts}=input;require(batchNodes(nodes)&&integer(attempts)&&attempts===pressureSettings.retries,'Bounded pressure completion');
 return {checks:10+nodes+attempts,nodes,attempts};
}
