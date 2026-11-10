// Synthetic, non-evidence native bank/layout constructors.
export const layout={schema:1,stackPointer:'0x900000',programs:[
 {name:'mbnd_add32',width:32,a:'0x401000',b:'0x401005',back:'0x40100d',side:'0x40100f',end:'0x401014',ownerBytes:15,codeHex:'83f900740a83c03531d083e901ebf1'},
 {name:'mbnd_add64',width:64,a:'0x402000',b:'0x402006',back:'0x402011',side:'0x402013',end:'0x402018',ownerBytes:19,codeHex:'4983f900740d4d31ea4983c2114983e901ebed'}]};
const U64=(1n<<64n)-1n,number=s=>BigInt('0x'+s);
export function put(w,at,n){n=BigInt(n);w[at]=Number(n&0xffffffffn);w[at+1]=Number((n>>32n)&0xffffffffn);}
export function idle(){const w=Array(256).fill(0);Object.assign(w,{0:0x4d334253,1:1,6:256,7:64});return w;}
export function fixture(input){
 const w=idle(),p=layout.programs[input.program];Object.assign(w,{2:3,3:input.request,4:input.mode,12:Number(BigInt(p.b)-BigInt(p.a)),13:p.ownerBytes,14:input.mode===1?1:3,15:input.mode,16:input.mode===1?0:2,17:1,18:3,19:1,20:1,21:1,22:41,23:42,24:71,25:72,26:3,27:input.mode===1?3:4,29:1,30:6});put(w,8,BigInt(p.a));put(w,10,17n);
 const before=input.initial.gpr.map(number),after=[...before];
 if(input.mode===1){if(p.width===32){after[0]=(((after[0]&0xffffffffn)+53n)^(after[3]&0xffffffffn))&0xffffffffn;after[2]=BigInt(input.count-1);}else{after[10]=((after[10]^after[13])+17n)&U64;after[9]=BigInt(input.count-1);}}
 for(const [at,r]of [[32,before],[96,after]]){
  for(let i=0;i<16;i++)put(w,at+i*2,r[i]);put(w,at+32,BigInt(at===32?p.a:input.mode===1?p.a:p.b));w[at+34]=at===32?Number(number(input.initial.rflags)):input.mode===1?0x202:0x206;
  put(w,at+36,0x202n);put(w,at+38,at===32?0x123n:(before[p.width===32?2:9]-(input.mode===1?1n:0n))&U64);put(w,at+40,at===32?number(input.initial.rflags)&0x8d5n:input.mode===1?1n:0n);put(w,at+42,0x456n);
  w[at+44]=at===32?0:p.width===32?18:19;w[at+45]=1;w[at+46]=0x1b3;w[at+47]=0x10;put(w,at+50,0x720000n);put(w,at+54,0x80010033n);put(w,at+56,0x6f0n);put(w,at+58,0xd01n);
 }
 for(let i=0;i<64;i++)w[160+i]=w[96+i];return w;
}
