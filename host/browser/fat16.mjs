// Create one active DOS FAT16 volume with BPB and MBR geometry in agreement.
// Round the partition end down to a full BIOS cylinder for DOS CHS readers.
export const maxDiskMiB=2047; // Keep byte offsets below signed 32-bit MEMFS limits.
const bootstrap=Uint8Array.from([250, 49, 192, 142, 208, 188, 0, 124, 142, 192, 142, 216, 252, 190, 0, 124, 191, 0, 6, 185, 0, 1, 243, 165, 234, 29, 6, 0, 0, 251, 190, 190, 7, 185, 4, 0, 128, 60, 128, 116, 10, 131, 198, 16, 226, 246, 205, 24, 244, 235, 251, 138, 116, 1, 139, 76, 2, 187, 0, 124, 184, 1, 2, 205, 19, 114, 235, 129, 62, 254, 125, 85, 170, 117, 227, 234, 0, 124, 0, 0]);
let zeroChunk;
export function zeroPadding(n){
  if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid zero-filled disk extent');
  zeroChunk??=new Blob([new Uint8Array(1048576)]);
  return new Blob([...Array(Math.floor(n/1048576)).fill(zeroChunk),zeroChunk.slice(0,n%1048576)]);
}
export function blankIDE(mib,rootEntries=512){return makeBlank(mib,rootEntries,false);}
export function blankIDEBlob(mib){return makeBlank(mib,512,true);}
function makeBlank(mib,rootEntries,sparse){
  if(!Number.isInteger(rootEntries)||rootEntries<16||rootEntries>65520||rootEntries%16)throw Error("Invalid FAT16 root directory size");
  if(!Number.isInteger(mib)||mib<8||mib>maxDiskMiB)throw Error('Disk size must be 8–2047 MiB');
  const total=mib*2048,spt=63,start=spt;let heads=16;
  while(Math.floor(total/(spt*heads))>1024)heads*=2;
  const cylinders=Math.floor(total/(spt*heads)),volume=cylinders*heads*spt-start;
  let clusterSize=1;
  while(Math.floor(volume/clusterSize)>65524)clusterSize*=2;
  // 1 reserved sector, 2 FATs, 512 root entries (32 sectors).
  let fatSize=1;
  for(;;){const clusters=Math.floor((volume-1-rootEntries/16-2*fatSize)/clusterSize);
    const needed=Math.ceil((clusters+2)*2/512);if(needed<=fatSize)break;fatSize=needed;}
  const disk=new Uint8Array(sparse?(start+1+fatSize)*512+4:mib*1048576),view=new DataView(disk.buffer);
  const put=(i,s)=>{for(let n=0;n<s.length;n++)disk[i+n]=s.charCodeAt(n);};
  const u16=(i,v)=>view.setUint16(i,v,true),u32=(i,v)=>view.setUint32(i,v,true);
  disk.set(bootstrap);disk[446]=128;disk.set([1,1,0,6],447);
  disk.set([heads-1,spt|(((cylinders-1)>>2)&192),(cylinders-1)&255],451);
  u32(454,start);u32(458,volume);u16(510,0xaa55);
  const base=start*512;disk.set([0xeb,0x3c,0x90],base);put(base+3,'QEMUWASM');
  u16(base+11,512);disk[base+13]=clusterSize;u16(base+14,1);disk[base+16]=2;
  u16(base+17,rootEntries);if(volume<=65535)u16(base+19,volume);else u32(base+32,volume);
  disk[base+21]=0xf8;u16(base+22,fatSize);u16(base+24,spt);u16(base+26,heads);u32(base+28,start);
  disk[base+36]=128;disk[base+38]=0x29;u32(base+39,0x47385357);put(base+43,'NO NAME    ');put(base+54,'FAT16   ');
  disk.set([0xcd,0x18,0xf4,0xeb,0xfd],base+62);u16(base+510,0xaa55);
  for(const n of [0,1]){const i=base+(1+n*fatSize)*512;disk.set([0xf8,0xff,0xff,0xff],i);}
  return sparse?new Blob([disk,zeroPadding(mib*1048576-disk.length)]):disk;
}
