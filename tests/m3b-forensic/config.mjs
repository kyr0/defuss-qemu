import {args as baselineArgs} from '../m3b-fallthrough/guest.mjs';
export const protocol='defuss-m3b-forensic-v1';
export const limits=Object.freeze({chunk:65536,pending:2*1024*1024,trace:256*1024*1024,serial:4*1024*1024,stderr:1024*1024,records:200});
export function traceSpec(layout){
 if(!Array.isArray(layout)||layout.length!==11)throw Error('Exact eleven-program ELF layout required');
 const ranges=layout.map(p=>{
  if(!/^0x[0-9a-f]+$/.test(p.a)||!/^0x[0-9a-f]+$/.test(p.end))throw Error('Canonical trace addresses');
  const begin=BigInt(p.a),end=BigInt(p.end);if(begin<0x100000n||end<=begin||end-begin>4096n||end>0x100000000n)throw Error('Bounded static user trace range');
  return {name:p.name,begin:p.a,endExclusive:p.end,last:'0x'+(end-1n).toString(16)};
 });
 for(let i=0;i<ranges.length;i++)for(let j=0;j<i;j++)if(BigInt(ranges[i].begin)<BigInt(ranges[j].endExclusive)&&BigInt(ranges[j].begin)<BigInt(ranges[i].endExclusive))throw Error('Overlapping trace ranges');
 return {ranges,filter:ranges.map(r=>r.begin+'..'+r.last).join(','),flags:'exec,in_asm,cpu',file:'/guest/m3b-tb.log',nochain:false};
}
export function argumentsFor(spec){
 const expected=spec.ranges.map(r=>r.begin+'..'+r.last).join(',');
 if(spec.filter!==expected||spec.ranges.length!==11||spec.flags!=='exec,in_asm,cpu'||spec.file!=='/guest/m3b-tb.log'||spec.nochain!==false)throw Error('Trace specification changed');
 return [...baselineArgs,'-d',spec.flags,'-dfilter',spec.filter,'-D',spec.file];
}
