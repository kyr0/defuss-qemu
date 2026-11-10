/* Diagnostic-only glue, installed before wrapping native exports. No yields. */
var pcM3s = null;
function pcM3sInit(raw) {
  if (typeof raw.defuss_m3s_abi !== 'function' || raw.defuss_m3s_abi() !== 1 ||
      typeof raw.defuss_m3s_data !== 'function' || typeof raw.asyncify_get_state !== 'function') {
    throw Error('M3s native observer ABI missing');
  }
  const p = Number(raw.defuss_m3s_data());
  if (!Number.isSafeInteger(p) || p < 0 || p % 4 || p + 2624 * 4 > HEAPU32.byteLength) {
    throw Error('M3s bank address');
  }
  if (HEAPU32[p / 4] !== 0x4d335357 || HEAPU32[p / 4 + 1] !== 1 || HEAPU32[p / 4 + 2] !== 2624 || HEAPU32[p / 4 + 3] !== 4 || HEAPU32[p / 4 + 4] !== 640 || HEAPU32[p / 4 + 14] !== 64) {
    throw Error('M3s bank layout');
  }
  pcM3s = {at:p / 4, state:raw.asyncify_get_state};
  Module.pcM3sABI = {version:1, words:2624, slots:4, stride:640};
}
function pcM3sTransition(kind, original) {
  let ticket = null;
  const fail = (code, slot) => {
    if (!pcM3s) return;
    const a = pcM3s.at;
    if (!Atomics.load(HEAPU32,a+7)) Atomics.store(HEAPU32,a+7,code);
    if (slot !== undefined && !Atomics.load(HEAPU32,slot+28)) Atomics.store(HEAPU32,slot+28,code);
  };
  try {
    if (pcM3s && ENVIRONMENT_IS_PTHREAD && Module.pcM3sWorker !== undefined) {
      const a=pcM3s.at, token=Atomics.load(HEAPU32,a+6);
      if (token) {
        if (token>4) throw Error('M3s active token');
        const slot=a+64+(token-1)*640;
        if(typeof Module.pcM3sWorker==='number'&&!Number.isSafeInteger(Module.pcM3sWorker))throw Error('M3s exact worker pointer');
        const worker=BigInt(Module.pcM3sWorker), low=Number(worker&0xffffffffn), high=Number(worker>>32n);
        if (HEAPU32[slot+4]===low && HEAPU32[slot+5]===high) {
          const count=HEAPU32[slot+18];
          if (count>=4 || kind!==count+1 || HEAPU32[slot]!==token || HEAPU32[slot+1]!==1) {
            fail(10,slot);
          } else ticket={a,slot,token,count,low,high,before:pcM3s.state()};
        }
      }
    }
  } catch (_) { fail(11,ticket?.slot);ticket=null; }
  let value;
  try { value=original(); }
  catch (error) { if(ticket)fail(12,ticket.slot);throw error; }
  if (ticket) try {
    const {a,slot,token,count,low,high,before}=ticket, after=pcM3s.state();
    if (Atomics.load(HEAPU32,a+6)!==token || HEAPU32[slot+18]!==count) throw Error('M3s candidate changed');
    const pointer = at => {
      const p=Number(BigInt(HEAPU32[at])|(BigInt(HEAPU32[at+1])<<32n));
      if(!Number.isSafeInteger(p)||p<0||p%4||p+4>HEAPU32.byteLength)throw Error('M3s scalar pointer');
      return p/4;
    };
    const profile=pointer(a+12),debt=pointer(slot+16),pool=pointer(a+16);
    if(profile+128>HEAPU32.length||HEAPU32[profile]!==0x4d334231||HEAPU32[profile+1]!==1)throw Error('M3s profile extent/ABI');
    const e=slot+288+count*64;
    HEAPU32[e]=kind;HEAPU32[e+1]=before;HEAPU32[e+2]=after;HEAPU32[e+3]=1;
    HEAPU32[e+4]=low;HEAPU32[e+5]=high;HEAPU32[e+6]=Atomics.load(HEAPU32,debt);
    HEAPU32[e+7]=Atomics.load(HEAPU32,profile+22);HEAPU32[e+8]=Atomics.load(HEAPU32,profile+24);HEAPU32[e+9]=Atomics.load(HEAPU32,profile+23);
    HEAPU32[e+10]=Asyncify.state;HEAPU32[e+11]=token;HEAPU32[e+12]=Atomics.load(HEAPU32,pool);
    if(before!==[0,1,0,2][count]||after!==[1,0,2,0][count]||HEAPU32[e+6]!==0)fail(13,slot);
    Atomics.store(HEAPU32,slot+18,count+1);Atomics.add(HEAPU32,a+10,1);
  } catch (_) { fail(14,ticket.slot); }
  return value;
}
