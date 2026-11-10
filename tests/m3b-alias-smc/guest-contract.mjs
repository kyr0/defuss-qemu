// Fixed guest arithmetic and byte/physical-alias contract, no native API.
export const protocol='defuss-m3b-alias-smc-v1';
export const settings=Object.freeze({guestRamMiB:512,tbMiB:128,hotLimit:1500,flags:2,instanceLimit:12000,timeoutMs:1800000,cases:8,epochs:3,gates:6});
export const stages=Object.freeze(['layout','add-complete','sub-patched','sub-complete','add-patched','add-restored-complete']);
export const iterations=Object.freeze([0,1,17,4096,100000,100003,100019,131071]);
export const codeAdd='89f931c083f900740701f083e901ebf4c3',codeSub='89f931c083f900740729f083e901ebf4c3';
const need=(x,why)=>{if(!x)throw Error(why);};
const exact=(x,keys)=>{need(x&&typeof x==='object'&&!Array.isArray(x),'Exact object');need(JSON.stringify(Object.keys(x).sort())===JSON.stringify([...keys].sort()),'Exact fields');};
const address=x=>{need(typeof x==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(x),'Canonical uint64');const n=BigInt(x);need(n<(1n<<64n),'uint64');return n;};
export function validateLayout(p){
 exact(p,['schema','rx','rw','a','b','back','side','end','pageBytes','codeBytes','physicalFrame']);
 for(const [k,v]of Object.entries({schema:1,rx:'0x20000000',rw:'0x21000000',a:'0x20000004',b:'0x20000009',back:'0x2000000e',side:'0x20000010',end:'0x20000011',pageBytes:4096,codeBytes:17}))need(p[k]===v,'Fixed layout '+k);
 const frame=address(p.physicalFrame);need(frame>0n&&frame*4096n<512n*1024n*1024n,'Actual nonzero guest RAM PFN');return p;
}
export function expectedValues(subtract){
 return iterations.map((n,i)=>{const step=0x9e3779b9n^(BigInt(i)*0x10203041n&0xffffffffn),v=BigInt(n)*step;return Number((subtract?-v:v)&0xffffffffn);});
}
export function validateGate(g,layout){
 exact(g,['seq','stage','checks','patches','rxPagemap','rwPagemap','rxHex','rwHex','values']);need(Number.isInteger(g.seq)&&g.seq>=0&&g.seq<6,'Gate seq');need(g.stage===stages[g.seq],'Exact stage');
 need(g.checks===[0,8,8,16,16,24][g.seq]&&g.patches===[0,0,1,1,2,2][g.seq],'Exact completed work');
 for(const k of ['rxPagemap','rwPagemap']){const v=address(g[k]);need((v>>63n)===1n&&(v&(1n<<62n))===0n,'Present unswapped mapping');need((v&((1n<<55n)-1n))===BigInt(layout.physicalFrame),'Shared persistent physical frame');}
 const subtract=g.seq===2||g.seq===3,bytes=subtract?codeSub:codeAdd;need(g.rxHex===bytes&&g.rwHex===bytes,'Exact opcode and unchanged remaining bytes');
 const values=g.seq%2===1?expectedValues(subtract):[];need(Array.isArray(g.values)&&JSON.stringify(g.values)===JSON.stringify(values),'Independent modulo32 arithmetic');return g;
}
export function validatePass(p){exact(p,['checks','calls','patches']);need(p.checks===24&&p.calls===24&&p.patches===2,'Fixed completed alias test');return p;}
