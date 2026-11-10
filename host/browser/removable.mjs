// 512-byte sector counts recognized by this QEMU build's fd_formats table.
const floppySectors = new Set([320,360,640,720,820,840,1440,1600,1640,1660,1760,
  2080,2240,2400,2880,2952,2988,3200,3360,3444,3486,3520,3680,3840,5760,6240,6400,7040,7680]);
const sector = 2048, maxFile = 1024 ** 3;
const floppyBytes = [0, 1200*1024, 1440*1024, 2880*1024];
const ascii = (data, start, count) => String.fromCharCode(...data.subarray(start,start+count));
const u16 = (b,i) => b[i] | b[i+1]<<8;
const u32 = (b,i) => u16(b,i) + u16(b,i+2)*65536;
async function slice(file,start,end){return new Uint8Array(await file.slice(start,end).arrayBuffer());}

function extractEntry(cat,i,platform){
  const type=cat[i+1]&15;
  if(platform!==0 || cat[i]!==0x88 || type<1 || type>3)return null;
  return {start:u32(cat,i+8)*sector,length:floppyBytes[type]};
}
function floppyEntry(cat){
  if(cat.length<64 || cat[0]!==1 || cat[30]!==0x55 || cat[31]!==0xaa)
    throw Error('Invalid El Torito validation entry');
  let sum=0;for(let i=0;i<32;i+=2)sum+=u16(cat,i);
  if(sum&65535)throw Error('Invalid El Torito catalog checksum');
  const first=extractEntry(cat,32,cat[1]);
  if(first)return first;
  for(let i=64;i+32<=cat.length;){
    const header=cat[i];
    if(header!==0x90 && header!==0x91)break;
    const platform=cat[i+1],count=u16(cat,i+2);
    i+=32;
    if(!count || i+count*32>cat.length)throw Error('Invalid El Torito section length');
    for(let n=0;n<count;n++,i+=32){
      const match=extractEntry(cat,i,platform);
      if(match)return match;
    }
    if(header===0x91)break;
  }
  return null;
}

// Inspect only the descriptors, catalog and embedded disk when A: gets an ISO.
// Boot catalog sector-count is the initial BIOS load length, not the disk size.
export async function readMedium(drive,file){
  if(!file)return null;
  if(drive!=='floppy' && drive!=='cdrom')throw Error('Unknown removable drive');
  if(!file.size || file.size>maxFile)throw Error('Select a nonempty image up to 1 GiB');
  const descriptors=await slice(file,16*sector,80*sector);
  let optical=false,catalog=0;
  for(let i=0;i+sector<=descriptors.length;i+=sector){
    const id=ascii(descriptors,i+1,5);
    if(['BEA01','NSR02','NSR03'].includes(id)){optical=true;break;}
    if(id!=='CD001' || descriptors[i+6]!==1)break;
    optical=true;
    if(descriptors[i]===0 && ascii(descriptors,i+7,32).replace(/[\x00 ]+$/,'')==='EL TORITO SPECIFICATION'){
      catalog=u32(descriptors,i+71);break;
    }
    if(descriptors[i]===255)break;
  }
  if(drive==='cdrom'){
    if(!optical || file.size%sector)throw Error('CD-ROM expects a 2048-byte-sector ISO/UDF image (.iso or .img). Use A: for a raw floppy.');
    return {bytes:await slice(file,0,file.size),label:file.name};
  }
  if(optical){
    const hint='Use the CD-ROM drive for this ISO. A: requires a raw floppy or an x86 El Torito floppy-emulation image.';
    if(!catalog)throw Error(hint);
    const start=catalog*sector;
    const cat=await slice(file,start,start+128*1024);
    const entry=floppyEntry(cat);
    if(!entry)throw Error(hint);
    if(!entry.start || entry.start+entry.length>file.size)throw Error('Truncated embedded floppy in ISO');
    return {bytes:await slice(file,entry.start,entry.start+entry.length),label:file.name+' (embedded floppy)'};
  }
  if(!floppySectors.has(file.size/512))throw Error('Unrecognized raw floppy size. Use a sector-for-sector floppy .img, or select a boot CD with floppy emulation.');
  const bytes=await slice(file,0,file.size);
  if(ascii(bytes,0,4)==='QFI\xfb' || ascii(bytes,0,4)==='IMD ' || ascii(bytes,0,2)==='PK' && u16(bytes,2)===0x0403)
    throw Error('Use an uncompressed raw floppy .img');
  return {bytes,label:file.name};
}
