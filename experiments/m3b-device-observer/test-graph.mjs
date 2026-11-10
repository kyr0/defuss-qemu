import test from 'node:test';
import assert from 'node:assert/strict';
import {observeGraph,validateCommand} from './graph.mjs';
function fixture(){
 const tree={
  '/':{type:'container',children:{machine:'pc-i440fx-test-machine',objects:'container'}},
  '/machine':{type:'pc-i440fx-test-machine',children:{'cpu[0]':'max-x86_64-cpu',bus:'System',bridge:'i440FX'},
   values:{acpi:'off',hpet:false,usb:false,smp:{cpus:1,maxcpus:1},memory:{size:536870912},'memory-backend':'/objects/pc.ram'}},
  '/objects':{type:'container',children:{'pc.ram':'memory-backend-ram'}},
  '/objects/pc.ram':{type:'memory-backend-ram',values:{size:536870912,share:false}},
  '/machine/cpu[0]':{type:'max-x86_64-cpu',device:true,values:{realized:true,hotplugged:false,parent_bus:''}},
  '/machine/bus':{type:'System'},
  '/machine/bridge':{type:'i440FX',device:true,values:{realized:true,hotplugged:false,parent_bus:'/machine/bus'}},
 };
 const f={tree,status:{running:false,status:'prelaunch'},visibleBlock:[],calls:[]};
 f.send=async(command,args={})=>{
  validateCommand(command,args);f.calls.push({command,args});
  if(command==='query-status')return structuredClone(f.status);
  if(command==='query-cpus-fast')return [{'cpu-index':0,'qom-path':'/machine/cpu[0]'}];
  if(command==='qom-list-types')return (args.implements==='cpu'?['max-x86_64-cpu']:args.implements==='memory-backend'?
   ['memory-backend-ram','memory-backend-file']:['max-x86_64-cpu','i440FX']).map(name=>({name}));
  if(command==='query-block')return structuredClone(f.visibleBlock);
  if(command==='human-monitor-command')return 'bus: main-system-bus\n';
  const node=tree[args.path];assert.ok(node,args.path);
  if(command==='qom-get')return structuredClone(args.property==='type'?node.type:node.values[args.property]);
  if(command==='qom-list')return [{name:'type',type:'string'},
   ...Object.entries(node.children??{}).map(([name,type])=>({name,type:'child<'+type+'>'})),
   ...Object.entries(node.values??{}).map(([name,value])=>({name,type:name==='parent_bus'?'link<bus>':typeof value==='boolean'?'bool':typeof value}))];
  throw Error('Unexpected mock command');
 };return f;
}
test('captures the full composition graph with exact device/CPU/bus identities and honest backend gap',async()=>{
 const f=fixture(),r=await observeGraph(f.send);assert.equal(r.nodes.length,7);assert.equal(r.devices.length,2);
 assert.equal(r.devices.find(d=>d.type==='i440FX').parentBus,'/machine/bus');
 assert.deepEqual(r.counts,{i440FX:1,'max-x86_64-cpu':1});
 assert.equal(r.completeness.nativeBlkAllNextVerified,false);assert.equal(r.completeness.hiddenBlockBackends,'unknown');
 assert.deepEqual(r.memoryBackend,{path:'/objects/pc.ram',type:'memory-backend-ram',size:536870912,share:false});
 assert.ok(f.calls.every(c=>!['cont','stop','qom-set','device_add'].includes(c.command)));
});
test('command allowlist rejects execution, writes, alternate HMP and argument substitutions',()=>{
 for(const [c,a] of [['cont',{}],['stop',{}],['qom-set',{path:'/machine',property:'hpet',value:true}],
  ['human-monitor-command',{'command-line':'info qtree; cont'}],['qmp_capabilities',{enable:['oob']}],
  ['qom-list',{path:'/machine/../'}],['qom-get',{path:'/machine',property:'unsafe'}]])assert.throws(()=>validateCommand(c,a));
});
test('rejects running, changed machine settings, extra backend and broken parent bus',async()=>{
 for(const mutate of [f=>{f.status.running=true;},f=>{f.tree['/machine'].values.hpet=true;},
  f=>{f.tree['/machine'].values.smp.maxcpus=2;},f=>{f.visibleBlock=[{}];},
  f=>{f.tree['/machine/bridge'].values.parent_bus='/missing';},
  f=>{f.tree['/machine/bridge'].values.realized=false;},
  f=>{f.tree['/objects/pc.ram'].values.share=true;},
  f=>{f.tree['/objects'].children['pc.ram']='memory-backend-file';f.tree['/objects/pc.ram'].type='memory-backend-file';},
  f=>{f.tree['/machine'].values.memory.slots=1;},
  f=>{f.tree['/machine/cpu[0]'].values.realized=1;}]){
  const f=fixture();mutate(f);await assert.rejects(observeGraph(f.send));
 }
});
test('rejects duplicate properties, child type drift and bounded traversal overflow',async()=>{
 for(const mode of ['duplicate','type','depth']){
  const f=fixture(),original=f.send;
  if(mode==='depth'){
   let path='/';f.tree['/']={type:'container',children:{next:'container'}};
   for(let i=0;i<34;i++){path=(path==='/'?'':path)+'/next';f.tree[path]={type:'container',children:{next:'container'}};}
  }
  f.send=async(c,a)=>{const result=await original(c,a);if(c==='qom-list'&&a.path==='/'&&mode==='duplicate')result.push({...result[0]});
   if(c==='qom-get'&&a.path==='/machine/bridge'&&a.property==='type'&&mode==='type')return 'different';return result;};
  await assert.rejects(observeGraph(f.send));
 }
});
