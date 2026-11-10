// A bounded, read-only QOM composition-tree observation. This is not eligibility.
export const limits=Object.freeze({nodes:2048,depth:32,propertiesPerNode:1024,totalProperties:65536,
 commands:16384,responseBytes:1024*1024,transcriptBytes:16*1024*1024,qtreeBytes:1024*1024});
const check=(ok,message)=>{if(!ok)throw Error(message);};
const utf8=new TextEncoder();
const compare=(a,b)=>{const x=utf8.encode(a),y=utf8.encode(b);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
const pathOK=p=>typeof p==='string'&&p.startsWith('/')&&p.length<=4096&&!p.includes('//')&&!p.split('/').some(x=>x==='.'||x==='..');
export function validateCommand(command,args){
 const exact=(keys)=>Object.keys(args??{}).sort().join(',')===[...keys].sort().join(',');
 if(['qmp_capabilities','query-status','query-cpus-fast','query-block'].includes(command)&&exact([]))return;
 if(command==='qom-list'&&exact(['path'])&&pathOK(args.path))return;
 if(command==='qom-list-types'&&exact(['implements','abstract'])&&['device','cpu','memory-backend'].includes(args.implements)&&args.abstract===true)return;
 if(command==='qom-get'&&exact(['path','property'])&&pathOK(args.path)&&
    ['type','realized','parent_bus','hotplugged','acpi','hpet','usb','smp','memory','memory-backend','size','share','vapic'].includes(args.property))return;
 if(command==='human-monitor-command'&&exact(['command-line'])&&args['command-line']==='info qtree')return;
 throw Error('Observer refuses non-allowlisted QMP command: '+command);
}
export function prelaunch(status){check(status?.running===false&&status.status==='prelaunch','Expected -S prelaunch state; observer never continues the VM');}
function typeNames(rows){
 check(Array.isArray(rows)&&rows.length<=8192,'Invalid bounded type catalogue');const result=new Set();
 for(const row of rows){check(row&&typeof row.name==='string'&&row.name.length>0&&row.name.length<=256&&!result.has(row.name),'Invalid/duplicate QOM type');result.add(row.name);}
 return result;
}
function properties(rows){
 check(Array.isArray(rows)&&rows.length<=limits.propertiesPerNode,'QOM property bound');const names=new Set();
 for(const p of rows){check(p&&typeof p.name==='string'&&p.name.length>0&&p.name.length<=256&&!p.name.includes('/')&&
  !['.','..'].includes(p.name)&&typeof p.type==='string'&&p.type.length<=256&&!names.has(p.name),'Invalid/duplicate QOM property');names.add(p.name);}
 return [...rows].sort((a,b)=>compare(a.name,b.name));
}
export async function observeGraph(send){
 const before=await send('query-status');prelaunch(before);
 // Unlike qom-list, this command is not allow-preconfig. Its success also
 // records that the machine reached QEMU's command-availability boundary.
 const cpus=await send('query-cpus-fast');
 check(Array.isArray(cpus)&&cpus.length===1&&cpus[0]['cpu-index']===0&&pathOK(cpus[0]['qom-path']),'Expected exactly one realized CPU');
 const deviceTypes=await send('qom-list-types',{implements:'device',abstract:true}),deviceNames=typeNames(deviceTypes);
 const cpuTypes=await send('qom-list-types',{implements:'cpu',abstract:true}),cpuNames=typeNames(cpuTypes);
 const memoryTypes=await send('qom-list-types',{implements:'memory-backend',abstract:true}),memoryNames=typeNames(memoryTypes);
 const queue=[{path:'/',parent:null,depth:0,declaredType:null}],seen=new Set(),nodes=[];let propertyCount=0;
 while(queue.length){
  const current=queue.shift();check(!seen.has(current.path),'Duplicate QOM composition path');seen.add(current.path);
  check(nodes.length<limits.nodes&&current.depth<=limits.depth,'QOM traversal bound');
  const props=properties(await send('qom-list',{path:current.path}));propertyCount+=props.length;
  check(propertyCount<=limits.totalProperties,'Total QOM property bound');
  const type=await send('qom-get',{path:current.path,property:'type'});
  check(typeof type==='string'&&type.length>0&&type.length<=256,'Invalid actual QOM type');
  if(current.declaredType!==null)check(type===current.declaredType,'Child and actual type differ');
  const row={path:current.path,parent:current.parent,type,properties:props,isDevice:deviceNames.has(type)};
  if(row.isDevice){
   check(props.some(p=>p.name==='realized'&&p.type==='bool'),'Device has no realized property');
   row.realized=await send('qom-get',{path:row.path,property:'realized'});check(typeof row.realized==='boolean','Nonboolean realized property');
   row.hotplugged=await send('qom-get',{path:row.path,property:'hotplugged'});check(typeof row.hotplugged==='boolean','Nonboolean hotplugged property');
   const bus=props.find(p=>p.name==='parent_bus');
   check(bus&&/^link<[^<>]+>$/.test(bus.type),'Missing parent_bus link');
   row.parentBus=await send('qom-get',{path:row.path,property:'parent_bus'});
   check(row.parentBus===''||pathOK(row.parentBus),'Invalid parent_bus path');
  }
  nodes.push(row);
  for(const p of props){
   if(!p.type.startsWith('child<'))continue;
   const match=p.type.match(/^child<([^<>]+)>$/);check(match,'Malformed QOM child type');
   const path=(current.path==='/'?'':current.path)+'/'+p.name;check(pathOK(path),'Invalid child path');
   check(queue.length+nodes.length<limits.nodes,'QOM queued-node bound');
   queue.push({path,parent:current.path,depth:current.depth+1,declaredType:match[1]});
  }
 }
 nodes.sort((a,b)=>compare(a.path,b.path));const devices=nodes.filter(n=>n.isDevice&&n.realized);
 check(devices.length>0,'No realized devices observed');
 check(devices.length===nodes.filter(n=>n.isDevice).length,'Partially realized device graph');
 for(const d of devices)if(d.parentBus!=='')check(seen.has(d.parentBus),'Device parent_bus is outside observed composition tree');
 const actualCPUs=devices.filter(n=>cpuNames.has(n.type));
 check(actualCPUs.length===1&&actualCPUs[0].path===cpus[0]['qom-path'],'CPU and QOM catalogues disagree');
 const apics=devices.filter(n=>n.type==='apic');
 check(apics.length===1&&apics[0].parent===actualCPUs[0].path&&apics[0].path===actualCPUs[0].path+'/lapic','Expected the sole CPU local APIC');
 check(!nodes.some(n=>n.type==='kvmvapic'),'Forbidden kvmvapic helper remains present');
 check(apics[0].properties.some(p=>p.name==='vapic'&&p.type==='bool'),'Missing native APIC vapic property');
 const apicConfig={path:apics[0].path,type:apics[0].type,vapic:await send('qom-get',{path:apics[0].path,property:'vapic'}),helperPresent:false};
 check(apicConfig.vapic===false,'Native APIC vapic property is not disabled');
 const machine=nodes.find(n=>n.path==='/machine');check(machine,'Missing machine root');
 const machineProperties={};
 for(const property of ['acpi','hpet','usb','smp','memory','memory-backend']){
  check(machine.properties.some(p=>p.name===property),'Missing machine property '+property);
  machineProperties[property]=await send('qom-get',{path:'/machine',property});
 }
 check(machineProperties.hpet===false&&machineProperties.usb===false&&['off',false].includes(machineProperties.acpi),'Requested disabled machine properties not effective');
 check(machineProperties.smp?.cpus===1&&machineProperties.smp?.maxcpus===1,'Effective CPU topology is not fixed1');
 check(machineProperties.memory?.size===512*1024*1024,'Effective RAM differs');
 check((machineProperties.memory.slots??0)===0&&
  (machineProperties.memory['max-size']??machineProperties.memory.size)===machineProperties.memory.size,'RAM slots/max-size differs');
 const memoryNodes=nodes.filter(n=>memoryNames.has(n.type));
 check(memoryNodes.length===1&&memoryNodes[0].type==='memory-backend-ram'&&
  memoryNodes[0].path===machineProperties['memory-backend'],'Expected one exact RAM backend linked to the machine');
 const memoryBackend={path:memoryNodes[0].path,type:memoryNodes[0].type,
  size:await send('qom-get',{path:memoryNodes[0].path,property:'size'}),
  share:await send('qom-get',{path:memoryNodes[0].path,property:'share'})};
 check(memoryBackend.size===512*1024*1024&&memoryBackend.share===false,'RAM backend size/share differs');
 const visibleBlock=await send('query-block');check(Array.isArray(visibleBlock)&&visibleBlock.length===0,'Visible block backend is present');
 const qtree=await send('human-monitor-command',{'command-line':'info qtree'});
 check(typeof qtree==='string'&&qtree.length>0&&new TextEncoder().encode(qtree).length<=limits.qtreeBytes,'Invalid/oversized qtree');
 const after=await send('query-status');prelaunch(after);
 const counts={};for(const row of devices)counts[row.type]=(counts[row.type]??0)+1;
 return {before,after,cpus,deviceTypes,cpuTypes,memoryTypes,nodes,devices,counts,machineProperties,memoryBackend,apicConfig,visibleBlock,qtree,
  completeness:{compositionRoot:'/',childEdgesOnly:true,allDeviceTypesFromQMP:true,objects:nodes.length,properties:propertyCount,
   hiddenBlockBackends:'unknown',nativeBlkAllNextVerified:false,eligibilityEstablished:false},
  scope:'Exact observed QOM composition/device graph before guest execution; hidden unnamed unattached BlockBackends remain unobservable. No lifecycle fence or ON acceptance.'};
}
