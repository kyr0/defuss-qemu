// The retained seven-mode MSG1 fixture against the installed release artifact.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {checkSerial, fixtureSourceSha256} from '../experiments/m2-sha-msg1/fixture-check.mjs';

const [packageDirectory, mode, tier, label] = process.argv.slice(2);
assert.ok(['on','off'].includes(mode));assert.ok(['hot','cold'].includes(tier));
assert.match(label || '', /^[a-z0-9-]+$/);
const packageRoot=resolve(packageDirectory), output=resolve('artifacts',label), fixture=resolve('artifacts/m2-msg1-guest-01');
mkdirSync(output);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={status:'failed',mode,tier,packageRoot,inputs:{},gates:[]};
let serial='',tail='',mod,port,marker=null,signal=false,finish,chain=Promise.resolve();
const done=new Promise(ok=>finish=ok),timer=setTimeout(()=>finish('Guest deadline'),300000);
const input=path=>{const data=readFileSync(path);report.inputs[path]=sha(data);return data;};
try {
  input(resolve('tests/candidate-isa.mjs'));
  input(resolve('experiments/m2-sha-msg1/fixture-check.mjs'));
  const manifest=JSON.parse(input(packageRoot+'/dist/manifest.json'));
  for(const [name,id] of Object.entries(manifest.files)) {
    const data=input(packageRoot+'/dist/'+name);assert.equal(data.length,id.bytes);assert.equal(sha(data),id.sha256);
  }
  const source=input(fixture+'/guest-fixture.c');assert.equal(sha(source),fixtureSourceSha256);
  const build=JSON.parse(input(fixture+'/build-report.json'));assert.equal(build.status,'passed');
  const initrd=input(fixture+'/initramfs.cpio.gz');assert.equal(sha(initrd),build.initramfsSha256);
  assert.equal(sha(input(fixture+'/fixture')),build.binarySha256);
  const {createQemu}=await import(pathToFileURL(packageRoot+'/dist/index.mjs'));
  const {Qmp}=await import(pathToFileURL(packageRoot+'/dist/host/browser/qmp.mjs'));
  const {attachCom1}=await import(pathToFileURL(packageRoot+'/dist/packaging/bun-app/serial.mjs'));
  const qmp=new Qmp(),decoder=new TextDecoder();
  function pump() {
    if(marker===null||!signal)return;
    const gate=marker;marker=null;signal=false;
    chain=chain.then(async()=>{
      await qmp.send('stop');assert.equal((await qmp.send('query-status')).running,false);
      assert.equal(gate,report.gates.length-1);
      assert.equal(mod._defuss_m2_msg1_status(),mode==='on'?0x10004:0x10003);
      report.gates.push(gate);port.write('K');await qmp.send('cont');
    }).catch(e=>finish(String(e.stack||e)));
  }
  createQemu({msg1:mode==='on',arguments:['-nodefaults','-machine','pc,acpi=off','-cpu','max','-accel','tcg,tb-size=128','-smp','1','-m','512','-display','none','-monitor','none','-qmp','stdio',
    '-chardev','file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1','-serial','chardev:fixture-com1','-serial','file:/guest/console.log','-parallel','none','-no-reboot','-L','/rom',
    '-kernel','/guest/kernel','-initrd','/guest/initramfs','-append','console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on'],
    printErr:text=>(report.stderr??=[]).push(String(text)),onAbort:e=>finish('Abort: '+e),
    onRuntimeInitialized(){
      const m=this;
      mod=m;assert.equal(m._defuss_m2_msg1_status(),mode==='on'?0x10002:0x10001);
      assert.equal(typeof m._defuss_m2_msg1_counts,'undefined');
      m._defuss_set_hot_limit(tier==='cold'?65535:1500);m._defuss46_settings(2);
      m.FS.mkdir('/guest');m.FS.mkdir('/rom');m.FS.writeFile('/guest/kernel',input(resolve('assets/bun/amd64/vmlinuz-virt')));
      m.FS.writeFile('/guest/initramfs',initrd);
      for(const name of ['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'])m.FS.writeFile('/rom/'+name,input(packageRoot+'/dist/firmware/'+name));
      port=attachCom1(m,data=>{if(data.length!==1||data[0]!==71||signal){finish('Invalid fixture COM1 gate');return;}signal=true;pump();});
      m.FS.writeFile('/guest/console.log',new Uint8Array());
      const node=m.FS.lookupPath('/guest/console.log').node,ops=node.stream_ops;
      node.stream_ops={...ops,write(s,b,o,n,p){
        const count=ops.write(s,b,o,n,p),text=decoder.decode(new Uint8Array(b.subarray(o,o+count)),{stream:true});serial+=text;tail+=text;
        if(serial.length>16777216){finish('Unbounded fixture output');return count;}
        let end;while((end=tail.indexOf('\n'))>=0){
          const line=tail.slice(0,end).replace(/\r/g,'');tail=tail.slice(end+1);
          if(line.includes('FIXTURE_FAIL')||line.includes('Kernel panic'))finish(line);
          const gate=line.match(/^MSG1_GATE:(-?\d+)$/);
          if(gate){assert.equal(marker,null);marker=Number(gate[1]);pump();}
          if(line==='FIXTURE_PASS')finish('pass');
        }return count;
      }};
      m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;
      const write=m.TTY.stream_ops.write;
      m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){qmp.accept(b.subarray(o,o+n));return n;}return write(s,b,o,n,p);};
    }}).catch(e=>finish(String(e.stack||e)));
  await Promise.race([qmp.greeting,done.then(reason=>{throw Error(reason);})]);await qmp.send('qmp_capabilities');
  assert.equal(await done,'pass');await chain;await qmp.send('stop');
  report.serialContract=checkSerial(serial);assert.equal(report.gates.length,8);
  report.lateConfigurationResult=mod._defuss_m2_msg1_config(mode==='on'?0:1);assert.equal(report.lateConfigurationResult,-1);
  report.finalStatus=mod._defuss_m2_msg1_status();assert.equal(report.finalStatus,mode==='on'?0x10004:0x10003);
  for(const [path,hash]of Object.entries(report.inputs))assert.equal(sha(readFileSync(path)),hash);
  report.status='passed';
} catch(error) {report.failure=String(error.stack||error);}
clearTimeout(timer);writeFileSync(output+'/serial.log',serial);writeFileSync(output+'/report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,mode,tier,output,failure:report.failure}));
process.exit(report.status==='passed'?0:1);
