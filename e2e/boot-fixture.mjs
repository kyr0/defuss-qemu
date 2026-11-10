export function bootDisk() {
  const code=[], labels={}, fixups=[];
  const emit=(...bytes)=>code.push(...bytes), label=n=>{labels[n]=code.length;};
  const jump=(op,to)=>{emit(op,0);fixups.push({at:code.length-1,to});};
  emit(0xfa,0x31,0xc0,0x8e,0xd8,0x8e,0xc0,0x8e,0xd0,0xbc,0x00,0x7c,0xfb);
  // Hide the BIOS text cursor so captures do not include its blinking overlay.
  emit(0xb4,0x01,0xb9,0x07,0x26,0xcd,0x10);
  emit(0xbe,0,0);const si=code.length-2;
  label('print');emit(0xac,0x84,0xc0);jump(0x74,'keys');
  emit(0xb4,0x0e,0xbb,0x07,0,0xcd,0x10);jump(0xeb,'print');
  label('keys');emit(0xbd,7,0);
  label('keyboard');emit(0x55,0x31,0xc0,0xcd,0x16,0xb4,0x0e,0xbb,0x07,0,0xcd,0x10,0x5d,0x4d);jump(0x75,'keyboard');
  emit(0xfa);label('halt');emit(0xf4);jump(0xeb,'halt');
  const message=0x7c00+code.length;code[si]=message&255;code[si+1]=message>>8;
  emit(...Buffer.from('DEFUSS_E2E_VIDEO_OK\r\n'),0);
  for(const f of fixups)code[f.at]=(labels[f.to]-f.at-1)&255;
  const disk=Buffer.alloc(1440*1024);disk.set(code);disk[510]=0x55;disk[511]=0xaa;return disk;
}
