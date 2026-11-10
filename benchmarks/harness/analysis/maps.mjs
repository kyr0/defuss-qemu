// Address attribution only. A mapping is not a JIT tier, symbol, or code identity.
export function parseMaps(raw) {
  if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>2097152)throw Error('Invalid bounded maps text');
  const mappings=[];
  for(const line of raw.split('\n')) {
    if(!line)continue;
    const m=line.match(/^([0-9a-f]+)-([0-9a-f]+)\s+([r-][w-][x-][ps])\s+([0-9a-f]+)\s+([0-9a-f]+:[0-9a-f]+)\s+(\d+)\s*(.*)$/i);
    if(!m)throw Error('Malformed maps line: '+line);
    const start=BigInt('0x'+m[1]),end=BigInt('0x'+m[2]);
    if(start>=end || (mappings.length && start<mappings.at(-1).end))throw Error('Unordered/overlapping maps ranges');
    mappings.push({start,end,permissions:m[3],offset:BigInt('0x'+m[4]),device:m[5],inode:m[6],path:m[7]||null,raw:line});
  }
  if(!mappings.length)throw Error('Empty maps');
  return mappings;
}
export function classifyAddress(address,mappings,privilege='unknown') {
  const pc=typeof address==='bigint'?address:BigInt(address);
  if(pc<0n||pc>0xffffffffffffffffn)throw Error('Address outside uint64');
  const value='0x'+pc.toString(16);
  if(privilege!=='user')return {address:value,category:privilege==='kernel'?'kernel-unresolved':'context-unresolved',privilege};
  const mapping=mappings.find(m=>m.start<=pc&&pc<m.end);
  if(!mapping)return {address:value,category:'user-unmapped-at-map-capture',privilege};
  const path=mapping.path,executable=mapping.permissions.includes('x');
  const category=!executable?'user-nonexecutable-at-map-capture':
    !path?'anonymous-executable-jit-unknown':path.startsWith('[')?'special-executable': 'file-executable';
  return {address:value,category,privilege,path,permissions:mapping.permissions,
    mappingStart:'0x'+mapping.start.toString(16),mappingEnd:'0x'+mapping.end.toString(16),
    mappedFileOffset:'0x'+(mapping.offset+pc-mapping.start).toString(16),
    identityLimit:'Captured map only; later remapping/code modification and CR3/process identity are not established by this address match'};
}
export function syscallNames(table) {
  const names=new Map();
  for(const line of table.split('\n')) {
    const m=line.match(/^(\d+)\s+(common|64)\s+(\w+)\s/);
    if(m)names.set(Number(m[1]),m[3]);
  }
  if(names.get(0)!=='read'||names.get(1)!=='write')throw Error('Wrong x86-64 syscall table');
  return names;
}
