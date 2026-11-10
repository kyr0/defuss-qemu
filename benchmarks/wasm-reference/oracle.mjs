// Deliberately uses arbitrary-precision BigInt arithmetic and a rotating vector,
// unlike the C kernel's native-width scalar state. Validation only, never timed.
const MASK=0xffffffffn;
const INITIAL=[0x6a09e667n,0xbb67ae85n,0x3c6ef372n,0xa54ff53an,0x510e527fn,0x9b05688cn,0x1f83d9abn,0x5be0cd19n];
const K=[
0x428a2f98n,0x71374491n,0xb5c0fbcfn,0xe9b5dba5n,0x3956c25bn,0x59f111f1n,0x923f82a4n,0xab1c5ed5n,
0xd807aa98n,0x12835b01n,0x243185ben,0x550c7dc3n,0x72be5d74n,0x80deb1fen,0x9bdc06a7n,0xc19bf174n,
0xe49b69c1n,0xefbe4786n,0x0fc19dc6n,0x240ca1ccn,0x2de92c6fn,0x4a7484aan,0x5cb0a9dcn,0x76f988dan,
0x983e5152n,0xa831c66dn,0xb00327c8n,0xbf597fc7n,0xc6e00bf3n,0xd5a79147n,0x06ca6351n,0x14292967n,
0x27b70a85n,0x2e1b2138n,0x4d2c6dfcn,0x53380d13n,0x650a7354n,0x766a0abbn,0x81c2c92en,0x92722c85n,
0xa2bfe8a1n,0xa81a664bn,0xc24b8b70n,0xc76c51a3n,0xd192e819n,0xd6990624n,0xf40e3585n,0x106aa070n,
0x19a4c116n,0x1e376c08n,0x2748774cn,0x34b0bcb5n,0x391c0cb3n,0x4ed8aa4an,0x5b9cca4fn,0x682e6ff3n,
0x748f82een,0x78a5636fn,0x84c87814n,0x8cc70208n,0x90befffan,0xa4506cebn,0xbef9a3f7n,0xc67178f2n];
const rotr=(x,n)=>((x>>BigInt(n))|(x<<BigInt(32-n)))&MASK;
const sum=(...values)=>values.reduce((a,b)=>a+b,0n)&MASK;
export function compressionOracle(initial,input){
  if(initial.length!==8||input.length%64)throw Error('Invalid oracle input');
  let state=Array.from(initial,BigInt);
  for(let block=0;block<input.length;block+=64){
    const schedule=[];
    for(let j=0;j<16;j++){
      let word=0n;for(let b=0;b<4;b++)word=word*256n+BigInt(input[block+j*4+b]);schedule.push(word);
    }
    for(let j=16;j<64;j++){
      const a=schedule[j-15],b=schedule[j-2];
      schedule.push(sum(schedule[j-16],rotr(a,7)^rotr(a,18)^(a>>3n),schedule[j-7],rotr(b,17)^rotr(b,19)^(b>>10n)));
    }
    let v=state.slice();
    for(let j=0;j<64;j++){
      const t=sum(v[7],rotr(v[4],6)^rotr(v[4],11)^rotr(v[4],25),
        (v[4]&v[5])^((MASK^v[4])&v[6]),K[j],schedule[j]);
      const next=sum(t,rotr(v[0],2)^rotr(v[0],13)^rotr(v[0],22),(v[0]&v[1])^(v[1]&v[2])^(v[0]&v[2]));
      v=[next,v[0],v[1],v[2],sum(v[3],t),v[4],v[5],v[6]];
    }
    state=state.map((x,i)=>sum(x,v[i]));
  }
  return Uint32Array.from(state,Number);
}
export function digestOracle(input){
  const blocks=Math.ceil((input.length+9)/64),padded=new Uint8Array(blocks*64);padded.set(input);padded[input.length]=0x80;
  let bits=BigInt(input.length)*8n;
  for(let i=0;i<8;i++){padded[padded.length-1-i]=Number(bits&255n);bits>>=8n;}
  const state=compressionOracle(INITIAL,padded),digest=new Uint8Array(32),view=new DataView(digest.buffer);
  state.forEach((word,i)=>view.setUint32(i*4,word,false));return digest;
}
export function integerOracle(seed,iterations,multiplier,increment){
  let value=BigInt(seed),m=BigInt(multiplier),a=BigInt(increment);
  for(let i=0;i<iterations;i++)value=((value^BigInt(i))*m+a)&MASK;
  return Number(value);
}
